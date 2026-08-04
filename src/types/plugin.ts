/**
 * Markdown 渲染插件的契约。
 *
 * 设计目标：新增 PlantUML / Chart.js / ECharts 等能力时，只需要写一个
 * 实现了 `MarkdownPlugin` 的模块并注册，核心渲染器不需要任何改动。
 */
import type MarkdownIt from 'markdown-it';
import type { MarkdownSettings, Settings } from './settings';

/** 插件唯一 id；内置插件的 id 与 MarkdownSettings 的开关字段同名 */
export type PluginId = keyof MarkdownSettings | (string & {});

/** 插件运行时可以拿到的上下文 */
export interface PluginContext {
  /** 只读的全量设置快照 */
  readonly settings: Settings;
  /** 请求宿主重新渲染当前文档（异步渲染完成后调用，如 Mermaid 出图） */
  requestRerender(): void;
}

/**
 * 渲染完成后的 DOM 增强钩子。
 *
 * markdown-it 只负责产出 HTML 字符串；像 Mermaid 绘图、代码块加 Copy 按钮、
 * 图片懒加载这类需要真实 DOM 的能力，统一走这个钩子，保证职责边界清晰。
 */
export type DomEnhancer = (root: HTMLElement, ctx: PluginContext) => void | Promise<void>;

/** Markdown 插件定义 */
export interface MarkdownPlugin {
  /** 唯一 id */
  id: PluginId;
  /** 展示名 */
  name: string;
  /** 一句话说明，用于设置页 */
  description?: string;
  /**
   * 优先级，数字小的先注册。
   * markdown-it 的部分插件对注册顺序敏感（例如 anchor 必须在 toc 之前）。
   */
  order?: number;
  /** 该插件是否启用；不实现则视为始终启用 */
  isEnabled?(settings: Settings): boolean;
  /** 向 markdown-it 实例注册规则 */
  setup?(md: MarkdownIt, ctx: PluginContext): void;
  /** 渲染后的 DOM 增强 */
  enhance?: DomEnhancer;
  /** 该插件需要注入的样式（作用域内 CSS 字符串），按需注入避免首屏加载 */
  styles?: () => Promise<string>;
  /**
   * 判断当前正文是否真的用得上这份样式。
   *
   * 「插件启用」不等于「这篇文档需要」——KaTeX 开着，但十篇文档里九篇
   * 一个公式都没有，照样下载 23KB 样式表纯属浪费。不实现则视为总是需要。
   */
  stylesNeeded?: (root: HTMLElement) => boolean;
}

/** 插件注册表对外暴露的能力 */
export interface PluginRegistry {
  register(plugin: MarkdownPlugin): void;
  unregister(id: PluginId): void;
  get(id: PluginId): MarkdownPlugin | undefined;
  /** 按 order 排序后的全部插件 */
  all(): readonly MarkdownPlugin[];
  /** 在当前设置下启用的插件 */
  enabled(settings: Settings): readonly MarkdownPlugin[];
}
