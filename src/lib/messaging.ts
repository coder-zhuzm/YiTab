import type { Settings } from './settings';
import type { TabInfo } from './match';
import type { SessionSnapshot, TabSnapshotItem } from './snapshots';

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
  | RestoreSnapshotRequest;

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

export function sendToBackground<T>(msg: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}
