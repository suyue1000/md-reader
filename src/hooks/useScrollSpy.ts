import { useEffect } from 'react';
import { flattenToc } from '@/markdown/toc';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * 只把视口顶部这一段比例算作「当前阅读位置」。
 *
 * 这是 Scroll Spy 的经典做法：如果把整个视口都算进去，一屏里同时出现
 * 三四个标题时高亮会来回跳；限定在顶部窄带里，高亮切换的时机与人的
 * 阅读直觉一致——标题滚到屏幕上方，就算进入了那一节。
 */
const SPY_BAND_RATIO = 0.25;

/** 由窄带比例推导出的 rootMargin，两者必须保持一致 */
const SPY_ROOT_MARGIN = `0px 0px -${String((1 - SPY_BAND_RATIO) * 100)}% 0px`;

/**
 * 目录高亮（Scroll Spy）。
 *
 * 用 IntersectionObserver 而不是监听 scroll 事件：后者每帧都要读
 * `getBoundingClientRect()`，几百个标题时会造成强制同步布局，直接掉帧。
 * IntersectionObserver 只在标题穿越边界时回调，滚动过程中零开销。
 *
 * @param contentKey 当前正文 HTML。**必须**传，且必须是真正渲染进 DOM 的那份。
 *
 * 为什么不能只依赖 `toc`：目录存在 Zustand store 里，而正文 HTML 是组件
 * 局部 state。Zustand 走 `useSyncExternalStore`，它的更新会同步冲刷一次渲染，
 * 于是「目录已更新、正文还没换」会短暂成立；此时去查标题元素只会查到空，
 * 而之后 `toc` 引用不再变化，effect 也就没有第二次机会。用正文内容做依赖，
 * 能保证绑定发生在标题真正进入 DOM 之后。
 */
export function useScrollSpy(contentKey: string): void {
  const container = useScrollContainer();
  const toc = useDocumentStore((state) => state.toc);
  const setActiveHeadingId = useDocumentStore((state) => state.setActiveHeadingId);
  const scrollSync = useSettingsStore((state) => state.settings.reading.scrollSync);

  useEffect(() => {
    if (!container || !scrollSync || toc.length === 0 || contentKey === '') return;

    const ids = flattenToc(toc).map((node) => node.id);
    // 文档顺序索引，用于在多个标题同时可见时取最靠前的那个
    const order = new Map(ids.map((id, index) => [id, index]));
    const visible = new Set<string>();

    const elements = ids
      .map((id) => container.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    /**
     * 窄带里一个标题都没有时的兜底：取「最后一个位于窄带上方」的标题。
     *
     * 这种情况在两处会发生：读一个很长的章节，以及**跳转式滚动**
     * （拖动滚动条、按 End、点击目录跨越大段内容）。后者如果只是保持
     * 上一次高亮，用户会看到目录停在十万八千里外的位置。
     *
     * 这里确实读了一次 `getBoundingClientRect()`，但只在 IO 回调里执行，
     * 而 IO 回调只在标题穿越边界时触发，不是每帧——不影响滚动帧率。
     */
    const fallbackToNearestAbove = (): void => {
      const bandBottom = container.getBoundingClientRect().top + container.clientHeight * SPY_BAND_RATIO;
      let candidate: string | null = null;
      for (const element of elements) {
        if (element.getBoundingClientRect().top > bandBottom) break;
        candidate = element.id;
      }
      setActiveHeadingId(candidate ?? elements[0]?.id ?? null);
    };

    // 初始高亮：直接按当前滚动位置算一次，而不是无条件落在第一个标题上
    fallbackToNearestAbove();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        }

        if (visible.size === 0) {
          fallbackToNearestAbove();
          return;
        }

        let topmost: string | null = null;
        let topmostOrder = Number.POSITIVE_INFINITY;
        for (const id of visible) {
          const index = order.get(id) ?? Number.POSITIVE_INFINITY;
          if (index < topmostOrder) {
            topmostOrder = index;
            topmost = id;
          }
        }
        setActiveHeadingId(topmost);
      },
      { root: container, rootMargin: SPY_ROOT_MARGIN, threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [container, toc, contentKey, scrollSync, setActiveHeadingId]);
}
