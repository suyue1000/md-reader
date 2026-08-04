import type { MarkdownPlugin, PluginContext } from '@/types';
import { sanitizeSvg } from '@/markdown/sanitize';
import { createLogger } from '@/utils/logger';
import { resolveTheme } from '@/utils/theme';

const log = createLogger('plugin:mermaid');

/**
 * 已渲染图表使用的主题，兼作「是否需要重画」的判据。
 * 值为 `light` / `dark` / `error`。
 */
const RENDERED_THEME = 'data-mermaid-theme';

/**
 * 图表源码缓存。
 *
 * 出图后占位节点的内容会被 SVG 替换，源码就丢了；而切换明暗主题时需要
 * 用原始源码重画。用 WeakMap 而不是写进 data 属性：不污染 DOM，
 * 节点被移除后条目自动回收。
 */
const sourceCache = new WeakMap<HTMLElement, string>();

/**
 * Mermaid 图表。
 *
 * 分两步走：
 * 1. markdown-it 阶段只把 ```mermaid 代码块转成一个带原始源码的占位节点——
 *    渲染 HTML 是同步路径，不能在这里等待异步出图；
 * 2. DOM 增强阶段动态 import mermaid（约 500KB，绝不能进首屏包）并逐个出图。
 *
 * 这正是 `DomEnhancer` 这个钩子存在的意义：把「需要真实 DOM + 异步」的能力
 * 从同步渲染管线里剥离出去。
 */
export const mermaidPlugin: MarkdownPlugin = {
  id: 'mermaid',
  name: 'Mermaid 图表',
  description: '把 ```mermaid 代码块渲染成流程图、时序图等',
  order: 30,
  isEnabled: (settings) => settings.markdown.mermaid,

  setup: (md) => {
    const defaultFence = md.renderer.rules.fence;

    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const lang = token?.info.trim().split(/\s+/)[0]?.toLowerCase();

      if (token && lang === 'mermaid') {
        // 源码原样转义后放进占位节点，增强阶段读 textContent
        return `<div class="mermaid-block" data-diagram="mermaid">${md.utils.escapeHtml(
          token.content.replace(/\n$/, ''),
        )}</div>`;
      }
      return (
        defaultFence?.(tokens, idx, options, env, self) ?? self.renderToken(tokens, idx, options)
      );
    };
  },

  enhance: async (root: HTMLElement, ctx: PluginContext) => {
    const resolved = resolveTheme(ctx.settings.appearance.theme);
    // 只处理没画过、或者画过但主题已经变了的图
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-block')).filter(
      (block) => block.getAttribute(RENDERED_THEME) !== resolved,
    );
    if (blocks.length === 0) return;

    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      // strict：不信任图表里的 HTML 标签，文件内容属于不可信输入
      securityLevel: 'strict',
      theme: resolved === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit',
      /**
       * 关掉 HTML 标签排版，改用原生 <text>。
       *
       * Mermaid 默认把节点文字放进 <foreignObject> 里的 <div>，而 DOMPurify
       * 会把 foreignObject 整个剥掉（它是已知的 mXSS 向量），结果就是图表
       * 只剩下空方框。用原生 SVG 文本既能通过净化，也少一层 HTML 解析。
       *
       * 必须用根级 `htmlLabels`：v11 起 `flowchart.htmlLabels` 等
       * 按图表类型的开关已废弃，根级设置优先级更高。
       */
      htmlLabels: false,
    });

    await Promise.all(
      Array.from(blocks, async (block, index) => {
        // 首次渲染时占位节点里还是源码；重画时从缓存取，因为内容已是 SVG
        const source = sourceCache.get(block) ?? block.textContent ?? '';
        sourceCache.set(block, source);

        const id = `mermaid-${Date.now().toString(36)}-${String(index)}`;
        try {
          const { svg } = await mermaid.render(id, source);
          // 图表源码同样来自不可信文件，Mermaid 自身的净化之外再过一道
          block.innerHTML = sanitizeSvg(svg);
          block.setAttribute(RENDERED_THEME, resolved);
        } catch (error) {
          // 单张图画不出来不应该影响整篇文档，就地降级成错误提示 + 源码
          log.warn('Mermaid 渲染失败', error);
          block.setAttribute(RENDERED_THEME, 'error');
          const message = error instanceof Error ? error.message : String(error);
          block.textContent = '';
          const hint = document.createElement('p');
          hint.className = 'mermaid-block__error';
          hint.textContent = `图表渲染失败：${message}`;
          const pre = document.createElement('pre');
          pre.textContent = source;
          block.append(hint, pre);
        }
      }),
    );
  },
};
