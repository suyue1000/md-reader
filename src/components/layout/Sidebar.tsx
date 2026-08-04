import { FolderTree, List } from 'lucide-react';
import { FileTreePanel } from '@/components/files/FileTreePanel';
import { TocPanel } from '@/components/toc/TocPanel';
import { cn } from '@/utils/cn';
import { useUiStore, type SidebarPanel } from '@/stores/ui.store';

/** 侧栏面板配置 */
const PANELS: ReadonlyArray<{ id: SidebarPanel; label: string; icon: typeof List }> = [
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'toc', label: '目录', icon: List },
];

/**
 * 左侧边栏容器。
 *
 * 只负责「面板切换 + 容器」，具体内容由各面板组件自己实现，
 * 包括内边距——不同面板的留白需求不一样（目录树要贴边，说明文字要缩进）。
 */
export function Sidebar(): React.JSX.Element {
  const panel = useUiStore((state) => state.sidebarPanel);
  const setPanel = useUiStore((state) => state.setSidebarPanel);

  return (
    <aside
      className="flex h-full flex-col overflow-hidden"
      style={{ background: 'var(--app-surface)' }}
    >
      <nav
        className="flex shrink-0 items-center gap-1 border-b p-2"
        style={{ borderColor: 'var(--app-border-subtle)' }}
      >
        {PANELS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            aria-pressed={panel === id}
            className={cn(
              'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs',
              'transition-colors duration-[var(--app-duration)]',
              panel === id
                ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                : 'text-[var(--app-text-muted)] hover:bg-[var(--app-hover)]',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1">
        {panel === 'toc' && <TocPanel />}
        {panel === 'files' && <FileTreePanel />}
      </div>
    </aside>
  );
}
