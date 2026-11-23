import React, { useCallback, useRef, useState } from 'react';

export interface TruncatedTextProps {
  text: string;
  /** 悬停提示；不传时仅在真正被截断时显示全文 */
  tooltip?: string;
  className?: string;
}

/**
 * 单行文本截断：只有 scrollWidth > clientWidth 时才在悬停后显示全文，
 * 避免未截断的短文本也弹出冗余 tooltip。
 */
export function TruncatedText({ text, tooltip, className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  const handleMouseEnter = useCallback(() => {
    const el = ref.current;
    setTruncated(Boolean(el && el.scrollWidth > el.clientWidth + 1));
  }, []);

  return (
    <span
      ref={ref}
      className={`yt-truncate${className ? ` ${className}` : ''}`}
      onMouseEnter={handleMouseEnter}
      title={tooltip ?? (truncated ? text : undefined)}
    >
      {text}
    </span>
  );
}