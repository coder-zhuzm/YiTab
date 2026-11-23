import React, { useEffect, useState } from 'react';

export type EmptyStateSize = 'page' | 'card' | 'row' | 'menu';

export interface EmptyStateProps {
  /** page=整页/大面板，card=卡片，row=一行，menu=菜单/下拉里的一行 */
  size: EmptyStateSize;
  /** 图片或图标，容器已标记 aria-hidden */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** 动词按钮或行内链接 */
  action?: React.ReactNode;
  /** 无结果时用 polite 播报 */
  live?: boolean;
  /** 内容到达后播放 180ms 淡出 */
  leaving?: boolean;
  className?: string;
}

/** 四种尺寸共用的空状态骨架：图标 → 标题 → 描述 → 按钮。 */
export function EmptyState({
  size,
  icon,
  title,
  description,
  action,
  live = false,
  leaving = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`yt-empty-state${leaving ? ' is-leaving' : ''}${className ? ` ${className}` : ''}`}
      data-size={size}
      aria-live={live ? 'polite' : undefined}
    >
      {icon ? (
        <div className="yt-empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      {title ? <p className="yt-empty-title">{title}</p> : null}
      {description ? <p className="yt-empty-desc">{description}</p> : null}
      {action ? <div className="yt-empty-actions">{action}</div> : null}
    </div>
  );
}

/** 空状态 -> 内容的延迟卸载：内容到达后空状态先原地淡出 180ms。 */
export function useDelayedUnmount(visible: boolean, delay = 180) {
  const [mounted, setMounted] = useState(visible);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, mounted, delay]);

  return { mounted, leaving: leaving && !visible };
}

export interface EmptyStateSwapProps extends Omit<EmptyStateProps, 'leaving'> {
  /** true 显示空状态；false 显示内容 */
  show: boolean;
  children: React.ReactNode;
  delay?: number;
}

/**
 * 空状态与内容互斥展示：内容出现时先让空状态绝对定位淡出，
 * 内容在原来的位置淡入，避免高度跳变。
 */
export function EmptyStateSwap({ show, children, delay, ...emptyProps }: EmptyStateSwapProps) {
  const { mounted, leaving } = useDelayedUnmount(show, delay);

  return (
    <div className={`yt-empty-swap${mounted && !show ? ' is-swapping' : ''}`}>
      {mounted ? (
        <div className="yt-empty-swap-empty">
          <EmptyState {...emptyProps} leaving={leaving} />
        </div>
      ) : null}
      {!show ? <div className="yt-content-enter">{children}</div> : null}
    </div>
  );
}

/** 空快捷方式：双色小图标（外部容器负责 aria-hidden）。 */
export function EmptyShortcutIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="14"
        height="14"
        rx="4"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <rect
        x="22.5"
        y="3.5"
        width="14"
        height="14"
        rx="4"
        fill="var(--surface-well)"
        stroke="var(--hairline-strong)"
        strokeWidth="1.5"
      />
      <rect
        x="3.5"
        y="22.5"
        width="14"
        height="14"
        rx="4"
        fill="var(--surface-well)"
        stroke="var(--hairline-strong)"
        strokeWidth="1.5"
      />
      <path
        d="M29.5 23v14M22.5 30h14"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}