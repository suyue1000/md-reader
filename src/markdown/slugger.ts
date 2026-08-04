/**
 * 标题锚点 id 生成。
 *
 * 单独抽出来的原因：锚点 id 同时被三个地方依赖——正文标题元素、TOC 树、
 * URL hash 跳转。三者必须用同一套规则，否则点目录跳不过去。
 */

/**
 * 需要从锚点中剔除的标点（含中英文常见符号）。
 *
 * Unicode 区间一律用 `\uXXXX` 转义而不是字面量：U+2000–U+206F 里包含
 * 各种不可见空白，直接写进源码会变成看不见的字符，既难维护也会被 lint 拦下。
 */
const PUNCTUATION = new RegExp(
  [
    '[',
    '\\u2000-\\u206f', // 通用标点（含各类空格、破折号、省略号）
    '\\u2e00-\\u2e7f', // 补充标点
    '\\u3000-\\u303f', // CJK 符号与标点（。、《》【】等）
    '\\uff00-\\uff0f\\uff1a-\\uff20\\uff3b-\\uff40\\uff5b-\\uff65', // 全角标点
    "\\\\'!\"#$%&()*+,./:;<=>?@\\[\\]^`{|}~",
    ']',
  ].join(''),
  'g',
);

/**
 * 把标题文本转成锚点 id。
 *
 * 保留 CJK 字符而不是把中文标题转成空串——GitHub 的做法也是如此，
 * 中文文档里几乎所有标题都是中文，丢掉就等于没有锚点。
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(PUNCTUATION, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 带去重能力的 slug 生成器。
 * 同名标题会依次得到 `foo`、`foo-1`、`foo-2`，与 GitHub 行为一致。
 */
export class Slugger {
  private readonly used = new Map<string, number>();

  /** 生成唯一 slug */
  slug(text: string): string {
    const base = slugify(text) || 'section';
    const seen = this.used.get(base);
    if (seen === undefined) {
      this.used.set(base, 0);
      return base;
    }
    const next = seen + 1;
    this.used.set(base, next);
    return `${base}-${next}`;
  }

  /** 重置计数，换文档时调用 */
  reset(): void {
    this.used.clear();
  }
}
