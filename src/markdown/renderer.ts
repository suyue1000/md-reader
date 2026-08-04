import MarkdownIt from 'markdown-it';
import type { PluginContext, PluginRegistry, Settings } from '@/types';
import type {
  ChunkOptions,
  ChunkResult,
  MarkdownRenderer,
  RenderInput,
  RenderResult,
  RenderSession,
  RenderStages,
} from './contract';
import { pluginRegistry as defaultRegistry } from '@/plugins';
import { splitSource } from './chunker';
import { sanitizeHtml } from './sanitize';
import { buildTocTree, collectHeadings, type FlatHeading } from './toc';
import { createLogger } from '@/utils/logger';

const log = createLogger('renderer');

/**
 * 超过这个字符数才启用分块。
 *
 * 定在 256KB：实测 1MB 文档一次渲染 164ms、主线程冻结 621ms，
 * 按比例 256KB 约 40ms/150ms，仍在「一次做完更划算」的范围内。
 * 阈值以下多走一轮调度反而是净损失。
 */
export const CHUNK_THRESHOLD_CHARS = 256 * 1024;

/**
 * 每块的目标字符数。
 *
 * 分块不是免费的：`md.parse()` 与 DOMPurify 都有可观的**每次调用固定开销**
 * （实测各约 24ms 与 36ms，与块的大小无关）。块切得越碎，这笔固定成本
 * 乘的次数越多——64KB 时 1MB 文档的净化总耗时从 105ms 涨到近 700ms。
 * 128KB 是实测下来的平衡点：单块任务仍在百毫秒量级不至于卡顿，
 * 固定开销的总量也还在可接受范围。
 */
export const CHUNK_TARGET_CHARS = 128 * 1024;

/** 创建渲染器所需的依赖，全部可注入以便单测 */
export interface RendererOptions {
  /** 插件注册表，默认使用全局单例 */
  registry?: PluginRegistry;
  /** 插件请求重新渲染时的回调（如 Mermaid 异步出图完成） */
  onRerenderRequest?: () => void;
}

/**
 * 执行一步并记下完成时刻。
 *
 * 写成辅助函数而不是在每一步之间穿插 `performance.now()`，是为了让
 * 渲染主流程读起来仍是四个连续的步骤，而不是被计时代码切碎。
 */
function mark<T>(step: () => T): { value: T; at: number } {
  const value = step();
  return { value, at: performance.now() };
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
   * 开启一次分块渲染会话。
   *
   * 小于阈值的文档只会得到一块，此时会话等价于一次性渲染——
   * 分块与不分块因此共用同一条代码路径，不存在「大文档专用分支」
   * 会在日常使用中长期得不到验证的问题。
   */
  createSession(input: RenderInput, options: ChunkOptions = {}): RenderSession {
    const md = this.ensureInstance(input.settings);
    // env 承载脚注、引用定义与锚点去重表，必须由整个会话共享
    const env: Record<string, unknown> = {};
    const wantToc = input.settings.markdown.toc;

    const threshold = options.thresholdChars ?? CHUNK_THRESHOLD_CHARS;
    const target = options.targetChars ?? CHUNK_TARGET_CHARS;
    const chunks =
      input.source.length > threshold
        ? splitSource(input.source, target)
        : [{ text: input.source, start: 0 }];

    return {
      chunkCount: chunks.length,
      renderChunk: (index: number): ChunkResult => {
        const chunk = chunks[index];
        if (!chunk) throw new RangeError(`块序号越界：${String(index)}`);

        const startedAt = performance.now();
        const afterParse = mark(() => md.parse(chunk.text, env));
        const afterToc = mark(() => (wantToc ? collectHeadings(afterParse.value) : []));
        const afterRender = mark(() => md.renderer.render(afterParse.value, md.options, env));
        const afterSanitize = mark(() => sanitizeHtml(afterRender.value, input.settings));

        return {
          index,
          html: afterSanitize.value,
          headings: afterToc.value,
          stages: {
            parseMs: afterParse.at - startedAt,
            tocMs: afterToc.at - afterParse.at,
            renderMs: afterRender.at - afterToc.at,
            sanitizeMs: afterSanitize.at - afterRender.at,
          },
        };
      },
    };
  }

  /** 一次性渲染整篇文档 */
  render(input: RenderInput): Promise<RenderResult> {
    const session = this.createSession(input);
    const parts: string[] = [];
    const headings: FlatHeading[] = [];
    const stages: RenderStages = { parseMs: 0, tocMs: 0, renderMs: 0, sanitizeMs: 0 };

    for (let i = 0; i < session.chunkCount; i++) {
      const chunk = session.renderChunk(i);
      parts.push(chunk.html);
      headings.push(...chunk.headings);
      stages.parseMs += chunk.stages.parseMs;
      stages.tocMs += chunk.stages.tocMs;
      stages.renderMs += chunk.stages.renderMs;
      stages.sanitizeMs += chunk.stages.sanitizeMs;
    }

    return Promise.resolve({
      html: parts.join(''),
      toc: buildTocTree(headings),
      durationMs: stages.parseMs + stages.tocMs + stages.renderMs + stages.sanitizeMs,
      stages,
    });
  }

  /** 让缓存的实例失效，下次渲染时重建 */
  invalidate(): void {
    this.md = null;
    this.signature = '';
  }
}

/** 创建渲染器 */
export function createMarkdownRenderer(options?: RendererOptions): MarkdownRenderer {
  return new MarkdownItRenderer(options);
}
