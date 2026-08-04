import type { DocumentSource, MarkdownDocument } from '@/types';
import { canUseFilePicker } from './env';
import { createLogger } from './logger';

const log = createLogger('file-open');

/** 阅读器识别的 Markdown 扩展名 */
export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mdx', '.txt'];

/** 用户取消选择时抛出的哨兵错误，调用方据此静默返回 */
export class FilePickerCancelled extends Error {
  constructor() {
    super('用户取消了文件选择');
    this.name = 'FilePickerCancelled';
  }
}

/**
 * 当前文档对应的文件句柄。
 *
 * 单独存在模块作用域而不是塞进 store：句柄是不可序列化的宿主对象，
 * 放进 Zustand 会污染状态快照，也无法参与持久化。
 * Phase 6 的自动刷新与 Phase 7 的文件夹浏览都从这里取。
 */
let currentFileHandle: FileSystemFileHandle | null = null;

/** 读取当前文件句柄 */
export function getCurrentFileHandle(): FileSystemFileHandle | null {
  return currentFileHandle;
}

/**
 * 路径 -> 文件句柄的登记表。
 *
 * 「最近打开」「收藏」「相对链接跳转」都只记录路径，真正打开时来这里换句柄。
 * 放在这里而不是目录模块里，是为了让依赖方向保持单一：目录扫描依赖
 * 文件模块，反过来不成立。
 *
 * 句柄无法序列化，因此这张表只在当前页面生命周期内有效——刷新后
 * 需要重新打开文件或文件夹。UI 会据此判断某条历史记录是否可点。
 */
const handleRegistry = new Map<string, FileSystemFileHandle>();

/** 登记一个文件句柄 */
export function registerFileHandle(path: string, handle: FileSystemFileHandle): void {
  handleRegistry.set(path, handle);
}

/** 按路径取文件句柄 */
export function getFileHandleByPath(path: string): FileSystemFileHandle | undefined {
  return handleRegistry.get(path);
}

/** 清空登记表（换文件夹时调用） */
export function clearHandleRegistry(): void {
  handleRegistry.clear();
}

/** 设置当前文件句柄 */
export function setCurrentFileHandle(handle: FileSystemFileHandle | null): void {
  currentFileHandle = handle;
}

/** 把 File 对象读成文档模型 */
export async function fileToDocument(
  file: File,
  source: DocumentSource,
  path?: string,
): Promise<MarkdownDocument> {
  const content = await file.text();
  return {
    // id 用「路径 + 文件名」而不是随机值：阅读位置、收藏都靠它关联，
    // 重新打开同一个文件必须拿到同一个 id
    id: `doc:${path ?? file.name}`,
    name: file.name,
    path: path ?? file.name,
    content,
    size: file.size,
    lastModified: file.lastModified,
    source,
  };
}

/** 通过 File System Access API 打开文件 */
async function openWithPicker(): Promise<MarkdownDocument> {
  const [handle] = await showOpenFilePicker({
    id: 'md-reader-open',
    multiple: false,
    types: [
      {
        description: 'Markdown 文档',
        accept: { 'text/markdown': MARKDOWN_EXTENSIONS, 'text/plain': ['.txt'] },
      },
    ],
  });
  if (!handle) throw new FilePickerCancelled();

  setCurrentFileHandle(handle);
  // 一并登记，「最近打开」里的这一条之后才点得开
  registerFileHandle(handle.name, handle);
  const file = await handle.getFile();
  return fileToDocument(file, 'fs-handle', handle.name);
}

/**
 * 回退方案：隐藏的 <input type="file">。
 *
 * 用在两种情况：浏览器不支持 File System Access API，或用户在
 * 非安全上下文里打开了阅读器。代价是拿不到句柄，因此无法自动刷新。
 */
function openWithInput(): Promise<MarkdownDocument> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MARKDOWN_EXTENSIONS.join(',');
    input.style.display = 'none';

    // 用户直接关掉对话框时不会触发 change，用 cancel 事件兜底
    input.addEventListener('cancel', () => {
      input.remove();
      reject(new FilePickerCancelled());
    });

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        reject(new FilePickerCancelled());
        return;
      }
      setCurrentFileHandle(null);
      void fileToDocument(file, 'file-input').then(resolve, reject);
    });

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * 打开一个 Markdown 文件。
 *
 * 优先走 File System Access API——它能拿到长期有效的句柄，
 * 这是 Phase 6「修改文件后自动刷新」的前提；`<input>` 只能拿到快照。
 *
 * @throws {FilePickerCancelled} 用户取消选择
 */
export async function openMarkdownFile(): Promise<MarkdownDocument> {
  // canUseFilePicker 而不是 hasFileSystemAccess：接管页面里的阅读器是跨源
  // iframe，浏览器禁止它弹选择器。好在 <input type="file"> 不受这条限制，
  // 退到它仍能打开文件——代价只是拿不到句柄，那份文档不支持自动刷新
  if (!canUseFilePicker()) {
    log.info('当前环境不允许使用文件选择器，回退到 input');
    return openWithInput();
  }

  try {
    return await openWithPicker();
  } catch (error) {
    // AbortError 是用户主动取消，不是故障
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FilePickerCancelled();
    }
    // 环境拒绝弹选择器时同样退到 input，而不是把错误抛给用户
    if (error instanceof DOMException && error.name === 'SecurityError') {
      log.warn('文件选择器被环境拒绝，回退到 input', error);
      return openWithInput();
    }
    throw error;
  }
}

/**
 * 重新读取当前文件的最新内容。
 *
 * 这条路径由用户手动点击「刷新」触发，因此**允许**在权限失效时重新申请——
 * `requestPermission` 需要用户手势，只有这里满足条件。
 *
 * @returns 最新文档；没有句柄（input 打开的）时返回 null
 */
export async function reloadCurrentFile(): Promise<MarkdownDocument | null> {
  const handle = currentFileHandle;
  if (!handle) return null;

  const permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (permission !== 'granted') {
    const requested = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
    if (requested !== 'granted') {
      log.warn('文件读取权限已被撤销');
      return null;
    }
  }

  const file = await handle.getFile();
  return fileToDocument(file, 'fs-handle', handle.name);
}

/**
 * 探测结果。
 *
 * 用可辨识联合而不是「返回 null + 抛异常」：文件没变、文件被删、权限被撤销
 * 都是**预期内**的结果，各自需要不同的界面反馈。用异常表达预期情况会让
 * 调用方不得不靠 error.name 字符串来分支，既脆弱又容易漏。
 */
export type FileProbeResult =
  /** 文件的修改时间没变，不需要读内容 */
  | { kind: 'unchanged' }
  /** 文件变了，附带最新内容 */
  | { kind: 'changed'; document: MarkdownDocument }
  /** 当前文档没有文件句柄（拖拽或 input 打开的） */
  | { kind: 'no-handle' }
  /** 权限被撤销；重新申请需要用户手势，轮询里做不到 */
  | { kind: 'permission-lost' }
  /** 文件已被删除或移动 */
  | { kind: 'missing' }
  /** 其它意外错误 */
  | { kind: 'error'; message: string };

/**
 * 探测当前文件是否发生变化。
 *
 * 先只读 `lastModified`（不读内容）——File System Access API 没有变更事件，
 * 只能轮询，而轮询的代价必须压到最低。只有时间戳变了才真正去读文本。
 *
 * @param knownLastModified 已加载版本的修改时间
 */
export async function probeCurrentFile(knownLastModified: number): Promise<FileProbeResult> {
  const handle = currentFileHandle;
  if (!handle) return { kind: 'no-handle' };

  // 轮询过程中不能调 requestPermission（它要求用户手势），只能如实报告
  const permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (permission !== 'granted') return { kind: 'permission-lost' };

  let file: File;
  try {
    file = await handle.getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return { kind: 'missing' };
    }
    return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
  }

  if (file.lastModified === knownLastModified) return { kind: 'unchanged' };

  return { kind: 'changed', document: await fileToDocument(file, 'fs-handle', handle.name) };
}
