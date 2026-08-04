import { useCallback, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FolderOpen, Loader2, Search, X } from 'lucide-react';
import type { FileTreeNode } from '@/types';
import { FileTreeItem } from './FileTreeItem';
import { RecentFiles } from './RecentFiles';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { SCAN_LIMITS, collectAncestorIds, filterTree } from '@/utils/directory';
import { hasFileSystemAccess } from '@/utils/env';
import { getCurrentFileHandle } from '@/utils/file-open';
import { parentDirName } from '@/utils/parent-dir';

/**
 * 未打开文件夹时的引导。
 *
 * 文案会带上当前文档所在的目录名。浏览器不允许页面自行打开那个目录
 * （File System Access API 既取不到文件的父目录，也要求目录选择器
 * 必须由用户手势触发），但**可以让选择器直接停在那里**——用户点一下
 * 确认即可，而且确认过一次就会被记住，之后自动加载。
 */
function EmptyState({
  parentName,
  onOpen,
}: {
  parentName: string | null;
  onOpen: () => void;
}): React.JSX.Element {
  const supported = hasFileSystemAccess() && typeof showDirectoryPicker === 'function';

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <FolderOpen size={22} strokeWidth={1.25} style={{ color: 'var(--app-text-subtle)' }} />
      <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
        {!supported
          ? '当前浏览器不支持打开文件夹，请改用「打开文件」。'
          : parentName
            ? '浏览器要求文件夹访问必须由你确认一次，选中当前文档所在的目录即可。'
            : '打开一个文件夹，浏览其中的全部 Markdown 文档。'}
      </p>
      {supported && (
        <button
          type="button"
          onClick={onOpen}
          className="rounded-md px-2.5 py-1 text-xs transition-colors duration-[var(--app-duration)]"
          style={{ background: 'var(--app-accent)', color: 'var(--app-accent-contrast)' }}
        >
          {parentName ? `打开「${parentName}」文件夹` : '打开文件夹'}
        </button>
      )}
    </div>
  );
}

/**
 * 文件树面板：文件夹头部 + 搜索 + 树 + 最近/收藏。
 *
 * 展开状态由本组件集中持有：搜索时要临时无视折叠、打开某个深层文件时
 * 要自动展开它的所有祖先，这两件事都需要一个统一的入口。
 */
export function FileTreePanel(): React.JSX.Element {
  const rootName = useWorkspaceStore((state) => state.rootName);
  const tree = useWorkspaceStore((state) => state.tree);
  const scanning = useWorkspaceStore((state) => state.scanning);
  const truncated = useWorkspaceStore((state) => state.truncated);
  const fileCount = useWorkspaceStore((state) => state.fileCount);
  const currentPath = useDocumentStore((state) => state.document?.path ?? '');
  const parentName = useMemo(() => parentDirName(currentPath), [currentPath]);

  const { openFolder, openPath, closeFolder } = useWorkspace();

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * 打开某个文件时自动展开它的所有祖先目录。
   *
   * 在渲染期调整 state 是 React 官方推荐的「随 props 变化重置 state」写法，
   * 比放进 effect 少一次提交——放 effect 里会先渲染出「没展开」的一帧。
   */
  const [trackedPath, setTrackedPath] = useState(currentPath);
  if (trackedPath !== currentPath) {
    setTrackedPath(currentPath);
    if (currentPath !== '') {
      setExpanded((prev) => new Set([...prev, ...collectAncestorIds(currentPath)]));
    }
  }

  const searching = query.trim() !== '';
  const visibleTree = useMemo(() => filterTree(tree, query), [tree, query]);

  /** 搜索时全部展开，否则命中项可能藏在折叠的目录里 */
  const effectiveExpanded = useMemo(() => {
    if (!searching) return expanded;
    const all = new Set<string>();
    const walk = (nodes: readonly FileTreeNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'directory') {
          all.add(node.id);
          walk(node.children ?? []);
        }
      }
    };
    walk(visibleTree);
    return all;
  }, [searching, expanded, visibleTree]);

  const handleToggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      void openPath(path);
    },
    [openPath],
  );

  if (scanning) {
    return (
      <div
        className="flex flex-col items-center gap-2 px-4 py-8 text-center"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        <Loader2 size={20} className="animate-spin" />
        <p className="text-xs">正在扫描文件夹…</p>
      </div>
    );
  }

  if (rootName === null) {
    return (
      <div className="flex h-full flex-col">
        <EmptyState
          parentName={parentName}
          // 带上当前文件的句柄，选择器就会停在它所在的目录上
          onOpen={() => void openFolder(getCurrentFileHandle() ?? undefined)}
        />
        <RecentFiles />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex shrink-0 items-center gap-1 border-b px-3 py-2"
        style={{ borderColor: 'var(--app-border-subtle)' }}
      >
        <FolderOpen size={13} className="shrink-0" style={{ color: 'var(--app-text-subtle)' }} />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={`${rootName}（${String(fileCount)} 个文档）`}
          style={{ color: 'var(--app-text)' }}
        >
          {rootName}
        </span>
        <button
          type="button"
          onClick={() => void openFolder()}
          title="打开其它文件夹"
          className="rounded px-1 py-0.5 text-[10px] transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          更换
        </button>
        <button
          type="button"
          onClick={closeFolder}
          title="关闭文件夹"
          aria-label="关闭文件夹"
          className="rounded px-1 py-0.5 transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <X size={12} />
        </button>
      </header>

      <div className="relative shrink-0 px-3 pt-2">
        <Search
          size={13}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-subtle)', marginTop: 4 }}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索文件"
          aria-label="搜索文件"
          className="w-full rounded-md py-1.5 pl-6 pr-6 text-xs outline-none"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-subtle)',
            color: 'var(--app-text)',
          }}
        />
        {searching && (
          <button
            type="button"
            aria-label="清除搜索"
            onClick={() => setQuery('')}
            className="absolute right-5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--app-text-subtle)', marginTop: 4 }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {truncated && (
        <p
          className="flex items-start gap-1 px-3 py-1.5 text-[10px] leading-relaxed"
          style={{ color: 'var(--app-warning)' }}
        >
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          文件夹过大，只显示了前 {SCAN_LIMITS.maxEntries} 个条目（最多 {SCAN_LIMITS.maxDepth} 层）。
        </p>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {visibleTree.length === 0 ? (
          <p className="px-1 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {searching ? `没有匹配「${query.trim()}」的文件。` : '这个文件夹里没有 Markdown 文档。'}
          </p>
        ) : (
          <ul>
            {visibleTree.map((node) => (
              <FileTreeItem
                key={node.id}
                node={node}
                depth={0}
                expanded={effectiveExpanded}
                onToggle={handleToggle}
                onSelect={handleSelect}
              />
            ))}
          </ul>
        )}
      </div>

      <RecentFiles />
    </div>
  );
}
