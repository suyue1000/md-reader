/**
 * 页面接管的通信协议。
 *
 * 内容脚本运行在被打开的 `.md` 页面里，阅读器运行在一个指向
 * `viewer.html` 的 iframe 中——二者分属不同的源，只能用 postMessage 通信。
 * 类型与常量放在这里由双方共享，避免两边各写一份字符串字面量而对不上。
 */

/** iframe 上标记「已进入嵌入模式」的查询参数 */
export const EMBED_FLAG = 'embed';

/** 阅读器就绪，可以接收文档 */
export interface ReadyMessage {
  type: 'md-reader:ready';
}

/** 宿主页面把正文交给阅读器 */
export interface LoadMessage {
  type: 'md-reader:load';
  /** 文件名，含扩展名 */
  name: string;
  /** 原始地址，同时作为相对路径的基准 */
  url: string;
  /** Markdown 源文本 */
  content: string;
  /** 打开时的地址栏 hash（可能是标题锚点） */
  hash: string;
}

/** 阅读器内部锚点变化，请宿主同步地址栏 */
export interface HashMessage {
  type: 'md-reader:hash';
  hash: string;
}

/**
 * 请宿主弹出目录选择器。
 *
 * 为什么要绕这一圈：阅读器是嵌在 `file://` 页面里的跨源 iframe，
 * 浏览器禁止这种 iframe 弹出任何文件选择器。而宿主页面是顶层帧，没有
 * 这条限制；用户在 iframe 里的点击会把「短暂用户激活」一并传播给所有
 * 祖先帧，因此宿主收到这条消息时仍然握着有效的用户手势。
 */
export interface PickFolderMessage {
  type: 'md-reader:pick-folder';
}

/** 请宿主读取工作区里的某个文件 */
export interface ReadFileMessage {
  type: 'md-reader:read-file';
  path: string;
}

/** 宿主扫描完目录后回传的**纯数据**树 */
export interface FolderMessage {
  type: 'md-reader:folder';
  rootName: string;
  tree: unknown;
  fileCount: number;
  truncated: boolean;
  paths: string[];
}

/** 目录选择或扫描失败；用户取消时 cancelled 为 true */
export interface FolderErrorMessage {
  type: 'md-reader:folder-error';
  message: string;
  cancelled: boolean;
}

/** 宿主读回的文件内容 */
export interface FileMessage {
  type: 'md-reader:file';
  path: string;
  name: string;
  content: string;
  lastModified: number;
  size: number;
}

/** 文件读取失败 */
export interface FileErrorMessage {
  type: 'md-reader:file-error';
  path: string;
  message: string;
}

/** 宿主 -> 阅读器 */
export type HostMessage =
  | LoadMessage
  | FolderMessage
  | FolderErrorMessage
  | FileMessage
  | FileErrorMessage;

/** 阅读器 -> 宿主 */
export type ViewerMessage = ReadyMessage | HashMessage | PickFolderMessage | ReadFileMessage;

/** 宿主消息的类型集合，用于运行时守卫 */
const HOST_TYPES = new Set([
  'md-reader:load',
  'md-reader:folder',
  'md-reader:folder-error',
  'md-reader:file',
  'md-reader:file-error',
]);

/** 判断一个未知值是否为宿主发来的消息 */
export function isHostMessage(value: unknown): value is HostMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && HOST_TYPES.has(type);
}

/** 判断一个未知值是否为宿主发来的载入消息 */
export function isLoadMessage(value: unknown): value is LoadMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<LoadMessage>;
  return (
    message.type === 'md-reader:load' &&
    typeof message.name === 'string' &&
    typeof message.url === 'string' &&
    typeof message.content === 'string'
  );
}

/** 阅读器消息的类型集合 */
const VIEWER_TYPES = new Set([
  'md-reader:ready',
  'md-reader:hash',
  'md-reader:pick-folder',
  'md-reader:read-file',
]);

/** 判断一个未知值是否为阅读器发来的消息 */
export function isViewerMessage(value: unknown): value is ViewerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && VIEWER_TYPES.has(type);
}
