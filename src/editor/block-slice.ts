import type Token from 'markdown-it/lib/token.mjs';

/**
 * 一个顶层块。
 *
 * 「顶层」指 `token.level === 0` 的那一层：一个段落、一个标题、一整个列表、
 * 一整张表格。切到更细的粒度（比如每个列表项）会让编辑列表时只有一项变源码，
 * 而列表的语法恰恰是跨项的（缩进、编号连续性），那样反而更难改。
 */
export interface BlockSlice {
  /** 0-based 起始行，含 */
  startLine: number;
  /** 0-based 结束行，不含 */
  endLine: number;
  /** 本块的 token 切片，交给 markdown-it 的 renderer 渲染 */
  tokens: Token[];
  /**
   * 是否没有对应的源码行区间。
   *
   * markdown-it-footnote 会把散落各处的 `[^1]: 注释` 收拢成一个汇总块，
   * 挂在 token 流末尾且 `map === null`。它在页面上要出现（否则屏幕与导出
   * 不一致），但没有能被替换的源码行，只能作为文末 widget 附加。
   *
   * 注意：多个 trailing 块会拿到**相同**的 `[maxLine, maxLine]` 区间——
   * 它们本来就没有源码位置，无从区分。因此下游绝不能用行区间来标识
   * trailing 块（比如拿它当缓存键），必须另找唯一标识。
   * 当前只有 footnote 会产出这种块，且每篇文档至多一个，尚不会触发。
   */
  trailing: boolean;
}

/**
 * 把 token 流切成顶层块。
 *
 * 用「深度归零」而不是「找同名的 close token」来定位块的结束：容器类插件
 * （markdown-it-container）会产出自定义的开合标签名，按名字配对需要维护
 * 一张表，而深度计数对任何成对 token 都成立。
 */
export function sliceTopLevelBlocks(tokens: readonly Token[]): BlockSlice[] {
  const blocks: BlockSlice[] = [];
  /** 已消费到的最大行号，作为 trailing 块的挂载点 */
  let maxLine = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined || token.level !== 0) continue;

    // 找出本块覆盖的 token 范围：自闭合就是它自己，成对则数到深度归零
    let end = i;
    if (token.nesting === 1) {
      let depth = 0;
      for (let j = i; j < tokens.length; j++) {
        const current = tokens[j];
        if (current === undefined) continue;
        depth += current.nesting;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    } else if (token.nesting === -1) {
      // 良构的 token 流走不到这里——配对的开标签一定先被处理，
      // 它的闭标签会被 `i = end` 跳过。留着是防自定义插件产出不平衡的
      // nesting，那种情况下宁可漏掉一个孤立闭标签，也不该让它自成一块
      continue;
    }

    const slice = tokens.slice(i, end + 1);
    if (token.map) {
      const [startLine, endLine] = token.map;
      maxLine = Math.max(maxLine, endLine);
      blocks.push({ startLine, endLine, tokens: slice, trailing: false });
    } else {
      blocks.push({ startLine: maxLine, endLine: maxLine, tokens: slice, trailing: true });
    }

    i = end;
  }

  return blocks;
}
