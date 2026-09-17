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
  /**
   * 本次接管的一次性令牌。
   *
   * 阅读器发回宿主的消息里，凡是会**读写用户文件**的（授权、写回）都必须
   * 带上它，宿主逐条核对。理由是这条通道的两端并不对称：宿主发给阅读器时
   * 用的是具体 origin（`viewerUrl.origin`），而阅读器发回宿主只能用 `'*'`——
   * 宿主是 `file://` 页面，其 origin 是字符串 "null"，没法做具体校验。
   *
   * 在只传「已就绪」和锚点的年代这不要紧（那句注释当时就是这么写的）。
   * 加入写回之后就要紧了：`EMBED_FLAG` 只是一个 URL 查询参数，任何页面都能
   * 构造一个 `viewer.html?embed=1` 的 iframe 并冒充宿主对话。令牌由宿主在
   * 接管时随机生成、只经由 `postMessage` 送给自己那个 iframe，第三方拿不到。
   */
  nonce: string;
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

/**
 * 请宿主弹出文件选择器，授权写回**当前这篇**文档。
 *
 * 为什么要用户亲手再选一次自己正看着的文件：File System Access API 没有
 * 「由 URL 换取句柄」的能力，句柄只能来自一次真实的选择器交互。宿主随后
 * 用两道闸校验选中的确实是这一篇（文件名 + 磁盘内容），见 content/index.ts。
 */
export interface GrantWriteMessage {
  type: 'md-reader:grant-write';
  nonce: string;
}

/** 请宿主把文本写回原文件 */
export interface WriteFileMessage {
  type: 'md-reader:write-file';
  nonce: string;
  /** 要写入的文本，原样落盘，不做任何规整 */
  text: string;
  /**
   * 阅读器认为的磁盘时间戳。宿主写之前会拿它跟真实的 `lastModified` 比对，
   * 对不上说明磁盘已被别的程序改过，这次一个字节都不写。
   *
   * 这道闸是**必需的**而不是保险：嵌入模式的文档 `source` 是 'url'，而
   * `useAutoRefresh` 只对 'fs-handle' 轮询，于是整套冲突检测在这条路径上
   * 根本不运行，`decideSaveTarget` 的 `conflictPending` 永远是 null。
   * 不在宿主侧自检，代劳写回就会静默覆盖第三方的改动——而那是没有回收站的。
   */
  baseModified: number;
}

/** 宿主已握住句柄；`content` 是**磁盘上的真实字节**，未必等于页面里那份 */
export interface WriteGrantedMessage {
  type: 'md-reader:write-granted';
  content: string;
  lastModified: number;
}

/** 授权失败；用户取消时 cancelled 为 true */
export interface WriteDeniedMessage {
  type: 'md-reader:write-denied';
  reason: string;
  cancelled: boolean;
}

/** 写回成功，附新的磁盘时间戳 */
export interface WriteOkMessage {
  type: 'md-reader:write-ok';
  lastModified: number;
}

/** 写回失败；`stale` 为真表示磁盘已被外部改动，**这次一个字节都没写** */
export interface WriteErrorMessage {
  type: 'md-reader:write-error';
  message: string;
  stale: boolean;
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
  | FileErrorMessage
  | WriteGrantedMessage
  | WriteDeniedMessage
  | WriteOkMessage
  | WriteErrorMessage;

/** 阅读器 -> 宿主 */
export type ViewerMessage =
  | ReadyMessage
  | HashMessage
  | PickFolderMessage
  | ReadFileMessage
  | GrantWriteMessage
  | WriteFileMessage;

/** 宿主消息的类型集合，用于运行时守卫 */
const HOST_TYPES = new Set([
  'md-reader:load',
  'md-reader:folder',
  'md-reader:folder-error',
  'md-reader:file',
  'md-reader:file-error',
  'md-reader:write-granted',
  'md-reader:write-denied',
  'md-reader:write-ok',
  'md-reader:write-error',
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
    typeof message.content === 'string' &&
    // 没有令牌的 load 一概不认：之后的写回全靠它证明「我是宿主那个 iframe」
    typeof message.nonce === 'string' &&
    message.nonce !== ''
  );
}

/** 阅读器消息的类型集合 */
const VIEWER_TYPES = new Set([
  'md-reader:ready',
  'md-reader:hash',
  'md-reader:pick-folder',
  'md-reader:read-file',
  'md-reader:grant-write',
  'md-reader:write-file',
]);

/** 判断一个未知值是否为阅读器发来的消息 */
export function isViewerMessage(value: unknown): value is ViewerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' && VIEWER_TYPES.has(type);
}
