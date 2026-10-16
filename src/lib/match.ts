/** 唯一匹配入口：后台拦截和确认页查询使用同一判定。 */
import type { HashPolicy, MatchMode, Settings, SiteRule } from './settings';
export const INTERNAL_URL_RE = /^(chrome|about|edge|devtools|chrome-extension|view-source):/i;
export const MODE_LABELS: Record<MatchMode, string> = { url: '完整地址', smart: '智能匹配', path: '同路径', domain: '同域名' };
const TRACKING = new Set(['gclid', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid']);

/**
 * 主机名归一化（仅用于白名单与 domain 模式的站点合并语义）。
 *
 * ⚠️ 不要用它构造 smart / path 的判定键：`example.com` 与 `www.example.com` 是两个不同 host，
 * 自动合并会扩大判定范围（原本放行的两个页面会被判为重复）。需要合并必须由用户显式声明。
 */
export function stripWww(host: string): string {
  return host.replace(/^www\./i, '');
}
export function hostOf(url: string): string | null {
  try { return stripWww(new URL(url).hostname); } catch { return null; }
}
function webUrl(value: string): URL | null {
  try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; }
}
function hashPolicyOf(settings: Settings): HashPolicy {
  return settings.hashPolicy === 'ignore' ? 'ignore' : 'keep';
}
/**
 * Hash 判定：
 * - keep（默认）：完整保留 Hash。`#inbox` / `#sent` 这类单段 Hash 路由必须区分，否则不同页面会被误判为重复。
 * - ignore：丢弃 Hash，把 `#intro` / `#comments` 一律视作页内锚点（适合纯文档站）。
 * 无法自动区分「单段路由」与「页内锚点」，因此默认取保守侧（漏判优于误判）。
 */
function routeHash(hash: string, policy: HashPolicy): string {
  return policy === 'ignore' ? '' : hash;
}
/**
 * 站点规则匹配。分层命中，层级越小越具体：
 *   0 原始 host 精确命中 —— 用户就是为这个 host 写的规则，任何规则都不得覆盖它
 *   1 别名精确命中     —— 裸域与 `www.` 互通，仅在用户显式写出对应域名时成立
 *   2 子域覆盖         —— 需 includeSubdomains，取域名最长者
 * 结果是确定性的，不依赖 siteRules 数组顺序。
 */
export function resolveRule(url: string, settings: Settings): { mode: MatchMode; rule?: SiteRule } {
  const raw = webUrl(url)?.hostname;
  if (!raw) return { mode: settings.matchMode };
  const host = stripWww(raw);

  let best: { rule: SiteRule; tier: number; specificity: number } | null = null;
  for (const rule of settings.siteRules) {
    const domain = stripWww(rule.domain);
    const exactRaw = rule.domain === raw;
    // 别名是**单向**的：`www.example.com` 是 `example.com` 的别名，反之不成立。
    // 只认用户为裸域显式写下的规则，不做双向推断 —— 否则为 www 写的规则会反过来吞掉裸域。
    const exactAlias = !exactRaw && raw.startsWith('www.') && rule.domain === host;
    const subdomain = !exactRaw && !exactAlias && rule.includeSubdomains && host.endsWith(`.${domain}`);
    if (!exactRaw && !exactAlias && !subdomain) continue;

    const tier = exactRaw ? 0 : exactAlias ? 1 : 2;
    const specificity = tier === 2 ? domain.length : 0;
    const better =
      !best ||
      tier < best.tier ||
      (tier === best.tier &&
        (specificity > best.specificity ||
          (specificity === best.specificity && !rule.includeSubdomains && best.rule.includeSubdomains)));
    if (better) best = { rule, tier, specificity };
  }

  return { mode: best?.rule.mode ?? settings.matchMode, rule: best?.rule };
}
function key(u: URL, mode: MatchMode, ignored: string[], hashPolicy: HashPolicy): string {
  // 完整地址模式保留参数顺序、斜杠和锚点，避免改变潜在语义。
  if (mode === 'url') return u.href;
  // 同域名模式保留其「整站合并」语义，裸域与 www 视为同一站点
  if (mode === 'domain') return stripWww(u.hostname);
  const pairs = [...u.searchParams.entries()].filter(([name]) => !ignored.includes(name) && !(mode === 'smart' && (name.toLowerCase().startsWith('utm_') || TRACKING.has(name.toLowerCase()))));
  // 不同参数名排序；同名多值的顺序保留，因为可能影响服务端含义。
  pairs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  // 用原始 hostname：不把裸域与 www 自动合并，需要合并请由用户显式声明站点规则
  return JSON.stringify([u.protocol, u.hostname, u.port, u.pathname, mode === 'path' ? [] : pairs, routeHash(u.hash, hashPolicy)]);
}
export interface MatchResult { mode: MatchMode; reason: string; ruleDomain?: string }
export function matchDuplicate(candidate: string, existing: string, settings: Settings): MatchResult | null {
  const a = webUrl(candidate), b = webUrl(existing);
  if (!a || !b || inWhitelist(candidate, settings.whitelist)) return null;
  const { mode, rule } = resolveRule(candidate, settings);
  const ignored = rule?.ignoredParams ?? [];
  const hashPolicy = hashPolicyOf(settings);
  if (key(a, mode, ignored, hashPolicy) !== key(b, mode, ignored, hashPolicy)) return null;
  const hashNote = mode === 'url' ? '' : hashPolicy === 'ignore' ? '，Hash 已忽略' : '，Hash 保留';
  const reason =
    mode === 'url' ? '完整地址相同'
    : mode === 'domain' ? '同域名规则：路径或参数可能不同'
    : mode === 'path' ? `同路径规则：查询参数不参与比较${hashNote}`
    : `智能匹配：路径与内容参数相同，忽略追踪参数${hashNote}`;
  return { mode, reason: reason + (rule?.ignoredParams.length && mode === 'smart' ? `；本站另忽略 ${rule.ignoredParams.join('、')}` : ''), ruleDomain: rule?.domain };
}
export function inWhitelist(url: string, whitelist: string[]): boolean {
  const h = hostOf(url);
  return !!h && whitelist.some(w => h === stripWww(w));
}
export function computeMatchKey(url: string, settings: Settings): string | null {
  const u = webUrl(url);
  if (!u) return null;
  const { mode, rule } = resolveRule(url, settings);
  return key(u, mode, rule?.ignoredParams ?? [], hashPolicyOf(settings));
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
  | 'allowed_temporary'
  | 'whitelist'
  | 'reload_or_history'
  | 'spa_ignored'
  | 'fragment_anchor'
  | 'same_match_key';

interface NavigationContext extends NavigationCheckParams {
  now: number;
}

/** 同一 matchKey 表示「对去重而言没有变化」，无需重复扫描全量标签。 */
function sameMatchKey(c: NavigationContext): boolean {
  return c.lastMatchKey != null && c.currentMatchKey != null && c.lastMatchKey === c.currentMatchKey;
}
function isReloadOrHistory(c: NavigationContext): boolean {
  return (
    c.transitionType === 'reload' ||
    (c.eventType === 'committed' && Boolean(c.lastUrl) && c.lastUrl === c.url) ||
    Boolean(c.transitionQualifiers?.includes('forward_back'))
  );
}
function isAllowedTemporary(c: NavigationContext): boolean {
  const e = c.allowedEntry;
  if (!e || c.now > e.expiresAt) return false;
  return e.targetUrl === c.url || (e.matchKey != null && c.currentMatchKey != null && e.matchKey === c.currentMatchKey);
}

/**
 * 放行策略链，自上而下短路求值。顺序即优先级，改动前请先读这里：
 * 1. internal_url      内部协议 / 非法地址
 * 2. allowed_temporary 用户显式点了「仍要打开」——显式意图优先级最高
 * 3. whitelist         站点白名单
 * 4. reload_or_history 刷新、原地重复提交、前进后退（受 ignoreReload 控制）
 * 5. spa_ignored       spaPolicy=off 时完全不管 SPA 路由变化
 * 6. fragment_anchor   纯锚点跳转（matchKey 未变）
 * 7. same_match_key    history 事件重复提交同一路由（SPA 高频 pushState 防抖）
 */
const POLICIES: ReadonlyArray<{ reason: SkipReason; test: (c: NavigationContext) => boolean }> = [
  { reason: 'internal_url', test: c => !c.url || INTERNAL_URL_RE.test(c.url) },
  { reason: 'allowed_temporary', test: isAllowedTemporary },
  { reason: 'whitelist', test: c => inWhitelist(c.url, c.settings.whitelist) },
  { reason: 'reload_or_history', test: c => c.settings.ignoreReload !== false && isReloadOrHistory(c) },
  { reason: 'spa_ignored', test: c => c.eventType !== 'committed' && c.settings.spaPolicy === 'off' },
  { reason: 'fragment_anchor', test: c => c.eventType === 'fragment' && sameMatchKey(c) },
  { reason: 'same_match_key', test: c => c.eventType === 'history' && sameMatchKey(c) },
];

/** 集中判断当前导航是否应当跳过去重拦截。 */
export function shouldSkipNavigation(params: NavigationCheckParams): { skip: boolean; reason?: SkipReason } {
  const c: NavigationContext = { ...params, now: params.now ?? Date.now() };
  for (const policy of POLICIES) {
    if (policy.test(c)) return { skip: true, reason: policy.reason };
  }
  return { skip: false };
}

export async function queryWebTabs(): Promise<chrome.tabs.Tab[]> {
  return (await chrome.tabs.query({})).filter(t => !!t.url && !!webUrl(t.url));
}
