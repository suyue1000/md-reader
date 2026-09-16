import { describe, expect, it } from 'vitest';
import { buildTocTree, filterToc, flattenToc } from './toc';

describe('buildTocTree', () => {
  it('按层级嵌套标题', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 1, line: 0 },
      { id: 'a1', text: 'A1', level: 2, line: 10 },
      { id: 'a2', text: 'A2', level: 2, line: 20 },
      { id: 'b', text: 'B', level: 1, line: 30 },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]?.children.map((n) => n.id)).toEqual(['a1', 'a2']);
    expect(tree[1]?.children).toHaveLength(0);
  });

  it('处理跳级（h1 直接到 h3）', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 1, line: 0 },
      { id: 'c', text: 'C', level: 3, line: 10 },
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children[0]?.id).toBe('c');
  });

  it('处理层级回退', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 1, line: 0 },
      { id: 'a1', text: 'A1', level: 3, line: 10 },
      { id: 'a2', text: 'A2', level: 2, line: 20 },
    ]);

    // A1 与 A2 都应挂在 A 下，A2 不能变成 A1 的子节点
    expect(tree[0]?.children.map((n) => n.id)).toEqual(['a1', 'a2']);
  });

  it('文档以深层标题开头时不丢节点', () => {
    const tree = buildTocTree([{ id: 'c', text: 'C', level: 3, line: 0 }]);
    expect(tree.map((n) => n.id)).toEqual(['c']);
  });
});

describe('filterToc', () => {
  /** 三层测试树：性能报告 > (实测对照, 关键点) / 优化路线 */
  const tree = buildTocTree([
    { id: 'perf', text: '性能报告', level: 1, line: 0 },
    { id: 'measure', text: '实测对照', level: 2, line: 10 },
    { id: 'device', text: '真机数据', level: 3, line: 20 },
    { id: 'keypoint', text: '关键点', level: 2, line: 30 },
    { id: 'roadmap', text: '优化路线', level: 1, line: 40 },
  ]);

  it('空关键词返回完整目录', () => {
    expect(filterToc(tree, '')).toHaveLength(2);
    expect(filterToc(tree, '   ')).toHaveLength(2);
  });

  it('命中的节点保留整棵子树', () => {
    const result = filterToc(tree, '实测');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('perf');
    // 「实测对照」命中，它的子节点「真机数据」应一并保留
    expect(result[0]?.children[0]?.children.map((n) => n.id)).toEqual(['device']);
  });

  it('保留命中节点的祖先以维持层级', () => {
    const result = filterToc(tree, '真机');
    expect(result[0]?.id).toBe('perf');
    expect(result[0]?.children.map((n) => n.id)).toEqual(['measure']);
    expect(result[0]?.children[0]?.children.map((n) => n.id)).toEqual(['device']);
  });

  it('剔除没有命中的分支', () => {
    const result = filterToc(tree, '关键');
    expect(result[0]?.children.map((n) => n.id)).toEqual(['keypoint']);
  });

  it('无匹配时返回空数组', () => {
    expect(filterToc(tree, '不存在的词')).toEqual([]);
  });

  it('忽略大小写', () => {
    const english = buildTocTree([{ id: 'a', text: 'Performance Report', level: 1, line: 0 }]);
    expect(filterToc(english, 'performance')).toHaveLength(1);
  });

  it('不修改原始目录树', () => {
    const snapshot = JSON.stringify(tree);
    filterToc(tree, '实测');
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});

describe('目录生成性能', () => {
  /**
   * 需求给出的指标是「目录生成 <100ms」。阈值放宽到 100ms 是给 CI 的
   * 慢机器留余量——本机实测 1000 个标题在 2ms 量级，真出问题时差距会是
   * 数量级的，不会卡在阈值边缘反复抖动。
   */
  it('1000 个标题的建树耗时在预算内', () => {
    const headings = Array.from({ length: 1000 }, (_, i) => ({
      id: `h-${String(i)}`,
      text: `标题 ${String(i)}`,
      level: (i % 5) + 1,
      line: i,
    }));

    const start = performance.now();
    const tree = buildTocTree(headings);
    const elapsed = performance.now() - start;

    expect(flattenToc(tree)).toHaveLength(1000);
    expect(elapsed).toBeLessThan(100);
  });
});

describe('flattenToc', () => {
  it('按文档顺序展平', () => {
    const tree = buildTocTree([
      { id: 'a', text: 'A', level: 1, line: 0 },
      { id: 'a1', text: 'A1', level: 2, line: 10 },
      { id: 'b', text: 'B', level: 1, line: 20 },
    ]);

    expect(flattenToc(tree).map((n) => n.id)).toEqual(['a', 'a1', 'b']);
  });
});
