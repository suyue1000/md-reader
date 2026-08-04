import { memo } from 'react';
import { ChevronRight, FileText, Folder, FolderOpen, Star } from 'lucide-react';
import type { FileTreeNode } from '@/types';
import { useDocumentStore } from '@/stores/document.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { cn } from '@/utils/cn';

/** 每层缩进的像素数 */
const INDENT_STEP = 12;

export interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  /** 已展开的目录 id 集合 */
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}

/**
 * 文件树节点。
 *
 * 与 `TocItem` 一样，「当前文件」与「是否收藏」由节点自己向 store 订阅
 * 一个布尔值，而不是从父组件层层传下来——否则打开一个文件会让整棵树
 * 重渲染，而实际变化的只有两个节点。
 */
export const FileTreeItem = memo(function FileTreeItem({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
}: FileTreeItemProps): React.JSX.Element {
  const isActive = useDocumentStore((state) => state.document?.path === node.id);
  const isFavorite = useWorkspaceStore((state) => state.favorites.includes(`doc:${node.id}`));
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);

  const isDirectory = node.kind === 'directory';
  const isExpanded = expanded.has(node.id);

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-0.5 rounded-md pr-1',
          'transition-colors duration-[var(--app-duration)]',
          isActive ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-[var(--app-hover)]',
        )}
        style={{ paddingLeft: depth * INDENT_STEP }}
      >
        {isDirectory ? (
          <button
            type="button"
            aria-label={isExpanded ? '折叠' : '展开'}
            aria-expanded={isExpanded}
            onClick={() => onToggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            <ChevronRight
              size={12}
              className="transition-transform duration-[var(--app-duration)]"
              style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <button
          type="button"
          data-file-path={node.id}
          title={node.id}
          onClick={() => (isDirectory ? onToggle(node.id) : onSelect(node.id))}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-xs',
            isActive && 'font-medium',
          )}
          style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text-muted)' }}
        >
          {isDirectory ? (
            isExpanded ? (
              <FolderOpen size={13} className="shrink-0" />
            ) : (
              <Folder size={13} className="shrink-0" />
            )
          ) : (
            <FileText size={13} className="shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </button>

        {!isDirectory && (
          <button
            type="button"
            aria-label={isFavorite ? '取消收藏' : '收藏'}
            title={isFavorite ? '取消收藏' : '收藏'}
            onClick={() => toggleFavorite(`doc:${node.id}`)}
            // 未收藏时只在悬停/聚焦时出现，避免整列星星干扰阅读
            className={cn(
              'shrink-0 rounded p-0.5 transition-opacity duration-[var(--app-duration)]',
              isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100',
            )}
            style={{ color: isFavorite ? 'var(--app-warning)' : 'var(--app-text-subtle)' }}
          >
            <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {isDirectory && isExpanded && node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
});
