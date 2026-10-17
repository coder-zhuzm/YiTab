import type { Settings } from './settings.ts';
import { INTERNAL_URL_RE, inWhitelist, computeMatchKey } from './match.ts';

/**
 * 关闭源标签前的安全守卫。
 *
 * 去重流程在「选中重复目标」与「真正删除标签」之间隔着若干 await（激活目标、聚焦窗口）。
 * 这段时间里用户可能：
 *   - 把源标签拖进另一个窗口，使其成为那个窗口的唯一标签；
 *   - 在源标签里又导航去了别的页面；
 *   - 触发新的导航事件，使旧的关闭计划失效。
 * 因此删除前必须重新读取实时状态，且「窗口标签数无法确认」时一律放弃关闭 ——
 * 把「无法判断」当作「可以删」会直接关掉用户窗口。
 */

/** 只依赖实际用到的几个 tabs 方法，便于注入测试替身。 */
export interface TabCloseApi {
  get(tabId: number): Promise<{ url?: string; windowId: number }>;
  query(queryInfo: { windowId: number }): Promise<unknown[]>;
  remove(tabId: number): Promise<void>;
  update(tabId: number, props: { url?: string; active?: boolean }): Promise<unknown>;
}

/** 切换标签还需要能聚焦窗口。 */
export interface SwitchApi extends TabCloseApi {
  focusWindow(windowId: number): Promise<unknown>;
}

export type LastTabVerdict = 'yes' | 'no' | 'unknown';
export type CloseOutcome = 'closed' | 'reset_to_newtab' | 'skipped';

/** 源标签是否仍停在本次切换时记录的那个地址。 */
function urlMatches(tab: { url?: string }, expectedUrl: string): boolean {
  return !!tab.url && tab.url === expectedUrl;
}

/**
 * 判断标签是否是所在窗口里最后一个。
 * 查询失败返回 `unknown`，调用方必须中止关闭。
 */
export async function isLastTabInWindow(
  api: TabCloseApi,
  windowId: number,
): Promise<LastTabVerdict> {
  try {
    const sibs = await api.query({ windowId });
    return sibs.length <= 1 ? 'yes' : 'no';
  } catch (err) {
    console.warn('[YiTab] 无法确认窗口标签数量，已放弃关闭以防误关窗口:', err);
    return 'unknown';
  }
}

/**
 * 静默切换后关闭源标签。
 *
 * @param expectedUrl 触发本次去重时的源地址；若实时地址已变说明用户又导航了，放弃关闭
 * @param isStale     返回 true 表示期间已有更新的导航事件，放弃关闭
 */
export async function closeTabAfterSwitch(
  api: TabCloseApi,
  tabId: number,
  expectedUrl: string,
  isStale: () => boolean,
): Promise<CloseOutcome> {
  let live: { url?: string; windowId: number };
  try {
    live = await api.get(tabId);
  } catch {
    return 'skipped'; // 标签已被关闭
  }

  // 空 expectedUrl 表示「调用方没提供可比对的地址」，属于无法校验，不能当成「匹配任意内容」，
  // 否则会关掉用户正在编辑的页面。调用方必须传入触发本次切换时的真实 URL。
  if (!expectedUrl || !urlMatches(live, expectedUrl)) return 'skipped';
  if (isStale()) return 'skipped';

  const countedWindowId = live.windowId;
  const verdict = await isLastTabInWindow(api, countedWindowId);
  if (verdict === 'unknown') return 'skipped';

  // 窗口查询是异步的，期间源标签可能已被导航到别处、或被拖进另一个窗口。
  // 必须重新读取源标签本身：只查 isStale() 挡不住这两种情况 ——
  // switchToTab 传的是恒 false 的 isStale，而窗口移动根本不会产生新的导航事件。
  let after: { url?: string; windowId: number };
  try {
    after = await api.get(tabId);
  } catch {
    return 'skipped'; // 标签已被关闭
  }
  if (!urlMatches(after, expectedUrl)) return 'skipped';
  // 窗口变了则本次「窗口内有几个标签」的计数不再适用，旧计划作废
  if (after.windowId !== countedWindowId) return 'skipped';
  if (isStale()) return 'skipped';

  if (verdict === 'yes') {
    // 关掉窗口里的最后一个标签会连窗口一起关闭，退回空白新标签页。
    // update 失败必须传播：吞掉错误再返回成功会让调用方以为已处理，实际标签还停在原地。
    await api.update(tabId, { url: 'chrome://newtab' });
    return 'reset_to_newtab';
  }

  await api.remove(tabId);
  return 'closed';
}

/**
 * 切换到已有标签，并（按需）关闭源标签。
 *
 * 关键点：必须在切换**之前**记下源标签当时的真实地址。确认页发起的切换里，源标签就是一个
 * 非空的 confirm.html 地址；若这里传空串，`closeTabAfterSwitch` 无法校验，源确认页会永远留着。
 */
export async function switchToTab(
  api: SwitchApi,
  target: { tabId: number; windowId: number; closeSelf: boolean },
  senderTabId?: number,
): Promise<CloseOutcome | 'noop'> {
  let sourceUrl = '';
  if (target.closeSelf && senderTabId != null) {
    try {
      sourceUrl = (await api.get(senderTabId)).url ?? '';
    } catch {
      return 'noop'; // 源标签已不存在
    }
  }

  await api.update(target.tabId, { active: true });
  await api.focusWindow(target.windowId);

  if (target.closeSelf && senderTabId != null) {
    return closeTabAfterSwitch(api, senderTabId, sourceUrl, () => false);
  }
  return 'noop';
}

export interface DeduplicateTabCandidate {
  id?: number;
  url?: string;
  active?: boolean;
  pinned?: boolean;
}

/**
 * 窗口内重复标签批量清理规划：
 * 1. 过滤内部协议与白名单保护站点；
 * 2. 组内选出保留者（活动标签 > 钉选标签 > 首个标签）；
 * 3. 绝对安全防线：已钉选或当前活动的标签绝不纳入删除列表。
 */
export function planCloseDuplicates(
  tabs: DeduplicateTabCandidate[],
  settings: Settings,
): number[] {
  const candidates = tabs.filter((t) => {
    if (!t.url || !t.id || INTERNAL_URL_RE.test(t.url)) return false;
    if (inWhitelist(t.url, settings.whitelist)) return false;
    return true;
  });

  const groupMap = new Map<string, DeduplicateTabCandidate[]>();
  for (const t of candidates) {
    const key = computeMatchKey(t.url!, settings);
    if (!key) continue;
    const list = groupMap.get(key) ?? [];
    list.push(t);
    groupMap.set(key, list);
  }

  const toRemove: number[] = [];
  for (const [, group] of groupMap.entries()) {
    if (group.length <= 1) continue;

    const keeper =
      group.find((t) => t.active) ||
      group.find((t) => t.pinned) ||
      group[0];

    for (const t of group) {
      if (t.id === keeper.id) continue;
      if (t.pinned || t.active) continue;
      toRemove.push(t.id!);
    }
  }

  return toRemove;
}
