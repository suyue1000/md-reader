import { ensureBuiltinPlugins, pluginRegistry } from '@/plugins';
import { useSettingsStore } from '@/stores/settings.store';
import type { PluginContext } from '@/types';
import { createLogger } from '@/utils/logger';
import { rebaseRelativeUrls } from '@/utils/rebase';
import type { BlockCache } from './block-cache';

const log = createLogger('editor-enhance');

/**
 * 对一个块 DOM 跑插件的增强钩子。
 *
 * 与旧的整篇增强的区别只有作用域：块 widget 是按需创建的，只有真正进入
 * 视口的块才值得跑 Shiki 与 Mermaid。增强结果由块缓存持有，滚出去再滚
 * 回来不会重跑。
 *
 * 增强器本身是幂等的（Phase 5 起的约定），因此重复调用是安全的；
 * `cache.isEnhanced` 只是省掉一次无谓的遍历。
 *
 * @param force 忽略「已增强」标记强制重跑。切换明暗主题时需要它——
 *   Shiki 的配色与 Mermaid 的图都是按主题生成的，标记为已增强的块
 *   在新主题下反而是过期的那一批。
 * @param eager 要求增强器一次做完并等它做完，不要按视口懒加载。
 *   屏幕上不需要（看不见的地方晚一点上色没人察觉），离屏渲染必须要——
 *   导出要在这个 Promise 落定的那一刻快照整棵树。见 `PluginContext.eager`。
 */
export async function enhanceBlock(
  node: HTMLElement,
  key: string,
  cache: BlockCache,
  baseUrl: string | undefined,
  force = false,
  eager = false,
): Promise<void> {
  if (!force && cache.isEnhanced(key)) return;

  // 相对链接必须在增强之前换算：图片增强会读 src 决定懒加载策略
  if (baseUrl) rebaseRelativeUrls(node, baseUrl);

  const ctx: PluginContext = {
    settings: useSettingsStore.getState().settings,
    requestRerender: () => undefined,
    eager,
  };

  const [{ syncPluginStyles }] = await Promise.all([
    import('@/markdown/plugin-styles'),
    ensureBuiltinPlugins(),
  ]);

  await Promise.all([
    syncPluginStyles(pluginRegistry.all(), ctx.settings, node),
    ...pluginRegistry.enabled(ctx.settings).map(async (plugin) => {
      if (!plugin.enhance) return;
      try {
        await plugin.enhance(node, ctx);
      } catch (error) {
        // 某个增强器失败只影响它自己的那部分内容
        log.warn(`插件 ${String(plugin.id)} 的 DOM 增强失败`, error);
      }
    }),
  ]);

  cache.markEnhanced(key);
}
