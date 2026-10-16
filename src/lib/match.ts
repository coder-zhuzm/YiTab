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
  return !!matchDuplicate(candidate, existing, {
    matchMode: mode,
    interceptMode: 'auto',
    whitelist: [],
    siteRules: [],
    ignoreReload: true,
  });
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

export interface NavigationCheckParams {
  url: string;
  eventType: 'committed' | 'history' | 'fragment';
  transitionType?: string;
  transitionQualifiers?: string[];
  lastUrl?: string;
  lastMatchKey?: string | null;
  currentMatchKey?: string | null;
  settings: Settings;
  allowedEntry?: { targetUrl: string; matchKey: string | null; expiresAt: number } | null;
  now?: number;
}

export type SkipReason =
  | 'internal_url'
  | 'reload_or_history'
  | 'fragment_anchor'
  | 'spa_same_domain'
  | 'allowed_temporary'
  | 'whitelist';

/**
 * 集中判断当前导航是否应当跳过去重拦截
 */
export function shouldSkipNavigation(
  params: NavigationCheckParams,
): { skip: boolean; reason?: SkipReason } {
  const {
    url,
    eventType,
    transitionType,
    transitionQualifiers,
    lastUrl,
    lastMatchKey,
    currentMatchKey,
    settings,
    allowedEntry,
    now = Date.now(),
  } = params;

  // 内部保留与特殊协议直接放行
  if (!url || INTERNAL_URL_RE.test(url)) {
    return { skip: true, reason: 'internal_url' };
  }

  // 0. 刷新与历史导航过滤：
  // 当开启 ignoreReload（默认开启）时：
  // a. transitionType 为 'reload'（F5、Ctrl+R、重新加载按钮、location.reload() 等）
  // b. 在 committed 整页导航中，当前标签已在相同 URL 上（原地提交相同网址）
  // c. transitionQualifiers 包含 'forward_back'（浏览器前进/后退历史导航，属于本标签的浏览轨迹，非新开）
  if (settings.ignoreReload !== false) {
    const isReloadOrHistory =
      transitionType === 'reload' ||
      (eventType === 'committed' && Boolean(lastUrl) && lastUrl === url) ||
      Boolean(transitionQualifiers?.includes('forward_back'));

    if (isReloadOrHistory) {
      return { skip: true, reason: 'reload_or_history' };
    }
  }

  // 1. 普通锚点变化过滤（如 #intro -> #comments，两者 matchKey 相同则不触发重复提示）
  if (eventType === 'fragment') {
    if (lastMatchKey != null && currentMatchKey != null && lastMatchKey === currentMatchKey) {
      return { skip: true, reason: 'fragment_anchor' };
    }
  }

  // 2. 同域名模式防过度骚扰：已在站内正常浏览的 SPA 站内路由跳转，不应在每个链接都弹提示
  if (eventType !== 'committed') {
    const { mode } = resolveRule(url, settings);
    if (mode === 'domain' && lastUrl && hostOf(lastUrl) === hostOf(url)) {
      return { skip: true, reason: 'spa_same_domain' };
    }
  }

  // 3. 「仍要打开」放行：时限内仅对目标地址及等价 matchKey 的导航链放行
  if (allowedEntry) {
    if (now <= allowedEntry.expiresAt) {
      if (
        allowedEntry.targetUrl === url ||
        (allowedEntry.matchKey != null &&
          currentMatchKey != null &&
          allowedEntry.matchKey === currentMatchKey)
      ) {
        return { skip: true, reason: 'allowed_temporary' };
      }
    }
  }

  // 4. 白名单检查
  if (inWhitelist(url, settings.whitelist)) {
    return { skip: true, reason: 'whitelist' };
  }

  return { skip: false };
}

export async function queryWebTabs(): Promise<chrome.tabs.Tab[]> {
  return (await chrome.tabs.query({})).filter(t => !!t.url && !!webUrl(t.url));
}