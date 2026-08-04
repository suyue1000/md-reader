/**
 * 部分 markdown-it 插件既不自带类型，社区 @types 包的版本也落后于我们安装的主版本。
 * 与其引入版本错配的 @types，不如在这里手写精确声明——
 * 项目禁用 any，这些声明是保证渲染管线全程类型安全的前提。
 */

declare module 'markdown-it-deflist' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-mark' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-sub' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-sup' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it';
  const plugin: PluginSimple;
  export default plugin;
}

declare module 'markdown-it-emoji' {
  import type { PluginWithOptions } from 'markdown-it';

  /** emoji 定义表：`:name:` -> 字符 */
  interface EmojiOptions {
    defs?: Record<string, string>;
    enabled?: string[];
    shortcuts?: Record<string, string | string[]>;
  }

  /** 完整表（约 1800 个），体积较大 */
  export const full: PluginWithOptions<EmojiOptions>;
  /** 精简表（GitHub 常用子集） */
  export const light: PluginWithOptions<EmojiOptions>;
  /** 仅包含 bare 定义，不含 shortcuts */
  export const bare: PluginWithOptions<EmojiOptions>;
}

declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it';

  interface TaskListsOptions {
    /** 是否允许勾选（阅读器为只读，固定 false） */
    enabled?: boolean;
    /** 是否给 li 加 label 包裹 */
    label?: boolean;
    /** label 是否放在 checkbox 之后 */
    labelAfter?: boolean;
  }

  const plugin: PluginWithOptions<TaskListsOptions>;
  export default plugin;
}

declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it';
  import type { PluginWithParams } from 'markdown-it';
  import type Token from 'markdown-it/lib/token.mjs';

  interface ContainerOptions {
    /** 自定义匹配规则 */
    validate?(params: string): boolean;
    /** 自定义渲染 */
    render?(tokens: Token[], index: number, options: MarkdownIt.Options): string;
    marker?: string;
  }

  const plugin: PluginWithParams;
  export default plugin;
  export type { ContainerOptions };
}
