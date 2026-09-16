import { useCallback, useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import { scrollToLine } from '@/editor/MarkdownEditor';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import {
  flushReadingPositions,
  hydrateReadingPositions,
  recallPosition,
  rememberPosition,
} from '@/utils/reading-position';
import { heightInDocument, isWithinScrollTolerance, offsetWithinBlock } from '@/utils/scroll-math';
import { afterScrollSettles } from '@/utils/scroll-settle';

/** 保存位置的节流间隔 */
const SAVE_THROTTLE = 400;

/**
 * 判定「这次滚动是不是我们自己引发的」时允许的容差（像素）。
 *
 * 不是精确为 0，是因为两类无害的抖动都会让实际值跟我们记的期望值差一点：
 * 一是浏览器本身的次像素取整；二是块增强改高度时触发的原生 scroll
 * anchoring——为了不让视觉内容跳动，浏览器会自己顺手把 scrollTop 挪几像素
 * 去抵消上方内容的高度变化，这个抵消也会派发 `scroll` 事件，值上会跟我们
 * 最后一次写入的不完全一样。2px 只够吞掉这类「不算真的动了」的抖动；
 * 一次明显的用户滚动（哪怕是最小的一格滚轮）产生的位移都远大于它。
 *
 * 这个容差**不**试图吞掉「上方一大块内容因为增强突然变高，anchoring 把
 * scrollTop 顶出去几十上百像素」这种大幅漂移——那种情况下会被误判成
 * 「用户滚动了」，校正因此被跳过。这是有意识的取舍：宁可少校正一次，
 * 也不要把值判断做成一个「多大都能吞」的黑洞，那样就无法再区分真实的
 * 用户滚动了。
 */
const SCROLL_TOLERANCE_PX = 2;

export interface UseReadingPositionParams {
  /** 当前文档 id */
  documentId: string;
  /** 编辑器实例；未就绪（还没挂载或已卸载）时为 null。只有首轮块渲染完成
   *  之后 `MarkdownEditor` 才会把它交出来，见该组件 `onViewReady` 的说明 */
  view: EditorView | null;
}

export interface UseReadingPositionResult {
  /**
   * 供 `MarkdownEditor` 的 `onEnhanced` 调用：一轮增强（Shiki 上色、
   * Mermaid 出图）结束后，再校正一次滚动位置。
   *
   * 必须暴露成回调而不是在 hook 内部自己订阅——增强完成的信号只有
   * `MarkdownEditor` 知道，它不属于这个 hook 能观察到的状态。
   */
  onEnhanced: () => void;
}

/**
 * 阅读位置的记录与恢复。
 *
 * 记录位置不依赖高度：滚动时直接从 `view.lineBlockAtHeight` 读当前行号，
 * 编辑器的文档模型本身按行寻址，这一步不需要等任何东西。
 *
 * 但**恢复**位置依赖高度——这是与上面容易混淆、且曾经被写错的一点：恢复
 * 要把行号换算回像素（`scrollToLine` 内部按行高累加），如果此刻编辑器里
 * 还是引导阶段的裸源码（没有标题、代码块、图片撑开的高度），算出来的像素
 * 目标就是错的，等管线加载完、内容重新排版后也不会自动纠正。所以：
 * - `view` 只有在 `MarkdownEditor` 完成首轮块渲染后才会非空（见该组件），
 *   本 hook 拿到非空 `view` 时就已经具备正确的行高。
 * - Shiki / Mermaid 的增强还会再一次显著改变高度，因此还需要
 *   `onEnhanced` 在增强完成后校正一次，见下方 `onEnhanced` 的实现。
 */
export function useReadingPosition({
  documentId,
  view,
}: UseReadingPositionParams): UseReadingPositionResult {
  const container = useScrollContainer();
  const shouldPersist = useSettingsStore((state) => state.settings.reading.restoreScrollPosition);
  const pendingAnchor = useDocumentStore((state) => state.pendingAnchor);
  // 「第几次打开」，闩锁与恢复状态都按它复位，见 anchorOpenRef 的说明
  const openEpoch = useDocumentStore((state) => state.openEpoch);

  /** 已经为哪个文档恢复过位置，避免同一文档在设置项等无关变化下被反复恢复 */
  const restoredDocRef = useRef<string | null>(null);
  /** 取消正在进行的落点观测（它负责补行内偏移并记落点）；卸载时要能取消 */
  const cancelSettleRef = useRef<(() => void) | null>(null);
  /**
   * 恢复之后，用户是否已经自己滚动过。
   *
   * 只要为真，`onEnhanced` 的校正就必须放弃——用户已经滚走了，增强完成后
   * 把他拽回恢复点，比当初落错位置体验更差。放在 ref 里而不是 state，
   * 是因为它只在事件回调里读写，不需要触发重渲染。
   *
   * 这只是撤防的**其中一种**理由，判断请统一走下面的 `isDisarmed`。
   */
  const userScrolledRef = useRef(false);
  /**
   * 这一次打开开始时的显式导航序号（store 的 `navigationEpoch`），比对基线。
   *
   * 之后序号变过，就说明用户在这一次打开里点过目录或正文锚点——那同样是
   * 「我要待在别处」，见 `isDisarmed`。
   */
  const navigationBaselineRef = useRef(0);
  /**
   * 我们自己最后一次程序化滚动落定后的 `scrollTop`，用来在 `scroll` 事件里
   * 甄别「是不是我们自己写的」——见下面 `applyPosition` 与 scroll 监听器里
   * 的用法，以及 `SCROLL_TOLERANCE_PX` 上方对取值考量的说明。
   * null 表示这个文档还没发生过任何程序化滚动，此时不做任何判断。
   */
  const expectedScrollTopRef = useRef<number | null>(null);
  /**
   * 「带着锚点打开的」是**哪一次打开**（`openEpoch`）；null 表示还没有过。
   *
   * 用户输入 `xxx.md#某标题` 时，意图是明确的：去那一节。恢复上次读到哪儿
   * 必须整个让路——不只是首次恢复，`onEnhanced` 那次校正也一样，否则代码块
   * 上色/图表出图结束后会把用户从锚点一把拽回上次的位置。
   *
   * 为什么要闩住而不是每次现读 `pendingAnchor`：那个字段是**消费一次即清空**
   * 的，`usePendingAnchor` 滚完就把它置回 null 了，而增强要等好几百毫秒甚至
   * 几秒才结束。等到 `onEnhanced` 触发时现读，读到的一定是 null，守卫等于
   * 不存在。闩锁记的是「这一次打开是带锚点的」这个事实，它在这次打开的整个
   * 生命周期内都成立。
   *
   * **记的是打开序号而不是 documentId**，这是修掉「闩锁粘住」的关键：
   * documentId 只能区分「换没换文档」，区分不了「同一篇文档又打开了一次」。
   * 存 documentId 时，同一篇文档先带锚点打开、后不带锚点重开，第二次的 id
   * 与闩锁里存的完全一样，于是阅读位置恢复被继续挡着——用户永远回不到上次
   * 读到的地方。序号每次 `setDocument` 自增，第二次打开自然对不上，
   * 闩锁自动松开；而同一次打开里它一直咬合，锚点优先这条不变量丝毫未减。
   */
  const anchorOpenRef = useRef<number | null>(null);

  /*
   * 闩锁的置位。
   *
   * 声明在下面两条恢复路径**之前**，保证同一轮提交里先置位后判定。
   * 判定处仍会额外看一眼当下的 `pendingAnchor`，覆盖「锚点刚设上、这个
   * effect 还没跑过」的那一帧。
   */
  useEffect(() => {
    if (pendingAnchor !== null && documentId !== '') anchorOpenRef.current = openEpoch;
  }, [pendingAnchor, documentId, openEpoch]);

  /*
   * 每次「打开」都重置恢复状态，允许在这一次打开里重新走一遍恢复。
   *
   * 同样必须声明在两条恢复路径**之前**：同一轮提交里 effect 按声明顺序执行，
   * 排在后面就会让恢复路径先读到上一次打开残留的 `restoredDocRef`，
   * 于是重新打开同一篇文档时恢复被自己的旧痕迹挡掉。
   *
   * 依赖是 `openEpoch` 而不是 documentId：documentId 只会随 `setDocument`
   * 变化，而 `setDocument` 必然自增 openEpoch，后者是严格更细的判据——
   * 它还能认出「同一篇文档重新打开」。
   */
  useEffect(() => {
    restoredDocRef.current = null;
    userScrolledRef.current = false;
    expectedScrollTopRef.current = null;
    // 上一次打开里点过目录，不该让这一次打开的恢复也跟着作废
    navigationBaselineRef.current = useDocumentStore.getState().navigationEpoch;
  }, [openEpoch]);

  /**
   * 位置恢复是否已经**撤防**——撤了就既不首次恢复，也不做增强后的校正。
   *
   * 两种理由在语义上是同一件事：用户已经明确表示他要待在别处。
   * 1. 他自己滚走了（`userScrolledRef`）；
   * 2. 这一次打开里发生过显式导航——点侧栏目录、点正文里的 `#锚点` 链接。
   *
   * 第二种必须单列，因为第一种**认不出**它：导航是程序化滚动，
   * `checkUserScrolled` 比的是「实际值 vs 我们自己写入的值」，而这次滚动
   * 由 CodeMirror 的测量周期异步落定，`scroll` 事件晚于同一批块渲染派发的
   * 增强完成信号——校正抢在撤防之前跑完，当场用一次 `scrollToLine` 把刚跳
   * 过去的用户拽回记录位置，两次滚动互相抵消，表现是「恢复阅读位置之后
   * 第一次点目录纹丝不动，再点一次才跳」。撤防必须在**点击那一刻**同步
   * 完成，不能等任何一次测量或事件。
   *
   * 现读 store 而不是把 `navigationEpoch` 订阅成依赖：导航只会让恢复放弃，
   * 从不触发恢复，订阅只是白白多几次重渲染，还要多操心闭包里的值新不新。
   */
  const isDisarmed = useCallback(
    (): boolean =>
      userScrolledRef.current ||
      useDocumentStore.getState().navigationEpoch !== navigationBaselineRef.current,
    [],
  );

  // 首次挂载时把存储里的记录读进内存缓存
  useEffect(() => {
    void hydrateReadingPositions();
  }, []);

  // 滚动时记录位置
  useEffect(() => {
    if (!container || !view || documentId === '') return;

    let frame = 0;
    let lastSavedAt = 0;

    /**
     * @param force 跳过节流。页面即将隐藏/关闭时必须立即落盘，
     *              否则最后一段滚动会随着挂起的 rAF 一起丢掉
     */
    const save = (force = false): void => {
      frame = 0;

      const now = Date.now();
      if (!force && now - lastSavedAt < SAVE_THROTTLE) return;
      lastSavedAt = now;

      // 容器可视区顶部相对文档顶部的距离，即当前应该记的「高度坐标」
      const heightInDoc = heightInDocument(container.getBoundingClientRect().top, view.documentTop);
      const block = view.lineBlockAtHeight(heightInDoc);
      const line = view.state.doc.lineAt(block.from).number - 1;
      const offset = offsetWithinBlock(heightInDoc, block.top);

      rememberPosition({ documentId, line, offset, updatedAt: now }, shouldPersist);
    };

    /**
     * 甄别这次滚动是不是我们自己引发的。
     *
     * 比较依据是**值**而不是时序——不猜「程序化滚动之后多久算安全」，
     * 而是把我们自己每次写完 `scrollTop` 后的落点记下来（见 `applyPosition`
     * 结尾），跟这次滚动事件观察到的实际值比对。差在容差内就认为还是
     * 我们自己的（或抵消性的 anchoring 抖动），顺手把期望值刷新到当前
     * 实际值，防止误差累积；差出容差就是用户真的动了手——不管是滚轮、
     * 触摸板、键盘翻页还是直接拖滚动条，最终都体现为 scrollTop 变了，
     * 这一种判据能一并覆盖，不需要分别监听各种输入手势。
     */
    const checkUserScrolled = (): void => {
      const expected = expectedScrollTopRef.current;
      if (expected === null) return;
      const actual = container.scrollTop;
      if (isWithinScrollTolerance(actual, expected, SCROLL_TOLERANCE_PX)) {
        expectedScrollTopRef.current = actual;
      } else {
        userScrolledRef.current = true;
      }
    };

    const onScroll = (): void => {
      checkUserScrolled();
      // 用 rAF 而不是直接保存：滚动事件每帧可能来好几次，
      // 而 rAF 天然把一帧内的多次触发合并成一次。
      // 必须包一层箭头函数——rAF 会把时间戳作为首个参数传入，
      // 直接传 save 会让恒为真的时间戳变成 force，把节流整个绕过
      if (frame === 0) frame = requestAnimationFrame(() => save());
    };

    /**
     * 页面被隐藏或即将卸载时立即刷写。
     *
     * 这一步不是锦上添花：隐藏的页面里 rAF 会被浏览器停掉，挂起的保存
     * 永远不会执行；而 `pagehide` 之后就没有下一次机会了。
     */
    const flush = (): void => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      save(true);
      // 内存里记下了还不够，写盘本身也是防抖的，一并催掉
      flushReadingPositions();
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) flush();
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flush);

    return () => {
      container.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flush);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container, view, documentId, shouldPersist]);

  /**
   * 滚到指定位置，行内偏移在 CodeMirror 的滚动真的落定之后再叠加一次。
   *
   * 收尾不管有没有行内偏移都要跑：落定后的 `scrollTop` 会被记进
   * `expectedScrollTopRef`，供上面 `checkUserScrolled` 做值比对——跳过它会让
   * 「我们自己刚滚过」这件事没有留下痕迹，下一次 `scroll` 事件就会被误判成
   * 用户动了手。
   */
  const applyPosition = useCallback(
    (targetView: EditorView, targetContainer: HTMLElement, line: number, offset: number): void => {
      scrollToLine(targetView, line);
      /*
       * 为什么不能只等一帧：`scrollToLine` 派发的是 CodeMirror 的
       * `scrollIntoView` 效果，实际滚动发生在它自己的测量周期里，而那不一定
       * 是下一帧——带 fenced 代码块的文档实测要三帧（见 `afterScrollSettles`）。
       * 早一帧叠行内偏移，偏移会被随后那次滚动整个覆盖掉；早一帧记落点，
       * 记下的是滚动前的值，`checkUserScrolled` 当场把自己判成用户滚动，
       * 于是增强完成后的校正被永久放弃。两个后果都不报错，只是位置不对。
       */
      cancelSettleRef.current?.();
      cancelSettleRef.current = afterScrollSettles(
        () => targetContainer.scrollTop,
        () => {
          cancelSettleRef.current = null;
          if (offset > 0) targetContainer.scrollTop += offset;
          expectedScrollTopRef.current = targetContainer.scrollTop;
        },
      );
    },
    [],
  );

  // 文档就绪后恢复位置一次（受设置控制——这是「跨会话恢复」，可以关掉）
  useEffect(() => {
    if (!container || !view || documentId === '' || !shouldPersist) return;
    /*
     * 换文档的那一轮提交里，这个 `view` 是**上一篇文档那个已经销毁的实例**。
     *
     * `useEditorView` 的存活过滤发生在**渲染期**，而 view 是在这一轮的
     * effect 里才被销毁的：子组件（`MarkdownEditor`）的 effect 先于父组件跑，
     * 等本 effect 执行时旧实例早已 destroy，但闭包里捕获的还是渲染期那个值。
     *
     * 不补这一刀，恢复就会对着一个死掉的视图 dispatch——CodeMirror 静默无视，
     * 滚动不发生，而 `restoredDocRef` 已经被置位，于是新视图就绪后的那一轮
     * 不会再恢复一次。表现是「换文档回来永远停在开头」，且没有任何报错。
     * 这与 `usePendingAnchor` 里 `toc.length === 0` 那道门槛防的是同一个陷阱。
     *
     * 判据同 `EditorContext`：CodeMirror 的 `destroy()` 会把根节点摘出文档。
     */
    if (!view.dom.isConnected) return;
    // 只在这个文档还没恢复过时动手，避免设置项变化之类的重渲染把用户重新拽走
    if (restoredDocRef.current === documentId) return;
    // 带锚点打开的这一次，锚点说了算，见 anchorOpenRef
    if (pendingAnchor !== null || anchorOpenRef.current === openEpoch) return;
    /*
     * 已经撤防就连首次恢复也不做。
     *
     * 恢复要等首轮块渲染完成（`view` 非空）才动手，用户完全可能在这之前就
     * 点了目录——那一刻他的意图已经写在屏幕上了，几百毫秒后再把他拽回上次
     * 读到的地方，和缺陷本身是同一种冒犯。
     */
    if (isDisarmed()) return;

    const position = recallPosition(documentId);
    if (!position) return;
    restoredDocRef.current = documentId;

    applyPosition(view, container, position.line, position.offset);
  }, [
    container,
    view,
    documentId,
    shouldPersist,
    pendingAnchor,
    openEpoch,
    applyPosition,
    isDisarmed,
  ]);

  /**
   * 增强完成后再校正一次滚动位置。
   *
   * 只在「这个文档已经恢复过」且「还没撤防」时才出手，理由见 `isDisarmed`。
   * 任一条件不满足都直接放弃，不做任何事——尤其不能因为拿不到位置就退回
   * 顶部之类的兜底动作。
   *
   * 带锚点打开的文档要额外挡住：`isDisarmed` 拦不住它——锚点跳转本身就是
   * 程序化滚动，不会被判成用户操作；而它是「这一次打开」自带的意图，不经过
   * `markNavigation`（理由见 store 的 `navigationEpoch`）。不挡的话这一次
   * 校正会把用户从他明确指定的锚点拽回上次读到的位置。
   *
   * **但按当前代码，这一行其实到不了**——这条注释原先写的是「删掉它坏的是
   * 几秒之后」，那是推断，复核之后不成立，据实改在这里（裁决 R24 及其补充）：
   * 带锚点打开时闩锁会让上面那条恢复路径整个放弃，`restoredDocRef` 因此
   * 永远不会被置成这篇文档的 id，上一行的 `restoredDocRef.current !== documentId`
   * 先一步返回，锚点守卫从不成为决定性条件。单独删掉它，没有任何用例会变红。
   *
   * 仍然保留，是刻意的纵深防御：让「锚点优先于阅读位置」在两个出口各自
   * 独立成立，而不是依赖另一个 ref 的副作用间接保证。代价是一行没有被
   * 独立测试扎住的代码，这里标明它的性质，免得下一个人把它当成活分支去推理。
   */
  const onEnhanced = useCallback((): void => {
    if (!container || !view) return;
    if (restoredDocRef.current !== documentId) return;
    if (isDisarmed()) return;
    if (pendingAnchor !== null || anchorOpenRef.current === openEpoch) return;

    const position = recallPosition(documentId);
    if (!position) return;

    applyPosition(view, container, position.line, position.offset);
  }, [container, view, documentId, pendingAnchor, openEpoch, applyPosition, isDisarmed]);

  // 卸载时别留下悬挂的逐帧观测
  useEffect(() => {
    return () => {
      cancelSettleRef.current?.();
      cancelSettleRef.current = null;
    };
  }, []);

  return { onEnhanced };
}
