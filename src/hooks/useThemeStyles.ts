import { useEffect } from 'react';
import { resolveReadingTheme, serializeThemeCss } from '@/themes';
import { useSettingsStore } from '@/stores/settings.store';
import { getThemeStyleElement } from '@/utils/style-slots';

/**
 * 把阅读主题与排版设置写进 `<style id="app-theme">`。
 *
 * 为什么用样式表而不是给根节点写 inline style：inline 样式的优先级高于
 * 任何普通规则，用户在自定义 CSS 里写 `:root { --app-bg: ... }` 将永远不生效。
 * 换成同特异度、但位置更靠前的样式表之后，用户 CSS 天然可以覆盖它——
 * 这才是「自定义 CSS」应有的语义。
 *
 * 代价是改设置时要重新解析一小段 CSS。实测这段只有二十来条声明，
 * 拖动滑块时的开销可以忽略；换来的是一条能讲清楚的层叠规则。
 */
export function useThemeStyles(): void {
  const appearance = useSettingsStore((state) => state.settings.appearance);

  useEffect(() => {
    const theme = resolveReadingTheme(appearance.readingTheme);
    getThemeStyleElement().textContent = serializeThemeCss(theme, appearance);
  }, [appearance]);
}
