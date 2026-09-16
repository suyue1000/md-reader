import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { buildTextIndex, rangeForMatch } from './block-highlight';
import { DEFAULT_MATCH_LIMIT, countMatches, findMatches, findSourceMatches, stepIndex } from './matcher';

/** 造一个只有文档、没有实时预览的视图，用来测源文本查找 */
function makeView(doc: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc }) });
}

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

describe('countMatches', () => {
  it('统计源文本中的命中数', () => {
    const view = makeView('甲乙甲丙甲');
    expect(countMatches(view, '甲')).toBe(3);
    view.destroy();
  });

  it('空查询返回 0', () => {
    const view = makeView('甲');
    expect(countMatches(view, '')).toBe(0);
    view.destroy();
  });

  it('忽略大小写', () => {
    const view = makeView('Hello hello HELLO');
    expect(countMatches(view, 'hello')).toBe(3);
    view.destroy();
  });

  it('跨行也能数到', () => {
    // 命中数按整篇文档算，不按行——视口外的行同样要计入
    const view = makeView('甲\n\n乙\n\n甲');
    expect(countMatches(view, '甲')).toBe(2);
    view.destroy();
  });

  it('查的是源文本：语法标记本身可以被搜到', () => {
    /*
     * 这是改用源文本查找之后的**行为变化**，如实锁进用例：
     * 搜「粗体」能命中 `**粗体**`（这一条是好事），但反过来，
     * 一段被行内标记切断的连续文字会落空。
     */
    const view = makeView('这是**粗体**字');
    expect(countMatches(view, '粗体')).toBe(1);
    expect(countMatches(view, '**粗体**')).toBe(1);
    expect(countMatches(view, '是粗体')).toBe(0);
    view.destroy();
  });

  it('把查询词当字面量：`\\n` 找的是这两个字符', () => {
    // CodeMirror 默认会把 `\n` 解释成换行，查找框是给人打字用的，不该这样
    const view = makeView('a\\nb\nc');
    expect(countMatches(view, '\\n')).toBe(1);
    view.destroy();
  });
});

describe('findSourceMatches', () => {
  it('给出的是文档偏移，按出现顺序', () => {
    const view = makeView('甲乙甲');
    expect(findSourceMatches(view, '甲')).toEqual([
      { from: 0, to: 1 },
      { from: 2, to: 3 },
    ]);
    view.destroy();
  });

  it('遵守结果上限', () => {
    const view = makeView('a'.repeat(50));
    expect(findSourceMatches(view, 'a', 10)).toHaveLength(10);
    view.destroy();
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
  /** 造一块渲染结果 */
  function makeBlock(html: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'markdown-body cm-md-block';
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it('把分散的文本节点拼成连续文本', () => {
    const index = buildTextIndex(makeBlock('<p>粗<strong>体</strong>字</p>'));
    expect(index.text).toBe('粗体字');
    expect(index.nodes).toHaveLength(3);
  });

  it('跳过 SVG 内的文字', () => {
    // Mermaid 图上的标签不是正文，搜到了也没法定位
    const index = buildTextIndex(makeBlock('<p>正文</p><svg><text>图内文字</text></svg>'));
    expect(index.text).toBe('正文');
  });

  it('跳过 KaTeX 的 MathML 影子', () => {
    // 它与旁边可见的 .katex-html 逐字重复，不跳过的话每个公式里的命中都会被画两遍
    const index = buildTextIndex(
      makeBlock(
        '<span class="katex"><span class="katex-mathml">x+y</span><span class="katex-html">x+y</span></span>',
      ),
    );
    expect(index.text).toBe('x+y');
  });

  it('跨节点的匹配也能还原成 Range', () => {
    // `**粗**体` 渲染出来是两个文本节点，逐节点搜「粗体」永远搜不到
    const root = makeBlock('<p><strong>粗</strong>体字</p>');
    const index = buildTextIndex(root);
    const match = findMatches(index.text, '粗体')[0];
    expect(match).toBeDefined();

    const range = rangeForMatch(index, match!);
    expect(range).not.toBeNull();
    expect(range?.toString()).toBe('粗体');
  });

  it('单节点内的匹配定位准确', () => {
    const index = buildTextIndex(makeBlock('<p>abcdef</p>'));
    const range = rangeForMatch(index, { start: 2, end: 4 });
    expect(range?.toString()).toBe('cd');
  });
});
