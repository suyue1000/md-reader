import type { EditorView } from '@codemirror/view';
import { blocksField } from '@/editor/live-preview';
import { STYLE_SLOT_IDS } from '@/utils/style-slots';
import { findMatches, type SourceMatch, type TextMatch } from './matcher';

/**
 * 把搜索命中画到屏幕上。
 *
 * ## 为什么这一层必须存在
 *
 * 查找本身已经改成查源文本（见 `matcher.ts`），但**源文本在屏幕上一个字都看不到**：
 * 实时预览把每一块源码整段替换成了块 widget（`live-preview.ts` 的
 * `Decoration.replace({ block: true })`），被替换掉的文本不参与渲染。因此
 * `@codemirror/search` 那套基于 `Decoration.mark` 的高亮——包括
 * `highlightSelectionMatches()` 和它自带搜索面板里的全量高亮——挂上去是**完全
 * 不可见**的。CodeMirror 在这个项目里给不出可见的命中高亮，只能自己画。
 *
 * ## 画法：CSS Custom Highlight API，画在渲染结果上
 *
 * 走 `CSS.highlights` + `::highlight()`，而不是往命中处插 `<mark>`。在这个项目里
 * 这不是偏好问题：块 DOM 由 `block-cache` 按键复用，同一个节点滚出视口再滚回来
 * 还是它——往里插标签等于把用户的搜索痕迹**焊进缓存**，清高亮时还得原样拆回去，
 * 一步没拆干净就污染了导出产物。Highlight API 只是给浏览器一组 Range，
 * DOM 一个字节都不改。
 *
 * ## 已知的不对齐（如实记录）
 *
 * 计数走源文本、高亮走渲染结果，两者在少数查询上对不齐：
 * - 查询只匹配到语法标记时（搜 `**`、搜 `](`），源文本里有命中、屏幕上没有对应
 *   的字符可画，于是计数有、高亮无。跳转仍然把那一块带到视口里。
 * - 反过来（渲染文本里有、源文本里没有，比如搜「是粗体」）计数为 0，压根不会走到
 *   这里，也就不会出现「画了却没计数」。
 * - Mermaid 图里的文字同样是「计数有、高亮无」，理由与上一条不同，
 *   见 `SHADOW_SELECTOR`。
 * 不做「源码偏移 -> 渲染偏移」的映射，理由见 `countMatches` 的说明。
 */

/** 块 widget 的根节点，由 `block-cache.acquire` 打上这个类名 */
const BLOCK_SELECTOR = '.cm-md-block';

/** 全部命中的高亮名 */
const HIGHLIGHT_ALL = 'md-search';
/** 当前命中的高亮名 */
const HIGHLIGHT_CURRENT = 'md-search-current';

/** 高亮样式节点的 id */
const STYLE_ID = 'search-highlight-style';

/**
 * 搜索高亮的样式。
 *
 * 运行时注入而不是写进 markdown.css，是因为构建期的 CSS 优化器
 * （Tailwind v4 用的 LightningCSS）不认识 `::highlight()` 这个伪元素，
 * 每次构建都会报两条 "not recognized as a valid pseudo-element" 警告。
 * 规则本身能原样通过，功能没问题，但长期留着一条假警告会训练人忽略警告。
 */
const HIGHLIGHT_CSS = `
::highlight(${HIGHLIGHT_ALL}) {
  background-color: var(--app-accent-soft);
  color: var(--app-text);
}
::highlight(${HIGHLIGHT_CURRENT}) {
  background-color: var(--app-accent);
  color: var(--app-accent-contrast);
}
`;

/**
 * 确保高亮样式已注入。
 *
 * 插到用户自定义 CSS 之前，保证用户仍能覆盖这两条（见 utils/style-slots.ts
 * 定下的层级：基础 < 主题 < 用户）。
 */
function ensureHighlightStyle(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = HIGHLIGHT_CSS;

  const userStyle = document.getElementById(STYLE_SLOT_IDS.user);
  if (userStyle) document.head.insertBefore(style, userStyle);
  else document.head.appendChild(style);
}

/** 一块渲染结果的扁平文本索引 */
export interface TextIndex {
  /** 全部文本节点拼接而成的字符串 */
  text: string;
  /** 文本节点，按文档顺序 */
  nodes: Text[];
  /** 每个节点在 `text` 中的起始偏移，与 nodes 一一对应 */
  starts: number[];
}

/** 这些元素里的文字不是「屏幕上看到的正文」，不参与高亮 */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE']);

/**
 * 这两类子树里的文字不参与高亮。两条的理由**不一样**，别当成同一条。
 *
 * ## `.katex-mathml`：同一个公式的第二份副本
 *
 * KaTeX 为屏幕阅读器额外输出一份 MathML，与旁边可见的 `.katex-html` 逐字重复。
 * 不跳过的话，一处源码命中会被画成两处，而多出来的那一处落在一个**看不见却
 * 仍然参与布局**的节点上——KaTeX 用的是无障碍界那套「视觉隐藏」写法，
 * **不是** `display: none`（`node_modules/katex/dist/katex.css:159-168`：
 * `position: absolute` + `clip-path: inset(50%)` + `width/height: 1px`
 * + `overflow: hidden`；实测 computed style 与它一致，矩形 1×1）。
 *
 * 这个区别是有后果的，不只是措辞：`display: none` 的节点量不到矩形，而这种节点
 * 量得到一个 1×1 的矩形，`useSearch` 那句「当前命中在不在可视区内」会据此判错，
 * 于是该滚的时候不滚。
 *
 * ## `svg`：Mermaid 的图——跳过是有代价的取舍，不是白捡
 *
 * 图上的标签**在屏幕上看得见**，跳过它意味着「图里的文字在源码中被计数、却没有
 * 高亮」。两个想当然的理由都已实测**排除**（Chrome 152，含一张 `graph TD` 的文档）：
 * 图里**没有**用来量宽度的隐藏副本（含关键词的文本节点只有 1 个，`tspan` 39×18，
 * computed `visibility: visible`）；Highlight API 画在 SVG 文本上也**确实画得出来**
 * （同一块区域在注册高亮前后截图，字节不同；用普通段落做正例对照）。
 *
 * 真正的理由是**定位对不上**。块内的「第几处」是源码坐标与渲染坐标之间唯一的桥
 * （见 `ActiveSlot`），而 Mermaid 的图形布局与源码的书写次序没有对应关系：先写的
 * 节点完全可能被画在右下角，源码里的节点 id、箭头语法又根本不出现在图上。
 * 按序号配对会把「当前命中」画到图里的另一处去。宁可少画一处，不要画错一处。
 */
const SHADOW_SELECTOR = 'svg, .katex-mathml';

/**
 * 把一块渲染结果里的文本节点拼成一条可搜索的长字符串。
 *
 * 拼接而不是逐节点搜索，是为了让跨节点的匹配也能被找到——
 * `**粗**体` 渲染出来是两个文本节点，逐节点搜「粗体」永远搜不到。
 *
 * 索引按**块**建而不是按整篇正文建（旧实现的做法）：编辑器只保留视口附近的
 * 块 widget，「整篇正文」这个 DOM 根本不存在。旧实现用
 * `document.querySelector('.markdown-body')` 取正文，而每个块都带这个类名，
 * 于是只取到了第一块——查找因此只在文档开头那一块里生效。
 */
export function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  const parts: string[] = [];
  let offset = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIPPED_TAGS.has(parent.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SHADOW_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return node.nodeValue ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    const value = current.nodeValue ?? '';
    nodes.push(current as Text);
    starts.push(offset);
    parts.push(value);
    offset += value.length;
    current = walker.nextNode();
  }

  return { text: parts.join(''), nodes, starts };
}

/**
 * 找出偏移量落在哪个文本节点里。
 *
 * 二分而不是线性扫描：一块里可能有上千处命中，线性查找会退化成
 * O(命中数 × 节点数)。
 */
function locate(index: TextIndex, offset: number): number {
  let low = 0;
  let high = index.starts.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((index.starts[mid] ?? 0) <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/** 把一处匹配还原成 DOM Range；跨节点的匹配也能正确覆盖 */
export function rangeForMatch(index: TextIndex, match: TextMatch): Range | null {
  const startNode = index.nodes[locate(index, match.start)];
  const endNode = index.nodes[locate(index, match.end - 1)];
  const startBase = index.starts[locate(index, match.start)];
  const endBase = index.starts[locate(index, match.end - 1)];
  if (!startNode || !endNode || startBase === undefined || endBase === undefined) return null;

  const range = document.createRange();
  range.setStart(startNode, match.start - startBase);
  range.setEnd(endNode, match.end - endBase);
  return range;
}

/** 一块渲染结果里全部命中的 Range，按出现顺序 */
function rangesInBlock(node: HTMLElement, query: string): Range[] {
  const index = buildTextIndex(node);
  return findMatches(index.text, query)
    .map((match) => rangeForMatch(index, match))
    .filter((range): range is Range => range !== null);
}

/**
 * 「当前命中」在渲染侧的坐标：它落在哪一块、是那一块里的第几处。
 *
 * 为什么不用源文档偏移直接定位：块 widget 里的 DOM 与源码之间没有字符级的
 * 对应关系（语法标记被吃掉、`&amp;` 被解码、锚点链接是凭空多出来的）。
 * 「第几块的第几处」是这两套坐标之间唯一稳定的对应，绝大多数查询下
 * 一块里的源码命中与渲染命中数量相同、次序相同。
 */
export interface ActiveSlot {
  /** 命中所在块的缓存键，与 DOM 上的 `data-block-key` 一致 */
  blockKey: string;
  /** 它在这一块里是第几处命中，0 开始 */
  ordinal: number;
}

/**
 * 把「第 current 处源码命中」换算成渲染侧的坐标。
 *
 * 按块列表线性找而不是二分：块列表本身要现算行号到偏移的换算，
 * 而这个函数每次导航只调一次，不在热路径上。
 */
export function locateActive(
  view: EditorView,
  matches: readonly SourceMatch[],
  current: number,
): ActiveSlot | null {
  const match = matches[current];
  const blocks = view.state.field(blocksField, false);
  if (!match || !blocks) return null;

  const doc = view.state.doc;
  for (const block of blocks) {
    // trailing 块（脚注汇总）没有源码行，命中不可能落在它的行区间里
    if (block.trailing) continue;
    if (block.startLine + 1 > doc.lines || block.endLine > doc.lines) continue;
    const from = doc.line(block.startLine + 1).from;
    const to = doc.line(block.endLine).to;
    if (match.from < from || match.from > to) continue;

    let ordinal = 0;
    for (let i = 0; i < current; i++) {
      const earlier = matches[i];
      if (earlier && earlier.from >= from && earlier.from <= to) ordinal++;
    }
    return { blockKey: block.key, ordinal };
  }
  return null;
}

/** 当前命中在渲染结果里对应的那个 Range；块没挂载、或渲染侧对不上时为 null */
export function activeMatchRange(
  view: EditorView,
  query: string,
  active: ActiveSlot | null,
): Range | null {
  if (!active || query === '') return null;
  for (const node of view.dom.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (node.dataset.blockKey !== active.blockKey) continue;
    return rangesInBlock(node, query)[active.ordinal] ?? null;
  }
  return null;
}

/** 运行时是否支持 Highlight API */
export function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/**
 * 把当前挂载的每一块里的命中全部画上高亮。
 *
 * 只能画**此刻挂在 DOM 上**的块——视口外的块 widget 已经被 CodeMirror 销毁，
 * 没有节点可画。所以调用方必须在块挂载/卸载（滚动）以及块内容被增强
 * （Shiki 上色、Mermaid 出图会整段换掉块内的 DOM，上一批 Range 随之失效）
 * 之后重画，见 `useSearch` 里的 MutationObserver。
 *
 * @returns 本次实际画上的高亮数，供验收时与命中数对账
 */
export function paintBlockHighlights(
  view: EditorView,
  query: string,
  active: ActiveSlot | null,
): number {
  if (!supportsHighlightApi()) return 0;
  if (query === '') {
    clearHighlights();
    return 0;
  }
  ensureHighlightStyle();

  const others: Range[] = [];
  let activeRange: Range | null = null;

  for (const node of view.dom.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    const ranges = rangesInBlock(node, query);
    if (ranges.length === 0) continue;
    if (active && node.dataset.blockKey === active.blockKey) {
      activeRange = ranges[active.ordinal] ?? null;
    }
    for (const range of ranges) {
      if (range !== activeRange) others.push(range);
    }
  }

  // 当前命中单独一层：两层都画在同一处时，后注册的那层覆盖前一层
  if (others.length > 0) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...others));
  else CSS.highlights.delete(HIGHLIGHT_ALL);
  if (activeRange) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(activeRange));
  else CSS.highlights.delete(HIGHLIGHT_CURRENT);

  return others.length + (activeRange ? 1 : 0);
}

/** 清除全部搜索高亮 */
export function clearHighlights(): void {
  if (!supportsHighlightApi()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}
