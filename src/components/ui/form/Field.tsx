import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  /** 补充说明，解释这个选项的实际影响 */
  description?: string;
  /** 不可用时的原因；给出后控件区会附上说明 */
  disabledReason?: string;
  /** 控件渲染函数，接收要绑定到控件上的 id */
  children: (controlId: string) => ReactNode;
  /** 控件是否与标签同行（开关类）还是换行（滑块、文本域） */
  layout?: 'inline' | 'stacked';
}

/**
 * 设置项的统一布局。
 *
 * 把 label / 说明 / 控件的关系集中在一处，好处不只是样式一致——
 * `htmlFor` 与控件 id 的绑定也只写一遍，不会出现某一项漏绑导致
 * 点击标签无法聚焦控件的情况。
 */
export function Field({
  label,
  description,
  disabledReason,
  children,
  layout = 'inline',
}: FieldProps): React.JSX.Element {
  const controlId = useId();
  const inline = layout === 'inline';

  return (
    <div
      className={
        inline ? 'flex items-center justify-between gap-4 py-2' : 'flex flex-col gap-1.5 py-2'
      }
    >
      <div className="min-w-0">
        <label
          htmlFor={controlId}
          className="block text-xs font-medium"
          style={{ color: 'var(--app-text)' }}
        >
          {label}
        </label>
        {(description ?? disabledReason) && (
          <p className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--app-text-subtle)' }}>
            {disabledReason ?? description}
          </p>
        )}
      </div>
      <div className={inline ? 'shrink-0' : ''}>{children(controlId)}</div>
    </div>
  );
}
