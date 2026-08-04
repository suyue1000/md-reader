import { useEffect, useRef } from 'react';
import { ensureBuiltinPlugins, pluginRegistry } from '@/plugins';
import { useResolvedTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores/settings.store';
import { createLogger } from '@/utils/logger';
import { rebaseRelativeUrls } from '@/utils/rebase';
import type { PluginContext } from '@/types';

const log = createLogger('markdown-view');

/** 正文视图属性 */
export interface MarkdownViewProps {
  /** 已净化的 HTML 分块，按文档顺序 */
  chunks: readonly string[];
  /** 渲染会话标识；变化表示换了文档，需要清空重来而不是继续追加 */
  sessionKey: string;
  /** 相对链接的解析基准，仅从 URL 打开的文档才有 */
  baseUrl?: string | undefined;
  /** 请求重新渲染（传给插件上下文） */
  onRerenderRequest?: () => void;
  /**
   * DOM 增强全部跑完后的回调。
   *
   * 存在的理由是「高度何时稳定」这个问题：Shiki 上色与 Mermaid 出图都会
   * 显著改变正文高度，任何依赖 offsetTop 的功能（阅读位置恢复）必须等到
   * 这一刻才能得到准确结果。用回调显式通知，比在外面猜一个延时可靠得多。
   */
  onEnhanced?: () => void;
}

/**
 * Markdown 正文视图。
 *
 * 职责有且只有两件事：把净化后的 HTML 挂到 DOM 上，然后依次跑插件的
 * DOM 增强钩子（Shiki 上色、Mermaid 出图、图片懒加载）。
 *
 * 关于手动操作 DOM 而不用 `dangerouslySetInnerHTML`：分块渲染要求
 * **追加**而不是整体替换。把已有的几十块重新拼成一个大字符串再交给 React
 * 赋值 innerHTML，等于每来一块就把整篇文档重建一次——既是 O(n²) 的字符串
 * 拼接，也会把用户已经滚到的位置、已展开的代码块全部推倒重来。
 *
 * HTML 在渲染器出口已经过 DOMPurify 净化，这里是整条管线里唯一的注入点。
 */
export function MarkdownView({
  chunks,
  sessionKey,
  baseUrl,
  onRerenderRequest,
  onEnhanced,
}: MarkdownViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const settings = useSettingsStore((state) => state.settings);

  /** 已插入 DOM 的块数，与当前会话绑定 */
  const insertedRef = useRef({ key: '', count: 0 });
  /** 增强的运行状态，用于把并发的多轮增强串起来 */
  const enhanceStateRef = useRef({ running: false, pending: false });

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // 换了会话就清空重来；同一会话只补插新增的那几块
    if (insertedRef.current.key !== sessionKey) {
      root.replaceChildren();
      insertedRef.current = { key: sessionKey, count: 0 };
    }

    for (let i = insertedRef.current.count; i < chunks.length; i++) {
      const chunk = chunks[i];
      // 内容已在渲染器出口经过 sanitizeHtml（DOMPurify）净化
      if (chunk !== undefined) root.insertAdjacentHTML('beforeend', chunk);
    }
    insertedRef.current.count = chunks.length;

    // 相对链接必须在增强之前换算：图片增强会读 src 决定懒加载策略
    if (baseUrl) rebaseRelativeUrls(root, baseUrl);
  }, [chunks, sessionKey, baseUrl]);

  // 增强钩子依赖这几项：代码主题、行号/换行/折叠，以及**实际生效**的明暗主题
  // （auto 模式下系统切换深浅色时 settings 不变，但 Mermaid 需要按新配色重画）
  const { appearance, reading, markdown } = settings;
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    const root = containerRef.current;
    if (!root || chunks.length === 0) return;

    let cancelled = false;
    const state = enhanceStateRef.current;

    const runOnce = async (): Promise<void> => {
      const ctx: PluginContext = {
        settings: useSettingsStore.getState().settings,
        requestRerender: () => onRerenderRequest?.(),
      };

      // 正文能渲染出来说明管线已加载，这里只是等待同一个 Promise
      const [{ syncPluginStyles }] = await Promise.all([
        import('@/markdown/plugin-styles'),
        ensureBuiltinPlugins(),
      ]);
      if (cancelled) return;

      const plugins = pluginRegistry.enabled(ctx.settings);

      // 样式与增强并行：KaTeX 的 CSS 加载不该阻塞 Shiki 上色
      await Promise.all([
        syncPluginStyles(pluginRegistry.all(), ctx.settings, root),
        ...plugins.map(async (plugin) => {
          if (!plugin.enhance) return;
          try {
            await plugin.enhance(root, ctx);
          } catch (error) {
            // 某个增强器失败只影响它自己的那部分内容
            log.warn(`插件 ${String(plugin.id)} 的 DOM 增强失败`, error);
          }
        }),
      ]);
    };

    /**
     * 串行推进增强。
     *
     * 分块渲染下这个 effect 会被触发几十上百次。若每次都直接开跑，
     * 上一轮还没结束下一轮就并发进来，而「已处理」标记是在异步完成后
     * 才写上的——于是同一批代码块被反复高亮，重复劳动随块数平方增长。
     * 改成「正在跑就只记一笔待办，跑完再补一轮」，总工作量回到线性。
     */
    const schedule = async (): Promise<void> => {
      if (state.running) {
        state.pending = true;
        return;
      }
      state.running = true;
      try {
        do {
          state.pending = false;
          await runOnce();
          if (cancelled) return;
        } while (state.pending);
      } finally {
        state.running = false;
      }
      onEnhanced?.();
    };

    void schedule();
    return () => {
      cancelled = true;
    };
    // chunks 变化即「又插入了一块」，此时对整个容器重跑一遍增强。
    // 之所以敢每次都全量扫描而不去精确定位新节点：增强器从 Phase 5 起就是
    // 按维度幂等的，已处理的节点会被自己跳过；而全文 querySelectorAll 实测
    // 6 万节点仅 0.2ms，为了省这 0.2ms 去维护一套「新节点范围」不划算
  }, [chunks, appearance, reading, markdown, resolvedTheme, onRerenderRequest, onEnhanced]);

  // 内容由上面的 effect 手动插入，这里只提供容器
  return <div ref={containerRef} className="markdown-body" />;
}
