import type { MarkdownPlugin, Settings } from '@/types';
import { createLogger } from '@/utils/logger';

const log = createLogger('plugin-styles');

/** 已注入样式的插件 id -> style 节点 */
const injected = new Map<string, HTMLStyleElement>();
/** 正在加载中的插件，避免并发重复请求 */
const loading = new Set<string>();

/**
 * 按需注入 / 回收插件样式。
 *
 * KaTeX 的样式表就有 23KB，全量塞进首屏 CSS 对不写公式的用户是纯浪费。
 * 插件通过 `styles()` 声明自己的样式，宿主在插件启用时才动态加载，
 * 禁用时立刻移除节点——这样「关掉 KaTeX」是真的把成本也一起关掉了。
 *
 * 注意这些 style 节点带 `data-plugin` 标记，与用户自定义的
 * `<style id="user-style">` 完全隔离，互不影响优先级判断。
 */
export async function syncPluginStyles(
  plugins: readonly MarkdownPlugin[],
  settings: Settings,
  root: HTMLElement,
): Promise<void> {
  const shouldBeActive = new Set<string>();

  for (const plugin of plugins) {
    if (!plugin.styles) continue;
    const enabled = plugin.isEnabled?.(settings) ?? true;
    if (!enabled) continue;
    // 启用了，但这篇文档未必用得上（见 MarkdownPlugin.stylesNeeded）
    if (plugin.stylesNeeded && !plugin.stylesNeeded(root)) continue;

    const id = String(plugin.id);
    shouldBeActive.add(id);
    if (injected.has(id) || loading.has(id)) continue;

    loading.add(id);
    try {
      const css = await plugin.styles();
      // 加载期间用户可能已经把插件关掉了，这时不再注入
      if (!shouldBeActive.has(id)) continue;
      const style = document.createElement('style');
      style.dataset['plugin'] = id;
      style.textContent = css;
      document.head.appendChild(style);
      injected.set(id, style);
    } catch (error) {
      log.warn(`插件 ${id} 的样式加载失败`, error);
    } finally {
      loading.delete(id);
    }
  }

  // 回收已禁用插件的样式
  for (const [id, style] of injected) {
    if (!shouldBeActive.has(id)) {
      style.remove();
      injected.delete(id);
    }
  }
}
