import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_LIMIT, findMatches, stepIndex } from './matcher';
import { buildTextIndex, rangeForMatch } from './highlight';

describe('findMatches', () => {
  it('找出全部匹配', () => {
    expect(findMatches('abcabc', 'bc')).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it('默认忽略大小写', () => {
    expect(findMatches('Hello World', 'hello')).toEqual([{ start: 0, end: 5 }]);
  });

  it('可以要求区分大小写', () => {
    expect(findMatches('Hello hello', 'hello', { caseSensitive: true })).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  it('匹配互不重叠', () => {
    // 与浏览器原生查找一致：aaa 里搜 aa 只算一处
    expect(findMatches('aaa', 'aa')).toEqual([{ start: 0, end: 2 }]);
  });

  it('空查询返回空', () => {
    expect(findMatches('abc', '')).toEqual([]);
  });

  it('把正则元字符当普通字符', () => {
    // 用 indexOf 而不是正则，`.` 就是点，不是通配符
    expect(findMatches('a.c abc', '.')).toEqual([{ start: 1, end: 2 }]);
    expect(findMatches('a+b', 'a+b')).toHaveLength(1);
  });

  it('遵守结果上限', () => {
    // 在 10MB 文档里搜「a」会有几百万处，不设上限会直接把内存吃光
    const matches = findMatches('a'.repeat(50), 'a', { limit: 10 });
    expect(matches).toHaveLength(10);
    expect(DEFAULT_MATCH_LIMIT).toBeGreaterThan(0);
  });
});

describe('stepIndex', () => {
  it('向后循环', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
  });

  it('向前循环不会得到负数', () => {
    // `(current - 1 + total) % total` 少加一个 total 就会返回 -1
    expect(stepIndex(0, 3, -1)).toBe(2);
  });

  it('没有结果时返回 -1', () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1);
  });
});

describe('buildTextIndex 与 rangeForMatch', () => {
  /** 造一个正文容器 */
  function makeRoot(html: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'markdown-body';
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it('把分散的文本节点拼成连续文本', () => {
    const index = buildTextIndex(makeRoot('<p>粗<strong>体</strong>字</p>'));
    expect(index.text).toBe('粗体字');
    expect(index.nodes).toHaveLength(3);
  });

  it('跳过 SVG 内的文字', () => {
    // Mermaid 图上的标签不是正文，搜到了也没法定位
    const index = buildTextIndex(makeRoot('<p>正文</p><svg><text>图内文字</text></svg>'));
    expect(index.text).toBe('正文');
  });

  it('跨节点的匹配也能还原成 Range', () => {
    // `**粗**体` 在 DOM 里是两个文本节点，逐节点搜「粗体」永远搜不到
    const root = makeRoot('<p><strong>粗</strong>体字</p>');
    const index = buildTextIndex(root);
    const match = findMatches(index.text, '粗体')[0];
    expect(match).toBeDefined();

    const range = rangeForMatch(index, match!);
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe('粗体');
  });

  it('单节点内的匹配定位准确', () => {
    const index = buildTextIndex(makeRoot('<p>abcdef</p>'));
    const range = rangeForMatch(index, { start: 2, end: 4 });
    expect(range?.toString()).toBe('cd');
  });
});
