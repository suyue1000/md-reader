import MarkdownIt from 'markdown-it';
import type { PluginContext, PluginRegistry, Settings } from '@/types';
import type { MarkdownRenderer, RenderInput, RenderResult } from './contract';
import { pluginRegistry as defaultRegistry } from '@/plugins';
import { sanitizeHtml } from './sanitize';
import { buildTocTree, collectHeadings } from './toc';
import { createLogger } from '@/utils/logger';

const log = createLogger('renderer');

/** 创建渲染器所需的依赖，全部可注入以便单测 */
export interface RendererOptions {
  /** 插件注册表，默认使用全局单例 */
  registry?: PluginRegistry;
  /** 插件请求重新渲染时的回调（如 Mermaid 异步出图完成） */
  onRerenderRequest?: () => void;
}

/**
 * 计算「会影响 markdown-it 实例构造」的设置签名。
 *
 * 只有插件开关与 HTML 开关会改变实例本身；字号、主题这类纯展示设置
 * 不该导致实例重建。签名一致就复用实例，省掉一次全部插件的 setup。
 */
function instanceSignature(settings: Settings): string {
  const { markdown } = settings;
  return Object.keys(markdown)
    .sort()
    .map((key) => `${key}:${String(markdown[key as keyof typeof markdown])}`)
    .join('|');
}

/**
 * 基于 markdown-it 的渲染器实现。
 *
 * 设计要点：
 * 1. **解析一次**：`md.parse()` 拿到 token 流后，目录抽取与 HTML 渲染共用它，
 *    避免为了生成目录再扫一遍全文；
 * 2. **实例缓存**：插件开关没变就复用同一个 MarkdownIt 实例；
 * 3. **净化在最后**：所有插件产出的 HTML 统一过一次 DOMPurify，
 *    插件作者不需要各自考虑 XSS。
 */
class MarkdownItRenderer implements MarkdownRenderer {
  private md: MarkdownIt | null = null;
  private signature = '';
  private readonly registry: PluginRegistry;
  private readonly onRerenderRequest: (() => void) | undefined;

  constructor(options: RendererOptions = {}) {
    this.registry = options.registry ?? defaultRegistry;
    this.onRerenderRequest = options.onRerenderRequest;
  }

  /** 构造（或复用）配置好插件的 MarkdownIt 实例 */
  private ensureInstance(settings: Settings): MarkdownIt {
    const signature = instanceSignature(settings);
    if (this.md && this.signature === signature) return this.md;

    const md = new MarkdownIt({
      // GFM 基线能力
      html: settings.markdown.html,
      linkify: true,
      typographer: false,
      breaks: false,
    });

    const ctx: PluginContext = {
      settings,
      requestRerender: () => this.onRerenderRequest?.(),
    };

    for (const plugin of this.registry.enabled(settings)) {
      try {
        plugin.setup?.(md, ctx);
      } catch (error) {
        // 单个插件挂掉不应该让整篇文档打不开
        log.error(`插件 ${String(plugin.id)} 初始化失败，已跳过`, error);
      }
    }

    this.md = md;
    this.signature = signature;
    return md;
  }

  /**
   * 一次性渲染整篇文档。
   *
   * 四步一趟走完：parse → 抽目录 → render → 净化。
   *
   * 为什么 `env` 在 parse 与 render 之间传的是同一个对象：这是 markdown-it 自己
   * `md.render()` 的写法，也是它给插件的约定——插件可以在 parse 阶段往 env 里
   * 存东西、在 renderer 规则里取回。
   *
   * **实测**（Task 11）当前启用的这套插件里没有一个真的依赖它：把 render 那侧
   * 换成空对象，脚注 + 引用式链接的产出逐字节相同（footnote_tail 与引用解析都在
   * parse 阶段就把 token 改完了）。所以这里没有对应的用例——照约定传是为了将来
   * 装上一个依赖 env 的插件时不会莫名其妙地坏掉，不是在修复某个已知的症状。
   *
   * 返回 Promise 而不是同步值：这是**接口留给将来的余地**——渲染若要挪进
   * Worker 或拆成多趟，签名不必再动。当下的实现是同步完成后立刻兑现的。
   */
  render(input: RenderInput): Promise<RenderResult> {
    const md = this.ensureInstance(input.settings);
    const env: Record<string, unknown> = {};

    const tokens = md.parse(input.source, env);
    const headings = input.settings.markdown.toc ? collectHeadings(tokens) : [];
    const html = md.renderer.render(tokens, md.options, env);

    return Promise.resolve({
      html: sanitizeHtml(html, input.settings),
      toc: buildTocTree(headings),
    });
  }

  /** 让缓存的实例失效，下次渲染时重建 */
  invalidate(): void {
    this.md = null;
    this.signature = '';
  }

  instance(settings: Settings): MarkdownIt {
    return this.ensureInstance(settings);
  }
}

/** 创建渲染器 */
export function createMarkdownRenderer(options?: RendererOptions): MarkdownRenderer {
  return new MarkdownItRenderer(options);
}
