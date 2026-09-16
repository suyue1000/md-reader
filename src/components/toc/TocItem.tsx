import { memo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TocNode } from '@/types';
import { useDocumentStore } from '@/stores/document.store';
import { cn } from '@/utils/cn';

/** 每层缩进的像素数 */
const INDENT_STEP = 12;

export interface TocItemProps {
  node: TocNode;
  /** 在树中的深度，从 0 开始 */
  depth: number;
  /** 已折叠的节点 id 集合 */
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /**
   * 点击标题。
   *
   * 连行号一起交出去，是因为跳转已经改成按行定位：节点自己手里就有
   * `line`，让上层再拿 id 回目录里查一遍纯属绕路。
   */
  onSelect: (id: string, line: number) => void;
}

/**
 * 目录树节点。
 *
 * 高亮状态由节点自己向 store 订阅一个布尔值，而不是从父组件接收 `activeId`：
 * 后者会让滚动时每次高亮切换都重渲染整棵树（长文档动辄几百项），
 * 前者配合 `memo` 只会重渲染真正变化的那两个节点——旧的和新的。
 */
export const TocItem = memo(function TocItem({
  node,
  depth,
  collapsed,
  onToggle,
  onSelect,
}: TocItemProps): React.JSX.Element {
  const isActive = useDocumentStore((state) => state.activeHeadingId === node.id);
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);

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
        {/* 没有子节点时也占位，保证同级标题的文字左边缘对齐 */}
        {hasChildren ? (
          <button
            type="button"
            aria-label={isCollapsed ? '展开' : '折叠'}
            aria-expanded={!isCollapsed}
            onClick={() => onToggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            <ChevronRight
              size={12}
              className="transition-transform duration-[var(--app-duration)]"
              style={{ transform: isCollapsed ? 'none' : 'rotate(90deg)' }}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <button
          type="button"
          data-toc-id={node.id}
          onClick={() => onSelect(node.id, node.line)}
          title={node.text}
          className={cn('min-w-0 flex-1 truncate py-1 text-left text-xs', isActive && 'font-medium')}
          style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text-muted)' }}
        >
          {node.text}
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <TocItem
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
});
