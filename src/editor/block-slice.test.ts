import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { describe, expect, it } from 'vitest';
import { sliceTopLevelBlocks, type BlockSlice } from './block-slice';

/** 用最朴素的 markdown-it 实例产出 token，避免测试依赖插件配置 */
function slice(source: string, md = new MarkdownIt()): BlockSlice[] {
  return sliceTopLevelBlocks(md.parse(source, {}));
}

describe('sliceTopLevelBlocks', () => {
  it('把标题与段落切成两块，行区间不重叠', () => {
    const blocks = slice('# 标题\n\n正文');
    expect(blocks.map((b) => [b.startLine, b.endLine])).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('围栏代码块整体是一块，内部的空行不构成切点', () => {
    const blocks = slice('```js\nconst a = 1;\n\nconst b = 2;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.startLine).toBe(0);
    expect(blocks[0]?.endLine).toBe(5);
  });

  it('嵌套列表是一块，不会被拆成每项一块', () => {
    const blocks = slice('- 甲\n  - 乙\n- 丙');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.endLine).toBe(3);
  });

  it('表格是一块', () => {
    const blocks = slice('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.endLine).toBe(3);
  });

  it('引用块整体是一块', () => {
    const blocks = slice('> 甲\n> 乙');
    expect(blocks).toHaveLength(1);
  });

  it('分隔线这类自闭合 token 也能成块', () => {
    const blocks = slice('段落\n\n---\n\n段落');
    expect(blocks).toHaveLength(3);
    expect(blocks[1]?.startLine).toBe(2);
  });

  it('setext 标题的行区间覆盖两行', () => {
    const blocks = slice('标题\n===\n');
    expect(blocks[0]?.endLine).toBe(2);
  });

  it('脚注汇总块没有源码行区间，标记为 trailing', () => {
    const md = new MarkdownIt().use(footnote);
    const blocks = slice('正文[^1]\n\n[^1]: 注释', md);
    const trailing = blocks.filter((b) => b.trailing);
    expect(trailing).toHaveLength(1);
    // trailing 块不占源码行，因此起止相同
    expect(trailing[0]?.startLine).toBe(trailing[0]?.endLine);
  });

  it('引用块里套列表、列表里再套列表，整体仍是一块', () => {
    const blocks = slice('> - 甲\n>   - 乙\n>   - 丙\n> - 丁');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.startLine).toBe(0);
    expect(blocks[0]?.endLine).toBe(4);
  });

  it('空文档产出空数组', () => {
    expect(slice('')).toEqual([]);
  });
});
