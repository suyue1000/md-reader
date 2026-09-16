import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListTree, Search, X } from 'lucide-react';
import { TocItem } from './TocItem';
import { useEditorView } from '@/editor/EditorContext';
import { scrollToLine } from '@/editor/MarkdownEditor';
import { syncAnchorHash } from '@/hooks/useEmbeddedDocument';
import { filterToc, flattenToc } from '@/markdown/toc';
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
  const view = useEditorView();
  const toc = useDocumentStore((state) => state.toc);
  const hasDocument = useDocumentStore((state) => state.document !== null);
  const setActiveHeadingId = useDocumentStore((state) => state.setActiveHeadingId);
  const markNavigation = useDocumentStore((state) => state.markNavigation);
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

  /**
   * 点击目录项跳到对应标题。
   *
   * 从「按 id 查 DOM 元素再 scrollIntoView」改成 `scrollToLine`：编辑器只
   * 渲染视口附近的块，视口外的标题根本不在 DOM 里，查不到就整个跳转失效——
   * 而「跳到远处的某一节」恰恰是目录最主要的用途。
   *
   * `view` 为空（文档还没就绪）时只更新高亮不滚动：这时候也没有内容可跳，
   * 地址栏也就没什么可写——写了也是一个指向空文档的链接。
   *
   * 注意这道判断**只是**「编辑器就绪了没有」，不代表滚动真的发生了。刻意不去
   * 确认落点：
   * 1. 判据本身有二义性——目标本来就在当前位置时，不动才是对的；
   * 2. 要确认就得等滚动落定（`afterScrollSettles`），地址栏因此晚一百多毫秒
   *    才更新，而用户此刻正盯着它；
   * 3. 下面那行高亮是**无条件**写的，另外两条跳转路径（地址栏锚点、正文
   *    `#锚点` 链接）也都无条件写地址栏。只给这一条加前提，三处就对不齐了。
   * 「点了却没跳」是定位机制自己的缺陷（估算高度、块身份），要在那里修，
   * 不该由目录面板用「那我不写地址栏了」来掩盖。
   *
   * `markNavigation` 的位置有两条要求，强弱不同：
   * - **必须在这个同步流程里**。`scrollToLine` 的 dispatch 会同步触发视口变化，
   *   `enhanceMounted` 随即发起、并在**至少一个微任务之后**回调 `onEnhanced`
   *   （`MarkdownEditor` 里那个 `.then()`）。所以同步路径上放前放后都来得及，
   *   放在滚动之前只是最不容易读错的写法；真正来不及的是「等滚动落定再撤防」
   *   ——那正是「恢复阅读位置后第一次点目录没反应」的成因，见
   *   `useReadingPosition` 的 `isDisarmed`。
   * - **必须在 `if (view)` 之内**。view 为空时压根没跳，白撤一次防会吃掉一次
   *   本该发生的阅读位置恢复。下面那行高亮无条件写，理由见上，两者不是一回事。
   */
  const handleSelect = useCallback(
    (id: string, line: number) => {
      if (view) {
        markNavigation();
        scrollToLine(view, line);
        syncAnchorHash(id);
      }
      // 立刻给出反馈，不等滚动落定后 Scroll Spy 再确认
      setActiveHeadingId(id);
    },
    [view, setActiveHeadingId, markNavigation],
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
