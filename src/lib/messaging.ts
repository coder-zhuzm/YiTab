/** confirm 页 / options 与 background 之间的消息协议 */

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
export interface GetSettingsRequest {
  type: 'getSettings';
}

export type BackgroundRequest =
  | FindDuplicatesRequest
  | ConfirmOpenRequest
  | SwitchTabRequest
  | GetSettingsRequest;

export interface FindDuplicatesResponse {
  ok: true;
  tabs: {
    id: number;
    windowId: number;
    title: string;
    url: string;
    favicon: string;
  }[];
}
export interface GetSettingsResponse {
  ok: true;
  settings: {
    matchMode: 'url' | 'domain';
    interceptMode: 'auto' | 'ask';
    whitelist: string[];
  };
}

export function sendToBackground<T>(msg: BackgroundRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}