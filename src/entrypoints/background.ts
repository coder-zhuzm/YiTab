import { browser } from 'wxt/browser';
import { getSettings, watchSettings } from '@/lib/settings';
import {
  INTERNAL_URL_RE,
  matchDuplicate,
  inWhitelist,
  queryWebTabs,
  computeMatchKey,
  resolveRule,
  hostOf,
  type TabInfo,
} from '@/lib/match';
import { analyzeTabsByDomain, getDeterministicColor } from '@/lib/snapshots';
import type { BackgroundRequest } from '@/lib/messaging';

const ALLOW_TTL = 8000;

/** 「仍要打开」放行表：tabId -> { targetUrl, matchKey, expiresAt }。精确放行目标及其重定向链 */
interface AllowedEntry {
  targetUrl: string;
  matchKey: string | null;
  expiresAt: number;
}
const allowed = new Map<number, AllowedEntry>();

/** 标签导航状态跟踪，用于 SPA 连续变化防竞态与锚点过滤 */
interface TabState {
  lastUrl: string;
  lastMatchKey: string | null;
  seq: number;
}
const tabStates = new Map<number, TabState>();

export default defineBackground(() => {
  watchSettings();

  // 1. 整页导航（地址栏、书签、新标签等真实提交的整页加载）
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0) return;
    handleNavigation(details.tabId, details.url, 'committed');
  });

  // 2. SPA History API 路由变化（pushState / replaceState）
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0) return;
    handleNavigation(details.tabId, details.url, 'history');
  });

  // 3. Hash 路由变化
  chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0) return;
    handleNavigation(details.tabId, details.url, 'fragment');
  });

  // 标签关闭时清理状态表
  chrome.tabs.onRemoved.addListener((tabId) => {
    allowed.delete(tabId);
    tabStates.delete(tabId);
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === 'findDuplicates') {
          sendResponse(await findDuplicates(msg.url));
        } else if (msg.type === 'confirmOpen') {
          // 只登记放行，导航由确认页自己发起（location.href）。
          // 记录目标地址及其 matchKey，在时限内仅对该目标（及重定向链）放行。
          if (sender.tab?.id != null) {
            const settings = await getSettings();
            const matchKey = computeMatchKey(msg.url, settings);
            allowed.set(sender.tab.id, {
              targetUrl: msg.url,
              matchKey,
              expiresAt: Date.now() + ALLOW_TTL,
            });
          }
          sendResponse({ ok: true });
        } else if (msg.type === 'switchTab') {
          await switchTab(msg, sender.tab?.id, sender.tab?.windowId);
          sendResponse({ ok: true });
        } else if (msg.type === 'closeTabs') {
          if (Array.isArray(msg.tabIds) && msg.tabIds.length) {
            await browser.tabs.remove(msg.tabIds).catch(() => {});
          }
          sendResponse({ ok: true });
        } else if (msg.type === 'groupTabs') {
          if (chrome.tabs.group && Array.isArray(msg.tabIds) && msg.tabIds.length) {
            try {
              const opts: { tabIds: number[]; groupId?: number } = { tabIds: msg.tabIds };
              if (msg.groupId != null && msg.groupId > 0) {
                opts.groupId = msg.groupId;
              }
              const groupId = await chrome.tabs.group(opts);
              if (msg.title || msg.color) {
                await chrome.tabGroups.update(groupId, {
                  title: msg.title,
                  color: msg.color,
                });
              }
              sendResponse({ ok: true, groupId });
              return;
            } catch (err) {
              console.warn('[YiTab] Failed to group tabs:', err);
            }
          }
          sendResponse({ ok: false });
        } else if (msg.type === 'ungroupTabs') {
          if (chrome.tabs.ungroup && Array.isArray(msg.tabIds) && msg.tabIds.length) {
            try {
              await chrome.tabs.ungroup(msg.tabIds);
              sendResponse({ ok: true });
              return;
            } catch (err) {
              console.warn('[YiTab] Failed to ungroup tabs:', err);
            }
          }
          sendResponse({ ok: false });
        } else if (msg.type === 'getTabGroups') {
          if (chrome.tabGroups) {
            try {
              const query = msg.windowId != null ? { windowId: msg.windowId } : {};
              const groups = await chrome.tabGroups.query(query);
              sendResponse({
                ok: true,
                groups: groups.map((g) => ({
                  id: g.id,
                  windowId: g.windowId,
                  title: g.title,
                  color: g.color,
                })),
              });
              return;
            } catch {}
          }
          sendResponse({ ok: true, groups: [] });
        } else if (msg.type === 'getSettings') {
          sendResponse({ ok: true, settings: await getSettings() });
        } else if (msg.type === 'autoGroupTabs') {
          const win =
            msg.windowId ??
            sender.tab?.windowId ??
            (await chrome.windows?.getLastFocused({ populate: false }).catch(() => null))?.id;
          if (win == null || !chrome.tabs?.group) {
            sendResponse({ ok: false, createdGroupsCount: 0, groupedTabsCount: 0 });
            return;
          }
          const tabs = await chrome.tabs.query({ windowId: win });
          const groups = analyzeTabsByDomain(tabs, msg.minCount ?? 2);
          let createdGroupsCount = 0;
          let groupedTabsCount = 0;
          for (const g of groups) {
            try {
              const groupId = await chrome.tabs.group({ tabIds: g.tabIds });
              await chrome.tabGroups.update(groupId, {
                title: g.domain,
                color: getDeterministicColor(g.domain),
              });
              createdGroupsCount++;
              groupedTabsCount += g.tabIds.length;
            } catch (e) {
              console.warn('[YiTab] autoGroupTabs failed for domain:', g.domain, e);
            }
          }
          sendResponse({ ok: true, createdGroupsCount, groupedTabsCount });
        } else if (msg.type === 'ungroupAllTabs') {
          const win =
            msg.windowId ??
            sender.tab?.windowId ??
            (await chrome.windows?.getLastFocused({ populate: false }).catch(() => null))?.id;
          if (win == null || !chrome.tabs?.ungroup) {
            sendResponse({ ok: false, ungroupedCount: 0 });
            return;
          }
          const tabs = await chrome.tabs.query({ windowId: win });
          const groupedTabIds = tabs
            .filter((t) => t.groupId != null && t.groupId > 0 && t.id != null)
            .map((t) => t.id!);
          if (groupedTabIds.length) {
            await chrome.tabs.ungroup(groupedTabIds).catch(() => {});
          }
          sendResponse({ ok: true, ungroupedCount: groupedTabIds.length });
        } else if (msg.type === 'getCurrentWindowTabs') {
          const win =
            msg.windowId ??
            sender.tab?.windowId ??
            (await chrome.windows?.getLastFocused({ populate: false }).catch(() => null))?.id;
          const tabs = await chrome.tabs.query(
            win != null ? { windowId: win } : { currentWindow: true },
          );
          sendResponse({
            ok: true,
            windowId: win ?? 0,
            tabs: tabs.map((t) => ({
              title: t.title || t.url || '',
              url: t.url || '',
              favIconUrl: t.favIconUrl,
            })),
          });
        } else if (msg.type === 'restoreSnapshot') {
          if (Array.isArray(msg.urls) && msg.urls.length) {
            if (msg.newWindow && chrome.windows?.create) {
              await chrome.windows.create({ url: msg.urls });
            } else {
              for (const url of msg.urls) {
                await chrome.tabs.create({ url }).catch(() => {});
              }
            }
          }
          sendResponse({ ok: true });
        }
      } catch (err) {
        console.error('[YiTab] Error handling message:', err);
        sendResponse({ ok: false });
      }
    })();
    return true; // 异步 sendResponse
  });

  console.info('[YiTab] background ready with SPA & TabGroups support');
});

function confirmURL(url: string): string {
  return chrome.runtime.getURL('/confirm.html') + '?u=' + encodeURIComponent(url);
}

async function findDuplicates(url: string): Promise<{ ok: true; tabs: TabInfo[] }> {
  const [settings, tabs] = await Promise.all([getSettings(), queryWebTabs()]);

  // 获取各分组信息（标题、颜色）
  const groupMap = new Map<number, { title?: string; color?: string }>();
  if (chrome.tabGroups) {
    try {
      const groups = await chrome.tabGroups.query({});
      for (const g of groups) {
        groupMap.set(g.id, { title: g.title, color: g.color });
      }
    } catch {
      // 忽略 tabGroups 查询异常
    }
  }

  const matched = tabs
    .filter((t) => !!t.url && !!matchDuplicate(url, t.url, settings))
    .map((t) => {
      const g = t.groupId && t.groupId > 0 ? groupMap.get(t.groupId) : undefined;
      return {
        id: t.id!,
        windowId: t.windowId,
        title: t.title ?? t.url ?? '',
        url: t.url ?? '',
        favicon: t.favIconUrl || '',
        groupId: t.groupId && t.groupId > 0 ? t.groupId : undefined,
        groupTitle: g?.title,
        groupColor: g?.color,
        match: matchDuplicate(url, t.url!, settings) ?? undefined,
      };
    });

  return {
    ok: true,
    tabs: matched,
  };
}

async function switchTab(
  msg: { tabId: number; windowId: number; closeSelf: boolean },
  senderTabId?: number,
  senderWindowId?: number,
): Promise<void> {
  try {
    await browser.tabs.update(msg.tabId, { active: true });
    await browser.windows.update(msg.windowId, { focused: true });
    if (msg.closeSelf && senderTabId != null) {
      const sibs = await browser.tabs.query({ windowId: senderWindowId });
      if (sibs.length > 1) {
        await browser.tabs.remove(senderTabId).catch(() => {});
      } else {
        await browser.tabs
          .update(senderTabId, { url: 'chrome://newtab' })
          .catch(() => {});
      }
    }
  } catch {
    /* 标签可能已被关闭 */
  }
}

/** 核心检测：导航事件后检查重复 */
async function handleNavigation(
  tabId: number,
  url?: string,
  eventType: 'committed' | 'history' | 'fragment' = 'committed',
): Promise<void> {
  if (!url || INTERNAL_URL_RE.test(url)) return;

  // 记录序列号，避免连续导航异步竞争导致用过期事件覆盖最新状态
  const state = tabStates.get(tabId) ?? { lastUrl: '', lastMatchKey: null, seq: 0 };
  const currentSeq = ++state.seq;
  tabStates.set(tabId, state);

  // 预取配置以计算匹配 key
  const settings = await getSettings();
  if (state.seq !== currentSeq) return; // 已有更新的导航事件发生

  const currentMatchKey = computeMatchKey(url, settings);

  // 1. 普通锚点变化过滤（如 #intro -> #comments，两者 matchKey 相同则不触发重复提示）
  if (eventType === 'fragment') {
    if (state.lastMatchKey != null && state.lastMatchKey === currentMatchKey) {
      state.lastUrl = url;
      return;
    }
  }

  // 2. 同域名模式防过度骚扰：已在站内正常浏览的 SPA 站内路由跳转，不应在每个链接都弹提示
  if (eventType !== 'committed') {
    const { mode } = resolveRule(url, settings);
    if (mode === 'domain' && state.lastUrl && hostOf(state.lastUrl) === hostOf(url)) {
      state.lastUrl = url;
      state.lastMatchKey = currentMatchKey;
      return;
    }
  }

  // 3. 「仍要打开」放行：时限内仅对目标地址及等价 matchKey 的导航链放行
  const allowEntry = allowed.get(tabId);
  if (allowEntry) {
    if (Date.now() > allowEntry.expiresAt) {
      allowed.delete(tabId);
    } else {
      if (
        allowEntry.targetUrl === url ||
        (allowEntry.matchKey != null && allowEntry.matchKey === currentMatchKey)
      ) {
        state.lastUrl = url;
        state.lastMatchKey = currentMatchKey;
        return;
      }
    }
  }

  // 4. 白名单检查
  if (inWhitelist(url, settings.whitelist)) {
    state.lastUrl = url;
    state.lastMatchKey = currentMatchKey;
    return;
  }

  // 5. 查询其他所有网页标签
  const allTabs = await queryWebTabs();
  if (state.seq !== currentSeq) return;

  // 校验当前标签依然存在且 URL 未变
  try {
    const cur = await browser.tabs.get(tabId);
    if (cur.url && cur.url !== url) return;
  } catch {
    return; // 标签已关闭
  }

  const target =
    allTabs.find(
      (t) => t.id !== tabId && !!t.url && !!matchDuplicate(url, t.url, settings),
    ) ?? null;
  if (!target || target.id == null) {
    state.lastUrl = url;
    state.lastMatchKey = currentMatchKey;
    return;
  }

  const match = matchDuplicate(url, target.url!, settings);
  state.lastUrl = url;
  state.lastMatchKey = currentMatchKey;

  // 6. 执行交互策略
  if (eventType === 'committed') {
    // 整页导航（新标签页、地址栏、书签）
    if (settings.interceptMode === 'ask') {
      browser.tabs.update(tabId, { url: confirmURL(url) }).catch(() => {});
      return;
    }

    // 静默切换式
    try {
      await browser.tabs.update(target.id, { active: true });
      await browser.windows.update(target.windowId, { focused: true });
      const cur = await browser.tabs.get(tabId);
      const sibs = await browser.tabs.query({ windowId: cur.windowId });
      if (sibs.length > 1) {
        await browser.tabs.remove(tabId);
      } else {
        browser.tabs.update(tabId, { url: confirmURL(url) }).catch(() => {});
      }
    } catch {}
  } else {
    // SPA 内部路由切换（history / fragment）
    if (settings.interceptMode === 'auto') {
      // 自动静默切换（不关闭正在浏览的当前标签页）
      try {
        await browser.tabs.update(target.id, { active: true });
        await browser.windows.update(target.windowId, { focused: true });
      } catch {}
      return;
    }

    // 页内确认式：发送轻量页内提示给 Content Script，避免跳出确认页卸载单页应用
    const tabInfo: TabInfo = {
      id: target.id,
      windowId: target.windowId,
      title: target.title ?? target.url ?? '',
      url: target.url ?? '',
      favicon: target.favIconUrl || '',
      match: match ?? undefined,
    };

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'yitab_spa_duplicate',
        candidateUrl: url,
        targetTab: tabInfo,
      });
    } catch {
      // 受限页面或 Content Script 尚未就绪，安全静默放行，避免破坏运行中的页面
    }
  }
}
