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

export interface NewTabSettings {
  profile: ProfileMode;
  defaultEngineId: string;
  openInNewTab: boolean;
  showGreeting: boolean;
}

export const DEFAULT_NEWTAB_SETTINGS: NewTabSettings = {
  profile: 'work',
  defaultEngineId: 'google',
  openInNewTab: false,
  showGreeting: true,
};
