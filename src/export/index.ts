import type { ExportResult, MarkdownDocument } from '@/types';
import type { ResolvedTheme } from '@/utils/theme';
import { collectDocumentCss } from './css-collect';
import { prepareExportFragment } from './dom-snapshot';
import { replaceExtension, saveFile } from './download';
import { buildStandaloneHtml } from './html';
import { normalizeMarkdown } from './markdown';

export { buildStandaloneHtml } from './html';
export { collectDocumentCss } from './css-collect';
export { normalizeMarkdown } from './markdown';
export { prepareExportFragment } from './dom-snapshot';
export { replaceExtension, saveFile } from './download';

/** 屏幕上正文节点的选择器 */
const CONTENT_SELECTOR = '.markdown-body';

/** 导出所需的上下文 */
export interface ExportContext {
  doc: MarkdownDocument;
  /** 当前生效的明暗模式 */
  theme: ResolvedTheme;
}

/**
 * 导出为独立 HTML。
 *
 * 必须在用户手势的调用栈内调用（保存对话框的要求）。
 */
export async function exportHtml(context: ExportContext): Promise<ExportResult> {
  const content = document.querySelector<HTMLElement>(CONTENT_SELECTOR);
  if (!content) return { status: 'error', message: '正文尚未渲染完成' };

  const html = buildStandaloneHtml({
    title: context.doc.name,
    bodyHtml: prepareExportFragment(content).innerHTML,
    css: collectDocumentCss(),
    theme: context.theme,
  });

  const filename = replaceExtension(context.doc.name, 'html');
  return saveFile(filename, new Blob([html], { type: 'text/html;charset=utf-8' }), {
    description: 'HTML 文件',
    accept: { 'text/html': ['.html'] },
  });
}

/**
 * 导出规整后的 Markdown 源文本。
 *
 * 注意导出的是**源文本**而不是渲染结果——Markdown 的价值就在于它是源。
 */
export async function exportMarkdown(context: ExportContext): Promise<ExportResult> {
  const text = normalizeMarkdown(context.doc.content);
  return saveFile(
    context.doc.name,
    new Blob([text], { type: 'text/markdown;charset=utf-8' }),
    { description: 'Markdown 文件', accept: { 'text/markdown': ['.md', '.markdown'] } },
  );
}

/**
 * 导出 PDF。
 *
 * 这里直接调浏览器打印，让用户在打印对话框里选「另存为 PDF」，
 * 而不是引入 jsPDF / html2canvas 之类的库。原因有三：
 *
 * 1. **质量**：浏览器打印管线输出的是矢量文字，可选中、可检索、可无损缩放；
 *    html2canvas 那条路是先截成位图再塞进 PDF，文字发虚且体积暴涨。
 * 2. **分页**：`break-inside` / `break-after` 这些规则只有真正的打印管线认，
 *    print.css 里为代码块、表格、标题写的分页控制能直接生效。
 * 3. **体积**：这两个库加起来接近 1MB，而它们能做的事浏览器已经内置了。
 *
 * 代价是没法静默生成文件——必须经过用户手动确认的打印对话框。
 * 对一个本地阅读器来说这个代价是划算的。
 *
 * 返回 void 而不是 ExportResult：打印对话框的结果（存了还是取消了）
 * 浏览器不会告诉页面，编不出一个诚实的结果。
 */
export function exportPdf(): void {
  window.print();
}
