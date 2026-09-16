/**
 * 阅读位置的坐标换算。
 *
 * 单独拆出来是因为这两步换算原本嵌在 `useReadingPosition` 的滚动回调里，
 * 要跑真实的 `EditorView` 才能验证——审查因此指出它是「零测试覆盖」的
 * Critical 缺口。换算本身只是两次 `Math.max(0, ...)`，跟 CodeMirror 没有
 * 关系，拆成纯函数后可以直接单测，不用启动编辑器。
 */

/**
 * 把「容器可视区顶部」换算成「文档内高度坐标」。
 *
 * 编辑器不自己滚动（`height: auto`），真正滚动的是外层容器；而 CodeMirror
 * 的 `lineBlockAtHeight` 认的是相对文档顶部（`view.documentTop`，第一行顶部
 * 的视口坐标）的距离。两个坐标系的原点不同，这一步就是对齐原点。
 *
 * 结果夹到 0 是因为：容器顶部有可能滚到比文档顶部更靠上的位置（比如文档
 * 前面还有别的元素），这时候「文档内高度」在语义上就是 0，不该是负数——
 * 负数传给 `lineBlockAtHeight` 没有意义。
 */
export function heightInDocument(containerTop: number, documentTop: number): number {
  return Math.max(0, containerTop - documentTop);
}

/**
 * 给定命中的行块，算出目标高度落在该行内的像素偏移。
 *
 * 只记行号还原不到长行/换行行内的精确位置——同一行可能占好几个视觉行，
 * 这个偏移补的就是「行内的第几个视觉行」。夹到 0 防的是浮点误差：
 * 命中的块本应满足 `blockTop <= heightInDoc`，但两者都来自不同的测量
 * 路径，理论上可能出现极小的负差。
 */
export function offsetWithinBlock(heightInDoc: number, blockTop: number): number {
  return Math.max(0, heightInDoc - blockTop);
}

/**
 * 一次观测到的 `scrollTop` 能否归为「跟我们自己最后一次写入的值一致」。
 *
 * `useReadingPosition` 用它甄别一次 `scroll` 事件是不是用户真的动了手：
 * 差值在容差内就认为还是程序化滚动本身的抖动（次像素取整、增强改高度
 * 触发的 scroll anchoring），容差的取值考量见调用方 `SCROLL_TOLERANCE_PX`
 * 上方的说明——这里只负责比较，不负责解释为什么选这个数。
 */
export function isWithinScrollTolerance(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

/**
 * 容器是否已经滚到底。
 *
 * 目录高亮用它切换判据：正常情况下「当前章节」是最后一个越过视口顶边的
 * 标题，但文档末尾的标题永远推不到顶边——已经没有可滚的余量了。到底时
 * 改用视口底边判定，末尾章节才可能被高亮到。
 *
 * 和 `heightInDocument` / `offsetWithinBlock` 一样抽成纯函数，是因为判据
 * 内联在 effect 里就只能靠真实容器验证，而这三行跟 DOM 没有关系。
 *
 * 短文档（内容一屏放得下）直接判 false：此时 `scrollHeight - clientHeight`
 * 本来就在容差之内，不特判的话「到底」会恒成立，变成「无论看哪儿都高亮
 * 最后一节」。
 *
 * @param tolerance 允许的误差（像素）。**不能取 0**：浏览器缩放或非整数
 *   设备像素比下，`scrollTop` 是带小数的，`scrollHeight - scrollTop -
 *   clientHeight` 永远落不到精确值上，判据会永不成立——末尾章节点不亮的
 *   毛病会悄悄复发，而且没有任何报错。取值考量见调用方的说明。
 */
export function isScrolledToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  tolerance: number,
): boolean {
  // 根本没有可滚的余量，「到底」这个概念不成立
  if (scrollHeight - clientHeight <= tolerance) return false;
  return scrollHeight - scrollTop - clientHeight <= tolerance;
}
