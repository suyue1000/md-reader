import { afterEach, describe, expect, it } from 'vitest';
import { collectDocumentCss } from './css-collect';

/** 往文档里加一段样式，返回清理函数 */
function addStyle(css: string): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

afterEach(() => {
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

describe('collectDocumentCss', () => {
  it('按文档顺序收集所有样式表', () => {
    // 顺序即优先级（见 utils/style-slots.ts），收集时打乱顺序会让导出的
    // 文件里主题令牌被基础层反压
    addStyle(':root { --app-bg: white; }');
    addStyle(':root { --app-bg: black; }');

    const css = collectDocumentCss();
    expect(css.indexOf('white')).toBeLessThan(css.indexOf('black'));
  });

  it('把相对 url() 换成绝对地址', () => {
    // 导出文件会被存到任意目录，相对路径（KaTeX 字体最典型）必然失效
    addStyle("@font-face { font-family: K; src: url(fonts/k.woff2); }");
    expect(collectDocumentCss()).toContain(`${document.baseURI.replace(/[^/]*$/, '')}fonts/k.woff2`);
  });

  it('不动 data: 与绝对地址', () => {
    addStyle('.a { background: url(data:image/png;base64,AAA); }');
    addStyle('.b { background: url(https://example.com/x.png); }');

    const css = collectDocumentCss();
    expect(css).toContain('url(data:image/png;base64,AAA)');
    expect(css).toContain('url(https://example.com/x.png)');
  });

  it('@media 块整体保留', () => {
    // 阅读主题的配色令牌就裹在 @media screen 里，丢了它打印会变成白纸白字
    addStyle("@media screen { :root { --app-bg: #f5efe0; } }");
    const css = collectDocumentCss();
    expect(css).toContain('@media screen');
    expect(css).toContain('--app-bg');
  });
});
