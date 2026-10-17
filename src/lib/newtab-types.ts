/**
 * YiTab 新标签页 (New Tab Smart Launcher) 核心类型定义
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
 * - initials（默认）：本地生成的首字母渐变 SVG，稳定、可预测、零网络请求。
 * - browser：Chrome 本地图标库（`_favicon`）。未访问过的站点会显示浏览器默认占位图，
 *   这是正常结果，不做检测、也不提示「已获得真实网站图标」。
 */
export type IconMode = 'initials' | 'browser';

export interface NewTabSettings {
  profile: ProfileMode;
  defaultEngineId: string;
  openInNewTab: boolean;
  showGreeting: boolean;
  iconMode: IconMode;
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
  iconMode: 'initials',
  workEngineId: 'google',
  homeEngineId: 'google',
};
