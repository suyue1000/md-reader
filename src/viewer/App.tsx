import { useMemo } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { EditorViewProvider } from '@/editor/EditorContext';
import { SearchBar } from '@/components/search/SearchBar';
import { SettingsDrawer } from '@/components/settings/SettingsDrawer';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { Toast } from '@/components/ui/Toast';
import { ReaderPage } from './pages/ReaderPage';
import { RouterOutlet, type RouteDefinition } from './router';
import { useBootstrap } from '@/hooks/useBootstrap';
import { useEmbeddedDocument } from '@/hooks/useEmbeddedDocument';
import { useHostWorkspace } from '@/hooks/useHostWorkspace';
import { useLocalDirectory } from '@/hooks/useLocalDirectory';
import { useCustomStyle } from '@/hooks/useCustomStyle';
import { useThemeStyles } from '@/hooks/useThemeStyles';
import { useFileDrop } from '@/hooks/useFileDrop';
import { useFullscreenSync } from '@/hooks/useFullscreen';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';
import { useRestoreWorkspace } from '@/hooks/useRestoreWorkspace';
import { useThemeSync } from '@/hooks/useTheme';

/**
 * 阅读器根组件。
 *
 * 路由承载「阅读 / 导出预览」这类整页级视图；
 * 设置面板是抽屉而非路由，不占用地址栏。
 */
export function App(): React.JSX.Element {
  const ready = useBootstrap();

  // 这几个 hook 负责把设置与浏览器状态同步到 DOM，与渲染逻辑解耦。
  // 它们都带副作用，全应用只在这里调用一次
  useThemeSync();
  useFullscreenSync();
  useThemeStyles();
  useCustomStyle();
  useGlobalHotkeys();
  useEmbeddedDocument();
  useHostWorkspace();
  useLocalDirectory();
  useRestoreWorkspace();
  const dragging = useFileDrop();

  const routes = useMemo<readonly RouteDefinition[]>(
    () => [{ path: '/', element: <ReaderPage /> }],
    [],
  );

  // 未恢复设置前不渲染，避免默认值与用户配置之间的闪烁
  if (!ready) {
    return <div className="h-screen" style={{ background: 'var(--app-bg)' }} />;
  }

  return (
    <ErrorBoundary>
      {/* 编辑器实例的 provider 必须包住 AppShell：侧栏的目录要跳转，
          正文的编辑器才是实例的来源，两者是 AppShell 里的兄弟子树。
          查找条也在里面——它查的是编辑器里的源文本、跳转也要对 view 下指令，
          留在 provider 之外的话 `useEditorView()` 永远是 null，查找会静默失效 */}
      <EditorViewProvider>
        <AppShell>
          <RouterOutlet routes={routes} fallback={<ReaderPage />} />
        </AppShell>
        <SearchBar />
      </EditorViewProvider>
      <SettingsDrawer />
      <Toast />
      {dragging && (
        <div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center text-sm"
          style={{ background: 'var(--app-overlay)', color: '#fff' }}
        >
          松开即可打开 Markdown 文件
        </div>
      )}
    </ErrorBoundary>
  );
}
