import type Token from 'markdown-it/lib/token.mjs';
import type { TocNode } from '@/types';

/**
 * 从 markdown-it 的 token 流中抽取目录树。
 *
 * 为什么复用 token 而不是解析渲染后的 DOM：
 * 1. 只需一次 parse，渲染与目录共用同一份 token，省掉一次全文扫描；
 * 2. DOM 还没插入文档时就能拿到目录，侧栏和正文可以同一帧出现；
 * 3. 性能可控——1 万个标题也只是一次线性遍历，满足「目录生成 <100ms」。
 */

/**
 * 从 inline token 中提取纯文本（去掉行内标记与图片）。
 *
 * 仍然导出而不是收成模块私有：它是「标题文本该长什么样」这条规则的唯一
 * 定义，任何将来要自己取标题文本的地方都该来用它，而不是再抄一份。
 */
export function extractText(inline: Token | undefined): string {
  if (!inline?.children) return inline?.content ?? '';
  let text = '';
  for (const child of inline.children) {
    if (child.type === 'text' || child.type === 'code_inline') {
      text += child.content;
    } else if (child.type === 'emoji') {
      text += child.content;
    }
  }
  return text.trim() || (inline.content ?? '').trim();
}

/** 扁平的标题记录 */
export interface FlatHeading {
  id: string;
  text: string;
  level: number;
  /**
   * 标题所在的 0-based 行号（相对整篇文档）。
   *
   * 这个字段原本只有编辑器那份 `LineHeading` 有。收敛成一份之后，
   * 「标题该长什么样」只剩这一处定义——两份只差一个字段的规则迟早会在
   * 某个语法上分岔，而分岔的表现是目录和正文对不上，很难查。
   */
  line: number;
}

/**
 * 收集所有 heading token。
 *
 * 导出给分块渲染与编辑器块渲染共用：各自收集扁平标题，全部到齐后再
 * `buildTocTree` 一次。树是有层级的，没法逐块往上拼——后一块的 h2
 * 可能属于前一块的 h1。
 *
 * @param lineOffset 本批 token 所属文本在整篇文档里的起始行号。
 *   分块渲染是**逐块独立 parse** 的，`token.map` 记的是块内行号；不加上这个
 *   偏移，第二块之后的标题行号会全部退回块首重新计数，跳转就会跳到文档开头
 *   附近。整篇一次性 parse 的调用方（编辑器）用默认值 0 即可。
 */
export function collectHeadings(tokens: readonly Token[], lineOffset = 0): FlatHeading[] {
  const headings: FlatHeading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type !== 'heading_open') continue;

    const level = Number.parseInt(token.tag.slice(1), 10);
    // markdown-it-anchor 已经把 id 写进 attrs，这里直接取，保证与正文一致
    const id = token.attrGet('id');
    if (!id) continue;

    // token.map 理论上对 block token 总是存在；缺失时退回 0 而不是丢掉这个
    // 标题——目录里少一项比跳错一行更糟
    headings.push({
      id,
      level,
      text: extractText(tokens[i + 1]),
      line: (token.map?.[0] ?? 0) + lineOffset,
    });
  }
  return headings;
}

/**
 * 把扁平标题列表折叠成树。
 *
 * 用栈而不是递归：Markdown 里标题层级可能跳跃（h1 直接到 h3），
 * 栈的写法处理跳级和回退都只需要一次 while，且是 O(n)。
 */
export function buildTocTree(headings: readonly FlatHeading[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];

  for (const heading of headings) {
    const node: TocNode = {
      id: heading.id,
      text: heading.text,
      level: heading.level,
      line: heading.line,
      children: [],
    };

    // 弹出所有层级不低于当前标题的节点，栈顶即为父节点
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top && top.level >= node.level) {
        stack.pop();
      } else {
        break;
      }
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      root.push(node);
    }
    stack.push(node);
  }

  return root;
}

/** 从 token 流生成目录树 */
export function extractToc(tokens: readonly Token[]): TocNode[] {
  return buildTocTree(collectHeadings(tokens));
}

/** 把目录树展平成有序列表，供 Scroll Spy 与键盘导航使用 */
export function flattenToc(nodes: readonly TocNode[]): TocNode[] {
  const result: TocNode[] = [];
  const walk = (list: readonly TocNode[]): void => {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return result;
}

/**
 * 按关键词过滤目录树。
 *
 * 规则：命中的节点保留其**整棵子树**（用户搜到某一章，通常想看这章下面有什么），
 * 同时保留命中节点的所有祖先（否则层级断裂，看不出这一章属于哪一部分）。
 *
 * @param nodes 原始目录树
 * @param query 关键词，空字符串表示不过滤
 */
export function filterToc(nodes: readonly TocNode[], query: string): TocNode[] {
  const keyword = query.trim().toLowerCase();
  if (keyword === '') return [...nodes];

  const walk = (list: readonly TocNode[]): TocNode[] => {
    const kept: TocNode[] = [];
    for (const node of list) {
      const selfMatched = node.text.toLowerCase().includes(keyword);
      // 自己命中就整棵子树保留，否则只保留命中的后代
      const children = selfMatched ? node.children : walk(node.children);
      if (selfMatched || children.length > 0) {
        kept.push({ ...node, children });
      }
    }
    return kept;
  };

  return walk(nodes);
}

/**
 * 在展平后的目录里定位「当前所在的章节」：行号不大于 `line` 的最后一个标题。
 *
 * 这是滚动同步的核心判据，抽成纯函数是为了能脱离 CodeMirror 单测——
 * 它本身跟编辑器无关，只是一次有序数组上的二分查找。
 *
 * 用二分而不是线性扫描：滚动时每帧都要跑一次，长文档的标题数可能上千，
 * 二分让这一步与标题数量基本脱钩。
 *
 * @param flat 已按文档顺序展平的目录（`flattenToc` 的产物，行号天然升序）
 * @returns 命中的节点；`line` 落在第一个标题之前（文档以正文开头）时为 null
 */
export function activeHeadingAt(flat: readonly TocNode[], line: number): TocNode | null {
  let low = 0;
  let high = flat.length - 1;
  let found: TocNode | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const node = flat[mid];
    if (!node) break;
    if (node.line <= line) {
      found = node;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * 按锚点 id 在目录树里找到对应标题的行号。
 *
 * 抽成共用函数而不是让调用方各写一遍：「按 id 找行号」现在有两个调用方——
 * 地址栏锚点（`usePendingAnchor`）与正文里的 `[文字](#标题)` 链接
 * （`useRelativeLinks`）。两份实现迟早会在某个边界上分岔（大小写、去重后缀、
 * URL 解码），而分岔的表现是「同一个锚点从地址栏能跳、从正文点不动」，
 * 极难查。这与 `LineHeading` / `FlatHeading` 收敛成一份是同一个理由。
 *
 * 必须遍历整棵树：`TocNode` 是有 `children` 的树，只看顶层会漏掉除 h1 之外的
 * 全部标题。
 *
 * @returns 命中标题的 0-based 行号；目录里没有这个 id 时为 null。
 *   刻意用 null 而不是 -1 或 0——行号 0（文档第一行）本身就是个合法的跳转目标，
 *   用 0 表示「没找到」会让「跳到开篇」和「跳不动」变成同一件事。
 */
export function findHeadingLine(nodes: readonly TocNode[], id: string): number | null {
  return flattenToc(nodes).find((node) => node.id === id)?.line ?? null;
}
