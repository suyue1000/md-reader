/**
 * 内置插件注册入口。
 *
 * 新增一种渲染能力（PlantUML / ECharts / 自定义容器…）只需要两步：
 * 1. 在 `builtin/` 下写一个实现 `MarkdownPlugin` 的模块；
 * 2. 在下面的 `loadBuiltinPlugins()` 里加一行动态 import。
 * 渲染器、视图组件、设置页都不需要改动。
 *
 * 为什么是动态 import：整条 Markdown 管线（markdown-it + 全部插件 +
 * KaTeX + DOMPurify）加起来接近 500KB。阅读器打开时还没有文档，
 * 这些代码一行都用不上。改成按需加载后，首屏只需要 React 与界面骨架。
 */
import type { MarkdownPlugin } from '@/types';
import { pluginRegistry } from './registry';

export { pluginRegistry, createPluginRegistry } from './registry';

/**
 * 动态加载全部内置插件。
 *
 * 顺序由各插件的 `order` 字段决定，与这里的加载顺序无关。
 * 目前对次序敏感的只有两处：
 * - `anchor`(1) 必须最先，heading 的 id 是目录抽取的输入；
 * - `codeBlock`(25) 必须早于 `mermaid`(30)，这样 mermaid 的 fence 包装在外层，
 *   可以先截获图表块、再把普通代码块交回 codeBlock 处理。
 */
async function loadBuiltinPlugins(): Promise<MarkdownPlugin[]> {
  const [anchor, inline, katex, codeBlock, mermaid, images] = await Promise.all([
    import('./builtin/anchor'),
    import('./builtin/inline-syntax'),
    import('./builtin/katex'),
    import('./builtin/code-block'),
    import('./builtin/mermaid'),
    import('./builtin/images'),
  ]);

  return [
    anchor.anchorPlugin,
    inline.markPlugin,
    inline.subSupPlugin,
    inline.deflistPlugin,
    inline.footnotePlugin,
    inline.taskListPlugin,
    inline.emojiPlugin,
    katex.katexPlugin,
    codeBlock.codeBlockPlugin,
    mermaid.mermaidPlugin,
    images.imagesPlugin,
  ];
}

/** 加载中的 Promise，保证并发调用只触发一次网络/磁盘读取 */
let loading: Promise<void> | null = null;

/**
 * 确保内置插件已注册（幂等，可并发调用）。
 *
 * 渲染前与 DOM 增强前都要 await 它——两条路径都可能是「第一个」被触发的。
 */
export function ensureBuiltinPlugins(): Promise<void> {
  loading ??= loadBuiltinPlugins().then((plugins) => {
    for (const plugin of plugins) pluginRegistry.register(plugin);
  });
  return loading;
}
