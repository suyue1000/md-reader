import { useEffect, useId, useRef, type ReactNode } from 'react';

/** 可获得焦点的元素选择器 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** 抽屉宽度 */
  width?: number;
}

/**
 * 右侧抽屉。
 *
 * 自己实现而不是引入组件库，理由与 `Menu` 一致：全项目只有设置面板一处需要。
 * 但模态对话框的可访问性契约必须完整，否则键盘用户会被困住：
 * 1. 打开时把焦点移入面板，关闭时归还给触发元素；
 * 2. Tab / Shift+Tab 在面板内循环（焦点陷阱），不会跑到背后的正文里；
 * 3. Esc 关闭；点击遮罩关闭；
 * 4. `role="dialog"` + `aria-modal` + `aria-labelledby` 让读屏正确播报。
 */
export function Drawer({ open, onClose, title, children, width = 380 }: DrawerProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    // 记住打开前的焦点，关闭时归还
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      // 在首尾之间循环，把焦点关在面板内
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩：点击关闭；aria-hidden 避免读屏读到一个空div */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 animate-[fade-in_var(--app-duration)_var(--app-ease)]"
        style={{ background: 'var(--app-overlay)' }}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full max-w-full flex-col animate-[slide-in_var(--app-duration)_var(--app-ease)] outline-none"
        style={{
          width,
          background: 'var(--app-bg)',
          borderLeft: '1px solid var(--app-border)',
          boxShadow: 'var(--app-shadow-lg)',
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--app-border-subtle)' }}
        >
          <h2 id={titleId} className="text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="rounded-md px-2 py-1 text-xs transition-colors duration-[var(--app-duration)] hover:bg-[var(--app-hover)]"
            style={{ color: 'var(--app-text-muted)' }}
          >
            关闭
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
