export interface CodeAreaProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

/**
 * 代码输入框。
 *
 * 刻意用朴素的 textarea 而不是接一个代码编辑器：自定义 CSS 通常只有几十行，
 * 为它引入 CodeMirror（200KB+）不划算，何况这里的输入不需要补全与诊断。
 *
 * 关掉拼写检查与自动纠正——它们会把 CSS 属性名标成拼写错误，
 * 在移动端还会自动大写首字母，直接毁掉样式。
 */
export function CodeArea({
  id,
  value,
  onChange,
  placeholder,
  rows = 8,
  disabled,
}: CodeAreaProps): React.JSX.Element {
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
      className="w-full resize-y rounded-md p-2 font-mono text-[11px] leading-relaxed outline-none disabled:opacity-40"
      style={{
        background: 'var(--app-code-bg)',
        border: '1px solid var(--app-border)',
        color: 'var(--app-text)',
        tabSize: 2,
      }}
    />
  );
}
