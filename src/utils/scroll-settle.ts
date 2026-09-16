/**
 * 等一次程序化滚动真正落定。
 *
 * ## 为什么需要
 *
 * `scrollToLine` 派发的是 CodeMirror 的 `scrollIntoView` 效果，真正的滚动
 * 发生在它自己的测量周期里，而那**不一定是下一帧**：CodeMirror 会先按估算
 * 高度把视口挪到目标附近，量出真实高度，必要时再修一轮。带 fenced 代码块的
 * 文档实测要**三帧**才落定（逐帧采样：第 1、2 帧 `scrollTop` 仍是 0，第 3 帧
 * 直接跳到 5656）。
 *
 * 两条跳转路径都要在滚动之后记下「我们自己滚到了哪儿」，用来在之后区分
 * 「这次滚动是不是用户自己干的」。只等一帧就量，量到的是**滚动前**的值，
 * 于是第一次校正就把自己判成「用户滚走了」并**永久撤防**——
 * 表现是锚点落点偏浅、侧栏高亮落在上一节，而且怎么等都不会自愈。
 * 阅读位置恢复那边同理，还会把行内偏移叠在滚动**之前**，随即被覆盖掉。
 *
 * ## 判据
 *
 * 逐帧采样，等到「值变过一次、并且不再变」为止。用值而不是固定帧数：
 * 落定要几帧取决于文档形态（纯段落一帧，代码块三帧），写死一个数不是偏早
 * 就是偏晚。目标恰好就在当前位置时值一次都不会变，靠帧数上限收尾。
 */

/**
 * 最多等几帧。
 *
 * 上限存在的意义是收尾而不是限速：正常情况下两三帧就落定，走到上限只有
 * 「这次滚动根本没让位置发生变化」一种可能（目标已经在视口顶部）。
 * 8 帧约 130ms，用户在这段时间里做不出一次有意义的滚动。
 */
const MAX_SETTLE_FRAMES = 8;

/**
 * 逐帧观察 `read()`，落定后调用 `done` 一次。
 *
 * @param read 读当前值，通常是 `container.scrollTop`
 * @param done 落定后回调，参数是落定值；只会被调用一次
 * @returns 取消函数。组件卸载、或下一次滚动开始时必须调用，
 *   否则上一次的收尾会在新落点上再叠一遍
 */
export function afterScrollSettles(
  read: () => number,
  done: (value: number) => void,
  maxFrames: number = MAX_SETTLE_FRAMES,
): () => void {
  const initial = read();
  let frame = 0;
  let previous = initial;
  let moved = false;

  const step = (remaining: number): void => {
    frame = requestAnimationFrame(() => {
      const current = read();
      if (current !== previous) moved = true;
      // 变过一次又停住了，或者等够了，都算落定
      if ((moved && current === previous) || remaining <= 0) {
        frame = 0;
        done(current);
        return;
      }
      previous = current;
      step(remaining - 1);
    });
  };

  // remaining 是「这一帧之后还能再等几帧」，所以从 maxFrames - 1 起算，
  // 总帧数正好等于 maxFrames
  step(maxFrames - 1);

  return () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
  };
}
