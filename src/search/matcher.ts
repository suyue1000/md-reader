import { SearchQuery } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';

/**
 * 文本匹配。
 *
 * 这里有**两套**查找，服务于同一次搜索的两端，不要混用：
 *
 * 1. `findSourceMatches` / `countMatches` 查的是编辑器里的 **Markdown 源文本**，
 *    命中数与「上一处 / 下一处」的落点都由它决定。查源文本是新编辑器唯一可行的
 *    办法：块 widget 只在视口附近存在，视口外的正文根本不在 DOM 里，按 DOM 搜
 *    等于只搜了一屏。
 * 2. `findMatches` 查的是一段**已经渲染出来的纯文本**，用来在屏幕上把命中画出来
 *    （见 `block-highlight.ts`）。它与 DOM 无关，是纯字符串逻辑，因此能直接测。
 *
 * 两端会有不一致，这是源码型编辑器的固有行为，`countMatches` 上有详细说明。
 */

/** 一处匹配在文本中的区间 */
export interface TextMatch {
  start: number;
  /** 不含末位，`text.slice(start, end)` 即匹配内容 */
  end: number;
}

/** 一处匹配在源文档中的区间（CodeMirror 的文档偏移） */
export interface SourceMatch {
  from: number;
  to: number;
}

/** 匹配选项 */
export interface MatchOptions {
  /** 区分大小写 */
  caseSensitive?: boolean;
  /** 最多返回多少处，防止「a」这种查询在 10MB 文档上产生几百万个结果 */
  limit?: number;
}

/** 默认结果上限 */
export const DEFAULT_MATCH_LIMIT = 5000;

/**
 * 在文本中查找全部匹配。
 *
 * 用 `indexOf` 而不是正则：查询词来自用户输入，正则要先转义元字符，
 * 而转义之后的正则并不比 `indexOf` 快，还多一层出错的可能。
 *
 * 匹配互不重叠——找到一处后从它的**末尾**继续找。搜 `aa` 时
 * `aaa` 只算一处，这与浏览器原生查找、也与下面 `SearchCursor` 的行为一致。
 */
export function findMatches(
  haystack: string,
  query: string,
  options: MatchOptions = {},
): TextMatch[] {
  if (query === '') return [];

  const { caseSensitive = false, limit = DEFAULT_MATCH_LIMIT } = options;
  const text = caseSensitive ? haystack : haystack.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  const matches: TextMatch[] = [];
  let from = 0;

  while (matches.length < limit) {
    const index = text.indexOf(needle, from);
    if (index === -1) break;
    matches.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }

  return matches;
}

/**
 * 在编辑器的源文本里查找全部匹配。
 *
 * 走 `@codemirror/search` 的 `SearchQuery` 而不是自己对 `doc.toString()` 做
 * `indexOf`：`SearchCursor` 直接在 CodeMirror 的文本树上按块迭代，不必先把
 * 整篇文档拼成一个几 MB 的字符串；大小写折叠也按 Unicode 规则做（`İ`、`ß`
 * 这类字符 `toLowerCase()` 会改变长度，自己折叠会把偏移量算错）。
 *
 * `literal: true` 是刻意的：查找框是给人打字用的，输入 `\n` 应该找 `\n` 这两个
 * 字符本身。CodeMirror 默认（`literal: false`）会把它解释成换行，与旧实现
 * （`indexOf`）的行为不一致，也不符合一个纯文本查找框的预期。
 *
 * 上限的理由与 `findMatches` 相同：在大文档里搜「a」会有几百万处，
 * 全部收进数组只会把内存吃光，而用户根本翻不到第 5000 处以后。
 */
export function findSourceMatches(
  view: EditorView,
  query: string,
  limit = DEFAULT_MATCH_LIMIT,
): SourceMatch[] {
  if (query === '') return [];

  const cursor = new SearchQuery({ search: query, literal: true }).getCursor(view.state);
  const matches: SourceMatch[] = [];
  while (matches.length < limit) {
    const step = cursor.next();
    if (step.done === true) break;
    matches.push({ from: step.value.from, to: step.value.to });
  }
  return matches;
}

/**
 * 统计命中数。
 *
 * 查的是**源文本**而非渲染结果。这一改动带来一处如实存在的行为变化：
 * - 搜「粗体」能命中 `**粗体**`，搜「](」能命中链接语法——源码里有什么就能搜到什么；
 * - 但一段被行内标记切断的连续文字会落空：屏幕上显示「这是粗体字」，源码是
 *   `这是**粗体**字`，搜「是粗体」搜不到。旧的 DOM 实现能搜到，新的搜不到。
 *
 * 这是所有源码型编辑器的一致行为，且随着实时预览，用户看到的和搜到的本就是
 * 同一份文本。不为它做「源码 -> 渲染文本」的映射：那需要为每个行内标记维护一张
 * 偏移对照表，markdown-it 的 token 只带行号、不带行内字符偏移，做不到而且脆弱。
 */
export function countMatches(view: EditorView, query: string): number {
  return findSourceMatches(view, query).length;
}

/**
 * 计算「下一个/上一个」的序号，到头后绕回。
 *
 * 单独抽出来是因为绕回的边界最容易写错：没有结果时不能返回 -1 以外的值，
 * 而 `(current - 1 + total) % total` 里少加一个 total 就会得到负数下标。
 */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  return (((current + delta) % total) + total) % total;
}
