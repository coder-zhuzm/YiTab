/**
 * YiTab 会话快照与导出格式化工具库
 */

export interface TabSnapshotItem {
  title: string;
  url: string;
  favIconUrl?: string;
  domain?: string;
}

export interface SessionSnapshot {
  id: string;
  name: string;
  createdAt: number;
  tabs: TabSnapshotItem[];
}

const STORAGE_KEY = 'yitab_session_snapshots';

/** 从 URL 提取规范化主域名 */
export function extractCleanDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return 'unknown';
  }
}

/** 获取所有已保存的会话快照（按时间倒序） */
export async function getSnapshots(): Promise<SessionSnapshot[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const snapshots = result[STORAGE_KEY];
  if (Array.isArray(snapshots)) {
    return snapshots;
  }
  return [];
}

/** 保存新的会话快照 */
export async function saveSnapshot(
  tabs: TabSnapshotItem[],
  customName?: string,
): Promise<SessionSnapshot> {
  const snapshots = await getSnapshots();
  const now = new Date();
  const timeStr = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const defaultName = `会话 (${tabs.length} 标签) · ${timeStr}`;

  const newSnapshot: SessionSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: customName?.trim() || defaultName,
    createdAt: Date.now(),
    tabs: tabs.map((t) => ({
      title: t.title || t.url,
      url: t.url,
      favIconUrl: t.favIconUrl,
      domain: extractCleanDomain(t.url),
    })),
  };

  const updated = [newSnapshot, ...snapshots];
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return newSnapshot;
}

/** 删除指定会话快照 */
export async function deleteSnapshot(id: string): Promise<void> {
  const snapshots = await getSnapshots();
  const updated = snapshots.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

/** 重命名指定会话快照 */
export async function renameSnapshot(id: string, newName: string): Promise<void> {
  const snapshots = await getSnapshots();
  const updated = snapshots.map((s) => (s.id === id ? { ...s, name: newName.trim() } : s));
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

/** 从快照中删除单个标签项 */
export async function removeSnapshotTab(snapshotId: string, tabIndex: number): Promise<void> {
  const snapshots = await getSnapshots();
  const updated = snapshots.map((s) => {
    if (s.id !== snapshotId) return s;
    const newTabs = [...s.tabs];
    newTabs.splice(tabIndex, 1);
    return { ...s, tabs: newTabs };
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

/** 导出格式枚举 */
export type ExportFormat = 'markdown_list' | 'markdown_table' | 'urls_only' | 'json';

/** 将标签列表格式化为指定文本 */
export function formatTabsExport(tabs: TabSnapshotItem[], format: ExportFormat): string {
  if (!tabs.length) return '';

  switch (format) {
    case 'markdown_list':
      return tabs
        .map((t) => {
          const safeTitle = (t.title || t.url).replace(/\[/g, '\\[').replace(/\]/g, '\\]');
          return `- [${safeTitle}](${t.url})`;
        })
        .join('\n');

    case 'markdown_table': {
      const header = '| 序号 | 标签页标题 | 域名 | 链接 |\n| :--- | :--- | :--- | :--- |';
      const rows = tabs.map((t, idx) => {
        const safeTitle = (t.title || t.url).replace(/\|/g, '\\|');
        const domain = t.domain || extractCleanDomain(t.url);
        return `| ${idx + 1} | ${safeTitle} | ${domain} | [打开链接](${t.url}) |`;
      });
      return `${header}\n${rows.join('\n')}`;
    }

    case 'urls_only':
      return tabs.map((t) => t.url).join('\n');

    case 'json':
      return JSON.stringify(
        tabs.map((t) => ({
          title: t.title || t.url,
          url: t.url,
          domain: t.domain || extractCleanDomain(t.url),
        })),
        null,
        2,
      );

    default:
      return tabs.map((t) => t.url).join('\n');
  }
}

/** 智能域名聚合统计 */
export interface DomainGroupAnalysis {
  domain: string;
  count: number;
  tabIds: number[];
}

export function analyzeTabsByDomain(
  tabs: { id?: number; url?: string }[],
  minCount = 2,
): DomainGroupAnalysis[] {
  const map = new Map<string, { count: number; tabIds: number[] }>();

  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    // 忽略内部 chrome://, edge://, about:, extension 页面
    if (!/^https?:/i.test(tab.url)) continue;

    const domain = extractCleanDomain(tab.url);
    if (!domain || domain === 'unknown') continue;

    const entry = map.get(domain) ?? { count: 0, tabIds: [] };
    entry.count += 1;
    entry.tabIds.push(tab.id);
    map.set(domain, entry);
  }

  const results: DomainGroupAnalysis[] = [];
  for (const [domain, entry] of map.entries()) {
    if (entry.count >= minCount) {
      results.push({
        domain,
        count: entry.count,
        tabIds: entry.tabIds,
      });
    }
  }

  // 按数量从多到少排序
  return results.sort((a, b) => b.count - a.count);
}

/** 确定性颜色分配算法：根据域名哈希映射到 Chrome 标签组颜色 */
export const TAB_GROUP_COLORS = [
  'blue',
  'cyan',
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
  'pink',
] as const;

export type TabGroupPaletteColor = (typeof TAB_GROUP_COLORS)[number];

export function getDeterministicColor(str: string): TabGroupPaletteColor {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % TAB_GROUP_COLORS.length;
  return TAB_GROUP_COLORS[index];
}
