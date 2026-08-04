import type { TextMatch } from './matcher';
import { STYLE_SLOT_IDS } from '@/utils/style-slots';

/**
 * 正文文本索引与搜索高亮绘制。
 *
 * 高亮走 CSS Custom Highlight API（`CSS.highlights` + `::highlight()`），
 * 而不是往命中处插 `<mark>`。理由在大文档上是决定性的：插标签意味着
 * 每改一次查询词就要切开、再合并成百上千个文本节点，33 万节点的文档
 * 会被反复重排；而 Highlight API 只是给浏览器一组 Range，
 * DOM 一个字节都不变，也就不会影响滚动位置、导出产物和已有的增强结果。
 */

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
 *
 * 放在这里也更合理：搜索功能自己拥有它，与 Highlight API 的注册逻辑同处一处。
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

/** 正文的扁平文本索引 */
export interface TextIndex {
  /** 全部文本节点拼接而成的字符串 */
  text: string;
  /** 文本节点，按文档顺序 */
  nodes: Text[];
  /** 每个节点在 `text` 中的起始偏移，与 nodes 一一对应 */
  starts: number[];
}

/** 跳过这些元素内部的文本：它们不是正文内容 */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'SVG']);

/**
 * 把正文里的文本节点拼成一条可搜索的长字符串。
 *
 * 拼接而不是逐节点搜索，是为了让跨节点的匹配也能被找到——
 * `**粗**体` 在 DOM 里是两个文本节点，逐节点搜「粗体」永远搜不到。
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
      // SVG 内的文字（Mermaid 图上的标签）不参与正文搜索
      if (SKIPPED.has(parent.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
      if (parent.closest('svg')) return NodeFilter.FILTER_REJECT;
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
 * 二分而不是线性扫描：一次搜索要为几千处命中各做一次定位，
 * 线性查找会退化成 O(命中数 × 节点数)。
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

/** 运行时是否支持 Highlight API */
export function supportsHighlightApi(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/**
 * 绘制高亮。
 *
 * @param ranges 全部命中
 * @param activeIndex 当前命中的下标，-1 表示没有
 */
export function paintHighlights(ranges: readonly Range[], activeIndex: number): void {
  if (!supportsHighlightApi()) return;
  if (ranges.length === 0) {
    clearHighlights();
    return;
  }

  ensureHighlightStyle();

  const active = ranges[activeIndex];
  // 当前命中单独一层：两层都画在同一处时，后注册的那层覆盖前一层
  const others = active ? ranges.filter((range) => range !== active) : ranges;

  CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...others));
  if (active) CSS.highlights.set(HIGHLIGHT_CURRENT, new Highlight(active));
  else CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/** 清除全部搜索高亮 */
export function clearHighlights(): void {
  if (!supportsHighlightApi()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}
