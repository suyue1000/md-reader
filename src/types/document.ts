/**
 * 文档 / 文件树相关类型。
 *
 * 这些类型在 Phase 1 就定义好，是因为 store、渲染器、文件树、自动刷新
 * 四个模块都要依赖它们；先固化契约可以避免后续互相 import 具体实现。
 */

/** 文档来源渠道 */
export type DocumentSource =
  /** 通过 File System Access API 打开（可读到最新内容，支持自动刷新） */
  | 'fs-handle'
  /** 通过 <input type="file"> 打开（只有快照，无法自动刷新） */
  | 'file-input'
  /** 通过拖拽打开 */
  | 'drop'
  /** 通过 URL / file:// 读取 */
  | 'url';

/** 已加载的 Markdown 文档 */
export interface MarkdownDocument {
  /** 稳定 id，用于阅读位置、收藏等关联数据的 key */
  id: string;
  /** 文件名，含扩展名 */
  name: string;
  /** 展示用路径（可能只有文件名） */
  path: string;
  /** 原始 Markdown 文本 */
  content: string;
  /** 字节数 */
  size: number;
  /** 文件最后修改时间戳，自动刷新据此判断变更 */
  lastModified: number;
  /** 来源渠道 */
  source: DocumentSource;
  /**
   * 相对路径的解析基准。
   *
   * 只有从 URL 打开的文档才有：此时阅读器跑在 `chrome-extension://` 下，
   * 而正文里的 `![](./img/a.png)` 是相对于原始地址的，不换算就全是坏图。
   */
  baseUrl?: string;
}

/** 文件树节点 */
export interface FileTreeNode {
  /** 相对根目录的路径，作为唯一 id */
  id: string;
  name: string;
  kind: 'file' | 'directory';
  /** 目录才有子节点；懒加载时为 undefined */
  children?: FileTreeNode[];
  /** 相对根目录的深度，用于缩进 */
  depth: number;
}

/** 目录（TOC）节点 */
export interface TocNode {
  /** 锚点 id，与正文标题的 id 一致 */
  id: string;
  /** 标题文本（已去除 Markdown 标记） */
  text: string;
  /** 标题级别 1~6 */
  level: number;
  /**
   * 标题所在的 0-based 行号，目录跳转与滚动同步据此定位。
   *
   * 记行号而不是继续依赖锚点 id 去 DOM 里查元素：编辑器只渲染视口附近的块，
   * 视口外的标题根本不在 DOM 里——查不到就跳不了，也看不出「现在在哪一节」。
   * 行号是文档模型自带的坐标，不受渲染与否影响，和 `ReadingPosition.line`
   * 是同一套坐标系。
   */
  line: number;
  children: TocNode[];
}

/**
 * 文件监听状态。
 *
 * 单独建模而不是用一个布尔值，是因为「没在监听」有好几种截然不同的原因，
 * 而用户需要知道是哪一种——文件被删了和标签页在后台，处理方式完全不同。
 */
export type WatchStatus =
  /** 当前文档不支持监听（没有文件句柄）或功能被关闭 */
  | 'inactive'
  /** 正在轮询 */
  | 'watching'
  /** 标签页不可见，已暂停轮询 */
  | 'paused'
  /** 文件不见了或权限被撤销，已停止 */
  | 'stopped';

/**
 * 单个文档的阅读状态。
 *
 * 记录行号而不是锚点 + 比例：编辑器的文档模型本身就是按行寻址的，行号
 * 是天然稳定的坐标。旧方案要靠「锚点 + 像素偏移 + 比例」三重兜底，是因为
 * 渲染后的 DOM 没有一个稳定的坐标系——标题会被改、高度会随字号变。
 * 行号没有这些问题：改了第 100 行之后的内容，第 50 行还是第 50 行。
 */
export interface ReadingPosition {
  documentId: string;
  /** 0-based 行号 */
  line: number;
  /** 该行在视口中的像素偏移，用于长行的精确还原 */
  offset: number;
  updatedAt: number;
}

/** 最近打开记录 */
export interface RecentFileEntry {
  id: string;
  name: string;
  path: string;
  openedAt: number;
}
