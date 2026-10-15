/** 设置模型与存储（chrome.storage.sync + 内存缓存） */

export type MatchMode = 'url' | 'domain';
export type InterceptMode = 'auto' | 'ask';

export interface Settings {
  matchMode: MatchMode;
  interceptMode: InterceptMode;
  whitelist: string[];
}

export const DEFAULTS: Settings = {
  matchMode: 'url',
  interceptMode: 'auto',
  whitelist: [],
};

const SETTINGS_KEYS: (keyof Settings)[] = ['matchMode', 'interceptMode', 'whitelist'];

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const stored = await chrome.storage.sync.get(DEFAULTS as unknown as Record<string, unknown>);
  const s = { ...DEFAULTS, ...(stored as Partial<Settings>) };
  if (!Array.isArray(s.whitelist)) s.whitelist = [];
  cache = s;
  return s;
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  await chrome.storage.sync.set(patch);
  return getSettings();
}

/** 在 background 启动时调用：设置变更时使内存缓存失效 */
export function watchSettings(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && SETTINGS_KEYS.some((k) => k in changes)) cache = null;
  });
}