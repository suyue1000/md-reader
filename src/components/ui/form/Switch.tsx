import { cn } from '@/utils/cn';

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 无障碍标签，未提供时依赖外部 label 的 htmlFor 关联 */
  label?: string;
}

/**
 * 开关。
 *
 * 用 `role="switch"` 的 button 而不是 checkbox：读屏会播报「开/关」而不是
 * 「已选中/未选中」，与视觉呈现一致。
 */
export function Switch({ id, checked, onChange, disabled, label }: SwitchProps): React.JSX.Element {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full',
        'transition-colors duration-[var(--app-duration)]',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
      style={{ background: checked ? 'var(--app-accent)' : 'var(--app-border)' }}
    >
      <span
        className="inline-block h-4 w-4 rounded-full transition-transform duration-[var(--app-duration)]"
        style={{
          background: '#fff',
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
          boxShadow: 'var(--app-shadow-sm)',
        }}
      />
    </button>
  );
}
