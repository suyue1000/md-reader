import { useEffect, useLayoutEffect, useRef } from 'react';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useSettingsStore } from '@/stores/settings.store';
import {
  computeRestoreTarget,
  findAnchorIndex,
  flushReadingPositions,
  hydrateReadingPositions,
  recallPosition,
  rememberPosition,
} from '@/utils/reading-position';

/** 保存位置的节流间隔 */
const SAVE_THROTTLE = 400;

export interface UseReadingPositionParams {
  /** 当前文档 id */
  documentId: string;
  /** 当前正文 HTML，作为「内容已换」的信号 */
  contentKey: string;
  /** DOM 增强完成的次数，用于在高度稳定后再校正一次位置 */
  enhancedToken: number;
}

/**
 * 阅读位置的记录与恢复。
 *
 * 需要恢复位置的时机有三个，它们的共同点是「内容或布局刚刚变过」：
 * 1. 打开一个以前读过的文档（跨会话恢复，受设置控制）；
 * 2. 自动刷新后内容被替换（**不受设置控制**——刷新后跳回顶部是 bug，
 *    不是可选偏好）；
 * 3. DOM 增强完成后（Shiki 上色、Mermaid 出图会显著改变高度），
 *    此时按同一个锚点再校正一次。
 *
 * 定位方式是「锚点 + 相对偏移」：记下视口顶部上方最近的那个标题，
 * 以及滚动位置相对它的像素差。这样文档上方新增或删除内容都不会让位置漂移，
 * 而纯比例定位在自动刷新（常见于文末追加内容）时一定会偏。
 */
export function useReadingPosition({
  documentId,
  contentKey,
  enhancedToken,
}: UseReadingPositionParams): void {
  const container = useScrollContainer();
  const shouldPersist = useSettingsStore((state) => state.settings.reading.restoreScrollPosition);

  /** 当前文档的标题元素与它们的偏移量，按文档顺序 */
  const anchorsRef = useRef<{ ids: string[]; offsets: number[] }>({ ids: [], offsets: [] });
  /** 上一次已恢复过的内容标识，避免同一份内容反复恢复 */
  const restoredKeyRef = useRef('');
  /**
   * 标记「下一次滚动事件是我们自己滚出来的」。
   *
   * 恢复位置会触发一次 scroll 事件，如果不加区分就会被当成用户滚动记录下来。
   * 这本身还不算大问题，真正的坑是**顺序**：内容替换后浏览器也会派发一次
   * 滚动事件，此时若先执行保存，就会用新布局去反算锚点，把正确的位置
   * 覆盖成错的，随后的恢复自然就回到了原来的像素位置——看起来像「没恢复」。
   */
  const programmaticScrollRef = useRef(false);

  // 首次挂载时把存储里的记录读进内存缓存
  useEffect(() => {
    void hydrateReadingPositions();
  }, []);

  // 内容变化后重建锚点索引。
  // 用 layout effect：它在 DOM 变更后、浏览器派发滚动事件之前同步执行，
  // 保证「重建索引 -> 恢复位置」这一对动作抢在任何滚动回调之前完成
  useLayoutEffect(() => {
    if (!container || contentKey === '') {
      anchorsRef.current = { ids: [], offsets: [] };
      return;
    }
    const headings = container.querySelectorAll<HTMLElement>(
      '.markdown-body h1[id], .markdown-body h2[id], .markdown-body h3[id], .markdown-body h4[id], .markdown-body h5[id], .markdown-body h6[id]',
    );
    const ids: string[] = [];
    const offsets: number[] = [];
    for (const heading of headings) {
      ids.push(heading.id);
      offsets.push(heading.offsetTop);
    }
    anchorsRef.current = { ids, offsets };
  }, [container, contentKey, enhancedToken]);

  // 滚动时记录位置
  useEffect(() => {
    if (!container || documentId === '') return;

    let frame = 0;
    let lastSavedAt = 0;

    /**
     * @param force 跳过节流。页面即将隐藏/关闭时必须立即落盘，
     *              否则最后一段滚动会随着挂起的 rAF 一起丢掉
     */
    const save = (force = false): void => {
      frame = 0;

      // 吃掉由恢复动作自己引发的那一次滚动事件
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }

      const now = Date.now();
      if (!force && now - lastSavedAt < SAVE_THROTTLE) return;
      lastSavedAt = now;

      const { ids, offsets } = anchorsRef.current;
      const scrollTop = container.scrollTop;
      const scrollable = container.scrollHeight - container.clientHeight;
      const index = findAnchorIndex(offsets, scrollTop);
      const anchorId = index >= 0 ? (ids[index] ?? null) : null;
      const anchorOffset = index >= 0 ? scrollTop - (offsets[index] ?? 0) : 0;

      rememberPosition(
        {
          documentId,
          ratio: scrollable > 0 ? scrollTop / scrollable : 0,
          anchorId,
          anchorOffset,
          updatedAt: now,
        },
        shouldPersist,
      );
    };

    const onScroll = (): void => {
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
  }, [container, documentId, shouldPersist]);

  // 内容或布局变化后恢复位置（同样用 layout effect，理由见上）
  useLayoutEffect(() => {
    if (!container || documentId === '' || contentKey === '') return;

    const position = recallPosition(documentId);
    if (!position) return;

    // 首次加载某文档时，只有开启了「恢复阅读位置」才跳转；
    // 而内容被替换（自动刷新）时无条件恢复——这不是偏好，是正确性
    const isFirstRestoreForDocument = restoredKeyRef.current === '';
    if (isFirstRestoreForDocument && !shouldPersist) {
      restoredKeyRef.current = contentKey;
      return;
    }
    restoredKeyRef.current = contentKey;

    const top = computeRestoreTarget(
      position,
      anchorsRef.current,
      container.scrollHeight - container.clientHeight,
    );
    // 目标位置与当前位置一致时不要滚——否则不会产生 scroll 事件，
    // programmaticScrollRef 会一直挂着，把用户接下来的真实滚动吃掉一次
    if (Math.abs(container.scrollTop - top) <= 1) return;

    programmaticScrollRef.current = true;
    // 用 instant 而不是 smooth：这是「恢复」而不是「导航」，
    // 平滑滚动会让用户看到一段莫名其妙的动画
    container.scrollTo({ top, behavior: 'instant' });
  }, [container, documentId, contentKey, enhancedToken, shouldPersist]);

  // 换文档时重置「是否已恢复过」的标记
  useEffect(() => {
    restoredKeyRef.current = '';
  }, [documentId]);
}
