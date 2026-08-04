import type { AppearanceSettings, ReadingTheme, ThemeTokens } from '@/types';
import { FONT_FAMILIES } from '@/types';

/** 把令牌表序列化成 CSS 声明 */
function serializeTokens(tokens: ThemeTokens, indent: string): string {
  return Object.entries(tokens)
    .map(([name, value]) => `${indent}--${name}: ${value};`)
    .join('\n');
}

/**
 * 把阅读主题与排版设置序列化成一段 CSS。
 *
 * 三处刻意的结构安排：
 *
 * 1. **配色令牌包在 `@media screen` 里**。打印样式表用更高特异度的选择器
 *    强制浅色（否则深色主题会打出白纸白字），限定 screen 后打印时这一段
 *    整体失效，打印样式表得以生效——两道保险中的第二道。
 *
 * 2. **排版变量不限定媒体**。字号、行高在纸上同样要生效，
 *    它们与明暗配色无关，不该被打印规则覆盖。
 *
 * 3. **模式选择器包在 `:where()` 里**，特异度归零，整块保持 (0,0,1)，
 *    与 theme.css 的基础令牌、用户自定义 CSS 完全持平。这样三层的胜负
 *    只由 head 中的先后顺序决定（见 utils/style-slots.ts）。裸写
 *    `:root[data-theme='light']` 会是 (0,1,1)，用户再怎么写 `:root {}`
 *    也覆盖不掉主题令牌。
 */
export function serializeThemeCss(theme: ReadingTheme, appearance: AppearanceSettings): string {
  const blocks: string[] = [];

  const lightTokens = serializeTokens(theme.light, '    ');
  const darkTokens = serializeTokens(theme.dark, '    ');

  if (lightTokens !== '' || darkTokens !== '') {
    const rules: string[] = [];
    if (lightTokens !== '') rules.push(`  :root:where([data-theme='light']) {\n${lightTokens}\n  }`);
    if (darkTokens !== '') rules.push(`  :root:where([data-theme='dark']) {\n${darkTokens}\n  }`);
    blocks.push(`@media screen {\n${rules.join('\n')}\n}`);
  }

  const width =
    appearance.contentWidth === 'full' ? '100%' : `${String(appearance.contentWidth)}px`;

  blocks.push(
    [
      ':root {',
      `  --content-font-family: ${FONT_FAMILIES[appearance.fontFamily].stack};`,
      `  --content-font-size: ${String(appearance.fontSize)}px;`,
      `  --content-line-height: ${String(appearance.lineHeight)};`,
      `  --content-letter-spacing: ${String(appearance.letterSpacing)}px;`,
      `  --content-max-width: ${width};`,
      '}',
    ].join('\n'),
  );

  return blocks.join('\n\n');
}
