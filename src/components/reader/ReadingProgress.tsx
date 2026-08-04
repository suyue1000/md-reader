import { useEffect, useRef } from 'react';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useSettingsStore } from '@/stores/settings.store';

/**
 * 顶部阅读进度条。
 *
 * 进度用 `transform: scaleX()` 而不是改 width：transform 只走合成层，
 * 不触发布局与重绘；配合 rAF 节流，滚动时每帧最多写一次样式，
 * 且全程不经过 React——否则一个进度条就能让整棵组件树每帧重渲染。
 */
export function ReadingProgress(): React.JSX.Element | null {
  const container = useScrollContainer();
  const enabled = useSettingsStore((state) => state.settings.reading.showProgressBar);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container || !enabled) return;

    let frame = 0;

    const update = (): void => {
      frame = 0;
      const scrollable = container.scrollHeight - container.clientHeight;
      const ratio = scrollable <= 0 ? 0 : container.scrollTop / scrollable;
      if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`;
    };

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    // 内容高度会随 Shiki 上色、Mermaid 出图而变化，跟着重算一次
    const resizeObserver = new ResizeObserver(onScroll);
    resizeObserver.observe(container);
    update();

    return () => {
      container.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container, enabled]);

  if (!enabled) return null;

  return (
    <div
      className="no-print relative h-0.5 shrink-0"
      style={{ background: 'var(--app-border-subtle)' }}
    >
      <div
        ref={barRef}
        className="h-full origin-left"
        style={{ background: 'var(--app-accent)', transform: 'scaleX(0)' }}
      />
    </div>
  );
}
