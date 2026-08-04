import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createThemeRegistry } from './registry';
import { serializeThemeCss } from './css';
import { BUILTIN_THEMES, githubTheme, sepiaTheme } from './presets';
import { resolveReadingTheme } from './index';
import { DEFAULT_SETTINGS, type ReadingTheme } from '@/types';

/** 构造一个最小主题 */
function makeTheme(id: string): ReadingTheme {
  return {
    id,
    name: id,
    description: '',
    light: { 'app-bg': '#fff' },
    dark: { 'app-bg': '#000' },
    code: { light: 'github-light', dark: 'github-dark' },
  };
}

describe('主题注册表', () => {
  it('按注册顺序返回主题', () => {
    const registry = createThemeRegistry();
    registry.register(makeTheme('b'));
    registry.register(makeTheme('a'));
    expect(registry.all().map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('按 id 取主题', () => {
    const registry = createThemeRegistry();
    registry.register(makeTheme('sepia'));
    expect(registry.get('sepia')?.id).toBe('sepia');
    expect(registry.get('missing')).toBeUndefined();
  });
});

describe('resolveReadingTheme', () => {
  it('取得内置主题', () => {
    expect(resolveReadingTheme('sepia').id).toBe('sepia');
  });

  it('未知 id 回落到默认主题而不是抛错', () => {
    // 主题 id 存在用户配置里，删掉一套主题不该让老配置打不开阅读器
    expect(resolveReadingTheme('已被删除的主题').id).toBe(githubTheme.id);
  });
});

describe('内置主题完整性', () => {
  it('每套主题都同时提供浅色与深色令牌', () => {
    // 只支持一种模式的主题会在用户切换明暗时露馅
    for (const theme of BUILTIN_THEMES) {
      if (theme.id === githubTheme.id) continue; // 默认主题直接用基础令牌
      expect(Object.keys(theme.light).length, `${theme.id} 缺少浅色令牌`).toBeGreaterThan(0);
      expect(Object.keys(theme.dark).length, `${theme.id} 缺少深色令牌`).toBeGreaterThan(0);
    }
  });

  it('每套主题都给出配套的代码配色', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.code.light).not.toBe('');
      expect(theme.code.dark).not.toBe('');
    }
  });

  it('主题 id 不重复', () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('基础令牌表 theme.css', () => {
  // vitest 从项目根目录运行，import.meta.url 在转换后不是 file: 协议
  const themeCss = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');

  /**
   * 与 serializeThemeCss 的同名断言配对：基础层若停在 (0,1,1)，
   * 运行时注入的阅读主题（(0,0,1)、但在文档后方）就压不过它，
   * 换主题会出现「浅色变了、深色没变」这种半生效的怪状态。
   */
  it('模式选择器的特异度被 :where() 归零', () => {
    expect(themeCss).not.toMatch(/:root\[data-theme/);
    expect(themeCss).not.toMatch(/:root:not\(/);
    expect(themeCss).toContain(":root:where([data-theme='dark'])");
  });
});

describe('serializeThemeCss', () => {
  const appearance = DEFAULT_SETTINGS.appearance;

  it('把令牌写成对应模式的选择器', () => {
    const css = serializeThemeCss(sepiaTheme, appearance);
    expect(css).toContain(":root:where([data-theme='light'])");
    expect(css).toContain(":root:where([data-theme='dark'])");
    expect(css).toContain(`--app-bg: ${sepiaTheme.light['app-bg'] ?? ''}`);
  });

  /**
   * 守的是 Phase 8 的核心承诺：用户自定义 CSS 永远能覆盖主题令牌。
   * 模式选择器一旦漏掉 `:where()`，特异度升到 (0,1,1)，
   * 用户写的 `:root { --app-bg: … }` 就会静默失效——没有报错，只是不生效。
   */
  it('模式选择器的特异度被 :where() 归零', () => {
    const css = serializeThemeCss(sepiaTheme, appearance);
    // 不存在任何「不在 :where() 里」的 [data-theme] 属性选择器
    expect(css).not.toMatch(/:root\[data-theme/);
  });

  /**
   * 这条断言守的是一个已经踩过的坑：打印样式表用同样特异度的选择器
   * 强制浅色，而本段 CSS 在文档里更靠后。不限定 screen 就会把打印的
   * 强制规则压过去，深色主题下打出白纸白字。
   */
  it('配色令牌被限定在 @media screen 内', () => {
    const css = serializeThemeCss(sepiaTheme, appearance);
    const screenBlock = /@media screen \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(screenBlock).toContain('--app-bg');
  });

  it('排版变量不受媒体限制，打印时同样生效', () => {
    const css = serializeThemeCss(sepiaTheme, appearance);
    // 排版块位于 @media screen 之后，且不在其中
    const afterScreen = css.slice(css.lastIndexOf('}\n\n'));
    expect(afterScreen).toContain('--content-font-size');
  });

  it('排版变量取自外观设置', () => {
    const css = serializeThemeCss(githubTheme, {
      ...appearance,
      fontSize: 21,
      lineHeight: 1.9,
      letterSpacing: 0.5,
      contentWidth: 1200,
    });
    expect(css).toContain('--content-font-size: 21px;');
    expect(css).toContain('--content-line-height: 1.9;');
    expect(css).toContain('--content-letter-spacing: 0.5px;');
    expect(css).toContain('--content-max-width: 1200px;');
  });

  it('内容宽度为 full 时输出百分比', () => {
    const css = serializeThemeCss(githubTheme, { ...appearance, contentWidth: 'full' });
    expect(css).toContain('--content-max-width: 100%;');
  });

  it('默认主题没有令牌覆盖时不产出空的 @media 块', () => {
    const css = serializeThemeCss(githubTheme, appearance);
    expect(css).not.toContain('@media screen');
    expect(css).toContain('--content-font-size');
  });
});
