import { flushSync } from 'react-dom';

/** 从 :root 读取 CSS 变量（缓动曲线、时长等一律走 P0 令牌）。 */
export function readCssVariable(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** 读取 CSS 时长令牌并换算成毫秒；无法解析时使用回退值。 */
export function readCssDurationMs(name: string, fallback: number): number {
  const value = readCssVariable(name, '');
  if (!value) return fallback;
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  if (value.endsWith('ms')) return num;
  if (value.endsWith('s')) return num * 1000;
  return fallback;
}

/** 是否开启「减弱动态效果」；JS 驱动的动效需自行遵守。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * 015 视图切换：优先使用 View Transitions API，浏览器不支持时直接更新。
 * React 状态需要同步提交，否则快照会在 DOM 更新前拍下，故用 flushSync。
 */
export function runViewTransition(update: () => void): void {
  if (typeof document === 'undefined' || prefersReducedMotion()) {
    update();
    return;
  }
  const doc = document as DocumentWithViewTransition;
  if (typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }
  try {
    doc.startViewTransition(() => {
      flushSync(update);
    });
  } catch {
    update();
  }
}