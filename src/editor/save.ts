import { saveFile } from '@/export/download';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { canUseFilePicker } from '@/utils/env';
// 这里**只读**当前句柄，不写：另存拿到的新句柄由 `runSave` 在 openEpoch
// 守卫之后登记（理由见下方 performSave 头部）
import { ensureFileWritePermission, getCurrentFileHandle } from '@/utils/file-open';
import { createLogger } from '@/utils/logger';
import { hasHostChannel, requestHostWrite } from './host-write';
import { decideSaveTarget } from './save-target';
import { recordSelfWrite } from './self-write';
import { createVersionBuffer, type VersionBuffer } from './versions';

const log = createLogger('save');

/** 保存前的版本缓冲，容量随设置变化时重建 */
let buffer: VersionBuffer = createVersionBuffer(5);
let bufferCapacity = 5;
/**
 * 这份缓冲属于**哪一次打开**（`document.store` 的 `openEpoch`）。
 * 初值 -1 表示「还没跟任何一次打开绑定过」，第一次取用时被认领。
 */
let bufferEpoch = -1;

/**
 * 取当前的版本缓冲：容量跟随设置，内容跟随「这一次打开」。
 *
 * ## 为什么换文档必须清空
 *
 * 缓冲里存的是会被**原样灌回编辑器**的正文（工具栏的「回到上一个保存
 * 版本」，见 `useSaveCommands.restorePreviousVersion`），而那个菜单项只按
 * `mode === 'edit'` 置灰，并不问「缓冲里这一份是谁的」。不清的话：甲保存过
 * 一次 → 换到乙 → 在乙上点它 → 甲的正文进了乙的编辑器 → 文本一变即为脏 →
 * 800ms 后自动保存把**甲的内容写进乙的文件**。用户从没编辑过乙，也没有
 * 回收站。`runSave` 的 openEpoch 守卫堵的是「写盘期间换文档」那条入口，
 * 这里堵的是同一个后果的第二条入口，用的是同一个判据。
 *
 * ## 为什么按 openEpoch 而不是 documentId
 *
 * 同一篇文档重新打开也是新的一次打开：那时编辑器里已经是磁盘上的内容，
 * 上一次打开留下的「保存前版本」对它不再成立，弹回去等于凭空改一篇
 * 用户刚打开、还没动过的文档。判据与 `useReadingPosition` 的闩锁同源。
 */
function versionBuffer(): VersionBuffer {
  const capacity = useSettingsStore.getState().settings.editor.keepVersions;
  if (capacity !== bufferCapacity) {
    // 容量变小时旧缓冲直接丢弃而不是搬运截断：这只是「最多留几份后悔药」
    // 的设置变化，不值得为了保留几条旧历史而复杂化
    buffer = createVersionBuffer(capacity);
    bufferCapacity = capacity;
  }

  const epoch = useDocumentStore.getState().openEpoch;
  if (epoch !== bufferEpoch) {
    // 用 clear() 而不是重建一个：容量是另一件事，不该被「换了文档」顺手改掉
    buffer.clear();
    bufferEpoch = epoch;
  }
  return buffer;
}

/** 回到上一个保存版本；没有历史时返回 null */
export function popPreviousVersion(): string | null {
  return versionBuffer().pop();
}

/**
 * 把一份内容推进版本缓冲，但不写盘。
 *
 * 唯一调用点是冲突提示里「用磁盘的」那个选择（见 `ConflictBanner`）：
 * 磁盘内容即将覆盖编辑器，而编辑器里那份还没保存的改动一旦被覆盖就再也
 * 找不回来——版本缓冲是它唯一的后悔药，所以必须在覆盖**之前**调用这个函数，
 * 调用顺序反了这份改动就无声丢失了。
 */
export function pushVersionBeforeOverwrite(content: string): void {
  versionBuffer().push(content);
}

export type SaveOutcome =
  /**
   * 写回了原文件。
   *
   * `permissionGranted` 为真表示这次保存顺带申请到了写权限（needs-permission
   * 分支）。要不要把它记进 store 由调用方决定——理由见下面「本函数不写全局
   * 状态」那一段。
   */
  | { kind: 'saved'; lastModified: number; permissionGranted: boolean }
  /**
   * 弹出过保存对话框，另存成了一份新文件。
   *
   * `handle` 是这份新文件的句柄，调用方凭它把「另存」升格成「往后可以静默
   * 写回」；为 null 表示这次没拿到（`saveFile` 的 `via: 'picker'` 并不保证
   * 一定带句柄，见 `ExportResult.handle`）。
   */
  | { kind: 'saved-as'; handle: FileSystemFileHandle | null; filename: string }
  /**
   * 保存对话框弹不出来（跨源 iframe、或用户手势已过期），退到了浏览器下载。
   *
   * 与 `saved-as` **必须分开**：文件落在下载目录，而**原文件一个字节都没有
   * 改动**。合成一种的话，调用方会照着「已保存」去清脏状态，用户于是得到
   * 一条「已保存」的提示、一个不再拦截关页的标签页，和一个原封未动的文件。
   */
  | { kind: 'downloaded'; filename: string }
  /**
   * 宿主代劳写回时，在动手**之前**发现磁盘已被别的程序改过，这次
   * 一个字节都没写。
   *
   * 与 `conflict-pending` 分开：那一种是本应用自己早已知道冲突（由
   * `decideRefresh` 判出、提示条正挂着），而这一种是「我们以为磁盘还是
   * 老样子、直到写之前才发现不是」——接管路径上 `useAutoRefresh` 根本不
   * 轮询，除了宿主这一道自检没有任何别的地方能发现它。
   */
  | { kind: 'host-stale'; message: string }
  | { kind: 'skipped' }
  /** 冲突未决，这次保存没有发生（见 `decideSaveTarget` 的 conflict 分支） */
  | { kind: 'conflict-pending' }
  | { kind: 'cancelled' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/**
 * 执行一次保存。
 *
 * ## 本函数不写任何全局状态
 *
 * 它只读一次 store（进入时那一眼）、只动磁盘，结果一律以返回值交出去，
 * 由 `runSave` 在 openEpoch 守卫**之后**落点。这条是硬约束，不是风格偏好：
 * 写盘与弹对话框都要 await，而 await 期间用户完全可以换一篇文档（切换前的
 * 未保存确认框就是入口）。曾经 save-as 分支在 await 之后直接
 * `setCurrentFileHandle(result.handle)`，后果实测如下：另存进行中换到乙，
 * 落定后「当前文件句柄」变成甲刚另存出来的那个文件，于是**乙的下一次自动
 * 保存写进了甲的新文件**。needs-permission 分支的 `setWritable(true)` 是
 * 同一类：授权框弹着的时候换到乙，乙会顶着一份对它并不成立的写权限。
 *

 * @param text 要写入的文本，直接来自编辑器——**不做任何规整**。
 *   导出 Markdown 时会走 `normalizeMarkdown` 整理空白，但那是「导出」这个
 *   动作的一部分；保存是把用户的文件写回去，改动一个字符都是越界。
 * @param automatic 是否由定时器触发。两个调用方都在 `hooks/useAutoSave.ts`：
 *   停笔后的防抖定时器传 true，⌘S 与工具栏的「保存」传 false。
 */
export async function performSave(text: string, automatic: boolean): Promise<SaveOutcome> {
  const state = useDocumentStore.getState();
  const doc = state.document;
  if (!doc) return { kind: 'skipped' };

  const target = decideSaveTarget({
    dirty: text !== doc.content,
    handle: getCurrentFileHandle(),
    writable: state.writable,
    canUsePicker: canUseFilePicker(),
    // 接管页面上没有本地句柄，写权限落在「宿主已授权代劳」这件事上
    hostWritable: hasHostChannel() && state.writable,
    automatic,
    conflictPending: state.conflict !== null,
  });

  switch (target.kind) {
    case 'clean':
      return { kind: 'skipped' };

    case 'conflict':
      return { kind: 'conflict-pending' };

    case 'needs-permission': {
      // decideSaveTarget 保证走到这里时 automatic 一定是 false（见
      // save-target.ts），也就是手动保存。手动保存的两个入口——⌘S 与工具栏
      // 的「保存」按钮——都在用户手势的调用栈内（快捷键 handler 就是按钮的
      // onSelect 本身），因此这里可以放心调用需要手势的 requestPermission
      const outcome = await ensureFileWritePermission(target.handle, true);
      if (outcome !== 'granted') return { kind: 'denied' };
      // 申请到的写权限以返回值交出去，不在这里落进 store（见函数头部）
      return writeThrough(target.handle, text, doc.content, true);
    }

    case 'write':
      return writeThrough(target.handle, text, doc.content, false);

    case 'host-write': {
      // 先留后悔药再动磁盘，与 writeThrough 同理：写失败了缓冲里多一版无害，
      // 写成功了没留就没救了
      pushVersionBeforeOverwrite(doc.content);

      /*
       * 把我们认为的磁盘时间戳一并交过去，宿主写之前拿它比对真实值。
       * 这是这条路径上**唯一**的冲突闸门（理由见 SaveOutcome 的 host-stale）。
       */
      const result = await requestHostWrite(text, doc.lastModified);
      if (result.kind === 'written') {
        return { kind: 'saved', lastModified: result.lastModified, permissionGranted: false };
      }
      if (result.stale) return { kind: 'host-stale', message: result.message };
      return { kind: 'error', message: result.message };
    }

    case 'save-as':
    case 'download': {
      const result = await saveFile(
        doc.name,
        new Blob([text], { type: 'text/markdown;charset=utf-8' }),
        {
          description: 'Markdown 文件',
          accept: { 'text/markdown': ['.md', '.markdown'] },
        },
      );
      if (result.status === 'cancelled') return { kind: 'cancelled' };
      if (result.status === 'error') return { kind: 'error', message: result.message };

      /*
       * `saveFile` 的两种成功是**两件不同的事**，这里必须原样传下去：
       * `picker` 是用户在对话框里挑了位置、文件真的存到了那里；
       * `download` 是对话框压根没弹出来（跨源 iframe，或用户手势过期），
       * 文件被 `<a download>` 丢进了浏览器下载目录，**原文件一个字节没变**。
       *
       * 导出那一路（`useExport.report`）一直是分开报的；保存这一路曾经把
       * `via` 整个丢掉，两种都返回 `saved-as`，于是「浏览器直开 .md 时按
       * ⌘S」这条最常用的路径上，用户看到的是「已另存为 x.md」、脏状态被
       * 清零、关页不再拦截，而他的文件没有被改动过。
       *
       * 句柄只在 picker 那条路上才有；下载没有句柄可带，也不该动「当前
       * 文件」——文件落进下载目录，与当前打开的这一篇是两回事。
       */
      if (result.via === 'download') return { kind: 'downloaded', filename: result.filename };

      return { kind: 'saved-as', handle: result.handle ?? null, filename: result.filename };
    }
  }
}

/**
 * 写回一个已授权的句柄。
 *
 * @param permissionGranted 这次写回之前是否**刚刚**申请到写权限，原样放进
 *   返回值交给调用方；本函数不碰 store（理由见 `performSave` 头部）
 */
async function writeThrough(
  handle: FileSystemFileHandle,
  text: string,
  previous: string,
  permissionGranted: boolean,
): Promise<SaveOutcome> {
  try {
    // 先留后悔药再动磁盘：写失败了缓冲里多一版无害，写成功了没留就没救了
    versionBuffer().push(previous);

    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();

    // 读回时间戳并登记，让自动刷新认出这是我们自己写的（见 self-write.ts）
    const file = await handle.getFile();
    recordSelfWrite(text, file.lastModified);
    return { kind: 'saved', lastModified: file.lastModified, permissionGranted };
  } catch (error) {
    log.error('写回文件失败', error);
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
