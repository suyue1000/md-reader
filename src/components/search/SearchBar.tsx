import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useUiStore } from '@/stores/ui.store';
import { supportsHighlightApi } from '@/search/block-highlight';

/** 查找条里的小圆按钮 */
function BarButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ChevronUp;
  disabled?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
      style={{ color: 'var(--app-text-muted)' }}
    >
      <Icon size={14} />
    </button>
  );
}

/**
 * 正文查找条。
 *
 * 贴在工具栏搜索按钮下方，而不是占用侧栏的一整栏：查找是个**临时**动作，
 * 用完就关；侧栏那一栏则是常驻的，为它挤掉「文件 / 目录」的空间不划算。
 * 位置也刻意贴着触发它的按钮，符合浏览器原生查找栏的习惯。
 */
export function SearchBar(): React.JSX.Element | null {
  const open = useUiStore((state) => state.searchOpen);
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);
  const { query, setQuery, total, current, truncated, go, reset } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开即可直接打字；重新打开时选中原有内容，便于整词替换
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  // 关闭时撤掉高亮，否则关掉查找条却留着一屏底色
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  const close = (): void => {
    setSearchOpen(false);
  };

  return (
    <div
      className="no-print fixed top-12 right-3 z-40 flex items-center gap-1 rounded-lg px-2 py-1.5 shadow-[var(--app-shadow-md)]"
      style={{
        background: 'var(--app-elevated)',
        border: '1px solid var(--app-border)',
      }}
      role="search"
    >
      <Search size={13} style={{ color: 'var(--app-text-subtle)' }} />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="查找正文"
        aria-label="查找正文"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            go(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
        className="w-48 bg-transparent text-xs outline-none"
        style={{ color: 'var(--app-text)' }}
      />

      <span
        className="min-w-16 shrink-0 text-right text-[11px] tabular-nums"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        {query === ''
          ? ''
          : total === 0
            ? '无匹配'
            : `${String(current + 1)}/${String(total)}${truncated ? '+' : ''}`}
      </span>

      <span className="mx-0.5 h-4 w-px shrink-0" style={{ background: 'var(--app-border-subtle)' }} />

      <BarButton label="上一处" icon={ChevronUp} disabled={total === 0} onClick={() => { go(-1); }} />
      <BarButton label="下一处" icon={ChevronDown} disabled={total === 0} onClick={() => { go(1); }} />
      <BarButton label="关闭查找" icon={X} onClick={close} />

      {!supportsHighlightApi() && query !== '' && (
        // 老浏览器上仍然能跳转，只是不画底色，说清楚比让人以为搜坏了要好
        <span className="text-[11px]" style={{ color: 'var(--app-warning)' }}>
          不支持高亮
        </span>
      )}
    </div>
  );
}
