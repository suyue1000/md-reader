/**
 * 文本匹配。
 *
 * 与 DOM 无关的纯逻辑，单独成文件是为了能直接测——搜索的边界情况
 * （空查询、重叠匹配、大小写、正则元字符）远比它看起来多，
 * 混在 DOM 操作里就只能靠手点验证。
 */

/** 一处匹配在文本中的区间 */
export interface TextMatch {
  start: number;
  /** 不含末位，`text.slice(start, end)` 即匹配内容 */
  end: number;
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
 * `aaa` 只算一处，这与浏览器原生查找的行为一致。
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
 * 计算「下一个/上一个」的序号，到头后绕回。
 *
 * 单独抽出来是因为绕回的边界最容易写错：没有结果时不能返回 -1 以外的值，
 * 而 `(current - 1 + total) % total` 里少加一个 total 就会得到负数下标。
 */
export function stepIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  return (((current + delta) % total) + total) % total;
}
