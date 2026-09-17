import { EMBED_FLAG, isViewerMessage, type HostMessage, type LoadMessage } from './protocol';
import { scanDirectory } from '@/utils/directory';
import { getFileHandleByPath } from '@/utils/file-open';
import { wellKnownStartIn } from '@/utils/start-in';

/**
 * Markdown 页面接管。
 *
 * 浏览器打开 `.md` 时会把它当纯文本渲染成一个 `<pre>`。这个脚本把整页
 * 换成一个指向 `viewer.html` 的全屏 iframe，再把已经在页面里的源文本
 * 递进去——**地址栏保持原样**，仍是那个 `file:///…/xxx.md#锚点`。
 *
 * 为什么用 iframe 而不是把阅读器直接注入页面：
 * 1. 内容脚本是普通脚本，不支持 `import()`，而整条渲染管线（Shiki、
 *    Mermaid、KaTeX）全靠动态导入按需加载，注入进来就得全量打包；
 * 2. iframe 里是扩展页面，享有扩展的 CSP 与权限，行为和从工具栏打开
 *    阅读器完全一致，不必为「页面内」再维护一套分支。
 *
 * 为什么不重定向到 `viewer.html?src=…`：那样地址栏会变成
 * `chrome-extension://…`，书签、分享出去的链接、以及页面里的相对链接
 * 全部失效，而这恰恰是「在浏览器里打开 md」最常用的场景。
 *
 * 源文本直接取自已经渲染出来的 `<pre>`，不再去 fetch 一次：既省一次读取，
 * 也避免为 `file:///*` 申请主机权限。
 */

/** 只接管这些扩展名 */
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

/** 设置在 chrome.storage 里的位置，与 utils/storage.ts 保持一致 */
const SETTINGS_AREA = 'sync';
const SETTINGS_KEY = 'settings';

/** 挂到页面上的 iframe id，用于避免重复接管 */
const FRAME_ID = 'md-reader-frame';

/**
 * 本次接管的一次性令牌（见 protocol.ts 的 `LoadMessage.nonce`）。
 *
 * 阅读器发回来的消息里，凡是会读写用户文件的都必须带上它。
 */
const NONCE = crypto.randomUUID();

/**
 * 代阅读器握着的当前文件句柄；null 表示还没授权过。
 *
 * 句柄**留在宿主这一侧**，与目录句柄同理：文件系统权限是按源授予的，
 * 传给 `chrome-extension://` 那边就成了一个没有权限的对象，而那一侧恰恰
 * 弹不出授权框。跨越边界的始终只有普通数据。
 */
let writeHandle: FileSystemFileHandle | null = null;

/**
 * 丢掉代劳句柄。
 *
 * **生产代码没有调用点，只有测试在用**——用来构造「还没授权过」这一情形，
 * 以及避免用例之间互相污染。如实记在这里，理由与 `editor/self-write.ts` 的
 * `clearSelfWrites` 相同：让读代码的人不必猜它是不是被谁漏掉了。
 */
export function clearWriteHandle(): void {
  writeHandle = null;
}

/** 当前地址是否指向一个 Markdown 文件 */
function isMarkdownUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lower = decodeURIComponent(pathname).toLowerCase();
    return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension));
  } catch {
    return false;
  }
}

/**
 * 当前页面是不是「浏览器把 md 当纯文本渲染」的那种页面。
 *
 * 必须确认，否则会把恰好以 .md 结尾的 HTML 页面也一并吃掉。
 * 浏览器渲染纯文本时会生成一个只含单个 `<pre>` 的文档。
 */
function isPlainTextRender(): boolean {
  const type = document.contentType.toLowerCase();
  if (type !== 'text/plain' && type !== 'text/markdown') return false;
  return document.body.children.length === 1 && document.body.firstElementChild?.tagName === 'PRE';
}

/** 从地址里取出文件名 */
function fileNameFrom(url: string): string {
  try {
    const segments = decodeURIComponent(new URL(url).pathname).split('/');
    return segments[segments.length - 1] || 'document.md';
  } catch {
    return 'document.md';
  }
}

/** 读取「是否接管」这一项设置；读不到时按开启处理 */
async function takeoverEnabled(): Promise<boolean> {
  try {
    const stored = await chrome.storage[SETTINGS_AREA].get(SETTINGS_KEY);
    const settings = stored[SETTINGS_KEY] as
      | { advanced?: { takeoverMarkdownPages?: boolean } }
      | undefined;
    return settings?.advanced?.takeoverMarkdownPages ?? true;
  } catch {
    // 存储读不到不该让功能直接失效，按默认开启走
    return true;
  }
}

/**
 * 代阅读器弹出目录选择器并扫描。
 *
 * 目录句柄**留在宿主页面这一侧**，只把扫描出来的纯数据树发给 iframe。
 * 不把句柄 postMessage 过去，是因为文件系统权限是按源授予的：句柄传到
 * `chrome-extension://` 那边就成了一个没有权限的对象，还得再授权一次，
 * 而那一侧恰恰弹不出授权框。文件内容改由这边按需读取回传，
 * 跨越边界的始终只有普通数据。
 */
async function pickFolder(reply: (message: HostMessage) => void): Promise<void> {
  if (typeof showDirectoryPicker !== 'function') {
    reply({
      type: 'md-reader:folder-error',
      message: '当前浏览器不支持打开文件夹',
      cancelled: false,
    });
    return;
  }

  // 从当前文件的路径认出它属于哪个知名目录，让选择器落在正确的那一支上。
  // 浏览器不接受任意路径作为起始位置，这是能给出的最精确的提示
  const startIn = wellKnownStartIn(location.href);

  let root: FileSystemDirectoryHandle;
  try {
    // 用户在 iframe 里的点击会把短暂用户激活传播给祖先帧，
    // 因此这里仍然握着有效手势，选择器能正常弹出。
    //
    // 固定的 id 让浏览器记住上次选过的目录：第一次靠 startIn 落到大方向上，
    // 之后每次都会直接停在上次选中的那个目录
    root = await showDirectoryPicker({
      id: 'md-reader-folder',
      mode: 'read',
      ...(startIn ? { startIn } : {}),
    });
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    reply({
      type: 'md-reader:folder-error',
      message: error instanceof Error ? error.message : String(error),
      cancelled,
    });
    return;
  }

  try {
    const result = await scanDirectory(root);
    reply({
      type: 'md-reader:folder',
      rootName: result.root.name,
      tree: result.root.children ?? [],
      fileCount: result.fileCount,
      truncated: result.truncated,
      paths: [...result.paths],
    });
  } catch (error) {
    reply({
      type: 'md-reader:folder-error',
      message: error instanceof Error ? error.message : String(error),
      cancelled: false,
    });
  }
}

/**
 * 代阅读器弹出文件选择器，授权写回**当前这篇**文档。
 *
 * 为什么要用户亲手再选一次自己正看着的文件：File System Access API 没有
 * 「由 URL 换取句柄」的能力，句柄只能来自一次真实的选择器交互。
 *
 * 这里只关第一道闸（文件名）——它挡的是「用户选错了另一个文件」，那会把
 * 甲的内容写进乙，不可逆且没有回收站。第二道闸（磁盘内容是否与页面上那份
 * 一致）放在阅读器侧：只有它手里有当前正文。本函数负责把磁盘上的**真实
 * 字节**原样回传过去供它比对。
 *
 * 文件名比对依赖 `fileNameFrom` 已经做过 `decodeURIComponent`：`location.href`
 * 里的中文是百分号编码的，而 `handle.name` 是解码后的原文，不解码这道闸会
 * **永远拒绝**，功能一次都用不了。
 *
 * ## 为什么这个函数是导出的
 *
 * 生产代码里没有第二个调用点，导出纯粹是为了让测试够得着——这两道闸挡的是
 * 「把甲的内容写进乙」和「覆盖掉别的程序刚写进去的东西」，都是不可逆且没有
 * 回收站的事，不该只靠人工验收。同样的如实标注见 `editor/self-write.ts` 的
 * `clearSelfWrites`。
 *
 * import 本模块在测试环境里是安全的：末尾那次 `main()` 会在三道守卫上早退
 * （jsdom 的 location 不是 `.md`，`document.contentType` 也不是 `text/plain`），
 * 实测 import 不会接管页面。
 */
export async function grantWrite(reply: (message: HostMessage) => void): Promise<void> {
  if (typeof showOpenFilePicker !== 'function') {
    reply({
      type: 'md-reader:write-denied',
      reason: '当前浏览器不支持写回本地文件',
      cancelled: false,
    });
    return;
  }

  /*
   * 让选择器尽量开在离目标近的地方。
   *
   * 浏览器**不接受任意路径**作为起始位置，只认几个知名目录常量或一个已经
   * 拿到的句柄——而这里手上只有一个 `file://` 地址。于是与 `pickFolder` 用
   * 同一招：认出它属于哪个知名目录，至少落在正确的那一支上。
   *
   * 固定的 `id` 是另一半：浏览器会记住这个 id 上次选过的目录，第一次靠
   * `startIn` 落到大方向，之后每次直接停在上次那个目录。
   */
  const startIn = wellKnownStartIn(location.href);

  let picked: FileSystemFileHandle | undefined;
  try {
    // 用户在 iframe 里的点击会把短暂用户激活传播给祖先帧，这里仍握着手势
    [picked] = await showOpenFilePicker({
      id: 'md-reader-write',
      multiple: false,
      ...(startIn ? { startIn } : {}),
      types: [
        {
          description: 'Markdown 文件',
          accept: { 'text/markdown': MARKDOWN_EXTENSIONS },
        },
      ],
    });
  } catch (error) {
    const cancelled = error instanceof DOMException && error.name === 'AbortError';
    reply({
      type: 'md-reader:write-denied',
      reason: cancelled ? '已取消授权' : error instanceof Error ? error.message : String(error),
      cancelled,
    });
    return;
  }

  // 选择器正常返回时数组一定非空，但类型上是可选的；不判的话下面对
  // picked.name 的校验会在类型层面失守，而那正是防止写错文件的第一道闸
  if (!picked) {
    reply({ type: 'md-reader:write-denied', reason: '没有选中任何文件', cancelled: true });
    return;
  }

  const expected = fileNameFrom(location.href);
  if (picked.name !== expected) {
    /*
     * 硬拒绝而不是提示后放行：放行一次的代价是把这篇文档的内容写进另一个
     * 文件。同名不同目录这一道闸挡不住，那由阅读器侧的内容比对兜底。
     */
    reply({
      type: 'md-reader:write-denied',
      reason: `选中的是 ${picked.name}，与当前文档 ${expected} 不是同一个文件`,
      cancelled: false,
    });
    return;
  }

  try {
    const file = await picked.getFile();
    const content = await file.text();
    writeHandle = picked;
    reply({ type: 'md-reader:write-granted', content, lastModified: file.lastModified });
  } catch (error) {
    reply({
      type: 'md-reader:write-denied',
      reason: error instanceof Error ? error.message : String(error),
      cancelled: false,
    });
  }
}

/**
 * 代阅读器把文本写回原文件。
 *
 * 写之前必须自检磁盘时间戳：嵌入模式的文档 `source` 是 'url'，而
 * `useAutoRefresh` 只对 'fs-handle' 轮询，于是整套冲突检测在这条路径上根本
 * 不运行（`decideSaveTarget` 的 `conflictPending` 永远是 null）。不在这里挡
 * 一道，代劳写回就会静默覆盖别的程序刚写进去的内容。
 *
 * 这道闸同样没有自动化测试，理由见 `grantWrite` 的「覆盖缺口」一节。
 */
export async function writeCurrentFile(
  text: string,
  baseModified: number,
  reply: (message: HostMessage) => void,
): Promise<void> {
  if (!writeHandle) {
    reply({ type: 'md-reader:write-error', message: '尚未授权写回', stale: false });
    return;
  }

  try {
    const before = await writeHandle.getFile();
    if (before.lastModified !== baseModified) {
      reply({
        type: 'md-reader:write-error',
        message: '磁盘上的文件已被其它程序改动',
        stale: true,
      });
      return;
    }

    const writable = await writeHandle.createWritable();
    await writable.write(text);
    await writable.close();

    // 读回真实时间戳交给阅读器，作为下一次写入的比对基线
    const after = await writeHandle.getFile();
    reply({ type: 'md-reader:write-ok', lastModified: after.lastModified });
  } catch (error) {
    reply({
      type: 'md-reader:write-error',
      message: error instanceof Error ? error.message : String(error),
      stale: false,
    });
  }
}

/** 读取工作区里的某个文件并回传内容 */
async function readWorkspaceFile(
  path: string,
  reply: (message: HostMessage) => void,
): Promise<void> {
  const handle = getFileHandleByPath(path);
  if (!handle) {
    reply({ type: 'md-reader:file-error', path, message: '该文件已不在工作区里' });
    return;
  }

  try {
    const file = await handle.getFile();
    reply({
      type: 'md-reader:file',
      path,
      name: file.name,
      content: await file.text(),
      lastModified: file.lastModified,
      size: file.size,
    });
  } catch (error) {
    reply({
      type: 'md-reader:file-error',
      path,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** 用阅读器 iframe 替换整个页面 */
function takeOver(source: string): void {
  if (document.getElementById(FRAME_ID)) return;

  const viewerUrl = new URL(chrome.runtime.getURL('viewer.html'));
  viewerUrl.searchParams.set(EMBED_FLAG, '1');

  const frame = document.createElement('iframe');
  frame.id = FRAME_ID;
  frame.src = viewerUrl.toString();
  frame.setAttribute('allow', 'clipboard-write');
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;margin:0;';

  const payload: LoadMessage = {
    type: 'md-reader:load',
    name: fileNameFrom(location.href),
    url: location.href,
    content: source,
    hash: location.hash,
    nonce: NONCE,
  };

  /** 往 iframe 里发一条消息 */
  const reply = (message: HostMessage): void => {
    // iframe 的源是 chrome-extension://，用它做 targetOrigin 而不是 '*'
    frame.contentWindow?.postMessage(message, viewerUrl.origin);
  };

  window.addEventListener('message', (event) => {
    // 只认自家 iframe 发来的消息
    if (event.source !== frame.contentWindow) return;
    if (!isViewerMessage(event.data)) return;

    switch (event.data.type) {
      case 'md-reader:ready':
        reply(payload);
        return;

      case 'md-reader:hash':
        // 阅读器内跳转标题时同步地址栏，但用 replaceState 而不是新增历史记录——
        // 否则读一篇长文点十次目录，返回键要按十次才能离开
        history.replaceState(null, '', `${location.pathname}${location.search}${event.data.hash}`);
        return;

      case 'md-reader:pick-folder':
        void pickFolder(reply);
        return;

      case 'md-reader:read-file':
        void readWorkspaceFile(event.data.path, reply);
        return;

      /*
       * 下面两条会读写用户的真实文件，因此逐条核对令牌。
       * `EMBED_FLAG` 只是一个 URL 查询参数，任何页面都能构造一个
       * `viewer.html?embed=1` 的 iframe 冒充对话；令牌由本次接管随机生成，
       * 只经 postMessage 送给自己那个 iframe，第三方拿不到。
       */
      case 'md-reader:grant-write':
        if (event.data.nonce !== NONCE) return;
        void grantWrite(reply);
        return;

      case 'md-reader:write-file':
        if (event.data.nonce !== NONCE) return;
        void writeCurrentFile(event.data.text, event.data.baseModified, reply);
        return;
    }
  });

  // 纯文本页面的 html/body 带着浏览器给的默认边距，一并清掉
  document.documentElement.style.cssText = 'margin:0;padding:0;height:100%;overflow:hidden;';
  document.body.style.cssText = 'margin:0;padding:0;height:100%;overflow:hidden;';
  document.body.replaceChildren(frame);
}

/** 入口 */
function main(): void {
  if (window.top !== window.self) return; // 不接管嵌套的 iframe
  if (!isMarkdownUrl(location.href)) return;
  if (!isPlainTextRender()) return;

  // 先把源文本取出来：接管之后原始 DOM 就没了
  const source = document.body.textContent ?? '';
  if (source.trim() === '') return;

  void takeoverEnabled().then((enabled) => {
    if (enabled) takeOver(source);
  });
}

main();
