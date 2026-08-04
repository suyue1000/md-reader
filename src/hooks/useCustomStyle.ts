import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings.store';
import { getUserStyleElement, removeUserStyleElement } from '@/utils/style-slots';

/**
 * 注入用户自定义 CSS。
 *
 * 用独立的 `<style id="user-style">` 承载，且它永远位于 head 末尾——
 * 这保证了用户 CSS 能覆盖包括阅读主题令牌在内的一切应用样式，
 * 而不需要用户去猜要不要加 `!important`。
 *
 * 更新时只改 textContent，浏览器增量重算样式，不会触发 React 重渲染；
 * 清空时直接移除节点，不留残余。
 */
export function useCustomStyle(): void {
  const customCss = useSettingsStore((state) => state.settings.advanced.customCss);

  useEffect(() => {
    if (!customCss.trim()) {
      removeUserStyleElement();
      return;
    }
    getUserStyleElement().textContent = customCss;
  }, [customCss]);
}
