/**
 * Markdown 渲染管线的对外契约（Phase 2 实现）。
 *
 * 提前定义接口的目的：viewer / TOC / 搜索 / 导出 四个模块都依赖渲染结果，
 * 先把「输入什么、产出什么」钉死，各模块可以并行开发而不必等渲染器落地。
 */
import type { Settings, TocNode } from '@/types';
import type { FlatHeading } from './toc';

/** 一次渲染的输入 */
export interface RenderInput {
  /** 原始 Markdown 文本 */
  source: string;
  /** 当前设置（决定启用哪些插件） */
  settings: Settings;
  /** 文档 id，用于生成稳定的锚点前缀 */
  documentId: string;
}

/**
 * 各阶段耗时（毫秒）。
 *
 * 拆开记录而不是只报一个总数，是因为这四段的优化手段完全不同：
 * parse 只能靠分块摊平，sanitize 可以按块做，render 可以延迟到需要时。
 * 只看总耗时就只能猜是哪一段慢了。
 */
export interface RenderStages {
  /** markdown-it 解析成 token 流 */
  parseMs: number;
  /** 从 token 抽取目录 */
  tocMs: number;
  /** token 渲染成 HTML 字符串 */
  renderMs: number;
  /** DOMPurify 净化 */
  sanitizeMs: number;
}

/** 一次渲染的产出 */
export interface RenderResult {
  /** 渲染后的 HTML（已按设置做净化） */
  html: string;
  /** 从标题抽取的目录树 */
  toc: TocNode[];
  /** 渲染耗时（毫秒），用于性能面板与回归监控 */
  durationMs: number;
  /** 各阶段耗时明细 */
  stages: RenderStages;
}

/** 一块的渲染产出 */
export interface ChunkResult {
  /** 块序号，从 0 开始 */
  index: number;
  /** 本块的 HTML（已净化） */
  html: string;
  /** 本块内的扁平标题，全部到齐后统一折叠成树 */
  headings: readonly FlatHeading[];
  /** 本块各阶段耗时 */
  stages: RenderStages;
}

/**
 * 一次分块渲染会话。
 *
 * 会话持有跨块共享的状态——markdown-it 的 `env`（脚注、引用定义）与
 * 锚点去重表。逐块调用 `renderChunk` 必须**按序**进行，否则锚点编号
 * 和脚注序号都会错乱。
 */
export interface RenderSession {
  /** 总块数；1 表示无需分块，等同于一次性渲染 */
  readonly chunkCount: number;
  /** 渲染第 index 块 */
  renderChunk(index: number): ChunkResult;
}

/** 分块参数；不传则用渲染器的默认值 */
export interface ChunkOptions {
  /** 超过这个字符数才分块 */
  thresholdChars?: number;
  /** 每块的目标字符数 */
  targetChars?: number;
}

/** 渲染器 */
export interface MarkdownRenderer {
  /** 执行渲染（一次性，用于小文档与测试） */
  render(input: RenderInput): Promise<RenderResult>;
  /** 开启一次分块渲染会话 */
  createSession(input: RenderInput, options?: ChunkOptions): RenderSession;
  /** 设置变更后让内部缓存失效（例如插件开关被切换） */
  invalidate(): void;
}
