/**
 * 用户设置的类型定义与默认值。
 *
 * 约定：
 * - 所有设置项都必须有默认值，读取时以 `DEFAULT_SETTINGS` 做深度兜底，
 *   这样新增字段不会让老用户的存量配置报错。
 * - 设置对象是扁平分组（appearance / markdown / reading / advanced / editor），
 *   与设置面板的分组一一对应，便于按组重置。
 */

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'auto';

/** 正文可选字体族 */
export type FontFamilyKey =
  | 'system'
  | 'pingfang'
  | 'yahei'
  | 'noto-sans'
  | 'source-han-sans'
  | 'jetbrains-mono';

/** 正文最大宽度，'full' 表示 100% */
export type ContentWidth =
  | 600
  | 700
  | 800
  | 900
  | 980
  | 1100
  | 1200
  | 1400
  | 1600
  | 'full';

/** 外观设置 */
export interface AppearanceSettings {
  /** 主题模式（明/暗/跟随系统） */
  theme: ThemeMode;
  /**
   * 阅读主题 id（配色风格）。
   *
   * 与 `theme` 是正交的两个维度：先决定明暗，再决定风格。
   * 每套阅读主题都同时提供浅色与深色两份令牌。
   */
  readingTheme: string;
  /** 正文字体 */
  fontFamily: FontFamilyKey;
  /** 正文字号，12~24 px */
  fontSize: number;
  /** 行高，1.2~2.4 */
  lineHeight: number;
  /** 字间距，0~2 px */
  letterSpacing: number;
  /** 正文最大宽度 */
  contentWidth: ContentWidth;
  /** 浅色模式下的代码块主题（Shiki 主题名） */
  codeTheme: string;
  /** 深色模式下的代码块主题 */
  codeThemeDark: string;
}

/** Markdown 渲染能力开关，与插件注册表的 id 对应 */
export interface MarkdownSettings {
  mermaid: boolean;
  katex: boolean;
  emoji: boolean;
  footnote: boolean;
  highlight: boolean;
  /** 是否允许渲染原始 HTML（存在 XSS 面，默认开但会做净化） */
  html: boolean;
  taskList: boolean;
  toc: boolean;
  images: boolean;
  /** 定义列表 */
  deflist: boolean;
  /** 上标 / 下标 */
  subSup: boolean;
}

/** 阅读行为设置 */
export interface ReadingSettings {
  /** 文件变更时自动重新渲染 */
  autoRefresh: boolean;
  /** 自动刷新轮询间隔（毫秒） */
  autoRefreshInterval: number;
  /** 目录与正文滚动同步（Scroll Spy） */
  scrollSync: boolean;
  /** 默认展开目录树 */
  expandTocByDefault: boolean;
  /** 重新打开文件时恢复上次阅读位置 */
  restoreScrollPosition: boolean;
  /** 代码块显示行号 */
  codeLineNumbers: boolean;
  /** 代码块自动换行 */
  codeWordWrap: boolean;
  /** 超长代码块默认折叠 */
  codeCollapseLong: boolean;
  /** 顶部阅读进度条 */
  showProgressBar: boolean;
}

/** 高级设置 */
export interface AdvancedSettings {
  /** 用户自定义 CSS，注入到 <style id="user-style"> */
  customCss: string;
  /** 用户自定义 JS（默认关闭，属于危险能力） */
  customJs: string;
  /** 是否启用自定义 JS */
  enableCustomJs: boolean;
  /** 实验特性总开关 */
  experimental: boolean;
  /**
   * 在浏览器直接打开 .md 时，是否用阅读器接管该页面。
   *
   * 关闭后仍保留浏览器原本的纯文本显示——有人就是想看源码。
   */
  takeoverMarkdownPages: boolean;
}

/** 编辑设置 */
export interface EditorSettings {
  /** 停笔后自动写回文件 */
  autoSave: boolean;
  /** 自动保存的防抖间隔（毫秒） */
  autoSaveDelay: number;
  /** 打开文档时的初始模式 */
  defaultMode: 'read' | 'edit';
  /** 编辑态显示行号 */
  showLineNumbers: boolean;
  /** 缩进宽度 */
  tabSize: number;
  /** 用 Tab 而不是空格缩进 */
  indentWithTabs: boolean;
  /**
   * 内存里保留多少个「保存前的版本」。
   *
   * 自动保存写的是用户真实的本地文件，没有回收站。这个缓冲是唯一的后悔药，
   * 因此不提供「0」这个选项。
   */
  keepVersions: number;
}

/** 完整设置 */
export interface Settings {
  appearance: AppearanceSettings;
  markdown: MarkdownSettings;
  reading: ReadingSettings;
  advanced: AdvancedSettings;
  editor: EditorSettings;
  /** 配置结构版本，用于未来的迁移 */
  schemaVersion: number;
}

/**
 * 当前设置结构版本。
 *
 * 从 1 升到 2（新增 `editor` 分组）不配套迁移脚本：`settings.store` 的
 * `hydrate` 用 `deepMerge(DEFAULT_SETTINGS, 存量数据)` 兜底，旧版本缺失的
 * 分组会自动补上默认值，这正是当初定下这条 deep-merge 约定的目的。
 * 已用 schemaVersion:1 的旧结构存量数据实测验证（见 settings.store.test.ts），
 * 而不是仅凭这段注释的推断——本项目已经因为「断言旧数据是新结构」白屏过一次。
 */
export const SETTINGS_SCHEMA_VERSION = 2;

/** 默认设置 —— 单一事实来源 */
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  appearance: {
    theme: 'auto',
    readingTheme: 'github',
    fontFamily: 'system',
    fontSize: 16,
    lineHeight: 1.7,
    letterSpacing: 0,
    contentWidth: 980,
    codeTheme: 'github-light',
    codeThemeDark: 'github-dark',
  },
  markdown: {
    mermaid: true,
    katex: true,
    emoji: true,
    footnote: true,
    highlight: true,
    html: true,
    taskList: true,
    toc: true,
    images: true,
    deflist: true,
    subSup: true,
  },
  reading: {
    autoRefresh: true,
    autoRefreshInterval: 1500,
    scrollSync: true,
    expandTocByDefault: true,
    restoreScrollPosition: true,
    codeLineNumbers: true,
    codeWordWrap: false,
    codeCollapseLong: false,
    showProgressBar: true,
  },
  advanced: {
    customCss: '',
    customJs: '',
    enableCustomJs: false,
    experimental: false,
    takeoverMarkdownPages: true,
  },
  editor: {
    autoSave: true,
    autoSaveDelay: 800,
    defaultMode: 'read',
    showLineNumbers: false,
    tabSize: 2,
    indentWithTabs: false,
    keepVersions: 5,
  },
};

/** 各设置项的取值边界，供 UI 与校验共用 */
export const SETTINGS_BOUNDS = {
  fontSize: { min: 12, max: 24, step: 1 },
  lineHeight: { min: 1.2, max: 2.4, step: 0.1 },
  letterSpacing: { min: 0, max: 2, step: 0.1 },
  autoRefreshInterval: { min: 500, max: 5000, step: 100 },
  autoSaveDelay: { min: 300, max: 5000, step: 100 },
  tabSize: { min: 2, max: 8, step: 1 },
  keepVersions: { min: 1, max: 20, step: 1 },
} as const;

/** 可选代码块主题（Shiki 内置主题的常用子集，成对出现） */
export const CODE_THEME_OPTIONS: ReadonlyArray<{ label: string; light: string; dark: string }> = [
  { label: 'GitHub', light: 'github-light', dark: 'github-dark' },
  { label: 'One', light: 'one-light', dark: 'one-dark-pro' },
  { label: 'Vitesse', light: 'vitesse-light', dark: 'vitesse-dark' },
  { label: 'Material', light: 'material-theme-lighter', dark: 'material-theme-darker' },
];

/** 可选内容宽度列表 */
export const CONTENT_WIDTH_OPTIONS: readonly ContentWidth[] = [
  600, 700, 800, 900, 980, 1100, 1200, 1400, 1600, 'full',
];

/** 字体族的展示名与实际 CSS font-family */
export const FONT_FAMILIES: Record<FontFamilyKey, { label: string; stack: string }> = {
  system: {
    label: '系统字体',
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  pingfang: { label: 'PingFang SC', stack: '"PingFang SC", "Heiti SC", sans-serif' },
  yahei: { label: 'Microsoft YaHei', stack: '"Microsoft YaHei", "微软雅黑", sans-serif' },
  'noto-sans': { label: 'Noto Sans', stack: '"Noto Sans", "Noto Sans SC", sans-serif' },
  'source-han-sans': {
    label: 'Source Han Sans',
    stack: '"Source Han Sans SC", "Source Han Sans", "思源黑体", sans-serif',
  },
  'jetbrains-mono': {
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
  },
};
