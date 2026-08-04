/**
 * 样式收集。
 *
 * 导出的 HTML 要能脱离扩展独立打开，样式必须内联进去。这里的做法是把
 * 当前文档**实际生效**的所有样式表读出来，而不是手写一份「导出专用样式」。
 *
 * 手写一份的问题在于它一定会漂移：markdown.css 改了个列表缩进，
 * 导出版本不会跟着改，两边越走越远，而这种偏差没有任何测试能自动发现。
 * 直接读 CSSOM 则天然跟随——阅读主题、用户自定义 CSS、按需注入的 KaTeX
 * 样式都在里面，顺序也和屏幕上完全一致。
 */

/** 相对 url() 的匹配；data: 与绝对地址不需要处理 */
const RELATIVE_URL = /url\(\s*(['"]?)(?!['"]?(?:data:|https?:|chrome-extension:|\/\/))([^'")]+)\1\s*\)/g;

/**
 * 把样式里的相对 url() 换成绝对地址。
 *
 * 导出的文件会被存到任意目录，相对路径（KaTeX 的字体最典型）必然失效。
 * 换成绝对地址后，只要原站点/扩展还在，字体就还能取到；取不到时浏览器
 * 回落到系统字体，公式仍然可读——比直接 404 强。
 */
function absolutizeUrls(css: string, base: string): string {
  return css.replace(RELATIVE_URL, (match, quote: string, path: string) => {
    try {
      return `url(${quote}${new URL(path, base).href}${quote})`;
    } catch {
      // 解析不了就原样留着，不值得为一条 url 让整段样式丢失
      return match;
    }
  });
}

/**
 * 读取一张样式表的全文。
 *
 * 跨域样式表访问 cssRules 会抛 SecurityError。本项目的样式全是同源的，
 * 但用户自定义 CSS 里可能 `@import` 了外部地址，所以必须容错。
 *
 * @returns 读不到时返回空串
 */
function readSheet(sheet: CSSStyleSheet, baseUri: string): string {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return '';
  }

  const text = Array.from(rules, (rule) => rule.cssText).join('\n');
  return absolutizeUrls(text, sheet.href ?? baseUri);
}

/**
 * 收集文档当前生效的全部 CSS。
 *
 * @param doc 来源文档，默认当前文档（参数化只为便于测试）
 */
export function collectDocumentCss(doc: Document = document): string {
  return Array.from(doc.styleSheets)
    .map((sheet) => readSheet(sheet, doc.baseURI))
    .filter((text) => text !== '')
    .join('\n\n');
}
