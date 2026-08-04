import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** 图标按钮属性 */
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 图标节点 */
  icon: ReactNode;
  /** 无障碍标签，同时作为 tooltip */
  label: string;
  /** 是否处于激活态（如侧栏已展开） */
  active?: boolean;
}

/**
 * 工具栏图标按钮。
 *
 * 唯一职责：渲染一个带 tooltip、可标记激活态的方形按钮。
 * 不关心具体业务，工具栏的每个动作都复用它。
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, active = false, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        'text-[var(--app-text-muted)] transition-colors duration-[var(--app-duration)]',
        'hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]',
        'active:bg-[var(--app-active)]',
        'disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
