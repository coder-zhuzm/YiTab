import type { Settings } from './settings';
import type { TabInfo } from './match';
import type { SessionSnapshot, TabSnapshotItem } from './snapshots';
import type { SearchItem, SearchItemKind } from './search';
import type { BookmarkScanReport } from './bookmarks';
import type { TabHealthReport } from './tab-health';

/** confirm 页 / popup / content script / options 与 background 之间的消息协议 */

export interface FindDuplicatesRequest {
  type: 'findDuplicates';
  url: string;
}

export interface ConfirmOpenRequest {
  type: 'confirmOpen';
  url: string;
}

export interface SwitchTabRequest {
  type: 'switchTab';
  tabId: number;
  windowId: number;
  closeSelf: boolean;
}

export interface CloseTabsRequest {
  type: 'closeTabs';
  tabIds: number[];
}

export type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

export interface GroupTabsRequest {
  type: 'groupTabs';
  tabIds: number[];
  title?: string;
  color?: TabGroupColor;
  groupId?: number;
}

export interface UngroupTabsRequest {
  type: 'ungroupTabs';
  tabIds: number[];
}

export interface GetTabGroupsRequest {
  type: 'getTabGroups';
  windowId?: number;
}

export interface GetSettingsRequest {
  type: 'getSettings';
}

/** 阶段二：域名智能归拢与会话快照管理协议 */

export interface AutoGroupTabsRequest {
  type: 'autoGroupTabs';
  windowId?: number;
  minCount?: number;
}

export interface UngroupAllTabsRequest {
  type: 'ungroupAllTabs';
  windowId?: number;
}

export interface GetCurrentWindowTabsRequest {
  type: 'getCurrentWindowTabs';
  windowId?: number;
}

export interface RestoreSnapshotRequest {
  type: 'restoreSnapshot';
  urls: string[];
  newWindow?: boolean;
}

/** 阶段三：快速检索与全局命令面板协议 */

export interface SearchItemsRequest {
  type: 'searchItems';
  query: string;
  kindFilter?: 'all' | SearchItemKind;
  limit?: number;
}

export interface ExecuteCommandRequest {
  type: 'executeCommand';
  action: string;
  windowId?: number;
}

/** 阶段四：书签生态与闲置标签休眠维护协议 */

export interface ScanBookmarksRequest {
  type: 'scanBookmarks';
}

export interface CleanBookmarksRequest {
  type: 'cleanBookmarks';
  bookmarkIds: string[];
}

export interface ExportBookmarksBackupRequest {
  type: 'exportBookmarksBackup';
  format: 'html' | 'json';
}

export interface GetTabHealthRequest {
  type: 'getTabHealth';
  windowId?: number;
}

export interface DiscardTabsRequest {
  type: 'discardTabs';
  tabIds?: number[];
  windowId?: number;
}

export interface ArchiveInactiveTabsRequest {
  type: 'archiveInactiveTabs';
  tabIds?: number[];
  windowId?: number;
  customName?: string;
}

export type BackgroundRequest =
  | FindDuplicatesRequest
  | ConfirmOpenRequest
  | SwitchTabRequest
  | CloseTabsRequest
  | GroupTabsRequest
  | UngroupTabsRequest
  | GetTabGroupsRequest
  | GetSettingsRequest
  | AutoGroupTabsRequest
  | UngroupAllTabsRequest
  | GetCurrentWindowTabsRequest
  | RestoreSnapshotRequest
  | SearchItemsRequest
  | ExecuteCommandRequest
  | ScanBookmarksRequest
  | CleanBookmarksRequest
  | ExportBookmarksBackupRequest
  | GetTabHealthRequest
  | DiscardTabsRequest
  | ArchiveInactiveTabsRequest;

export interface FindDuplicatesResponse {
  ok: true;
  tabs: TabInfo[];
}

export interface SimpleOkResponse {
  ok: boolean;
  groupId?: number;
  message?: string;
}

export interface AutoGroupTabsResponse {
  ok: boolean;
  createdGroupsCount: number;
  groupedTabsCount: number;
}

export interface UngroupAllTabsResponse {
  ok: boolean;
  ungroupedCount: number;
}

export interface GetCurrentWindowTabsResponse {
  ok: true;
  tabs: TabSnapshotItem[];
  windowId: number;
}

export interface TabGroupInfo {
  id: number;
  windowId: number;
  title?: string;
  color?: string;
}

export interface GetTabGroupsResponse {
  ok: true;
  groups: TabGroupInfo[];
}

export interface GetSettingsResponse {
  ok: true;
  settings: Settings;
}

export interface SearchItemsResponse {
  ok: true;
  items: SearchItem[];
}

export interface ExecuteCommandResponse {
  ok: boolean;
  message: string;
  copyText?: string;
}

export interface ScanBookmarksResponse {
  ok: boolean;
  report?: BookmarkScanReport;
  error?: string;
}

export interface CleanBookmarksResponse {
  ok: boolean;
  removedCount?: number;
  error?: string;
}

export interface ExportBookmarksBackupResponse {
  ok: boolean;
  content: string;
  filename: string;
  mimeType: string;
}

export interface GetTabHealthResponse {
  ok: boolean;
  health: TabHealthReport;
}

export interface DiscardTabsResponse {
  ok: boolean;
  discardedCount: number;
  freedMemoryMb: number;
}

export interface ArchiveInactiveTabsResponse {
  ok: boolean;
  archivedCount: number;
  snapshotName: string;
}

export function sendToBackground<T>(msg: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
