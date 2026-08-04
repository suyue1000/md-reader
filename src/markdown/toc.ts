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

/** 从 inline token 中提取纯文本（去掉行内标记与图片） */
function extractText(inline: Token | undefined): string {
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
}

/**
 * 收集所有 heading token。
 *
 * 导出给分块渲染用：每块各自收集扁平标题，全部到齐后再 `buildTocTree` 一次。
 * 树是有层级的，没法逐块往上拼——后一块的 h2 可能属于前一块的 h1。
 */
export function collectHeadings(tokens: readonly Token[]): FlatHeading[] {
  const headings: FlatHeading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type !== 'heading_open') continue;

    const level = Number.parseInt(token.tag.slice(1), 10);
    // markdown-it-anchor 已经把 id 写进 attrs，这里直接取，保证与正文一致
    const id = token.attrGet('id');
    if (!id) continue;

    headings.push({ id, level, text: extractText(tokens[i + 1]) });
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
    const node: TocNode = { id: heading.id, text: heading.text, level: heading.level, children: [] };

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
