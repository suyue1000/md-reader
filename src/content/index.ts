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
