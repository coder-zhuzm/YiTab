/**
 * YiTab 标签健康与休眠清理工具库
 * 包含闲置标签页识别、静音/固定标签保护、内存释放估算与转存归档
 */

export interface TabHealthItem {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  groupId?: number;
}

export interface TabHealthReport {
  totalCount: number;
  activeTabId?: number;
  discardedCount: number;
  audibleCount: number;
  pinnedCount: number;
  eligibleDiscardCount: number;
  eligibleArchiveCount: number;
  estimatedMemorySavedMb: number;
  eligibleTabs: TabHealthItem[];
}

export interface TabHealthFilterOptions {
  excludeAudible?: boolean; // 默认 true：排除正在发声/播放音频的标签
  excludePinned?: boolean; // 默认 true：排除固定的常用标签
  excludeActive?: boolean; // 默认 true：排除当前正处于活动状态的标签
  excludeGrouped?: boolean; // 默认 false：是否排除已有分组的标签
}

const DEFAULT_FILTER_OPTIONS: TabHealthFilterOptions = {
  excludeAudible: true,
  excludePinned: true,
  excludeActive: true,
  excludeGrouped: false,
};

/** 单个标签页平均常驻内存估算 (MB) */
export const ESTIMATED_MB_PER_TAB = 55;

/** 检查标签页是否符合安全休眠释放内存的条件 */
export function isEligibleForDiscard(
  tab: {
    id?: number;
    active?: boolean;
    pinned?: boolean;
    audible?: boolean;
    discarded?: boolean;
    groupId?: number;
  },
  options: TabHealthFilterOptions = DEFAULT_FILTER_OPTIONS,
): boolean {
  if (tab.id == null || tab.id <= 0) return false;
  if (tab.discarded) return false; // 已经休眠的不重复计算
  if (options.excludeActive && tab.active) return false;
  if (options.excludePinned && tab.pinned) return false;
  if (options.excludeAudible && tab.audible) return false;
  if (options.excludeGrouped && tab.groupId != null && tab.groupId > 0) return false;

  return true;
}

/** 分析给定标签列表的健康状态与闲置内存占用 */
export function analyzeTabHealth(
  tabs: chrome.tabs.Tab[],
  options: TabHealthFilterOptions = DEFAULT_FILTER_OPTIONS,
): TabHealthReport {
  let activeTabId: number | undefined;
  let discardedCount = 0;
  let audibleCount = 0;
  let pinnedCount = 0;

  const eligibleTabs: TabHealthItem[] = [];

  for (const t of tabs) {
    if (t.active) activeTabId = t.id;
    if (t.discarded) discardedCount++;
    if (t.audible) audibleCount++;
    if (t.pinned) pinnedCount++;

    if (isEligibleForDiscard(t, options)) {
      eligibleTabs.push({
        id: t.id!,
        windowId: t.windowId,
        title: t.title || t.url || '',
        url: t.url || '',
        favIconUrl: t.favIconUrl,
        active: Boolean(t.active),
        pinned: Boolean(t.pinned),
        audible: Boolean(t.audible),
        discarded: Boolean(t.discarded),
        groupId: t.groupId && t.groupId > 0 ? t.groupId : undefined,
      });
    }
  }

  const eligibleDiscardCount = eligibleTabs.length;
  const estimatedMemorySavedMb = eligibleDiscardCount * ESTIMATED_MB_PER_TAB;

  return {
    totalCount: tabs.length,
    activeTabId,
    discardedCount,
    audibleCount,
    pinnedCount,
    eligibleDiscardCount,
    eligibleArchiveCount: eligibleTabs.length,
    estimatedMemorySavedMb,
    eligibleTabs,
  };
}
