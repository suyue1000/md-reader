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

/**
 * 打印容器的 id。
 *
 * 与 `src/styles/print.css` 里的选择器一一对应，改名要两处一起改。
 */
export const PRINT_ROOT_ID = 'print-root';

/** 导出所需的上下文 */
export interface ExportContext {
  doc: MarkdownDocument;
  /** 当前生效的明暗模式 */
  theme: ResolvedTheme;
  /**
   * 要导出的源文本。
   *
   * 单独一个字段而不是直接用 `doc.content`：store 里那份是「上次灌进编辑器的」
   * 副本，编辑器里的文本才是用户此刻看到的。
   */
  source: string;
}

/** 导出 HTML 额外需要一份渲染好的正文 */
export interface HtmlExportContext extends ExportContext {
  /**
   * 已渲染并增强完毕的完整正文节点，由调用方通过 `renderOffscreen` 准备。
   *
   * 不再自己去 DOM 里找：编辑器只渲染视口附近的块，而**每个块 widget 都带
   * `.markdown-body`**，`querySelector` 只会取到第一块，导出得到的是开头一小段。
   */
  content: HTMLElement;
}

/**
 * 导出为独立 HTML。
 *
 * 必须在用户手势的调用栈内调用（保存对话框的要求）。
 */
export async function exportHtml(context: HtmlExportContext): Promise<ExportResult> {
  const content = context.content;

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
  const text = normalizeMarkdown(context.source);
  return saveFile(context.doc.name, new Blob([text], { type: 'text/markdown;charset=utf-8' }), {
    description: 'Markdown 文件',
    accept: { 'text/markdown': ['.md', '.markdown'] },
  });
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
 *
 * ## 为什么要往页面里塞一个 `#print-root`
 *
 * 过去直接打印页面本身，因为页面上就是完整正文。编辑器只渲染视口附近的块
 * 之后，直接打印只会得到视口那几块，配合 print.css 里「打破固定高度」的规则，
 * 结果是一份看起来正常、实际残缺的文档。所以改成把离屏渲染的完整正文塞进
 * 一个只在打印时可见的容器，同时由 print.css 把编辑器整个藏掉。
 *
 * 塞进去的是 `prepareExportFragment` 的**克隆**而不是节点本身：调用方
 * （`renderOffscreen` 的 dispose）仍然握着那棵树的所有权，而且纸上同样
 * 不需要复制/折叠按钮——与导出 HTML 用同一套清理，两个出口不会走偏。
 *
 * ## 为什么必须等图片
 *
 * 这一条是实测出来的，不是预防性的。8 张 600×400 PNG 的文档，不等的话
 * `window.print()` 被调的那一刻克隆里**只有 2 张解码完**（就是屏幕上已经挂着、
 * 走了浏览器缓存的那两张），其余 6 张还在路上——而 `window.print()` 是同步的，
 * 纸上那 6 张就是空框。
 *
 * 成因链条已查证：图片增强给每张图设了 `loading="lazy"`
 * （`plugins/builtin/images.ts`），而离屏那棵树定位在 `left:-99999px`，
 * 懒加载的图永远等不到「接近视口」，所以离屏阶段一张都没下载；
 * 紧接着 `prepareExportFragment` 又把 `loading` 属性摘掉了
 * （静态文件里懒加载没有收益），于是克隆一挂进文档，8 张图**同时从零开始**请求。
 *
 * 在 print() 之前多等一会儿是安全的，不会把打印预览等没了：`window.print()`
 * **不吃瞬时用户激活**，这一点是实测过的，不是照着 `showSaveFilePicker` 想当然。
 * 实测方法：在一个全程零交互的页面里用定时器调 `window.print()`——预览照常弹出
 * 并把渲染进程挡住（CDP 的 `Runtime.evaluate` 从此无响应），没有任何异常。
 * 若它有手势门禁，那次调用应当立刻抛错或静默返回。
 */
async function waitForImages(root: HTMLElement, timeoutMs: number): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img'), (img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    // decode() 是「解码完」而不只是「下载完」，正是打印需要的那个时刻；
    // jsdom 等环境没有它，退回 load/error 事件
    if (typeof img.decode === 'function') return img.decode();
    return new Promise<void>((resolve) => {
      img.addEventListener('load', () => resolve(), { once: true });
      img.addEventListener('error', () => resolve(), { once: true });
    });
  });
  if (pending.length === 0) return;

  /*
   * 保险丝，不是调优旋钮：一张取不到的图（断链、离线的远程地址）会让
   * decode() 一直悬着，没有它整个打印就永远不会发生。超时之后照常打印，
   * 代价只是那几张来不及的图印成空框——好过一张纸都印不出来。
   */
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/**
 * 等图片解码的上限，见 `waitForImages` 里的说明。
 */
const PRINT_IMAGE_TIMEOUT_MS = 10_000;

/**
 * 见上方说明。
 *
 * @param content 已渲染并增强完毕的完整正文节点
 */
export async function exportPdf(content: HTMLElement): Promise<void> {
  // 上一次打印若被中断（afterprint 没来）会留下残骸，先清掉
  document.getElementById(PRINT_ROOT_ID)?.remove();

  const container = document.createElement('div');
  container.id = PRINT_ROOT_ID;
  container.appendChild(prepareExportFragment(content));
  document.body.appendChild(container);

  const cleanup = (): void => {
    container.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // 必须在 print() 之前：window.print() 是同步的，图片没解码完就是空框
  await waitForImages(container, PRINT_IMAGE_TIMEOUT_MS);

  window.print();
}
