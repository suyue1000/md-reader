import { create } from 'zustand';
import type { RenderStages } from '@/markdown/contract';
import type { MarkdownDocument, TocNode, WatchStatus } from '@/types';

/** 文档加载状态机 */
export type DocumentStatus = 'idle' | 'loading' | 'ready' | 'error';

/** 当前文档 / 目录树的全局状态 */
export interface DocumentStore {
  /** 当前打开的文档 */
  document: MarkdownDocument | null;
  /** 加载状态 */
  status: DocumentStatus;
  /** 出错信息 */
  error: string | null;
  /** 当前文档的目录树（Phase 3 填充） */
  toc: TocNode[];
  /** 当前高亮的目录节点 id */
  activeHeadingId: string | null;
  /** 上一次渲染耗时（毫秒），用于状态栏与性能回归观察 */
  renderDurationMs: number;
  /** 上一次渲染的阶段明细，null 表示尚未渲染过 */
  renderStages: RenderStages | null;
  /** 分块渲染进度；总块数为 1 时表示没有分块 */
  renderProgress: { done: number; total: number };
  /**
   * 待跳转的标题锚点，消费一次即清空。
   *
   * 存在的理由是时序：打开 `xxx.md#某标题` 时，锚点在地址里，
   * 而目标元素要等渲染完才存在——浏览器原生的锚点跳转早就错过了时机。
   */
  pendingAnchor: string | null;
  /** 文件监听状态 */
  watchStatus: WatchStatus;
  /** 监听停止的原因，仅在 stopped 时有值 */
  watchMessage: string | null;
  /** 上一次因文件变化而自动刷新的时间戳；0 表示尚未发生过 */
  lastRefreshedAt: number;

  setLoading: () => void;
  setDocument: (doc: MarkdownDocument) => void;
  setError: (message: string) => void;
  setToc: (toc: TocNode[]) => void;
  setRenderDuration: (durationMs: number, stages: RenderStages) => void;
  setRenderProgress: (done: number, total: number) => void;
  setPendingAnchor: (anchor: string | null) => void;
  setWatchStatus: (status: WatchStatus, message?: string | null) => void;
  /** 文件变化引起的内容更新：与 setDocument 的区别是不清空目录、并记录刷新时间 */
  applyRefreshedDocument: (doc: MarkdownDocument) => void;
  setActiveHeadingId: (id: string | null) => void;
  reset: () => void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  document: null,
  status: 'idle',
  error: null,
  toc: [],
  activeHeadingId: null,
  renderDurationMs: 0,
  renderStages: null,
  renderProgress: { done: 0, total: 0 },
  pendingAnchor: null,
  watchStatus: 'inactive',
  watchMessage: null,
  lastRefreshedAt: 0,

  setLoading: () => set({ status: 'loading', error: null }),

  setDocument: (doc) =>
    set({
      document: doc,
      status: 'ready',
      error: null,
      // 换文档时清空上一份目录，避免闪烁出旧目录
      toc: [],
      activeHeadingId: null,
      // 新文档的监听状态由 useAutoRefresh 重新判定
      watchStatus: 'inactive',
      watchMessage: null,
      lastRefreshedAt: 0,
    }),

  /**
   * 文件变化引起的内容更新。
   *
   * 与 `setDocument` 的关键区别：**不清空目录、不清空高亮**。
   * 自动刷新是「同一篇文档换了内容」，把目录清成空再重建会让侧栏闪一下，
   * 而阅读器里最刺眼的就是这种无谓的闪烁。新目录会在渲染完成后原地替换。
   */
  applyRefreshedDocument: (doc) =>
    set({
      document: doc,
      status: 'ready',
      error: null,
      lastRefreshedAt: Date.now(),
    }),

  setError: (message) => set({ status: 'error', error: message }),
  setToc: (toc) => set({ toc }),
  setRenderDuration: (durationMs, stages) =>
    set({ renderDurationMs: durationMs, renderStages: stages }),

  setRenderProgress: (done, total) => set({ renderProgress: { done, total } }),

  setPendingAnchor: (anchor) => set({ pendingAnchor: anchor }),
  setWatchStatus: (status, message = null) => set({ watchStatus: status, watchMessage: message }),
  setActiveHeadingId: (id) => set({ activeHeadingId: id }),

  reset: () =>
    set({
      document: null,
      status: 'idle',
      error: null,
      toc: [],
      activeHeadingId: null,
      watchStatus: 'inactive',
      watchMessage: null,
      lastRefreshedAt: 0,
    }),
}));
