import type { RenderedBlock } from './block-render';

/**
 * 块 widget 的高度估算。
 *
 * ## 为什么非有不可
 *
 * CodeMirror 的高度图要在块 widget **还没被渲染出来**时就知道它占多高，
 * 否则算不出「滚到第 N 行」对应的像素位置。它问的是
 * `WidgetType.estimatedHeight`，而这个属性的默认值是 -1（「不知道」）。
 *
 * 关键在于 -1 的兜底不是「行数 × 行高」，而是**整块只算一个行高**——
 * `@codemirror/view` 的 `NodeBuilder.point()` 里写得很明白：
 *
 * ```js
 * let height = deco.widget ? deco.widget.estimatedHeight : 0;
 * if (height < 0) height = this.oracle.lineHeight;
 * ```
 *
 * 于是一个 20 行的 fenced 代码块在高度图里只占 27px，而它渲染出来有 500px。
 * 这个误差沿文档累积成几千像素，`scrollIntoView` 每测量一轮都会发现目标
 * 不在算好的位置上、于是重排一次，六轮之后 CodeMirror 放弃并打出
 * `Viewport failed to stabilize`，`scrollTop` 一动不动——目录跳转、地址栏
 * 锚点、正文锚点链接、阅读位置恢复**同时**静默失效。带代码块几乎是本项目
 * 目标文档（README、技术笔记）的常态，所以这不是边角情形。
 *
 * ## 估算的准确度要求
 *
 * 很低。估错只会让滚动落点需要再校正一轮（真实高度量出来之后 CodeMirror
 * 自己会重排），不会产生错误结果。所以这里一律选「便宜且量级正确」的算法，
 * 不为精确付出任何运行时代价：只做常数次字符串扫描，绝不碰真实 DOM——
 * 读 `offsetHeight` 会强制同步布局，而这个函数会被高度图重建时对每个块
 * 各调一次。
 *
 * ## 常量的来历
 *
 * **不是**直接抄 `markdown.css` 里那些 `margin: 0 0 1em`——照抄得出来的数是错的。
 * 全部常量真正的支柱是下面三条，都在真实构建里量过（1440px 窗口、默认设置、
 * 版心 `--content-max-width: 980px`）：
 *
 * 1. **块的最外层元素没有外边距**：`markdown.css` 的
 *    `.cm-md-block > :first-child { margin-top: 0 }` /
 *    `> :last-child { margin-bottom: 0 }`（本项目自己写的，见 markdown.css
 *    「编辑器块 widget」一节）把它清掉了。注意这条只管**直接子元素**——块内部
 *    嵌套的非末位元素照常带 1em，实测 blockquote / li 里的非末位 `<p>` 的
 *    computed `margin-bottom` 就是 16px。
 *    （`.markdown-body p { margin: 0 0 1em }` 本身是生效的：它落在所有 `@layer`
 *    之外，优先级高于 Tailwind Preflight 那条 `@layer base` 里的 `*{margin:0}`。
 *    别把「块没有外边距」记成「Preflight 把 margin 归零了」——那是两回事，
 *    照着后者去改 CSS 会改错地方。）
 * 2. **块自己有上下内边距**：同一节里的 `.cm-md-block { padding-block: 0.4em }`
 *    = 6.4px×2 = 12.8px，也是本项目写的。
 * 3. **块 widget 是 `white-space: normal`**：`markdown.css` 的同一节里显式声明。
 *    不声明的话，`.cm-content` 的 `white-space: break-spaces` 会继承进来，净化后
 *    HTML 里每个「块级标签后紧跟的换行」都保留成一次换行、各占一个 27.2px 的空行盒，
 *    每块白白多出一行。声明之后这些换行按常规折叠成空格，不再产生行盒。
 *    注意 `<br>` 不受影响——它在 `normal` 下照样强制断行，仍要单独计数。
 *
 * **所以 `markdown.css` 的「编辑器块 widget」那一节（`> :first-child` /
 * `> :last-child` / `padding-block`）是这套常量的唯一支柱。** 动那几行会让整套
 * 估算一起偏掉，而且不会有任何测试失败——改之前请连这里一起改。
 *
 * 块与块之间的空隙不归本函数管：两块之间那个**空行**是编辑器里一条真实的行，
 * CodeMirror 自己按 27.2px 记进高度图。
 *
 * 实测对账（左：本函数算出来的，右：浏览器量到的 `.cm-md-block` 边框盒）：
 *
 * | 块 | 估算 | 实测 | 偏差 |
 * | --- | --- | --- | --- |
 * | h1 / h2 / h3 | 88 / 78 / 65 | 88.3 / 78.1 / 64.9 | <1% |
 * | 单行段落 | 67 | 67.2 | -0.3% |
 * | 400 字中文段落（8 行） | 256 | 257.5 | -0.6% |
 * | 10 行 ```js 代码块 | 292 | 289.5 | +0.9% |
 * | 4 行缩进代码块 | 148 | 148.7 | -0.5% |
 * | 4 行表格 | 280 | 280.0 | 0% |
 * | 3 项列表 | 229 | 238.3 | -3.9% |
 * | 两行引用块 | 148 | 155.1 | -4.6% |
 *
 * 列表与引用块偏低的那 4%，来自上面第 1 条的后半句：它们内部嵌套的非末位元素
 * 还带着 1em 外边距，而这里没有逐个去数。
 *
 * 用户改字号会让这些数一起偏，但偏的是估算而不是结果，见上一段。
 *
 * 上面那张对账表是**加 `white-space: normal` 之前**量的，每个数都含一个 27.2px
 * 的空行盒。当前这套常量是在那份实测的基础上逐项扣除空行盒推导出来的（标题各减
 * 27、表格每行由 60 回到 `<tr>` 自身的 41、块外壳由 40 减到只剩 widget 内边距 13），
 * **尚未在真实浏览器里重新标定**。要复测的话，量 `.cm-md-block` 的边框盒即可。
 */

/** 正文行高：`--content-font-size` 16px × `--content-line-height` 1.7 = 27.2 */
const TEXT_LINE_PX = 27;

/**
 * 块自己的上下内边距：`markdown.css` 的 `.cm-md-block { padding-block: 0.4em }`
 * = 6.4px×2 = 12.8（实测 computed `padding: 6.4px 0`）。
 *
 * 它计入 ResizeObserver 量到的边框盒，估算漏掉它每块就差 13px。
 */
const WIDGET_PADDING_PX = 13;

/**
 * 一行大致放得下多少个「半宽单位」（一个西文字符算 1，一个汉字算 2）。
 *
 * 版心宽度 = `--content-max-width` 980px 减去 `.cm-content` 的
 * `padding: 2.5rem 2rem 4rem`（左右各 32px）= 916px；16px 字号下一个半宽单位
 * 正好 8px，理论容量 916 / 8 ≈ 114。
 *
 * 取 110 而不是 114，是因为实测两种文字的行盒宽度不一样：中文能顶到 912px
 * （114 单位，几乎填满），西文按**词**折行，实测只用到 883px（110 单位）就换行了。
 * 取实测里小的那个，两种文字都不会被系统性低估。
 *
 * 这个数只用来把长段落折成几行：Markdown 里段落常写成源码里的一行，不折算的话
 * 一段 600 字会被估成 27px 而实际有 200px 高，这是仅次于代码块的第二大误差来源。
 */
const CHARS_PER_LINE = 110;

/** 代码行高：`.code-block__pre` 的 font-size 0.85em(13.6px) × line-height 1.6 = 21.76 */
const CODE_LINE_PX = 22;

/**
 * fenced 代码块除代码行以外的固定开销，实测 72.0：
 * 标题栏 `.code-block__bar` 34.1（0.35em×2 内边距 + 0.72rem 的操作按钮撑出的行高）
 * + `.code-block__pre` 上下内边距 0.85em×2 = 23.1
 * + `.code-block` 上下边框 2
 * + widget 内边距 12.8。
 *
 * 这 72 里已经含了 widget 内边距（12.8），所以这一支**不**再另加
 * `WIDGET_PADDING_PX`——加了会把它算两遍。
 */
const CODE_CHROME_PX = 72;

/**
 * 表格的每一行，实测 60。
 *
 * `<tr>` 本身量到 40.7（th/td 上下内边距 0.5em×2 = 14.7 + 0.92em 字号下的行盒
 * 25.0 + 折叠边框 1）。
 *
 * 改 `white-space: normal` 之前这个数是 60：多出来的 ~19 是表格 HTML 里那些
 * 换行撑出的行盒（`.markdown-body table` 是 `display: block`，一部分换行落在
 * 表内匿名盒里被丢弃、一部分没有）。换行折叠之后它们一并消失，回到 `<tr>` 自身。
 */
const TABLE_ROW_PX = 41;

/**
 * 图片按一张 320px 估（整块，含外壳）。
 *
 * 图片的真实高度要等文件加载完才知道，源码行数（`![](x.png)` 只有一行）
 * 与它毫无关系。320 是「一张贴在技术文档里的截图」的量级；估错一倍也只是
 * 多校正一轮，而按一行 27px 算会差出十倍。
 */
const IMAGE_PX = 320;

/**
 * Mermaid 图同理：源码十几行，出图后的高度与行数无关，整块按 320 估。
 *
 * 实测一张两个节点的最小流程图整块 208.8px，真实文档里的流程图普遍更高，
 * 320 取的是这个量级。同样是经验值，不必也无法从 CSS 推。
 */
const DIAGRAM_PX = 320;

/**
 * 各级标题的整块高度。`white-space: normal` 之前实测 88.3 / 78.1 / 64.9 /
 * 61.8 / 59.7 / 58.7，各含一个 27.2px 的空行盒；折叠之后各减一个行盒。
 *
 * 算式（markdown.css：标题 line-height 1.3，h1/h2 另有 0.3em 下内边距 + 1px 下边框；
 * em 基准是**标题自己的字号**，不是 16px）：
 * h1 1.85em×16 = 29.6 → 行盒 38.5 + 内边距 8.9 + 边框 1 + widget 内边距 13 ≈ 61
 * h2 1.45em×16 = 23.2 → 行盒 30.2 + 内边距 7.0 + 边框 1 + widget 内边距 13 ≈ 51
 * h3 1.20em×16 = 19.2 → 行盒 25.0 + widget 内边距 13 ≈ 38
 * h4 1.05em×16 = 16.8 → 行盒 21.8 + widget 内边距 13 ≈ 35
 * h5 0.95em×16 = 15.2 → 行盒 19.8 + widget 内边距 13 ≈ 33
 * h6 0.90em×16 = 14.4 → 行盒 18.7 + widget 内边距 13 ≈ 32
 *
 * 标题的 `margin: 1.6em 0 0.6em` 一概不算：Preflight 已经把它归零了（见文件
 * 顶部第 1 条），块与块之间的空隙来自那条空行。
 */
const HEADING_PX = [61, 51, 38, 35, 33, 32] as const;

/** 数一个子串出现了几次。比 `match(/re/g)` 便宜，也不产生中间数组 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 估算 HTML 里可见文字折行后占几行。
 *
 * CJK 字符按两个西文字宽算：一篇中文文档里若不做这个区分，每个段落都会被
 * 低估一半，而低估是沿文档累积的。
 */
function wrappedLines(html: string): number {
  const text = html.replace(/<[^>]*>/g, '');
  if (text.length === 0) return 1;

  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // 覆盖 CJK 统一表意文字、中日韩标点、全角字符这三段最常见的宽字符区间
    const wide =
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7ff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60);
    width += wide ? 2 : 1;
  }
  return Math.max(1, Math.ceil(width / CHARS_PER_LINE));
}

/**
 * 「块级标签（或 `<br>`）后面紧跟一个换行」。
 *
 * 标签名必须白名单化，不能图省事匹配 `>\n`：`<p><strong>甲</strong>\n乙</p>` 里
 * `</strong>` 后面那个换行是**段落内部的软换行**，它本来就是一行文字、已经被
 * 源码行数算过一次，再数一次就把两行的段落估成三行。实测这两种写法的块一样高
 * （都是 94.3px），判据必须能把它们区分开。
 */
const HARD_BREAK_LINE_END = /<br\s*\/?>/g;

/**
 * 数出这一块里有多少个硬换行。
 *
 * 块 widget 是 `white-space: normal`（见 markdown.css「编辑器块 widget」一节），
 * 因此 HTML 里块级标签后面那些换行会被折叠成空格、不产生行盒——那一项不必再数。
 * 但 `<br>` 不同：它在 `normal` 下照样强制断行，`甲<br>乙` 实打实占两个行盒，
 * 不数的话带硬换行的段落会被系统性低估，而低估是沿文档累积的。
 */
function hardBreakLineBoxes(html: string): number {
  // 模块级的带 g 正则会记住 lastIndex，复用前必须归零
  HARD_BREAK_LINE_END.lastIndex = 0;
  let count = 0;
  while (HARD_BREAK_LINE_END.exec(html) !== null) count++;
  return count;
}

/**
 * 估算一个块渲染后的高度（像素）。
 *
 * 判定顺序即优先级：先认出「高度与源码行数无关」的那几类（图形、代码、
 * 表格、标题），剩下的一律按「文字折行后的行数 + 空行盒」算——段落、列表、
 * 引用块都落在这一支上，它们的共同点是高度确实由文字量决定。
 */
export function estimateBlockHeight(block: RenderedBlock): number {
  const { html } = block;
  // 渲染结果为空（比如整块被净化掉了）时也不能返回 0：0 会让高度图认为这里
  // 没有任何可滚动的内容，落点会整体前移一块
  if (html === '') return TEXT_LINE_PX;

  // Mermaid：markdown-it 阶段产出的是 <div class="mermaid-block">，图要等
  // enhance 之后才有。此时源码有多少行完全不说明问题
  if (html.includes('class="mermaid-block"')) return DIAGRAM_PX;

  // fenced 代码块：<figure class="code-block">，渲染行数 = 源码行数 - 两条围栏
  if (html.includes('class="code-block"')) {
    const lines = Math.max(1, block.endLine - block.startLine - 2);
    return lines * CODE_LINE_PX + CODE_CHROME_PX;
  }

  /*
   * 缩进式代码块没有 .code-block 外壳，也**不**走 CODE_LINE_PX：它只是一个裸
   * `<pre>`，markdown.css 没给它改字号，实测 pre 与内部 code 都是 16px 字号、
   * 27.2px 行高（4 行的块实测 148.7，按正文行高算得 148）。
   */
  if (html.startsWith('<pre')) {
    const lines = Math.max(1, block.endLine - block.startLine);
    return lines * TEXT_LINE_PX + WIDGET_PADDING_PX;
  }

  if (html.includes('<table')) {
    // 表头那一行也是 <tr>，所以直接数就够
    const rows = Math.max(1, countOccurrences(html, '<tr'));
    return rows * TABLE_ROW_PX + WIDGET_PADDING_PX;
  }

  // 图片：一块里可能有好几张，逐张累加；块里的文字另算
  const images = countOccurrences(html, '<img');
  if (images > 0) return images * IMAGE_PX + WIDGET_PADDING_PX;

  const heading = /^<h([1-6])[\s>]/.exec(html);
  if (heading) {
    const level = Number(heading[1]);
    return HEADING_PX[level - 1] ?? TEXT_LINE_PX;
  }

  /*
   * 其余按文字量折行估算，但不低于源码行数：列表、引用块、定义列表里
   * 每一源码行至少占一行，哪怕每行只有两个字。再加上块内的硬换行——
   * `<br>` 在 `white-space: normal` 下照样强制断行，要单独计一个行盒。
   */
  const sourceLines = Math.max(1, block.endLine - block.startLine);
  const textLines = Math.max(wrappedLines(html), sourceLines);
  return (textLines + hardBreakLineBoxes(html)) * TEXT_LINE_PX + WIDGET_PADDING_PX;
}
