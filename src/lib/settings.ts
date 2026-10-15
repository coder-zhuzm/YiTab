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

/**
 * Chrome Built-in AI (端侧模型) 资源管控与功能开关配置
 */
export interface AiSettings {
  /** 全局总开关：一票否决权。关闭时完全不加载任何 AI 模块，100% 走启发式规则 */
  enabled: boolean;
  /** 子功能 1：深层路由继续胶囊智能提炼 */
  capsuleSummarize: boolean;
  /** 子功能 2：搜索框自然语言意图起跳 */
  naturalLanguageJump: boolean;
  /** 子功能 3：跨域名任务语义聚类与智能标签组命名 */
  taskAutoGrouping: boolean;
  /** 子功能 4：书签空闲时自动打标分类（默认关闭，避免轻薄本频繁唤醒） */
  bookmarkSmartTagging: boolean;
  /** 子功能 5：晨间工作现场智能简报 */
  morningBriefing: boolean;
  /** 节电策略：电池供电或低电量时暂停后台推理（默认开启） */
  pauseOnBattery: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  capsuleSummarize: true,
  naturalLanguageJump: true,
  taskAutoGrouping: true,
  bookmarkSmartTagging: false,
  morningBriefing: true,
  pauseOnBattery: true,
};

export const AI_SETTINGS_STORAGE_KEY = 'yitab_ai_settings';

export async function getAiSettings(): Promise<AiSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    return { ...DEFAULT_AI_SETTINGS };
  }
  try {
    const res = await chrome.storage.sync.get(AI_SETTINGS_STORAGE_KEY);
    const saved = res[AI_SETTINGS_STORAGE_KEY];
    if (saved && typeof saved === 'object') {
      return { ...DEFAULT_AI_SETTINGS, ...saved };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_AI_SETTINGS };
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const current = await getAiSettings();
  const next: AiSettings = { ...current, ...patch };
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    await chrome.storage.sync.set({ [AI_SETTINGS_STORAGE_KEY]: next });
  }
  return next;
}

