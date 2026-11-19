import {
  DEFAULT_AI_SETTINGS,
  getAiSettings,
  getSettings,
  sanitizeSettings,
  saveAiSettings,
  setSettings,
  type AiSettings,
  type Settings,
} from './settings.ts';
import {
  getNewTabSettings,
  getPinnedData,
  saveNewTabSettings,
  savePinnedData,
} from './pinned.ts';
import type { NewTabSettings, PinnedData, PinnedGroup, PinnedItem } from './newtab-types.ts';
import {
  getThemeMode,
  sanitizeThemeMode,
  setThemeMode,
  type ThemeMode,
} from './theme-mode.ts';
import { APP_VERSION } from './version.ts';

export const CONFIG_BACKUP_SCHEMA_VERSION = 1;

export interface ConfigBackupPayload {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  themeMode: ThemeMode;
  settings: Settings;
  newTabSettings: Partial<NewTabSettings>;
  pinnedData: PinnedData;
  aiSettings: Partial<AiSettings>;
}

export type ParseBackupResult =
  | { ok: true; data: ConfigBackupPayload }
  | { ok: false; error: string };

function sanitizePinnedData(raw: unknown): PinnedData | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.groups) || !Array.isArray(obj.items)) return null;

  const groups: PinnedGroup[] = obj.groups
    .filter(
      (g): g is Record<string, unknown> =>
        Boolean(g && typeof g === 'object' && typeof (g as Record<string, unknown>).id === 'string'),
    )
    .map((g, idx) => ({
      id: String(g.id).trim(),
      name: String(g.name ?? '未命名分组').trim() || '未命名分组',
      order: typeof g.order === 'number' && Number.isFinite(g.order) ? g.order : idx + 1,
    }))
    .filter((g) => Boolean(g.id));

  if (groups.length === 0) return null;
  const groupIds = new Set(groups.map((g) => g.id));
  const fallbackGroupId = groups[0].id;

  const items: PinnedItem[] = obj.items
    .filter(
      (it): it is Record<string, unknown> =>
        Boolean(
          it &&
            typeof it === 'object' &&
            typeof (it as Record<string, unknown>).url === 'string' &&
            typeof (it as Record<string, unknown>).title === 'string',
        ),
    )
    .map((it, idx) => {
      const gid = typeof it.groupId === 'string' && groupIds.has(it.groupId) ? it.groupId : fallbackGroupId;
      return {
        id:
          typeof it.id === 'string' && it.id.trim()
            ? it.id.trim()
            : `pin_imp_${Date.now()}_${idx}`,
        title: String(it.title).trim() || String(it.url),
        url: String(it.url).trim(),
        groupId: gid,
        createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      };
    })
    .filter((it) => /^https?:\/\//i.test(it.url));

  return { groups, items };
}

/** 解析并校验导入的配置 JSON 字符串（纯函数，便于单测） */
export function parseConfigBackup(rawText: string): ParseBackupResult {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: '配置文件内容为空' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'JSON 格式解析失败，请确认文件未损坏' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: '配置根对象格式无效' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.schemaVersion !== CONFIG_BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: `不支持的配置版本：${String(obj.schemaVersion ?? '未知')}` };
  }
  if (!obj.settings || typeof obj.settings !== 'object') {
    return { ok: false, error: '缺少去重规则配置（settings）' };
  }
  const pinnedData = sanitizePinnedData(obj.pinnedData);
  if (!pinnedData) {
    return { ok: false, error: '快捷方式数据（pinnedData）格式无效或缺少分组' };
  }

  return {
    ok: true,
    data: {
      schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : APP_VERSION,
      themeMode: sanitizeThemeMode(obj.themeMode),
      settings: sanitizeSettings(obj.settings as Partial<Settings>),
      newTabSettings:
        obj.newTabSettings && typeof obj.newTabSettings === 'object'
          ? (obj.newTabSettings as Partial<NewTabSettings>)
          : {},
      pinnedData,
      aiSettings:
        obj.aiSettings && typeof obj.aiSettings === 'object'
          ? { ...DEFAULT_AI_SETTINGS, ...(obj.aiSettings as Partial<AiSettings>) }
          : { ...DEFAULT_AI_SETTINGS },
    },
  };
}

/** 导出当前扩展全量配置 */
export async function exportAllConfig(): Promise<ConfigBackupPayload> {
  const [settings, newTabSettings, pinnedData, aiSettings, themeMode] = await Promise.all([
    getSettings(),
    getNewTabSettings(),
    getPinnedData(),
    getAiSettings(),
    getThemeMode(),
  ]);

  return {
    schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    themeMode,
    settings,
    newTabSettings,
    pinnedData,
    aiSettings,
  };
}

/** 导入配置（支持覆盖 overwrite 或合并 merge） */
export async function importAllConfig(
  payload: ConfigBackupPayload,
  mode: 'merge' | 'overwrite',
): Promise<void> {
  if (mode === 'overwrite') {
    await Promise.all([
      setSettings(payload.settings),
      saveNewTabSettings(payload.newTabSettings),
      savePinnedData(payload.pinnedData),
      saveAiSettings(payload.aiSettings),
      setThemeMode(payload.themeMode),
    ]);
    return;
  }

  // merge 模式：保留现有白名单、站点规则、快捷方式与分组，按唯一键合并增量
  const [curSettings, curPinned] = await Promise.all([getSettings(), getPinnedData()]);

  const mergedWhitelist = [...new Set([...curSettings.whitelist, ...payload.settings.whitelist])];
  const ruleKey = (r: { domain: string; includeSubdomains: boolean }) =>
    `${r.domain}|${r.includeSubdomains ? '1' : '0'}`;
  const ruleMap = new Map(curSettings.siteRules.map((r) => [ruleKey(r), r]));
  for (const r of payload.settings.siteRules) {
    if (!ruleMap.has(ruleKey(r))) ruleMap.set(ruleKey(r), r);
  }

  const groupMap = new Map(curPinned.groups.map((g) => [g.id, g]));
  for (const g of payload.pinnedData.groups) {
    if (!groupMap.has(g.id)) groupMap.set(g.id, g);
  }
  const existingUrls = new Set(curPinned.items.map((i) => i.url));
  const mergedItems = [...curPinned.items];
  for (const item of payload.pinnedData.items) {
    if (!existingUrls.has(item.url)) {
      mergedItems.push(item);
      existingUrls.add(item.url);
    }
  }

  await Promise.all([
    setSettings({
      ...curSettings,
      whitelist: mergedWhitelist,
      siteRules: [...ruleMap.values()],
    }),
    savePinnedData({
      groups: [...groupMap.values()],
      items: mergedItems,
    }),
  ]);
}
