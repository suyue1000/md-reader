import type { ResolvedTheme } from '@/utils/theme';

/** 组装独立 HTML 所需的材料 */
export interface StandaloneHtmlInput {
  /** 文档标题，同时作为 <title> */
  title: string;
  /** 已清理的正文 HTML（见 dom-snapshot.ts） */
  bodyHtml: string;
  /** 内联样式全文（见 css-collect.ts） */
  css: string;
  /** 导出时生效的明暗模式，写进 data-theme */
  theme: ResolvedTheme;
  /** 生成时间，注入到页脚署名；参数化便于测试 */
  generatedAt?: Date;
}

/** HTML 文本转义，用于把标题安全地放进 <title> 与属性 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 导出文件的补充样式。
 *
 * 屏幕上的背景色来自应用外壳（AppShell 的容器类），而导出的文件没有外壳，
 * 所以这几条要显式补上。放在收集到的样式**之后**，才能盖住 Tailwind
 * Preflight 对 body 的重置。
 */
const DOCUMENT_STYLES = `
/* --- 导出补充：还原阅读器的页面底色与版心 --- */
html, body {
  background: var(--app-bg);
  color: var(--app-text);
}
body {
  margin: 0;
  font-family: var(--content-font-family);
}
.export-article {
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  max-width: var(--content-max-width);
}
.export-footer {
  margin: 3rem auto 0;
  padding-top: 1rem;
  max-width: var(--content-max-width);
  border-top: 1px solid var(--app-border-subtle);
  color: var(--app-text-subtle);
  font-size: 12px;
}
@media print {
  .export-footer { display: none; }
  .export-article { padding: 0; max-width: none; }
}
`;

/**
 * 组装一个自包含的 HTML 文件。
 *
 * 「自包含」的边界说明白：样式、代码配色、Mermaid 图（已是内联 SVG）、
 * 公式结构都在文件里；**图片和 KaTeX 字体不在**。图片保留原始 src，
 * 相对路径的图片需要和 Markdown 原文放在同一相对位置才显示得出来。
 * 把图片转成 base64 会让一篇带图长文膨胀到几十 MB，得不偿失。
 */
export function buildStandaloneHtml(input: StandaloneHtmlInput): string {
  const { title, bodyHtml, css, theme, generatedAt = new Date() } = input;
  const safeTitle = escapeHtml(title);

  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Markdown Reader">
<title>${safeTitle}</title>
<style>
${css}
${DOCUMENT_STYLES}
</style>
</head>
<body>
<main class="export-article">
<div class="markdown-body">
${bodyHtml}
</div>
</main>
<footer class="export-footer">${safeTitle} · 由 Markdown Reader 导出于 ${generatedAt.toLocaleString('zh-CN')}</footer>
</body>
</html>
`;
}
