/**
 * YiTab 工作台 (Smart Launcher) 核心类型定义
 */

export interface PinnedItem {
  id: string;
  title: string;
  url: string;
  groupId: string;
  customIcon?: string;
  createdAt: number;
}

export interface PinnedGroup {
  id: string;
  name: string;
  order: number;
}

export interface PinnedData {
  groups: PinnedGroup[];
  items: PinnedItem[];
}

export interface SearchEngine {
  id: string;
  name: string;
  prefix: string; // e.g. "g" -> Google, "b" -> Baidu, "gh" -> GitHub, "w" -> Bing
  urlTemplate: string;
  icon: string;
  placeholder: string;
}

export type ProfileMode = 'work' | 'home';

/**
 * 图标来源模式。
 * - browser（默认）：Chrome 本地图标库（`_favicon`），零网络请求。
 *   未访问过的站点会显示浏览器默认占位图，这是正常结果，不做检测、
 *   也不提示「已获得真实网站图标」。
 * - initials：本地生成的首字母渐变 SVG，稳定、可预测。
 */
export type IconMode = 'initials' | 'browser';

export interface NewTabSettings {
  profile: ProfileMode;
  defaultEngineId: string;
  openInNewTab: boolean;
  showGreeting: boolean;
  iconMode: IconMode;
  /** 书签区默认展开；页面上的收起/展开开关也写回此字段 */
  bookmarksExpanded: boolean;
  /** 办公模式下选中的搜索引擎 ID（独立记忆） */
  workEngineId?: string;
  /** 个人模式下选中的搜索引擎 ID（独立记忆） */
  homeEngineId?: string;
}

export const DEFAULT_NEWTAB_SETTINGS: NewTabSettings = {
  profile: 'work',
  defaultEngineId: 'google',
  openInNewTab: false,
  showGreeting: true,
  iconMode: 'browser',
  bookmarksExpanded: true,
  workEngineId: 'google',
  homeEngineId: 'google',
};
