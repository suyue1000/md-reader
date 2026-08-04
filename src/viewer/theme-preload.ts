/**
 * 首帧主题预设。
 *
 * 必须在 React 入口之前同步执行：读 localStorage 缓存的主题模式并打上
 * data-theme，避免深色模式用户看到一帧白闪。
 */
import { applyResolvedTheme, readCachedThemeMode, resolveTheme } from '@/utils/theme';

applyResolvedTheme(resolveTheme(readCachedThemeMode()));
