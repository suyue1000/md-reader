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
 * 同时记录锚点与比例，是因为两者各有失效场景：
 * - 纯比例在文档长度变化后会偏移（自动刷新最常见的就是文末追加内容）；
 * - 纯锚点丢失了章节内部的位置，且文档无标题时完全不可用。
 * 优先用「锚点 + 相对锚点的像素偏移」，锚点找不到时回落到比例。
 */
export interface ReadingPosition {
  documentId: string;
  /** 滚动百分比 0~1，锚点失效时的兜底 */
  ratio: number;
  /** 视口顶部上方最近的标题锚点 */
  anchorId: string | null;
  /** 滚动位置相对该锚点顶部的像素偏移 */
  anchorOffset: number;
  updatedAt: number;
}

/** 最近打开记录 */
export interface RecentFileEntry {
  id: string;
  name: string;
  path: string;
  openedAt: number;
}
