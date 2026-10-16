/**
 * 快捷方式名称的本地候选补全。
 *
 * 边界：
 * - 只查本地数据（已开标签、历史记录），**不请求目标站点、不抓页面、不建隐藏标签**。
 * - 查询失败不阻塞手填与保存，一律降级为「未找到」。
 * - 返回结果时由调用方再核对「当前 URL 是否已变」「用户是否已改名」，本模块不做写入。
 */

/** 名称来源：空 / 自动补全 / 用户手填。用户的输入永远优先。 */
export type TitleSource = 'empty' | 'auto' | 'user';

export interface TitleCandidate {
  title: string;
  source: 'tab' | 'history';
  url: string;
}

export interface TitleLookupApi {
  queryTabs(): Promise<Array<{ url?: string; title?: string }>>;
  /** 需显式给出时间范围与数量上限，否则默认只回看 24 小时 */
  searchHistory(url: string, startTime: number, maxResults: number): Promise<Array<{ url?: string; title?: string }>>;
}

/** 历史查询回看窗口：30 天。明确给出，避免落到 Chrome 默认的 24 小时。 */
export const HISTORY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** 历史查询数量上限：有界，接受可能漏查 */
export const HISTORY_MAX_RESULTS = 20;

/**
 * 按目标 URL 查本地名称候选。
 *
 * 顺序：已开标签精确匹配 → 历史记录（带范围与上限，且对结果**再次精确过滤**，
 * 因为 history.search 的 text 是自由文本查询而非精确 URL 条件）。
 */
export async function lookupLocalTitle(
  api: TitleLookupApi,
  targetUrl: string,
  now = Date.now(),
): Promise<TitleCandidate | null> {
  if (!targetUrl) return null;

  // 1. 已打开的标签：精确 URL 匹配最可靠
  try {
    const tabs = await api.queryTabs();
    const hit = tabs.find((t) => t.url === targetUrl && t.title?.trim());
    if (hit?.title) return { title: hit.title.trim(), source: 'tab', url: targetUrl };
  } catch {
    // 查询失败继续尝试历史，不阻塞
  }

  // 2. 历史记录：必须再次精确过滤，text 查询会返回近似结果
  try {
    const items = await api.searchHistory(targetUrl, now - HISTORY_LOOKBACK_MS, HISTORY_MAX_RESULTS);
    const hit = items.find((h) => h.url === targetUrl && h.title?.trim());
    if (hit?.title) return { title: hit.title.trim(), source: 'history', url: targetUrl };
  } catch {
    // 查询失败视为未找到
  }

  return null;
}

/**
 * 自动结果是否允许写入标题字段。
 *
 * 三重绑定：请求编号、URL、名称来源。任一不符即放弃，避免旧请求覆盖新状态。
 */
export function shouldApplyAutoTitle(params: {
  /** 发起查询时的请求编号 */
  requestId: number;
  /** 当前最新请求编号 */
  latestRequestId: number;
  /** 发起查询时的 URL */
  requestUrl: string;
  /** 当前表单里的 URL */
  currentUrl: string;
  /** 当前标题来源 */
  titleSource: TitleSource;
  /** 当前标题内容 */
  currentTitle: string;
  /** 本次自动结果的来源 */
  candidateSource: 'tab' | 'history';
  /** 编辑已有条目时为 true：自动结果只作为建议，不自动写入 */
  isEditing: boolean;
}): boolean {
  if (params.requestId !== params.latestRequestId) return false; // 有更新的请求，旧结果作废
  if (params.requestUrl !== params.currentUrl) return false; // URL 已变
  if (params.isEditing) return false; // 编辑已有条目默认保留名称，自动结果仅作建议
  // 用户已手填或已改名 -> 不覆盖
  if (params.titleSource === 'user') return false;
  // 已有自动名称时允许随 URL 更新（自动名称不归用户所有）
  if (params.titleSource === 'auto') return true;
  // 来源为空：仅在标题确实为空时填入
  return params.currentTitle.trim() === '';
}
