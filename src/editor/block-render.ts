import type { MarkdownRenderer, RenderInput } from '@/markdown/contract';
import { sanitizeHtml } from '@/markdown/sanitize';
import { collectHeadings, type FlatHeading } from '@/markdown/toc';
import { sliceTopLevelBlocks } from './block-slice';

/** 一个已渲染的块 */
export interface RenderedBlock {
  /** 0-based 起始行，含 */
  startLine: number;
  /** 0-based 结束行，不含 */
  endLine: number;
  /** 无源码行区间，以 widget 形式挂在文末（脚注汇总块） */
  trailing: boolean;
  /** 已净化的 HTML */
  html: string;
  /**
   * 缓存键：**这一块在这篇文档里的身份**，不是它的内容。
   *
   * 形如 `序号 源码文本`（中间一个空格）。序号是「同样的源码文本在本篇文档里
   * 第几次出现」，绝大多数块都是 0，只有重复块才会拿到 1、2……
   *
   * 为什么不能只用源码文本：块缓存对同一个键返回**同一个 DOM 节点**，而一个
   * DOM 节点在文档树里只能存在于一个位置。一篇文档里出现两个源码完全相同的
   * 块（重复标题、两段一样的话、两条 `---`）时，第二个 widget 挂上这个节点
   * 就等于把它从第一个位置**摘走**，两处轮流抢，块高度塌成 0、高度图彻底错位，
   * 目录跳转 `scrollTop` 恒为 0——静默失效。
   *
   * 为什么序号加在**前面**而不是后面：序号只含数字，键因此能按第一个空格
   * 唯一地分回 (序号, 文本)，两个不同的块不可能算出同一个键。加在后面就没有
   * 这条保证——源码文本自己也可能以「空格 + 数字」结尾。
   *
   * 为什么不用「块在列表里的下标」当序号：那样在开头插一段就会让后面每一块的
   * 键全变，整篇缓存作废、Shiki 与 Mermaid 全部重跑。按「相同文本的第几次出现」
   * 计数，唯一块的键与位置无关，受影响的只有重复块本身。
   *
   * 不做 hash：序号加原文已经能唯一标识一块，做 hash 只会引入碰撞风险，
   * 而这里的内存开销不过是把文档再存一遍。
   */
  key: string;
}

/**
 * 给一段源码文本算出本次出现所对应的缓存键，并把出现次数记进 `seen`。
 *
 * 抽成函数只是为了让 `renderBlocks` 里的 map 保持一行；键的形态与理由见
 * `RenderedBlock.key`。
 */
function nextKey(text: string, seen: Map<string, number>): string {
  const seq = seen.get(text) ?? 0;
  seen.set(text, seq + 1);
  return `${String(seq)} ${text}`;
}

export interface BlockRenderResult {
  blocks: readonly RenderedBlock[];
  /** 带行号的扁平标题，供目录跳转与滚动同步定位 */
  headings: readonly FlatHeading[];
}

/**
 * 把整篇文档渲染成块。
 *
 * 关键在于**整篇解析一次、共享同一个 `env`**：脚注定义、引用式链接定义、
 * 有序列表的起始编号都是跨块的上下文。逐块独立解析会让 `[^1]` 渲染不出
 * 链接、定义在别处的 `[ref]` 退化成纯文本——而这些内容在导出时是正确的，
 * 于是屏幕与导出对不上，正是本设计要避免的。
 *
 * `renderer` 由调用方注入而不是取全局单例：Markdown 管线（约 500KB）是
 * 懒加载的，取单例会把它拖进首屏 bundle；注入也让单测能直接传一个
 * 已配置好插件的实例，不必等待懒加载。
 */
export function renderBlocks(input: RenderInput, renderer: MarkdownRenderer): BlockRenderResult {
  const md = renderer.instance(input.settings);
  const env: Record<string, unknown> = {};
  const tokens = md.parse(input.source, env);
  const lines = input.source.split('\n');

  /** 每种源码文本已经出现过几次，用来给重复块编号，见 `RenderedBlock.key` */
  const seen = new Map<string, number>();
  /** trailing 块的计数，理由同上——它们连源码文本都没有 */
  let trailingCount = 0;

  const blocks = sliceTopLevelBlocks(tokens).map<RenderedBlock>((slice) => ({
    startLine: slice.startLine,
    endLine: slice.endLine,
    trailing: slice.trailing,
    html: sanitizeHtml(md.renderer.render(slice.tokens, md.options, env), input.settings),
    // trailing 块没有源码行，也没有唯一的行区间（多个 trailing 块会共用
    // 同一个 maxLine），只能按出现次序编号。这种键不以数字加空格开头，
    // 与下面那种 `序号 源码` 的键天然不可能撞上
    key: slice.trailing
      ? `trailing:${String(trailingCount++)}`
      : nextKey(lines.slice(slice.startLine, slice.endLine).join('\n'), seen),
  }));

  // 整篇一次性 parse，`token.map` 就是文档内行号，不需要块偏移
  const headings = input.settings.markdown.toc ? collectHeadings(tokens) : [];
  return { blocks, headings };
}
