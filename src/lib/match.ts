/** URL 匹配与白名单判定 */
import type { MatchMode } from './settings';

export const INTERNAL_URL_RE = /^(chrome|about|edge|devtools|chrome-extension|view-source):/i;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** 归一化：去 hash、去结尾斜杠 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function isDuplicate(candidate: string, existing: string, mode: MatchMode): boolean {
  if (!candidate || !existing) return false;
  if (mode === 'domain') {
    const a = hostOf(candidate);
    const b = hostOf(existing);
    return !!a && a === b;
  }
  return normalizeUrl(candidate) === normalizeUrl(existing);
}

export function inWhitelist(url: string, whitelist: string[]): boolean {
  const h = hostOf(url);
  return !!h && whitelist.some((w) => h === w.replace(/^www\./, ''));
}

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favicon: string;
}

/** 查询所有「真实网页」标签（排除浏览器内部页） */
export async function queryWebTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((t) => t.url && !INTERNAL_URL_RE.test(t.url));
}