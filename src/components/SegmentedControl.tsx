import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { prefersReducedMotion, readCssDurationMs, readCssVariable } from '@/lib/motion';

export interface SegmentedControlOption<T extends string> {
  id: T;
  label: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * 015 分段控件：指示条切换时先横向拉伸再落位，只动 transform。
 * 各分段等宽（见 .yt-seg button），指示条宽度无需在切换时改变。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const previousGeomRef = useRef<{ left: number; width: number } | null>(null);
  const [geom, setGeom] = useState<{ left: number; width: number } | null>(null);

  const index = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );

  const measure = useCallback(() => {
    const button = buttonsRef.current[index];
    if (!button) return;
    setGeom({ left: button.offsetLeft, width: button.offsetWidth });
  }, [index]);

  // 首帧与容器尺寸变化时重新测量（指示条尺寸跟随按钮）。
  useLayoutEffect(() => {
    measure();
  }, [measure, options.length]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  // 切换时：旧位置 → 中点略微拉伸 → 新位置，缓动与时长走 P0 令牌。
  useLayoutEffect(() => {
    const button = buttonsRef.current[index];
    const indicator = indicatorRef.current;
    if (!button || !indicator) return;

    const next = { left: button.offsetLeft, width: button.offsetWidth };
    const previous = previousGeomRef.current;
    previousGeomRef.current = next;

    if (!previous || (previous.left === next.left && previous.width === next.width)) return;
    if (prefersReducedMotion()) return;

    const duration = readCssDurationMs('--dur-md-in', 300);
    const easing = readCssVariable('--ease-overshoot', 'cubic-bezier(0.34, 1.56, 0.64, 1)');
    const mid = previous.left + (next.left - previous.left) * 0.5;

    indicator.animate(
      [
        { transform: `translateX(${previous.left}px)`, offset: 0 },
        { transform: `translateX(${mid}px) scaleX(1.06)`, offset: 0.55 },
        { transform: `translateX(${next.left}px) scaleX(1)`, offset: 1 },
      ],
      { duration, easing },
    );
  }, [index]);

  return (
    <div
      ref={rootRef}
      className={`yt-seg${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      <span
        ref={indicatorRef}
        className={`yt-seg-indicator${geom ? ' is-ready' : ''}`}
        style={
          geom
            ? { width: `${geom.width}px`, transform: `translateX(${geom.left}px)` }
            : undefined
        }
        aria-hidden="true"
      />
      {options.map((option, optionIndex) => (
        <button
          key={option.id}
          ref={(node) => {
            buttonsRef.current[optionIndex] = node;
          }}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => {
            if (option.id !== value) onChange(option.id);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}