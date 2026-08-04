import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** 菜单项 */
export interface MenuItem {
  id: string;
  label: string;
  /** 右侧的次要文本，通常是快捷键 */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** 不可用原因，作为 tooltip */
  disabledReason?: string;
  onSelect: () => void;
}

export interface MenuProps {
  /** 触发按钮的内容 */
  trigger: ReactNode;
  /** 触发按钮的无障碍标签 */
  triggerLabel: string;
  items: readonly MenuItem[];
}

/**
 * 轻量下拉菜单。
 *
 * 没有引入 Radix / Headless UI 之类的组件库：整个项目目前只有工具栏溢出
 * 这一处需要下拉菜单，为它引入一个几十 KB 的依赖不划算。
 * 这里实现了必要的可访问性契约——aria 关联、Esc 关闭、点击外部关闭、
 * 关闭后焦点回到触发按钮。
 */
export function Menu({ trigger, triggerLabel, items }: MenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      // 关闭后把焦点还给触发按钮，键盘用户不会掉进文档流里
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md',
          'text-[var(--app-text-muted)] transition-colors duration-[var(--app-duration)]',
          'hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]',
          open && 'bg-[var(--app-hover)] text-[var(--app-text)]',
        )}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="app-panel absolute right-0 top-full z-50 mt-1 min-w-52 overflow-hidden py-1"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs',
                'transition-colors duration-[var(--app-duration)]',
                'disabled:pointer-events-none disabled:opacity-40',
                'hover:bg-[var(--app-hover)]',
              )}
              style={{ color: 'var(--app-text)' }}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="shrink-0 text-[11px]" style={{ color: 'var(--app-text-subtle)' }}>
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
