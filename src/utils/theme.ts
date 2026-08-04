import type { ThemeMode } from '@/types';

/**
 * 主题应用逻辑。
 *
 * chrome.storage 是异步的，等它返回再上色会闪一帧白屏。
 * 因此主题模式额外镜像一份到 localStorage（同步可读），
 * 由 viewer.html 里的 preload 脚本在首帧之前就把 data-theme 打上。
 * localStorage 只是缓存，chrome.storage.sync 仍是唯一事实来源。
 */

/** localStorage 中的主题缓存 key */
export const THEME_CACHE_KEY = 'md-reader:theme';

/** 实际生效的主题（auto 已解析） */
export type ResolvedTheme = 'light' | 'dark';

/** 系统是否处于深色模式 */
export function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把 auto 解析为实际主题 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'auto') return prefersDark() ? 'dark' : 'light';
  return mode;
}

/** 读取缓存的主题模式，读不到时回落到 auto */
export function readCachedThemeMode(): ThemeMode {
  try {
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === 'light' || cached === 'dark' || cached === 'auto') return cached;
  } catch {
    // localStorage 在某些隐私模式下会抛错，忽略即可
  }
  return 'auto';
}

/** 写入主题缓存 */
export function cacheThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, mode);
  } catch {
    // 同上，缓存失败不影响功能
  }
}

/** 把解析后的主题写到根节点 */
export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = theme;
}
