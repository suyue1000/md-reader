import { useEffect, useMemo } from 'react';
import type { EditorView } from '@codemirror/view';
import { activeHeadingAt, flattenToc } from '@/markdown/toc';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';
import { heightInDocument, isScrolledToBottom } from '@/utils/scroll-math';

/**
 * 探测点相对容器顶边再往下挪的像素数。
 *
 * 不是「窄带」的变体，是一道防「差一点」的余量：`scrollToLine` 把目标块的
 * 顶部对齐到容器顶边，落点却可能比块顶低上几像素——正好卡在「还算上一块」
 * 的一侧，于是点了「第 9 章」高亮却停在第 8 章。误差有两个来源：
 *
 * 1. 浏览器把 `scrollTop` 夹到整数 / 设备像素的四舍五入，不足 1px；
 * 2. **跳到从没渲染过的区域时，目标上方全是估算高度**（见
 *    `editor/block-height.ts`）。估算再准也有残差，实测 20 章 × 60 行代码块
 *    的文档上累计约 4px——注意这部分**不会自愈**：上方那些块永远不会进入
 *    视口，也就永远不会被量到真实高度，重滚多少次都是同一个落点。
 *
 * 所以余量必须盖住第 2 项。取 8px：实测残差约 4px，留一倍余地；而它仍远小于
 * 一个章节标题的高度（28~58px，见 block-height.ts 的算式），肉眼分辨不出
 * 「标题贴着顶边」和「标题离顶边 8px」的区别。往大取的代价是自然滚动时高亮
 * 会早 8px 切换到下一节——同样在感知不到的量级。
 */
const SPY_PROBE_OFFSET_PX = 8;

/**
 * 判定「已经滚到底」时允许的误差（像素）。
 *
 * 取 2 而不是 1：`scrollTop` 在浏览器缩放、非整数设备像素比下是**带小数**
 * 的，`scrollHeight - scrollTop - clientHeight` 因此几乎不会落在整数上。
 * 1px 正卡在这类残差的边缘——判据一旦不成立，末尾章节就又变回「目录里点
 * 不亮」，而且是静默复发，不会有任何报错提示。残差本身小于一个 CSS 像素，
 * 2px 足够盖住；而它离「用户真的还没滚到底」的距离差着好几个数量级，
 * 不会把没到底误判成到底。
 */
const BOTTOM_TOLERANCE_PX = 2;

/**
 * 目录高亮（Scroll Spy）。
 *
 * 判据从「IntersectionObserver 观察标题元素」换成「视口顶行 vs 标题行号」。
 * 换的原因不是性能，是旧做法**已经不成立**了：观察器要求标题元素真实存在
 * 于 DOM 里，而编辑器只渲染视口附近的块——滚到文档中部时，上方所有标题的
 * DOM 早已被销毁，观察器手里剩下的全是失效节点，于是高亮停在打开文档时的
 * 第一个标题再也不动。行号比对完全不看 DOM，反而更准。
 *
 * 顺带消失的是旧实现里那条「顶部 25% 窄带」：窄带是为了压住
 * IntersectionObserver 的抖动（一屏里同时可见三四个标题时高亮会来回跳）。
 * 行号判据是「最后一个已经越过视口顶边的标题」，它对滚动位置单调，
 * 本来就不会抖；留着窄带反而会让点击目录跳到某个短章节后，高亮当场
 * 蹦到下一节去。
 *
 * @param view 编辑器实例；未就绪时为 null
 */
export function useScrollSpy(view: EditorView | null): void {
  const container = useScrollContainer();
  const toc = useDocumentStore((state) => state.toc);
  const setActiveHeadingId = useDocumentStore((state) => state.setActiveHeadingId);
  const scrollSync = useSettingsStore((state) => state.settings.reading.scrollSync);

  // 展平只跟目录树有关，不能放进每帧都跑的 sync 里
  const flat = useMemo(() => flattenToc(toc), [toc]);

  useEffect(() => {
    if (!view || !container || !scrollSync || flat.length === 0) return;

    let frame = 0;
    /** 上一次写进 store 的值，用来把重复写入挡在 store 之外 */
    let lastId: string | null = null;

    const sync = (): void => {
      frame = 0;

      /*
       * 真正滚动的是 AppShell 的 <main>，不是编辑器自己（`.cm-scroller` 的
       * overflow 是 visible，编辑器随内容自然增高）。所以要先把容器可视区
       * 顶部换算到 CodeMirror 的文档坐标系里，再问它这个高度落在哪一行。
       * 直接读 `view.scrollDOM.scrollTop` 会永远得到 0。
       */
      /*
       * 滚到底时换用视口**底边**做探测点。
       *
       * 文档末尾的标题永远推不到视口顶边——已经没有可滚的余量了。仍按顶边
       * 判定的话，最后一节（有时是最后好几节）在目录里根本无法被高亮，点它
       * 会高亮到上一节，而且怎么滚都回不来。到底意味着「最后一屏就是全部」，
       * 把这一屏里最后一个标题算作当前位置，让末尾章节至少可达。
       *
       * 代价说清楚：最后一屏里若挤着好几个标题，不管在看哪一个，高亮都会
       * 落在最靠后的那个。这是取舍，不是全面改善——自然滚到底时，原来那种
       * 按顶边算出来的高亮其实是准确的。用可达性换掉了这份准确。
       */
      const atBottom = isScrolledToBottom(
        container.scrollTop,
        container.scrollHeight,
        container.clientHeight,
        BOTTOM_TOLERANCE_PX,
      );

      const heightInDoc = heightInDocument(
        container.getBoundingClientRect().top +
          (atBottom ? container.clientHeight : SPY_PROBE_OFFSET_PX),
        view.documentTop,
      );
      const line = view.state.doc.lineAt(view.lineBlockAtHeight(heightInDoc).from).number - 1;

      /*
       * 视口顶部还在第一个标题之前（文档以正文开头）时退回第一个标题：
       * 侧栏一片没有高亮会让人以为功能坏了，而「还没进入任何一节」在目录上
       * 没有对应的表达。
       */
      const id = (activeHeadingAt(flat, line) ?? flat[0])?.id ?? null;
      if (id === lastId) return;
      lastId = id;
      setActiveHeadingId(id);
    };

    // 滚动事件一帧可能来好几次，rAF 天然把它们合并成一次；
    // 每次 sync 只做一次 getBoundingClientRect + 一次二分，与标题数量无关
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    };

    // 初始高亮：按当前滚动位置算一次，而不是无条件落在第一个标题上——
    // 恢复阅读位置的场景下，打开时就已经不在文档顶部了
    sync();

    container.addEventListener('scroll', schedule, { passive: true });

    /*
     * 高度变化也要重算：块 widget 挂载、Shiki 上色、Mermaid 出图都会改变
     * 上方内容的高度，滚动位置一动没动，视口顶部对应的行却变了。
     * 只观察编辑器根节点，一个 ResizeObserver 就够。
     */
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(view.dom);

    return () => {
      container.removeEventListener('scroll', schedule);
      resizeObserver.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [view, container, flat, scrollSync, setActiveHeadingId]);
}
