import katexPluginFactory from '@vscode/markdown-it-katex';
import type { MarkdownPlugin } from '@/types';

/**
 * 数学公式（KaTeX）。
 *
 * 样式表通过 `styles()` 按需加载：katex.min.css 约 23KB，
 * 不写公式的用户不该为它买单。宿主会在插件启用时注入、禁用时移除。
 */
export const katexPlugin: MarkdownPlugin = {
  id: 'katex',
  name: '数学公式',
  description: '支持 $行内$ 与 $$块级$$ LaTeX 公式',
  order: 20,
  isEnabled: (settings) => settings.markdown.katex,
  setup: (md) => {
    md.use(katexPluginFactory, {
      // 公式写错时渲染成红色源码而不是中断整篇文档
      throwOnError: false,
      enableFencedBlocks: true,
      enableBareBlocks: true,
    });
  },
  // 正文里没有公式就不下载样式表。KaTeX 会把每个公式渲染成 .katex 容器，
  // 用它嗅探比扫描源文本可靠——源文本里的 `$` 大多是货币符号而不是公式
  stylesNeeded: (root) => root.querySelector('.katex') !== null,
  styles: async () => {
    const module = await import('katex/dist/katex.min.css?inline');
    return module.default;
  },
};
