import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListTree, Search, X } from 'lucide-react';
import { TocItem } from './TocItem';
import { filterToc, flattenToc } from '@/markdown/toc';
import { useScrollContainer } from '@/components/layout/ScrollContainerContext';
import { useDocumentStore } from '@/stores/document.store';
import { useSettingsStore } from '@/stores/settings.store';

/** 空态提示 */
function Hint({ text }: { text: string }): React.JSX.Element {
  return (
    <p className="px-1 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
      {text}
    </p>
  );
}

/**
 * 目录面板：搜索框 + 目录树。
 *
 * 折叠状态由本组件集中持有而不是各节点自管：搜索时需要临时无视折叠、
 * 「默认展开目录」设置需要一次性初始化，这两件事都要求有一个统一的入口。
 */
export function TocPanel(): React.JSX.Element {
  const container = useScrollContainer();
  const toc = useDocumentStore((state) => state.toc);
  const hasDocument = useDocumentStore((state) => state.document !== null);
  const setActiveHeadingId = useDocumentStore((state) => state.setActiveHeadingId);
  const expandByDefault = useSettingsStore((state) => state.settings.reading.expandTocByDefault);

  const [query, setQuery] = useState('');
  /**
   * 只记录用户**显式**折叠/展开过的节点，其余节点跟随「默认展开目录」设置。
   *
   * 不把完整的折叠集合存进 state，是因为它其实是派生状态：
   * 由 (目录树, 默认展开设置, 用户覆盖) 三者推导而来。存派生状态就得用
   * effect 去同步，每次换文档都要多一轮渲染，还容易漏掉某条更新路径。
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const listRef = useRef<HTMLDivElement>(null);

  // 换文档时清空用户覆盖：渲染期直接调整 state 是 React 官方推荐的
  // 「随 props 变化重置 state」写法，比 effect 少一次提交
  const [trackedToc, setTrackedToc] = useState(toc);
  if (trackedToc !== toc) {
    setTrackedToc(toc);
    setOverrides(new Map());
  }

  const searching = query.trim() !== '';
  const visibleToc = useMemo(() => filterToc(toc, query), [toc, query]);

  // 搜索时无视折叠状态，否则命中项可能藏在折叠的父节点里
  const effectiveCollapsed = useMemo(() => {
    const set = new Set<string>();
    if (searching) return set;
    for (const node of flattenToc(toc)) {
      if (node.children.length === 0) continue;
      if (overrides.get(node.id) ?? !expandByDefault) set.add(node.id);
    }
    return set;
  }, [toc, overrides, expandByDefault, searching]);

  const handleToggle = useCallback(
    (id: string) => {
      setOverrides((current) => {
        const next = new Map(current);
        next.set(id, !(current.get(id) ?? !expandByDefault));
        return next;
      });
    },
    [expandByDefault],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const heading = container?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 立刻给出反馈，不等平滑滚动结束后 Scroll Spy 再确认
      setActiveHeadingId(id);
    },
    [container, setActiveHeadingId],
  );

  // 目录跟随正文：高亮项滚出侧栏视野时把它带回来
  const activeHeadingId = useDocumentStore((state) => state.activeHeadingId);
  useEffect(() => {
    if (!activeHeadingId || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(
      `[data-toc-id="${CSS.escape(activeHeadingId)}"]`,
    );
    // nearest：已经在视野里就什么都不做，避免把侧栏滚得跳来跳去
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeHeadingId]);

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 px-3 pt-3">
        <Search
          size={13}
          className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-subtle)', marginTop: 6 }}
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题"
          aria-label="搜索标题"
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
            style={{ color: 'var(--app-text-subtle)', marginTop: 6 }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {!hasDocument && <Hint text="打开文档后这里会显示目录。" />}
        {hasDocument && toc.length === 0 && (
          <div
            className="flex flex-col items-center gap-2 py-8 text-center"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            <ListTree size={22} strokeWidth={1.25} />
            <p className="text-xs">这篇文档没有标题</p>
          </div>
        )}
        {hasDocument && toc.length > 0 && visibleToc.length === 0 && (
          <Hint text={`没有匹配「${query.trim()}」的标题。`} />
        )}
        {visibleToc.length > 0 && (
          <ul>
            {visibleToc.map((node) => (
              <TocItem
                key={node.id}
                node={node}
                depth={0}
                collapsed={effectiveCollapsed}
                onToggle={handleToggle}
                onSelect={handleSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
