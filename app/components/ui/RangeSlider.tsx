import type { CSSProperties } from "react";

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * `.range-slider` with its filled track: the CSS paints the accent up to
 * `--val`, which has to follow the value (otherwise the track stays at 50%).
 */
export function RangeSlider({ value, min, max, step = 1, onChange, className = "", style, ...aria }: RangeSliderProps) {
  const pct = max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={`range-slider ${className}`.trim()}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ ...style, "--val": `${pct}%` } as CSSProperties}
      {...aria}
    />
  );
}
