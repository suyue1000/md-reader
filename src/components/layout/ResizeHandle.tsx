import { useCallback, useEffect, useRef } from 'react';
import { SIDEBAR_WIDTH, useUiStore } from '@/stores/ui.store';

/**
 * 侧栏拖拽调宽手柄。
 *
 * 拖拽期间直接改 DOM 上的 CSS 变量、不走 React state，只在松手时写一次
 * store 与存储。这样 60FPS 的拖拽过程完全不触发组件树重渲染。
 */
export function ResizeHandle(): React.JSX.Element {
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  const draggingRef = useRef(false);
  const widthRef = useRef<number>(SIDEBAR_WIDTH.default);

  /** 拖拽中：只更新 CSS 变量 */
  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!draggingRef.current) return;
    const next = Math.min(Math.max(event.clientX, SIDEBAR_WIDTH.min), SIDEBAR_WIDTH.max);
    widthRef.current = next;
    document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  }, []);

  /** 松手：提交到 store 并持久化 */
  const handlePointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setSidebarWidth(widthRef.current);
  }, [setSidebarWidth]);

  useEffect(() => {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  /** 按下：进入拖拽态并锁住文本选中 */
  const handlePointerDown = (): void => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  /** 键盘可达性：左右方向键以 16px 为步长调整 */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const current = useUiStore.getState().sidebarWidth;
    if (event.key === 'ArrowLeft') {
      setSidebarWidth(current - 16);
    } else if (event.key === 'ArrowRight') {
      setSidebarWidth(current + 16);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧边栏宽度"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className="no-print group relative w-px shrink-0 cursor-col-resize"
      style={{ background: 'var(--app-border-subtle)' }}
    >
      {/* 视觉上 1px，命中区域左右各扩 3px，避免难以拖中 */}
      <span className="absolute inset-y-0 -left-1 -right-1 block group-hover:bg-[var(--app-accent)]/30" />
    </div>
  );
}
