/** 唯一匹配入口：后台拦截和确认页查询使用同一判定。 */
import type { MatchMode, Settings, SiteRule } from './settings';
export const INTERNAL_URL_RE = /^(chrome|about|edge|devtools|chrome-extension|view-source):/i;
export const MODE_LABELS: Record<MatchMode, string> = { url: '完整地址', smart: '智能匹配', path: '同路径', domain: '同域名' };
const TRACKING = new Set(['gclid', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid']);
export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
}
function webUrl(value: string): URL | null {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}
// #/、#!/ 和 #route/... 作为路由保留。其他复杂 Hash 无法自动猜测，保守保留。
function routeHash(hash: string): string {
  if (!hash || /^#[\p{L}\p{N}_-]+$/u.test(hash)) return '';
  return hash;
}
export function normalizeUrl(url: string): string {
  // 完整地址模式保留参数顺序、斜杠和锚点，避免改变潜在语义。
  return webUrl(url)?.href ?? url;
}
export function resolveRule(url: string, settings: Settings): { mode: MatchMode; rule?: SiteRule } {
  const host = webUrl(url)?.hostname;
  if (!host) return { mode: settings.matchMode };
  const rule = settings.siteRules.filter(r => host === r.domain || (r.includeSubdomains && host.endsWith(`.${r.domain}`)))
    .sort((a, b) => b.domain.length - a.domain.length || Number(a.includeSubdomains) - Number(b.includeSubdomains))[0];
  return { mode: rule?.mode ?? settings.matchMode, rule };
}
function key(u: URL, mode: MatchMode, ignored: string[]): string {
  if (mode === 'url') return u.href;
  if (mode === 'domain') return u.hostname.replace(/^www\./, ''); // 兼容旧同域名设置
  const pairs = [...u.searchParams.entries()].filter(([name]) => !ignored.includes(name) && !(mode === 'smart' && (name.toLowerCase().startsWith('utm_') || TRACKING.has(name.toLowerCase()))));
  // 不同参数名排序；同名多值的顺序保留，因为可能影响服务端含义。
  pairs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return JSON.stringify([u.origin, u.pathname, mode === 'path' ? [] : pairs, routeHash(u.hash)]);
}
export interface MatchResult { mode: MatchMode; reason: string; ruleDomain?: string }
export function matchDuplicate(candidate: string, existing: string, settings: Settings): MatchResult | null {
  const a = webUrl(candidate), b = webUrl(existing);
  if (!a || !b || inWhitelist(candidate, settings.whitelist)) return null;
  const { mode, rule } = resolveRule(candidate, settings);
  if (key(a, mode, rule?.ignoredParams ?? []) !== key(b, mode, rule?.ignoredParams ?? [])) return null;
  const reason = mode === 'url' ? '完整地址相同' : mode === 'domain' ? '同域名规则：路径或参数可能不同' : mode === 'path' ? '同路径规则：查询参数不参与比较，Hash 路由保留' : '智能匹配：路径与内容参数相同，忽略追踪参数及普通锚点';
  return { mode, reason: reason + (rule?.ignoredParams.length && mode === 'smart' ? `；本站另忽略 ${rule.ignoredParams.join('、')}` : ''), ruleDomain: rule?.domain };
}
export function isDuplicate(candidate: string, existing: string, mode: MatchMode): boolean {
  return !!matchDuplicate(candidate, existing, { matchMode: mode, interceptMode: 'auto', whitelist: [], siteRules: [] });
}
export function inWhitelist(url: string, whitelist: string[]): boolean {
  const h = hostOf(url);
  return !!h && whitelist.some(w => h === w.replace(/^www\./, ''));
}
export function computeMatchKey(url: string, settings: Settings): string | null {
  const u = webUrl(url);
  if (!u) return null;
  const { mode, rule } = resolveRule(url, settings);
  return key(u, mode, rule?.ignoredParams ?? []);
}
export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favicon: string;
  groupId?: number;
  groupTitle?: string;
  groupColor?: string;
  match?: MatchResult;
}
export async function queryWebTabs(): Promise<chrome.tabs.Tab[]> {
  return (await chrome.tabs.query({})).filter(t => !!t.url && !!webUrl(t.url));
}