import { useEffect, useState, type ReactNode } from 'react';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { ResizeHandle } from './ResizeHandle';
import { ConflictBanner } from './ConflictBanner';
import { ScrollContainerProvider } from './ScrollContainerContext';
import { ReadingProgress } from '@/components/reader/ReadingProgress';
import { BackToTop } from '@/components/reader/BackToTop';
import { useUiStore } from '@/stores/ui.store';

/**
 * 应用整体骨架：Toolbar / (Sidebar + 内容区) / StatusBar。
 *
 * 用 flex 而非 grid，是为了让侧栏宽度可以由单个 CSS 变量驱动，
 * 拖拽时不需要重排整个网格模板。
 */
export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
  const sidebarVisible = useUiStore((state) => state.sidebarVisible);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);

  // 用 state 而非 ref 持有滚动容器，元素挂载后消费方能立刻拿到
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);

  // 把宽度同步到 CSS 变量，拖拽手柄在拖动过程中也直接改这个变量
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }, [sidebarWidth]);

  return (
    <ScrollContainerProvider value={scrollContainer}>
      {/* app-shell / app-body / app-main 这几个类名供打印样式打破屏幕布局用 */}
      <div className="app-shell flex h-screen flex-col overflow-hidden">
        <Toolbar />
        <ConflictBanner />
        <ReadingProgress />

        <div className="app-body flex min-h-0 flex-1">
          {sidebarVisible && (
            <>
              <div
                className="no-print h-full shrink-0"
                style={{ width: 'var(--sidebar-width, 280px)' }}
              >
                <Sidebar />
              </div>
              <ResizeHandle />
            </>
          )}

          <main ref={setScrollContainer} className="app-main relative min-w-0 flex-1 overflow-auto">
            {children}
            <BackToTop />
          </main>
        </div>

        <StatusBar />
      </div>
    </ScrollContainerProvider>
  );
}
