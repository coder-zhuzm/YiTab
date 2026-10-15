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
import { analyzeTabsByDomain, getDeterministicColor, saveSnapshot } from '@/lib/snapshots';
import {
  ACTION_COMMANDS,
  extractHostname,
  filterAndRankItems,
  formatOmniboxSuggest,
  type SearchItem,
  type SearchItemKind,
} from '@/lib/search';
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
        } else if (msg.type === 'searchItems') {
          const items = await queryAllSearchItems(
            msg.query,
            msg.kindFilter ?? 'all',
            msg.limit ?? 30,
          );
          sendResponse({ ok: true, items });
        } else if (msg.type === 'executeCommand') {
          const message = await executeActionCommand(
            msg.action,
            msg.windowId ?? sender.tab?.windowId,
          );
          sendResponse({ ok: true, message });
        }
      } catch (err) {
        console.error('[YiTab] Error handling message:', err);
        sendResponse({ ok: false });
      }
    })();
    return true; // 异步 sendResponse
  });

  // 阶段三：Omnibox 地址栏搜索集成 (tab + 空格)
  if (chrome.omnibox) {
    chrome.omnibox.setDefaultSuggestion({
      description: 'YiTab: 输入关键词搜索已开标签、书签、历史与快捷指令 (↵ 执行)',
    });

    chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
      try {
        const items = await queryAllSearchItems(text, 'all', 6);
        const suggestions = items.map((item) => formatOmniboxSuggest(item, text));
        suggest(suggestions);
      } catch (e) {
        console.warn('[YiTab] omnibox onInputChanged error:', e);
      }
    });

    chrome.omnibox.onInputEntered.addListener(async (content, disposition) => {
      try {
        await handleOmniboxInput(content, disposition);
      } catch (e) {
        console.warn('[YiTab] omnibox onInputEntered error:', e);
      }
    });
  }

  // 阶段三：全局快捷键唤出命令面板 (Alt+K / Cmd+K)
  if (chrome.commands) {
    chrome.commands.onCommand.addListener(async (command) => {
      if (command === 'toggle-palette') {
        try {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            lastFocusedWindow: true,
          });
          if (activeTab?.id != null) {
            const delivered = await chrome.tabs
              .sendMessage(activeTab.id, { type: 'yitab_toggle_palette' })
              .catch(() => null);
            if (!delivered) {
              // 在无法运行内容脚本的特殊受限页（如 chrome:// 或 New Tab）回退打开 Popup
              if (chrome.action?.openPopup) {
                await chrome.action.openPopup().catch(() => {});
              }
            }
          }
        } catch (e) {
          console.warn('[YiTab] toggle-palette failed:', e);
        }
      }
    });
  }

  console.info('[YiTab] background ready with SPA, TabGroups & Omnibox support');
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

/** 阶段三：跨标签页、书签、历史与快捷指令的多源统一检索 */
async function queryAllSearchItems(
  query: string,
  kindFilter: 'all' | SearchItemKind = 'all',
  limit = 30,
): Promise<SearchItem[]> {
  const items: SearchItem[] = [];

  // 1. 已打开的标签页
  if (kindFilter === 'all' || kindFilter === 'tab') {
    try {
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups ? chrome.tabGroups.query({}).catch(() => []) : [],
      ]);
      const groupMap = new Map<number, { title?: string; color?: string }>();
      for (const g of groups) {
        groupMap.set(g.id, { title: g.title, color: g.color });
      }

      for (const t of tabs) {
        if (!t.url || INTERNAL_URL_RE.test(t.url)) continue;
        const grp = t.groupId && t.groupId > 0 ? groupMap.get(t.groupId) : undefined;
        items.push({
          id: `tab:${t.id}`,
          kind: 'tab',
          title: t.title || t.url,
          url: t.url,
          domain: extractHostname(t.url),
          favicon: t.favIconUrl,
          tabId: t.id,
          windowId: t.windowId,
          active: t.active,
          groupId: t.groupId && t.groupId > 0 ? t.groupId : undefined,
          groupTitle: grp?.title,
          groupColor: grp?.color,
        });
      }
    } catch (e) {
      console.warn('[YiTab] Query tabs for search failed:', e);
    }
  }

  // 2. 快捷指令
  if (kindFilter === 'all' || kindFilter === 'command') {
    for (const cmd of ACTION_COMMANDS) {
      items.push({
        id: cmd.id,
        kind: 'command',
        title: cmd.title,
        description: cmd.description,
        commandAction: cmd.action,
      });
    }
  }

  // 3. 书签
  if ((kindFilter === 'all' || kindFilter === 'bookmark') && chrome.bookmarks) {
    try {
      const bookmarks = await chrome.bookmarks.search(query || 'http');
      for (const bm of bookmarks.slice(0, 50)) {
        if (bm.url && !INTERNAL_URL_RE.test(bm.url)) {
          items.push({
            id: `bm:${bm.id}`,
            kind: 'bookmark',
            title: bm.title || bm.url,
            url: bm.url,
            domain: extractHostname(bm.url),
          });
        }
      }
    } catch (e) {
      console.warn('[YiTab] Query bookmarks failed:', e);
    }
  }

  // 4. 历史记录
  if ((kindFilter === 'all' || kindFilter === 'history') && chrome.history) {
    try {
      const historyItems = await chrome.history.search({ text: query, maxResults: 30 });
      for (const h of historyItems) {
        if (h.url && !INTERNAL_URL_RE.test(h.url)) {
          items.push({
            id: `hist:${h.id}`,
            kind: 'history',
            title: h.title || h.url,
            url: h.url,
            domain: extractHostname(h.url),
            description: h.lastVisitTime
              ? new Date(h.lastVisitTime).toLocaleDateString()
              : undefined,
          });
        }
      }
    } catch (e) {
      console.warn('[YiTab] Query history failed:', e);
    }
  }

  return filterAndRankItems(items, query, kindFilter, limit);
}

/** 执行快捷指令 */
async function executeActionCommand(action: string, windowId?: number): Promise<string> {
  const win =
    windowId ??
    (await chrome.windows?.getLastFocused({ populate: false }).catch(() => null))?.id;

  if (action === 'auto_group') {
    if (win != null && chrome.tabs?.group) {
      const tabs = await chrome.tabs.query({ windowId: win });
      const groups = analyzeTabsByDomain(tabs, 2);
      let count = 0;
      for (const g of groups) {
        try {
          const groupId = await chrome.tabs.group({ tabIds: g.tabIds });
          await chrome.tabGroups.update(groupId, {
            title: g.domain,
            color: getDeterministicColor(g.domain),
          });
          count++;
        } catch {}
      }
      return `已自动聚拢 ${count} 个域名标签组`;
    }
    return '当前环境不支持标签分组';
  }

  if (action === 'ungroup_all') {
    if (win != null && chrome.tabs?.ungroup) {
      const tabs = await chrome.tabs.query({ windowId: win });
      const grouped = tabs
        .filter((t) => t.groupId != null && t.groupId > 0 && t.id != null)
        .map((t) => t.id!);
      if (grouped.length) {
        await chrome.tabs.ungroup(grouped).catch(() => {});
      }
      return `已解散 ${grouped.length} 个标签分组`;
    }
    return '未找到分组标签';
  }

  if (action === 'save_snapshot') {
    if (win != null) {
      const tabs = await chrome.tabs.query({ windowId: win });
      const items = tabs.map((t) => ({
        title: t.title || t.url || '',
        url: t.url || '',
        favIconUrl: t.favIconUrl,
      }));
      const snap = await saveSnapshot(items);
      return `已暂存会话快照「${snap.name}」（${snap.tabs.length} 项）`;
    }
    return '暂存快照失败';
  }

  if (action === 'open_options') {
    chrome.runtime.openOptionsPage();
    return '已打开规则配置中心';
  }

  if (action === 'close_duplicates') {
    if (win != null) {
      const [settings, tabs] = await Promise.all([
        getSettings(),
        chrome.tabs.query({ windowId: win }),
      ]);
      const seenKeys = new Set<string>();
      const toRemove: number[] = [];
      for (const t of tabs) {
        if (!t.url || !t.id || INTERNAL_URL_RE.test(t.url)) continue;
        const key = computeMatchKey(t.url, settings);
        if (!key) continue;
        if (seenKeys.has(key)) {
          toRemove.push(t.id);
        } else {
          seenKeys.add(key);
        }
      }
      if (toRemove.length > 0) {
        await chrome.tabs.remove(toRemove).catch(() => {});
        return `已扫描并清理 ${toRemove.length} 个重复标签`;
      }
      return '当前窗口未发现重复标签';
    }
  }

  return '指令已就绪';
}

/** Omnibox 回车执行 */
async function handleOmniboxInput(content: string, disposition: string): Promise<void> {
  if (content.startsWith('tab:')) {
    const [, tabIdStr, winIdStr] = content.split(':');
    const tabId = parseInt(tabIdStr, 10);
    const windowId = parseInt(winIdStr, 10);
    if (!isNaN(tabId)) {
      await chrome.tabs.update(tabId, { active: true }).catch(() => {});
      if (!isNaN(windowId) && windowId > 0) {
        await chrome.windows.update(windowId, { focused: true }).catch(() => {});
      }
    }
    return;
  }

  if (content.startsWith('action:')) {
    const action = content.slice('action:'.length);
    await executeActionCommand(action);
    return;
  }

  if (content.startsWith('http://') || content.startsWith('https://')) {
    if (disposition === 'currentTab') {
      await chrome.tabs.update({ url: content }).catch(() => {});
    } else {
      await chrome.tabs
        .create({ url: content, active: disposition !== 'newBackgroundTab' })
        .catch(() => {});
    }
    return;
  }

  // 普通文本回车：匹配度最高项
  const items = await queryAllSearchItems(content, 'all', 1);
  if (items.length > 0) {
    const top = items[0];
    if (top.kind === 'tab' && top.tabId != null) {
      await chrome.tabs.update(top.tabId, { active: true }).catch(() => {});
      if (top.windowId != null) {
        await chrome.windows.update(top.windowId, { focused: true }).catch(() => {});
      }
      return;
    }
    if (top.kind === 'command' && top.commandAction) {
      await executeActionCommand(top.commandAction);
      return;
    }
    if (top.url) {
      await chrome.tabs.create({ url: top.url }).catch(() => {});
      return;
    }
  }

  // 默认导航：搜索
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(content)}`;
  if (disposition === 'currentTab') {
    await chrome.tabs.update({ url: searchUrl }).catch(() => {});
  } else {
    await chrome.tabs.create({ url: searchUrl }).catch(() => {});
  }
}

