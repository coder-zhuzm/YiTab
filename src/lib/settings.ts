/** 设置模型与存储。未知参数不猜测，旧 matchMode 原样保留。 */
export type MatchMode = 'url' | 'smart' | 'path' | 'domain';
export type InterceptMode = 'auto' | 'ask';
export interface SiteRule {
  domain: string;
  mode: MatchMode;
  ignoredParams: string[];
  includeSubdomains: boolean;
}
export interface Settings {
  matchMode: MatchMode;
  interceptMode: InterceptMode;
  whitelist: string[];
  siteRules: SiteRule[];
}
export const DEFAULTS: Settings = {
  matchMode: 'smart', interceptMode: 'auto', whitelist: [], siteRules: [],
};
const MODES: MatchMode[] = ['url', 'smart', 'path', 'domain'];
const SETTINGS_KEYS: (keyof Settings)[] = ['matchMode', 'interceptMode', 'whitelist', 'siteRules'];
export function normalizeDomain(value: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.port || !u.hostname) return null;
    return u.hostname.toLowerCase();
  } catch { return null; }
}
export function sanitizeSettings(value: Partial<Settings>): Settings {
  return {
    matchMode: MODES.includes(value.matchMode!) ? value.matchMode! : DEFAULTS.matchMode,
    interceptMode: value.interceptMode === 'ask' ? 'ask' : 'auto',
    whitelist: Array.isArray(value.whitelist) ? [...new Set(value.whitelist.map(normalizeDomain).filter((x): x is string => !!x))] : [],
    siteRules: Array.isArray(value.siteRules) ? value.siteRules.flatMap(r => {
      if (!r || typeof r.domain !== 'string') return [];
      const domain = normalizeDomain(r.domain);
      if (!domain || !MODES.includes(r.mode)) return [];
      return [{ domain, mode: r.mode, includeSubdomains: r.includeSubdomains === true,
        ignoredParams: Array.isArray(r.ignoredParams) ? [...new Set(r.ignoredParams.filter((p): p is string => typeof p === 'string' && !!p.trim()).map(p => p.trim()))] : [] }];
    }) : [],
  };
}
let cache: Settings | null = null;
let watching = false;
export async function getSettings(): Promise<Settings> {
  watchSettings();
  if (cache) return cache;
  cache = sanitizeSettings(await chrome.storage.sync.get(SETTINGS_KEYS));
  return cache;
}
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitizeSettings({ ...await getSettings(), ...patch });
  await chrome.storage.sync.set(next);
  // 当前页面也必须立即失效；不能只依赖后台 storage 监听。
  cache = null;
  return getSettings();
}
export function watchSettings(): void {
  if (watching) return;
  watching = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && SETTINGS_KEYS.some(k => k in changes)) cache = null;
  });
}
