import type { BundledLanguage, BundledTheme, Highlighter } from 'shiki/bundle/full';
import { createLogger } from '@/utils/logger';

/**
 * Shiki 高亮器单例。
 *
 * 四个关键取舍：
 * 1. 用 `shiki/bundle/full` 而不是 web 子集。子集只有 78 个条目，缺 rust、go、
 *    diff、toml、dockerfile 这些在技术文档里极常见的语言，命中不了就退化成
 *    没有颜色的纯文本。全量包的**即时**代价只是一张语言索引表（约 +3KB gzip），
 *    语法本身仍是按需加载的独立分包，所以首屏成本几乎不变；
 * 2. 语言与主题都按需加载：只有文档里真的出现 rust 代码块才会去拉 rust 语法；
 * 3. 双主题模式（light + dark 同时产出 CSS 变量），切主题时不需要重新高亮，
 *    纯 CSS 就能完成，符合「切主题不重渲染」的整体设计；
 * 4. **用 JavaScript 正则引擎而不是默认的 Oniguruma（WASM）**，见下。
 */

const log = createLogger('highlighter');

let instance: Highlighter | null = null;
let creating: Promise<Highlighter> | null = null;

const loadedLangs = new Set<string>();
const loadedThemes = new Set<string>();

/** 语言别名与可用语言表，惰性加载 */
let languageIndex: { names: Set<string>; aliases: Record<string, string> } | null = null;

/** 加载语言索引，用于判断某个 info 串是否是 Shiki 认识的语言 */
async function ensureLanguageIndex(): Promise<{
  names: Set<string>;
  aliases: Record<string, string>;
}> {
  if (languageIndex) return languageIndex;
  const { bundledLanguages, bundledLanguagesAlias } = await import('shiki/bundle/full');
  languageIndex = {
    names: new Set(Object.keys(bundledLanguages)),
    aliases: bundledLanguagesAlias as unknown as Record<string, string>,
  };
  return languageIndex;
}

/** 创建（或复用）高亮器实例 */
async function ensureHighlighter(themes: readonly string[]): Promise<Highlighter> {
  if (!instance) {
    creating ??= (async () => {
      const [{ createHighlighter }, { createJavaScriptRegexEngine }] = await Promise.all([
        import('shiki/bundle/full'),
        import('shiki/engine/javascript'),
      ]);
      const created = await createHighlighter({
        themes: themes as BundledTheme[],
        langs: [],
        /**
         * Shiki 默认用 Oniguruma 正则引擎，它是一份 WASM。
         * 而 MV3 扩展页面的 CSP 固定为 `script-src 'self'`，实例化 WASM 需要
         * `wasm-unsafe-eval`——加上它就等于为了语法高亮放宽整个页面的脚本策略，
         * 对一个只读的本地阅读器来说不划算。
         *
         * JS 正则引擎把 Oniguruma 模式转译成原生 RegExp，不碰 WASM，
         * 顺带省掉约 600KB 的 wasm 分包。代价是极少数语法里的复杂模式转译不了，
         * `forgiving` 让这类模式被跳过而不是让整个语言高亮失败。
         */
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
      for (const theme of themes) loadedThemes.add(theme);
      return created;
    })();
    instance = await creating;
  }

  // 用户换了代码主题：只补加缺失的那一个，不重建实例
  for (const theme of themes) {
    if (!loadedThemes.has(theme)) {
      await instance.loadTheme(theme as BundledTheme);
      loadedThemes.add(theme);
    }
  }
  return instance;
}

/**
 * 把语言标识规范化成 Shiki 能识别的名字。
 *
 * @returns 规范化后的语言名；无法识别时返回 null，调用方应降级为纯文本
 */
export async function resolveLanguage(lang: string): Promise<string | null> {
  const normalized = lang.trim().toLowerCase();
  if (normalized === '') return null;

  const index = await ensureLanguageIndex();
  if (index.names.has(normalized)) return normalized;

  const aliased = index.aliases[normalized];
  return aliased ?? null;
}

/**
 * 高亮一段代码。
 *
 * @param code 源码
 * @param lang 语言名（已规范化）
 * @param themes 浅色 / 深色主题名
 * @returns Shiki 产出的 HTML；失败时返回 null，调用方保留原始 DOM
 */
export async function highlightCode(
  code: string,
  lang: string | null,
  themes: { light: string; dark: string },
): Promise<string | null> {
  try {
    const highlighter = await ensureHighlighter([themes.light, themes.dark]);

    const resolved = lang ?? 'text';
    if (resolved !== 'text' && !loadedLangs.has(resolved)) {
      await highlighter.loadLanguage(resolved as BundledLanguage);
      loadedLangs.add(resolved);
    }

    return highlighter.codeToHtml(code, {
      lang: resolved,
      themes: { light: themes.light, dark: themes.dark },
      // 不写死默认色，改为输出 --shiki-light / --shiki-dark 变量，交给 CSS 切换
      defaultColor: false,
    });
  } catch (error) {
    log.warn(`高亮失败（lang=${String(lang)}）`, error);
    return null;
  }
}

/** 释放高亮器，主要供测试与内存敏感场景使用 */
export function disposeHighlighter(): void {
  instance?.dispose();
  instance = null;
  creating = null;
  loadedLangs.clear();
  loadedThemes.clear();
}
