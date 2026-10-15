import { browser } from 'wxt/browser';
import { getSettings, watchSettings } from '@/lib/settings';
import {
  INTERNAL_URL_RE,
  isDuplicate,
  inWhitelist,
  queryWebTabs,
  type TabInfo,
} from '@/lib/match';
import type { BackgroundRequest } from '@/lib/messaging';

const ALLOW_TTL = 8000;
/** 「仍要新开」放行表：tabId -> 时间戳。按标签放行可覆盖整条重定向链 */
const allowed = new Map<number, number>();

export default defineBackground(() => {
  watchSettings();

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0 || details.tabId < 0) return;
    handleNavigation(details.tabId, details.url);
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
    (async () => {
      if (msg.type === 'findDuplicates') {
        sendResponse(await findDuplicates(msg.url));
      } else if (msg.type === 'confirmOpen') {
        if (sender.tab?.id != null) allowed.set(sender.tab.id, Date.now());
        await browser.tabs
          .update(sender.tab!.id, { url: msg.url })
          .catch(() => {});
        sendResponse({ ok: true });
      } else if (msg.type === 'switchTab') {
        await switchTab(msg, sender.tab?.id, sender.tab?.windowId);
        sendResponse({ ok: true });
      } else if (msg.type === 'getSettings') {
        sendResponse({ ok: true, settings: await getSettings() });
      }
    })();
    return true; // 异步 sendResponse
  });

  console.info('[YiTab] background ready');
});

function confirmURL(url: string): string {
  return chrome.runtime.getURL('/confirm.html') + '?u=' + encodeURIComponent(url);
}

async function findDuplicates(url: string): Promise<{ ok: true; tabs: TabInfo[] }> {
  const { matchMode } = await getSettings();
  const tabs = await queryWebTabs();
  return {
    ok: true,
    tabs: tabs
      .filter((t) => !!t.url && isDuplicate(url, t.url, matchMode))
      .map((t) => ({
        id: t.id!,
        windowId: t.windowId,
        title: t.title ?? t.url ?? '',
        url: t.url ?? '',
        favicon: t.favIconUrl || '',
      })),
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

/** 核心检测：任何顶层导航提交后立刻检查重复 */
async function handleNavigation(tabId: number, url?: string): Promise<void> {
  if (!url || INTERNAL_URL_RE.test(url)) return;

  // 「仍要新开」放行：该标签在时限内的导航直接通过（含重定向链）
  const allowedAt = allowed.get(tabId);
  if (allowedAt && Date.now() - allowedAt < ALLOW_TTL) return;

  // 设置读取和标签查询并行，缩短从提交到切走的延迟
  const [settings, allTabs] = await Promise.all([getSettings(), queryWebTabs()]);
  if (inWhitelist(url, settings.whitelist)) return;

  const target =
    allTabs.find(
      (t) => t.id !== tabId && !!t.url && isDuplicate(url, t.url, settings.matchMode),
    ) ?? null;
  if (!target || target.id == null) return;

  if (settings.interceptMode === 'ask') {
    // 确认页式：把当前标签原地重定向为大按钮确认页
    browser.tabs.update(tabId, { url: confirmURL(url) }).catch(() => {});
    return;
  }

  // 静默切换式：聚焦旧标签；当前标签非窗口内唯一标签则关闭，
  // 是唯一标签（关掉会连窗口一起关）时退回确认页
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
  } catch {
    /* 标签可能已被用户关掉 */
  }
}