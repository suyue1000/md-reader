export interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** 数值后缀，如 `px` */
  unit?: string;
  disabled?: boolean;
}

/**
 * 带数值显示的滑块。
 *
 * 数值用等宽字体并预留固定宽度：拖动时数字位数变化（9 -> 10）
 * 不会让滑块跟着左右跳动。
 */
export function Slider({
  id,
  value,
  min,
  max,
  step,
  onChange,
  unit = '',
  disabled,
}: SliderProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-full disabled:opacity-40"
        style={{ accentColor: 'var(--app-accent)', background: 'var(--app-border)' }}
      />
      <span
        className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums"
        style={{ color: 'var(--app-text-muted)' }}
      >
        {value}
        {unit}
      </span>
    </div>
  );
}
