import { useCallback, useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { scrollToLine } from '@/editor/MarkdownEditor';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { findHeadingLine } from '@/markdown/toc';
import { syncAnchorHash } from './useEmbeddedDocument';
import { useDocumentStore } from '@/stores/document.store';
import { isWithinScrollTolerance } from '@/utils/scroll-math';
import { afterScrollSettles } from '@/utils/scroll-settle';

/**
 * 判定「用户是不是自己滚走了」时允许的容差（像素）。
 *
 * 取值与 `useReadingPosition` 的 `SCROLL_TOLERANCE_PX` 同源：只吞次像素取整
 * 这类「不算真的动了」的抖动，一次真实的滚动手势远大于它。
 *
 * 这里能用这么小的容差，是有实测依据的：带锚点打开后连续采样 6 秒，Shiki
 * 从未上色到全部上色的整个过程里 `scrollTop` 一动没动（恒为 5191）。增强
 * 造成的漂移发生在**文档坐标**里（上方内容变高，目标行整体下移），不体现
 * 为 `scrollTop` 变化——这正是校正要修的东西，也正是它不会被误判成用户滚动
 * 的原因。
 */
const ANCHOR_SCROLL_TOLERANCE_PX = 2;

export interface UsePendingAnchorResult {
  /**
   * 供 `MarkdownEditor` 的 `onEnhanced` 调用：一轮增强（Shiki 上色、Mermaid
   * 出图）结束后，重新按锚点行号滚一次。
   *
   * 与 `useReadingPosition` 的同名回调是**两件不同的事**，不要合并：这里做的
   * 是「再按锚点滚一次」，那里做的是「恢复上次读到的位置」。带锚点打开的文档
   * 只允许发生前者，见 `useReadingPosition` 里 `anchorOpenRef` 闩锁的说明。
   */
  onEnhanced: () => void;
}

/**
 * 消费待跳转的标题锚点。
 *
 * 打开 `xxx.md#某标题` 时，锚点在地址里就位，而正文要等渲染完才存在——
 * 浏览器原生的锚点跳转在文档还是一片空白时就已经执行过了，什么也找不到。
 * 这个 hook 等到编辑器就绪再跳，并且只跳一次。
 *
 * 定位方式与目录跳转统一成行号：原先靠 `document.getElementById` 找标题
 * 元素，而编辑器只渲染视口附近的块，锚点指向的标题十有八九不在 DOM 里，
 * 于是查不到、跳不动——README 明确宣传的 `#锚点` 用法就是这么坏掉的。
 * 改成从 store 的目录里按 id 查行号，再交给 `scrollToLine`。
 *
 * 跳转优先于阅读位置恢复：用户带着锚点打开一篇文档，意图是明确的，
 * 不该被上次读到哪儿覆盖掉。调用顺序上本 hook 排在 `useReadingPosition`
 * 之后，同一轮提交里后跑的 effect 说了算。
 *
 * @param view 编辑器实例；非空即表示首轮块渲染已完成（见 `onViewReady`），
 *   此时 store 里的目录也已经是这篇文档的最终版本
 */
export function usePendingAnchor(view: EditorView | null): UsePendingAnchorResult {
  const container = useScrollContainer();
  const pendingAnchor = useDocumentStore((state) => state.pendingAnchor);
  const setPendingAnchor = useDocumentStore((state) => state.setPendingAnchor);
  const toc = useDocumentStore((state) => state.toc);
  // 「第几次打开」，锚点行号按它撤防，见下面撤防 effect 的说明
  const openEpoch = useDocumentStore((state) => state.openEpoch);

  /**
   * 本篇文档的锚点最终落在哪一行；null 表示这篇文档不是带锚点打开的。
   *
   * 必须自己记下来，不能等到要校正时再读 `pendingAnchor`：那个字段是**消费
   * 一次即清空**的，下面的 effect 滚完就把它置回 null 了，而增强要等几百毫秒
   * 到几秒才结束。这与 `useReadingPosition` 里闩锁存在的理由完全一致。
   */
  const anchorLineRef = useRef<number | null>(null);
  /**
   * 我们自己最后一次滚动落定后的 `scrollTop`，用来在校正前甄别「用户是不是
   * 已经自己滚走了」。null 表示还没测到（容器缺席，或 rAF 还没跑）。
   */
  const expectedScrollTopRef = useRef<number | null>(null);
  /**
   * 这一次打开开始时的显式导航序号（store 的 `navigationEpoch`），比对基线。
   *
   * 上面那个 `scrollTop` 值比对**认不出显式导航**，理由与 `useReadingPosition`
   * 的 `isDisarmed` 完全相同：目录点击派发的 `scrollIntoView` 要等 CodeMirror
   * 的测量周期才落定，而同一次 dispatch 会同步触发 `viewportChanged`、进而在
   * 一个微任务后回调 `onEnhanced`——校正跑在滚动之前，此刻 `scrollTop` 还是
   * 我们自己写的那个值，值比对当场判定「用户没滚走」，于是这一次校正把刚点了
   * 目录的用户**拽回锚点**。带锚点打开、随后在那个几百毫秒的窗口里点目录，
   * 这个组合是可达的。
   *
   * 本 hook 自己的锚点跳转**不**记导航（见 store 的 `navigationEpoch`），
   * 所以基线之后的任何一次自增都必然来自别人，语义上就是「有人把用户带走了」。
   */
  const navigationBaselineRef = useRef(0);
  /** 取消正在进行的落点观测；卸载或下一次滚动开始时必须调用 */
  const cancelMeasureRef = useRef<(() => void) | null>(null);

  /*
   * 每次「打开」都撤防。
   *
   * 声明在下面消费 effect **之前**，保证同一轮提交里先撤防、后置位——否则
   * 「带锚点换文档」的那一轮会把刚记下的行号又抹掉。
   *
   * 记的是「上一次打开的锚点不该影响下一次」这件事：不撤防的话，切到一篇
   * 没有锚点的文档后，它的第一次增强完成会把用户拽到上一篇文档的锚点行号上去。
   *
   * 依赖是 `openEpoch` 而不是 documentId，与 `useReadingPosition` 的闩锁同因：
   * documentId 认不出「同一篇文档重新打开」，于是**不带锚点重开一篇刚才带锚点
   * 读过的文档**时，这里的行号会残留下来，增强一完成就把用户拽回上次的锚点。
   */
  useEffect(() => {
    anchorLineRef.current = null;
    expectedScrollTopRef.current = null;
    // 上一次打开里点过目录，不该让这一次打开的锚点也跟着作废
    navigationBaselineRef.current = useDocumentStore.getState().navigationEpoch;
  }, [openEpoch]);

  /**
   * 滚到锚点行，并记下落定后的 `scrollTop`。
   *
   * 测量必须等滚动**真的落定**，不能只等一帧：`scrollToLine` 派发的是
   * CodeMirror 的 `scrollIntoView` 效果，实际滚动发生在它自己的测量周期里，
   * 带代码块的文档实测要三帧才动（见 `afterScrollSettles` 的说明）。量早了
   * 记下的是滚动前的值，紧接着的第一次校正就会把自己判成「用户滚走了」而
   * 永久撤防——落点因此停在偏浅的位置，侧栏高亮落在上一节，且不会自愈。
   */
  const scrollToAnchor = useCallback(
    (targetView: EditorView, line: number): void => {
      scrollToLine(targetView, line);
      if (!container) return;

      cancelMeasureRef.current?.();
      cancelMeasureRef.current = afterScrollSettles(
        () => container.scrollTop,
        (top) => {
          cancelMeasureRef.current = null;
          expectedScrollTopRef.current = top;
        },
      );
    },
    [container],
  );

  useEffect(() => {
    /*
     * 空目录时必须**什么都不做**，尤其不能顺手把锚点清掉。
     *
     * 换文档的那一轮提交里，`view` 还指着上一篇文档的编辑器实例——子组件
     * 的 effect 先于父组件跑，`MarkdownEditor` 虽然已经在重建并回调了
     * `onViewReady(null)`，但那是一次 state 更新，本轮 effect 读到的仍是
     * 旧值。只看 `view` 非空就动手，锚点会在新文档还没渲染时就被当成
     * 「找不到」清掉——实测正是这样跳不过去的。
     *
     * `toc` 非空是可靠的门槛：`setDocument` 会把它清空，只有新编辑器跑完
     * 首轮块渲染、把标题送进 store 之后才会再次非空，而那必然发生在
     * `onViewReady` 之前（见 `MarkdownEditor` 里 rerender 与 notifyViewReady
     * 的顺序）。
     *
     * 代价是「文档里一个标题都没有」时锚点不会被清掉。这没有后果：本来也
     * 无处可跳，而残留会在下一次 `setDocument` 时清干净。
     */
    if (!view || pendingAnchor === null || toc.length === 0) return;

    const line = findHeadingLine(toc, pendingAnchor);
    if (line !== null) {
      // 记下来供增强完成后的校正复用，见 anchorLineRef
      anchorLineRef.current = line;
      scrollToAnchor(view, line);
      /*
       * 地址栏本来就是锚点的来源，这一步看着多余，但两种情况下不是：
       * 一是独立标签页里打开的阅读器，锚点是别的路径塞进 store 的，地址栏
       * 上没有；二是宿主传过来的 hash 可能与我们规范化后的 id 编码不同。
       * 统一写一次，三条跳转路径的地址栏行为就完全一致，不必逐条推理。
       */
      syncAnchorHash(pendingAnchor);
    }

    // 找不到也要清掉：锚点可能指向一个已经不存在的标题，
    // 留着会让之后每一轮块渲染都白试一遍
    setPendingAnchor(null);
  }, [view, pendingAnchor, toc, setPendingAnchor, scrollToAnchor]);

  /**
   * 增强完成后重新按锚点行号滚一次。
   *
   * 为什么需要：锚点跳转发生在 Shiki 上色 / Mermaid 出图**之前**，此时上方
   * 内容还没被撑到最终高度，算出来的像素落点偏浅。实测对照（同一文档同一
   * 目标）：带锚点打开落在 `scrollTop 5191`、标题距容器顶 10.4px，侧栏高亮
   * 指到了上一章；内容全部增强后走目录点击是 5199 / 6.8px、高亮正确。用户
   * 小幅滚动**不会**自愈——高亮忠实反映了视口的真实位置，是落点本身短了。
   *
   * 为什么是「重新滚一次」而不是「恢复阅读位置」：这两条路径在带锚点的文档上
   * 是互斥的。`useReadingPosition` 的 `anchorOpenRef` 闩锁专门挡住后者，正是
   * 为了不让「上次读到的位置」覆盖用户显式指定的锚点。本回调只认
   * `anchorLineRef`，既不读也不写阅读位置，闩锁因此完全不受影响。
   *
   * 用户已经自己滚走时必须放弃：`onEnhanced` 在每次视口变化后都会触发
   * （见 `MarkdownEditor` 里 `enhanceMounted` 的调用点），不撤防的话用户
   * 每滚一下都会被弹回锚点，文档等于滚不动了。撤防之后不再恢复——同一篇
   * 文档里锚点只兑现这一次。
   *
   * 撤防有**两条**判据，缺一不可，因为它们看得见的东西不一样：显式导航要靠
   * 序号（值比对看不见它，见 `navigationBaselineRef`），用户手势要靠值比对
   * （它不经过任何我们能插桩的代码路径）。判序号在前，是因为它更便宜也更确定。
   */
  const onEnhanced = useCallback((): void => {
    const line = anchorLineRef.current;
    if (line === null || !view) return;

    // 有人把用户带到别处去了（点目录、点正文锚点），锚点这一次到此为止
    if (useDocumentStore.getState().navigationEpoch !== navigationBaselineRef.current) {
      anchorLineRef.current = null;
      return;
    }

    const expected = expectedScrollTopRef.current;
    if (
      container &&
      expected !== null &&
      !isWithinScrollTolerance(container.scrollTop, expected, ANCHOR_SCROLL_TOLERANCE_PX)
    ) {
      anchorLineRef.current = null;
      return;
    }

    scrollToAnchor(view, line);
  }, [view, container, scrollToAnchor]);

  // 卸载时别留下悬挂的逐帧观测
  useEffect(() => {
    return () => {
      cancelMeasureRef.current?.();
      cancelMeasureRef.current = null;
    };
  }, []);

  return { onEnhanced };
}
