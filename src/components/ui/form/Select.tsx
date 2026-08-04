export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string> {
  id?: string;
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * 下拉选择。
 *
 * 用原生 `<select>`：它自带键盘导航、首字母跳转与移动端的原生选择器，
 * 自绘一套等价体验的成本远高于收益。样式只做最低限度的令牌对齐。
 */
export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
}: SelectProps<T>): React.JSX.Element {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className="min-w-32 rounded-md px-2 py-1 text-xs outline-none disabled:opacity-40"
      style={{
        background: 'var(--app-bg)',
        border: '1px solid var(--app-border)',
        color: 'var(--app-text)',
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
