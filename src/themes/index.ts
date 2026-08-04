import { BUILTIN_THEMES, githubTheme } from './presets';
import { themeRegistry } from './registry';
import type { ReadingTheme } from '@/types';

export { themeRegistry, createThemeRegistry } from './registry';
export { serializeThemeCss } from './css';
export * from './presets';

let registered = false;

/**
 * 注册全部内置主题（幂等）。
 *
 * 与 Markdown 插件不同，这里用同步注册：主题只是一张令牌表，几 KB 而已，
 * 而首屏就要用到它——异步加载反而会让首帧用错配色再跳一下。
 */
export function registerBuiltinThemes(): void {
  if (registered) return;
  for (const theme of BUILTIN_THEMES) themeRegistry.register(theme);
  registered = true;
}

/**
 * 按 id 取主题，取不到时回落到默认主题。
 *
 * 回落而不是抛错：主题 id 存在用户配置里，如果某个版本删掉了一套主题，
 * 老配置不应该让阅读器打不开。
 */
export function resolveReadingTheme(id: string): ReadingTheme {
  registerBuiltinThemes();
  return themeRegistry.get(id) ?? githubTheme;
}
