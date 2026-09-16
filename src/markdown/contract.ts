/**
 * Markdown 渲染管线的对外契约。
 *
 * 渲染结果如今有两类消费者，形态完全不同，接口因此也分成两半：
 * - **块渲染**（`editor/block-render.ts`）拿 `instance()` 自己掌控 parse 与
 *   render 的时机——同一个 env 贯穿全篇、逐块出 HTML，屏幕上看到的正文走这条；
 * - **离屏渲染**（`editor/offscreen-render.ts`，服务于导出与打印）拿 `render()`
 *   一次成型，要的是「整篇的 HTML」这一个结果。
 *
 * ## 关于 `RenderResult.toc`
 *
 * **屏幕上的目录不走这里**：它由块渲染在 parse 的同一趟里抽出扁平标题
 * （`BlockRenderResult.headings`），再由 `ReaderPage` 折成树塞进 store，
 * 与正文共用一次解析。
 *
 * `render()` 仍然产出 `toc`，但**当前没有生产代码消费它**——唯一的调用方
 * `renderOffscreen` 只取 `html`。留着不删有两个理由，都不是「将来可能用得上」：
 * 一是它是这条 API 的完整性所在（一次成型的整篇渲染，理应连同整篇的目录一起给，
 * 而 token 已经在手，代价只是多扫一遍）；二是「锚点 id 与目录 id 必须一致」
 * 这条跨模块约束目前只有走 `render()` 的用例在锁（见 renderer.test.ts）。
 * 如果哪天要动它，请连同这两点一起考虑，不要只看「没人调用」。
 */
import type MarkdownIt from 'markdown-it';
import type { Settings, TocNode } from '@/types';

/** 一次渲染的输入 */
export interface RenderInput {
  /** 原始 Markdown 文本 */
  source: string;
  /** 当前设置（决定启用哪些插件） */
  settings: Settings;
  /** 文档 id，用于生成稳定的锚点前缀 */
  documentId: string;
}

/** 一次渲染的产出 */
export interface RenderResult {
  /** 渲染后的 HTML（已按设置做净化） */
  html: string;
  /** 从标题抽取的目录树 */
  toc: TocNode[];
}

/** 渲染器 */
export interface MarkdownRenderer {
  /** 一次性渲染整篇文档，用于离屏渲染与测试 */
  render(input: RenderInput): Promise<RenderResult>;
  /** 设置变更后让内部缓存失效（例如插件开关被切换） */
  invalidate(): void;
  /**
   * 取出配置好插件的 markdown-it 实例。
   *
   * 编辑器按块渲染时需要自己掌控 parse 与 render 的时机——同一个 env 贯穿
   * 全篇、逐块 render，这是一次成型的 `render()` 给不了的。
   */
  instance(settings: Settings): MarkdownIt;
}
