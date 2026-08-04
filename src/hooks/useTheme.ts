import { useEffect } from 'react';
import { useSettingsStore } from '@/stores/settings.store';
import { applyResolvedTheme, cacheThemeMode, resolveTheme, type ResolvedTheme } from '@/utils/theme';
import { useMediaQuery } from './useMediaQuery';
import type { ThemeMode } from '@/types';

/**
 * 主题读写接口（无副作用）。
 *
 * 与 `useThemeSync` 拆开是有原因的：读接口会被工具栏、快捷键等多处调用，
 * 如果副作用也跟在里面，每多一个调用方就多注册一个 matchMedia 监听器。
 * 副作用只应该发生一次，因此单独交给 `useThemeSync`，由应用根组件调用。
 */
export function useThemeMode(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const mode = useSettingsStore((state) => state.settings.appearance.theme);
  const setAppearance = useSettingsStore((state) => state.setAppearance);

  return {
    mode,
    setMode: (next: ThemeMode) => setAppearance({ theme: next }),
  };
}

/**
 * 当前**实际生效**的主题（auto 已解析为 light / dark）。
 *
 * 与 `useThemeMode` 的区别在于它对系统主题变化也是响应式的：
 * auto 模式下用户切换系统深浅色时，`settings.appearance.theme` 并不会变，
 * 但依赖真实配色的东西（Mermaid 出图的配色）必须跟着重来。
 */
export function useResolvedTheme(): ResolvedTheme {
  const mode = useSettingsStore((state) => state.settings.appearance.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  if (mode === 'auto') return systemDark ? 'dark' : 'light';
  return mode;
}

/**
 * 把设置里的主题模式同步到 DOM，并在 auto 模式下跟随系统。
 *
 * 只操作根节点的 data-theme 属性，不触发任何组件重渲染。
 * **整个应用只应调用一次**（在根组件里）。
 */
export function useThemeSync(): void {
  const mode = useSettingsStore((state) => state.settings.appearance.theme);

  useEffect(() => {
    applyResolvedTheme(resolveTheme(mode));
    cacheThemeMode(mode);

    if (mode !== 'auto') return;

    // auto 模式下跟随系统切换
    const media = matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      applyResolvedTheme(resolveTheme('auto'));
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [mode]);
}
