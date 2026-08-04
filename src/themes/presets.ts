import type { ReadingTheme } from '@/types';

/**
 * 内置阅读主题。
 *
 * 每套主题只覆盖真正需要区分的令牌，其余沿用 theme.css 的基础值——
 * 全量复制一遍调色板看着完整，实际是把「基础值调整」变成了
 * 「要改 N 个文件」的负担。
 */

/** GitHub —— 默认主题，与 theme.css 的基础值一致 */
export const githubTheme: ReadingTheme = {
  id: 'github',
  name: 'GitHub',
  description: '默认配色，克制的中性灰与蓝色强调',
  light: {},
  dark: {},
  code: { light: 'github-light', dark: 'github-dark' },
};

/** Typora —— 更柔和的边框与略暖的背景，接近 Typora 默认主题的观感 */
export const typoraTheme: ReadingTheme = {
  id: 'typora',
  name: 'Typora',
  description: '柔和边框与略暖的底色，长时间阅读不刺眼',
  light: {
    'app-bg': '#fefefe',
    'app-surface': '#f8f8f8',
    'app-elevated': '#ffffff',
    'app-text': '#333333',
    'app-text-muted': '#5d5d5d',
    'app-text-subtle': '#8c8c8c',
    'app-border': '#dcdcdc',
    'app-border-subtle': '#ededed',
    'app-accent': '#428bca',
    'app-accent-hover': '#3071a9',
    'app-accent-soft': '#e3eefa',
    'app-code-bg': '#f8f8f8',
    'app-code-border': '#e7e7e7',
  },
  dark: {
    'app-bg': '#1f2430',
    'app-surface': '#262b38',
    'app-elevated': '#2b3140',
    'app-text': '#d5d8de',
    'app-text-muted': '#9aa0ac',
    'app-text-subtle': '#737a88',
    'app-border': '#3a4152',
    'app-border-subtle': '#2f3543',
    'app-accent': '#63a8e6',
    'app-accent-hover': '#82bcf0',
    'app-accent-soft': '#243347',
    'app-code-bg': '#262b38',
    'app-code-border': '#3a4152',
  },
  code: { light: 'github-light', dark: 'one-dark-pro' },
};

/**
 * 护眼纸张 —— 米黄底色，模拟纸张。
 *
 * 深色模式下不能简单地「把纸变黑」，那样会丢掉这套主题的意义；
 * 这里改用暖调深棕，让明暗两种模式在气质上保持一致。
 */
export const sepiaTheme: ReadingTheme = {
  id: 'sepia',
  name: '护眼纸张',
  description: '米黄底色模拟纸张，降低屏幕的蓝光刺激',
  light: {
    'app-bg': '#f5efe0',
    'app-surface': '#efe8d7',
    'app-elevated': '#faf5e9',
    'app-text': '#41372a',
    'app-text-muted': '#6b5d4a',
    'app-text-subtle': '#94856e',
    'app-border': '#d8cdb6',
    'app-border-subtle': '#e5dcc8',
    'app-accent': '#9a6b34',
    'app-accent-hover': '#7d5527',
    'app-accent-soft': '#eadfc6',
    'app-accent-contrast': '#fffaf0',
    'app-selection': '#e0cfa8',
    'app-code-bg': '#efe8d7',
    'app-code-border': '#ddd2ba',
  },
  dark: {
    'app-bg': '#221c16',
    'app-surface': '#2a231b',
    'app-elevated': '#312921',
    'app-text': '#e6dcc9',
    'app-text-muted': '#b3a68e',
    'app-text-subtle': '#8b7f6a',
    'app-border': '#453a2d',
    'app-border-subtle': '#362e24',
    'app-accent': '#d7a86a',
    'app-accent-hover': '#e6bc85',
    'app-accent-soft': '#3a2f22',
    'app-accent-contrast': '#221c16',
    'app-selection': '#4a3d2b',
    'app-code-bg': '#2a231b',
    'app-code-border': '#453a2d',
  },
  code: { light: 'vitesse-light', dark: 'vitesse-dark' },
};

/** Nord —— 冷调蓝灰，对比度适中 */
export const nordTheme: ReadingTheme = {
  id: 'nord',
  name: 'Nord',
  description: '冷调蓝灰，低饱和度、对比柔和',
  light: {
    'app-bg': '#fbfcfe',
    'app-surface': '#eceff4',
    'app-elevated': '#ffffff',
    'app-text': '#2e3440',
    'app-text-muted': '#4c566a',
    'app-text-subtle': '#7b88a1',
    'app-border': '#d8dee9',
    'app-border-subtle': '#e5e9f0',
    'app-accent': '#5e81ac',
    'app-accent-hover': '#4c6f99',
    'app-accent-soft': '#e0e7f1',
    'app-code-bg': '#eceff4',
    'app-code-border': '#d8dee9',
  },
  dark: {
    'app-bg': '#2e3440',
    'app-surface': '#3b4252',
    'app-elevated': '#434c5e',
    'app-text': '#eceff4',
    'app-text-muted': '#c3cadb',
    'app-text-subtle': '#8b95a8',
    'app-border': '#4c566a',
    'app-border-subtle': '#3b4252',
    'app-accent': '#88c0d0',
    'app-accent-hover': '#a3d2df',
    'app-accent-soft': '#3b4a5a',
    'app-accent-contrast': '#2e3440',
    'app-selection': '#434c5e',
    'app-code-bg': '#3b4252',
    'app-code-border': '#4c566a',
  },
  code: { light: 'material-theme-lighter', dark: 'material-theme-darker' },
};

/** 内置主题清单；数组顺序即设置页里的展示顺序 */
export const BUILTIN_THEMES: readonly ReadingTheme[] = [
  githubTheme,
  typoraTheme,
  sepiaTheme,
  nordTheme,
];
