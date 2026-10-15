import type {
  NewTabSettings,
  PinnedData,
  PinnedGroup,
  PinnedItem,
} from './newtab-types.ts';
import { DEFAULT_NEWTAB_SETTINGS } from './newtab-types.ts';

const STORAGE_PINNED_KEY = 'yitab_pinned_data';
const STORAGE_NEWTAB_SETTINGS_KEY = 'yitab_newtab_settings';

/** 初始预设固钉分组 */
export const DEFAULT_PINNED_GROUPS: PinnedGroup[] = [
  { id: 'dev', name: '常用研发工具', order: 1 },
  { id: 'ops', name: '内网与环境', order: 2 },
  { id: 'daily', name: '日常工作台', order: 3 },
];

/** 初始预设固钉应用 */
export const DEFAULT_PINNED_ITEMS: PinnedItem[] = [
  {
    id: 'pin_github',
    title: 'GitHub',
    url: 'https://github.com',
    groupId: 'dev',
    createdAt: 1729000000000,
  },
  {
    id: 'pin_localhost',
    title: '本地开发服务',
    url: 'http://localhost:3000',
    groupId: 'dev',
    createdAt: 1729000000001,
  },
  {
    id: 'pin_v2ex',
    title: 'V2EX 技术社区',
    url: 'https://www.v2ex.com',
    groupId: 'daily',
    createdAt: 1729000000002,
  },
];

/**
 * 获取固钉数据 (优先从 chrome.storage.local 读取)
 */
export async function getPinnedData(): Promise<PinnedData> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return {
      groups: DEFAULT_PINNED_GROUPS,
      items: DEFAULT_PINNED_ITEMS,
    };
  }

  const res = await chrome.storage.local.get(STORAGE_PINNED_KEY);
  const data = res[STORAGE_PINNED_KEY] as PinnedData | undefined;

  if (
    !data ||
    !Array.isArray(data.groups) ||
    !Array.isArray(data.items) ||
    data.groups.length === 0
  ) {
    // 首次初始化默认预设
    const initial: PinnedData = {
      groups: DEFAULT_PINNED_GROUPS,
      items: DEFAULT_PINNED_ITEMS,
    };
    await chrome.storage.local.set({ [STORAGE_PINNED_KEY]: initial });
    return initial;
  }

  return data;
}

/**
 * 保存固钉数据
 */
export async function savePinnedData(data: PinnedData): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_PINNED_KEY]: data });
  }
}

/**
 * 新增固钉卡片
 */
export async function addPinnedItem(
  item: Omit<PinnedItem, 'id' | 'createdAt'>,
): Promise<PinnedItem> {
  const data = await getPinnedData();
  const newItem: PinnedItem = {
    ...item,
    id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  };

  data.items.push(newItem);
  await savePinnedData(data);
  return newItem;
}

/**
 * 更新固钉卡片
 */
export async function updatePinnedItem(item: PinnedItem): Promise<void> {
  const data = await getPinnedData();
  const idx = data.items.findIndex((i) => i.id === item.id);
  if (idx !== -1) {
    data.items[idx] = item;
    await savePinnedData(data);
  }
}

/**
 * 删除固钉卡片
 */
export async function deletePinnedItem(id: string): Promise<void> {
  const data = await getPinnedData();
  data.items = data.items.filter((i) => i.id !== id);
  await savePinnedData(data);
}

/**
 * 新增分组
 */
export async function addPinnedGroup(name: string): Promise<PinnedGroup> {
  const data = await getPinnedData();
  const maxOrder = data.groups.reduce((max, g) => Math.max(max, g.order), 0);
  const newGroup: PinnedGroup = {
    id: `grp_${Date.now()}`,
    name: name.trim() || '未命名分组',
    order: maxOrder + 1,
  };
  data.groups.push(newGroup);
  await savePinnedData(data);
  return newGroup;
}

/**
 * 删除分组（该分组下的卡片会自动移入默认或第一个分组）
 */
export async function deletePinnedGroup(id: string): Promise<void> {
  const data = await getPinnedData();
  if (data.groups.length <= 1) {
    // 至少保留一个分组
    return;
  }
  data.groups = data.groups.filter((g) => g.id !== id);
  const fallbackGroupId = data.groups[0].id;
  for (const item of data.items) {
    if (item.groupId === id) {
      item.groupId = fallbackGroupId;
    }
  }
  await savePinnedData(data);
}

/**
 * 获取新标签页通用设置
 */
export async function getNewTabSettings(): Promise<NewTabSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.sync) {
    return DEFAULT_NEWTAB_SETTINGS;
  }
  const res = await chrome.storage.sync.get(STORAGE_NEWTAB_SETTINGS_KEY);
  const settings = res[STORAGE_NEWTAB_SETTINGS_KEY] as Partial<NewTabSettings> | undefined;
  return {
    ...DEFAULT_NEWTAB_SETTINGS,
    ...(settings || {}),
  };
}

/**
 * 保存新标签页通用设置
 */
export async function saveNewTabSettings(
  patch: Partial<NewTabSettings>,
): Promise<NewTabSettings> {
  const current = await getNewTabSettings();
  const next = { ...current, ...patch };
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    await chrome.storage.sync.set({ [STORAGE_NEWTAB_SETTINGS_KEY]: next });
  }
  return next;
}
