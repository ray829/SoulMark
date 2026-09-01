/** 通用范围滑块:label + range input + 数值显示。
 *  套用 App.css 的 .range-* 样式,用于外观设置面板。 */
interface RangeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 自定义数值显示(如百分比) */
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function RangeSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  disabled,
}: RangeSliderProps) {
  return (
    <div className="range-row">
      <span className="range-label">{label}</span>
      <input
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="range-value">{format ? format(value) : value}</span>
    </div>
  );
}
