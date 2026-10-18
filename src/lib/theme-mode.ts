// 主题偏好：浅色 / 深色 / 跟随系统。
// 存于 chrome.storage.sync，所有界面（含 Shadow DOM 浮窗）共用同一份设置。
import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'yitab_theme_mode';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const VALID: ThemeMode[] = ['light', 'dark', 'system'];

export function sanitizeThemeMode(value: unknown): ThemeMode {
  return VALID.includes(value as ThemeMode) ? (value as ThemeMode) : DEFAULT_THEME_MODE;
}

/** 系统是否深色。 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 把偏好解析成实际生效的深色与否。 */
export function resolveIsDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark());
}

export async function getThemeMode(): Promise<ThemeMode> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return DEFAULT_THEME_MODE;
  try {
    const res = await chrome.storage.sync.get(THEME_STORAGE_KEY);
    return sanitizeThemeMode(res[THEME_STORAGE_KEY]);
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) return;
  await chrome.storage.sync.set({ [THEME_STORAGE_KEY]: sanitizeThemeMode(mode) });
}

/**
 * 订阅主题偏好与系统配色。
 * 返回当前偏好与生效结果；跨页面改动通过 storage.onChanged 同步。
 */
export function useThemeMode(): {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
} {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  useEffect(() => {
    let alive = true;
    void getThemeMode().then((m) => {
      if (alive) setModeState(m);
    });

    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && THEME_STORAGE_KEY in changes) {
        setModeState(sanitizeThemeMode(changes[THEME_STORAGE_KEY].newValue));
      }
    };
    chrome.storage?.onChanged?.addListener(onChanged);

    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMedia = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    media?.addEventListener('change', onMedia);

    return () => {
      alive = false;
      chrome.storage?.onChanged?.removeListener(onChanged);
      media?.removeEventListener('change', onMedia);
    };
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next); // 先反馈，避免等待存储往返
    await setThemeMode(next);
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  return { mode, isDark, setMode };
}

/**
 * 把生效主题写到 <html> 上：
 * - data-theme：供 CSS 令牌选择（工作台 style.css 使用）
 * - color-scheme：让滚动条、表单控件等原生 UI 与主题一致
 * - 页面底色：避免扩展页在首帧闪出系统默认背景
 */
export function applyThemeToDocument(isDark: boolean, canvas: string): void {
  const root = document.documentElement;
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.style.background = canvas;
  document.body.style.background = canvas;
}
