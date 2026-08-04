import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';

/** 滚过这个距离才显示按钮，避免刚翻一屏就冒出来挡内容 */
const SHOW_THRESHOLD = 400;

/**
 * 返回顶部按钮。
 *
 * 只在「跨过阈值」时才 setState，滚动过程中不产生任何重渲染——
 * 这与进度条的处理方式一致：能不进 React 的就不进。
 */
export function BackToTop(): React.JSX.Element | null {
  const container = useScrollContainer();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!container) return;

    let frame = 0;

    const update = (): void => {
      frame = 0;
      const shouldShow = container.scrollTop > SHOW_THRESHOLD;
      // 用函数式更新做一次比较，值没变时 zustand/React 都不会触发重渲染
      setVisible((current) => (current === shouldShow ? current : shouldShow));
    };

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [container]);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="返回顶部"
      title="返回顶部"
      onClick={() => container?.scrollTo({ top: 0, behavior: 'smooth' })}
      className="no-print fixed bottom-10 right-8 z-40 flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-[var(--app-duration)]"
      style={{
        background: 'var(--app-elevated)',
        border: '1px solid var(--app-border)',
        boxShadow: 'var(--app-shadow-md)',
        color: 'var(--app-text-muted)',
      }}
    >
      <ArrowUp size={16} />
    </button>
  );
}
