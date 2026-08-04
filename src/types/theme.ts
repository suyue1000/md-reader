/**
 * 阅读主题的类型定义。
 *
 * 阅读主题不是「深色/浅色」的替代品，而是叠加在它之上的一层：
 * 用户先选明暗（或跟随系统），再选一套配色风格。因此每个主题都必须
 * 同时给出浅色与深色两套令牌——只支持一种模式的主题会在切换时露馅。
 */

/** 主题可以覆盖的令牌名（与 theme.css 里的变量一一对应） */
export type ThemeTokenName =
  | 'app-bg'
  | 'app-surface'
  | 'app-elevated'
  | 'app-text'
  | 'app-text-muted'
  | 'app-text-subtle'
  | 'app-border'
  | 'app-border-subtle'
  | 'app-accent'
  | 'app-accent-hover'
  | 'app-accent-soft'
  | 'app-accent-contrast'
  | 'app-selection'
  | 'app-code-bg'
  | 'app-code-border';

/** 一套令牌覆盖；未列出的令牌沿用 theme.css 的基础值 */
export type ThemeTokens = Partial<Record<ThemeTokenName, string>>;

/** 阅读主题 */
export interface ReadingTheme {
  /** 唯一 id，存进设置里的就是它 */
  id: string;
  /** 展示名 */
  name: string;
  /** 一句话说明，用于设置页 */
  description: string;
  /** 浅色模式下的令牌覆盖 */
  light: ThemeTokens;
  /** 深色模式下的令牌覆盖 */
  dark: ThemeTokens;
  /**
   * 建议搭配的代码配色（Shiki 主题名）。
   * 切换阅读主题时会一并应用——配色不搭的代码块比不换主题更难看。
   */
  code: { light: string; dark: string };
}

/** 主题注册表 */
export interface ThemeRegistry {
  register(theme: ReadingTheme): void;
  get(id: string): ReadingTheme | undefined;
  /** 按注册顺序返回全部主题 */
  all(): readonly ReadingTheme[];
}
