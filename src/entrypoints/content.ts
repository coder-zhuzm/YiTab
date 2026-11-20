import type { TabInfo } from '@/lib/match';
import { parsePaletteQuery, type SearchItem, type SearchItemKind } from '@/lib/search';
import { resolveIsDark, THEME_STORAGE_KEY, sanitizeThemeMode, type ThemeMode } from '@/lib/theme-mode';
import {
  getDefaultPaletteShortcut,
  matchesPaletteShortcut,
  PALETTE_SHORTCUT_STORAGE_KEY,
  sanitizePaletteShortcut,
  type PaletteShortcutConfig,
} from '@/lib/palette-shortcut';

/** 当前生效的主题；content script 常驻页面，缓存一份避免每次弹窗都读存储。 */
let themeMode: ThemeMode = 'system';
let systemDark = false;
let paletteShortcut: PaletteShortcutConfig = getDefaultPaletteShortcut();

function applyThemeTo(el: HTMLElement): void {
  el.dataset.theme = resolveIsDark(themeMode) ? 'dark' : 'light';
}

/** 读取一次主题偏好，并订阅后续变化（设置页切换后浮窗立即跟随）。 */
function initTheme(): void {
  systemDark = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;

  chrome.storage?.sync?.get(THEME_STORAGE_KEY).then((res) => {
    themeMode = sanitizeThemeMode(res[THEME_STORAGE_KEY]);
    document.querySelectorAll<HTMLElement>('#yitab-spa-toast-root, #yitab-command-palette-root')
      .forEach(applyThemeTo);
  }).catch(() => {});

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !(THEME_STORAGE_KEY in changes)) return;
    themeMode = sanitizeThemeMode(changes[THEME_STORAGE_KEY].newValue);
    document.querySelectorAll<HTMLElement>('#yitab-spa-toast-root, #yitab-command-palette-root')
      .forEach(applyThemeTo);
  });

  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener('change', (e) => {
    systemDark = e.matches;
    document.querySelectorAll<HTMLElement>('#yitab-spa-toast-root, #yitab-command-palette-root')
      .forEach(applyThemeTo);
  });
}

/** 读取并订阅页内自定义命令面板快捷键（设置页修改后所有已开网页立即生效） */
function initPaletteShortcut(): void {
  chrome.storage?.sync?.get(PALETTE_SHORTCUT_STORAGE_KEY).then((res) => {
    paletteShortcut = sanitizePaletteShortcut(res[PALETTE_SHORTCUT_STORAGE_KEY]);
  }).catch(() => {});

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync' || !(PALETTE_SHORTCUT_STORAGE_KEY in changes)) return;
    paletteShortcut = sanitizePaletteShortcut(changes[PALETTE_SHORTCUT_STORAGE_KEY].newValue);
  });

  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (!matchesPaletteShortcut(e, paletteShortcut)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleCommandPalette();
    },
    true,
  );
}

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    initTheme();
    initPaletteShortcut();

    // 1. 监听来自 background 的 SPA 路由重复提醒与全局快捷键指令
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'yitab_spa_duplicate') {
        showDuplicateToast(msg.candidateUrl, msg.targetTab);
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'yitab_toggle_palette') {
        const opened = toggleCommandPalette(Array.isArray(msg.initialItems) ? msg.initialItems : null);
        sendResponse({ ok: true, opened });
      } else if (msg && msg.type === 'yitab_palette_initial_items') {
        if (Array.isArray(msg.items)) {
          applyInitialPaletteItems(msg.items);
        }
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'yitab_show_notice') {
        if (msg.message) {
          showStatusNotice(String(msg.message));
        }
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'yitab_copy_to_clipboard') {
        navigator.clipboard
          .writeText(msg.text || '')
          .then(() => {
            if (msg.message) {
              showStatusNotice(String(msg.message));
            }
          })
          .catch((err) => {
            console.warn('[YiTab] 写入剪贴板失败:', err);
          });
        sendResponse({ ok: true });
      }
    });
  },
});

/* ==========================================================================
   Part 0: 轻量状态气泡 (替代原生 alert，不抢焦点)
   ========================================================================== */

let noticeContainer: HTMLElement | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function showStatusNotice(text: string) {
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  if (!noticeContainer) {
    noticeContainer = document.createElement('div');
    noticeContainer.id = 'yitab-status-notice-root';
    noticeContainer.style.position = 'fixed';
    noticeContainer.style.top = '18px';
    noticeContainer.style.left = '50%';
    noticeContainer.style.transform = 'translateX(-50%)';
    noticeContainer.style.zIndex = '2147483647';
    noticeContainer.style.pointerEvents = 'none';
    document.documentElement.appendChild(noticeContainer);
  }
  applyThemeTo(noticeContainer);
  const shadow = noticeContainer.shadowRoot ?? noticeContainer.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; display: block; }
      .pill {
        background: #ffffff;
        color: #14161b;
        border: 1px solid #e3e6ec;
        box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.16);
        border-radius: 999px;
        padding: 8px 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      :host([data-theme='dark']) .pill {
        background: #16181d;
        color: #e8eaee;
        border-color: #262a31;
        box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.55);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #10b981;
        flex: none;
      }
    </style>
    <div class="pill" role="status"><span class="dot"></span><span>${escapeHtml(text)}</span></div>
  `;
  noticeTimer = setTimeout(() => {
    if (noticeContainer && noticeContainer.parentNode) {
      noticeContainer.parentNode.removeChild(noticeContainer);
      noticeContainer = null;
    }
    noticeTimer = null;
  }, 2600);
}

/* ==========================================================================
   Part 1: 单页应用路由重复提示 (SPA In-Page Toast)
   ========================================================================== */

let toastContainer: HTMLElement | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function showDuplicateToast(candidateUrl: string, targetTab: TabInfo) {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'yitab-spa-toast-root';
    toastContainer.style.position = 'fixed';
    toastContainer.style.top = '16px';
    toastContainer.style.right = '20px';
    toastContainer.style.zIndex = '2147483647';
    toastContainer.style.maxWidth = '390px';
    toastContainer.style.pointerEvents = 'auto';
    document.documentElement.appendChild(toastContainer);
  }
  applyThemeTo(toastContainer);

  const shadow = toastContainer.shadowRoot ?? toastContainer.attachShadow({ mode: 'open' });
  const reasonText = targetTab.match?.reason ?? '已打开相同页面';
  const tabTitle = targetTab.title || targetTab.url;
  const favicon = targetTab.favicon;

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
      }

      /* 深色：对齐主界面 --canvas(#0f1115) / --surface(#16181d) / --hairline(#262a31) */
      :host([data-theme='dark']) .card {
        background: rgba(22, 24, 29, 0.96);
        color: #e8eaee;
        border-color: #262a31;
        box-shadow: 0 20px 35px -10px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06);
      }

      :host([data-theme='dark']) .head-title { color: #e8eaee; }

      :host([data-theme='dark']) .favicon-box {
        background: #1e2127;
        border-color: #262a31;
      }

      :host([data-theme='dark']) .tab-title { color: #e8eaee; }

      :host([data-theme='dark']) .reason-tag {
        background: transparent;
        color: #8f96a2;
        border-color: transparent;
      }

      :host([data-theme='dark']) .btn-secondary {
        background: #1e2127;
        color: #b3bac5;
        border-color: #262a31;
      }
      :host([data-theme='dark']) .btn-secondary:hover {
        background: #262a31;
        color: #e8eaee;
      }

      .card {
        position: relative;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: #0f172a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        border-radius: 12px;
        box-shadow: 0 20px 35px -10px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(15, 23, 42, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.8);
        padding: 14px 16px 16px;
        box-sizing: border-box;
        animation: yitab-slide-in 0.24s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      
      .card.closing {
        animation: yitab-slide-out 0.16s cubic-bezier(0.4, 0, 1, 1) forwards;
      }
      @keyframes yitab-slide-in {
        from { opacity: 0; transform: translateY(-12px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes yitab-slide-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-10px) scale(0.96); }
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .title-group {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .logo-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 5px;
        letter-spacing: 0.3px;
        box-shadow: 0 2px 4px rgba(79, 70, 229, 0.25);
      }
      .head-title {
        font-weight: 600;
        font-size: 13px;
        color: #0f172a;
      }
      
      .close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 4px 6px;
        border-radius: 6px;
        transition: all 0.15s ease;
      }
      .close-btn:hover {
        color: #475569;
        background: rgba(148, 163, 184, 0.15);
      }
      .content {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      .favicon-box {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: 7px;
        background: #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, 0.06);
        margin-top: 1px;
      }
      
      .favicon-img {
        width: 18px;
        height: 18px;
        object-fit: contain;
      }
      .text-area {
        flex: 1;
        min-width: 0;
      }
      .tab-title {
        font-weight: 500;
        color: #1e293b;
        font-size: 13px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }
      
      .reason-tag {
        display: block;
        background: transparent;
        color: #64748b;
        font-size: 11.5px;
        font-weight: 400;
        padding: 0;
        border: none;
        line-height: 1.4;
      }
      
      .actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .btn-primary {
        background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
        color: #ffffff;
        border: none;
        padding: 6px 13px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        box-shadow: 0 1px 3px rgba(79, 70, 229, 0.3);
      }
      .btn-primary:hover {
        background: linear-gradient(135deg, #4338ca 0%, #3730a3 100%);
        transform: translateY(-0.5px);
        box-shadow: 0 2px 6px rgba(79, 70, 229, 0.4);
      }
      .btn-primary:active {
        transform: translateY(0);
      }
      .btn-secondary {
        background: #f1f5f9;
        color: #475569;
        border: 1px solid rgba(226, 232, 240, 0.8);
        padding: 6px 12px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .btn-secondary:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      .btn-link {
        margin-left: auto;
        background: transparent;
        border: none;
        color: #64748b;
        font-size: 11.5px;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 5px;
        transition: color 0.15s ease, background 0.15s ease;
      }
      .btn-link:hover {
        color: #4f46e5;
        background: rgba(79, 70, 229, 0.08);
      }
      :host([data-theme='dark']) .btn-link {
        color: #94a3b8;
      }
      :host([data-theme='dark']) .btn-link:hover {
        color: #a5b4fc;
        background: rgba(129, 140, 248, 0.15);
      }
      
      .countdown-bar {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2.5px;
        background: linear-gradient(90deg, #4f46e5, #06b6d4);
        width: 100%;
        transform-origin: left;
        animation: yitab-countdown 12s linear forwards;
      }
      @keyframes yitab-countdown {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
    </style>
    <div class="card" id="yitab-card">
      <div class="header">
        <div class="title-group">
          <span class="logo-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            YiTab
          </span>
          <span class="head-title">已有匹配标签</span>
        </div>
        <button class="close-btn" id="yitab-close" title="留在本页">✕</button>
      </div>
      <div class="content">
        <div class="favicon-box">
          ${
            favicon
              ? `<img class="favicon-img" src="${escapeHtml(favicon)}" alt="" onerror="this.style.display='none'" />`
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
          }
        </div>
        <div class="text-area">
          <div class="tab-title" title="${escapeHtml(tabTitle)}">${escapeHtml(tabTitle)}</div>
          <div class="reason-tag">${escapeHtml(reasonText)}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-primary" id="yitab-switch-close">切换并关闭</button>
        <button class="btn-secondary" id="yitab-switch">仅切换</button>
        <button class="btn-link" id="yitab-whitelist" title="将当前站点加入白名单，后续不再提示">此站不再提示</button>
      </div>
      <div class="countdown-bar"></div>
    </div>
  `;

  const dismiss = () => {
    const card = shadow.getElementById('yitab-card');
    if (card) {
      card.classList.add('closing');
      setTimeout(() => {
        if (toastContainer && toastContainer.parentNode) {
          toastContainer.parentNode.removeChild(toastContainer);
          toastContainer = null;
        }
      }, 150);
    } else if (toastContainer && toastContainer.parentNode) {
      toastContainer.parentNode.removeChild(toastContainer);
      toastContainer = null;
    }
  };

  shadow.getElementById('yitab-close')?.addEventListener('click', dismiss);

  shadow.getElementById('yitab-switch-close')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'switchTab',
      tabId: targetTab.id,
      windowId: targetTab.windowId,
      closeSelf: true,
    });
    dismiss();
  });

  shadow.getElementById('yitab-switch')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'switchTab',
      tabId: targetTab.id,
      windowId: targetTab.windowId,
      closeSelf: false,
    });
    dismiss();
  });

  shadow.getElementById('yitab-whitelist')?.addEventListener('click', () => {
    try {
      const host = new URL(candidateUrl || location.href).hostname.replace(/^www\./i, '');
      if (host) {
        chrome.runtime.sendMessage({ type: 'addWhitelistDomain', domain: host }, () => {
          showStatusNotice(`已将 ${host} 加入白名单`);
        });
      }
    } catch {
      // ignore
    }
    dismiss();
  });

  // 12 秒后自动消失
  dismissTimer = setTimeout(dismiss, 12000);
}

/* ==========================================================================
   Part 2: 全局命令面板 (Global Command Palette Modal)
   ========================================================================== */

let paletteContainer: HTMLElement | null = null;
let currentItems: SearchItem[] = [];
let currentFilter: 'all' | SearchItemKind = 'all';
let currentQuery = '';
let selectedIdx = 0;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let skeletonDelayTimer: ReturnType<typeof setTimeout> | null = null;
let paletteKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
let paletteApplyInitialItems: ((items: SearchItem[]) => void) | null = null;
let searchRequestSeq = 0;

/** 带超时与瞬时重试的扩展消息调用，避免 SW 唤醒抖动或通道断开时永久悬停在「正在加载」 */
async function sendRuntimeMessageWithTimeout<T>(
  payload: Record<string, unknown>,
  timeoutMs = 4500,
  retries = 1,
): Promise<T> {
  const attempt = (): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (!chrome.runtime?.id) {
        reject(new Error('CONTEXT_INVALIDATED'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('TIMEOUT'));
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(payload, (response: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error(err.message || 'RUNTIME_ERROR'));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });

  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (msg.includes('CONTEXT_INVALIDATED') || msg.includes('Extension context invalidated')) {
        throw err;
      }
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 140));
      }
    }
  }
  throw lastErr;
}

function applyInitialPaletteItems(items: SearchItem[]) {
  if (paletteApplyInitialItems) {
    paletteApplyInitialItems(items);
  }
}

function toggleCommandPalette(initialItems?: SearchItem[] | null): boolean {
  if (paletteContainer) {
    closeCommandPalette();
    return false;
  }
  openCommandPalette(initialItems);
  return true;
}

function closeCommandPalette() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (skeletonDelayTimer) {
    clearTimeout(skeletonDelayTimer);
    skeletonDelayTimer = null;
  }
  if (paletteKeydownHandler) {
    document.removeEventListener('keydown', paletteKeydownHandler, true);
    paletteKeydownHandler = null;
  }
  paletteApplyInitialItems = null;
  searchRequestSeq++;
  if (paletteContainer && paletteContainer.parentNode) {
    paletteContainer.parentNode.removeChild(paletteContainer);
  }
  paletteContainer = null;
  currentItems = [];
  currentFilter = 'all';
  currentQuery = '';
  selectedIdx = 0;
}

const SECTION_LABELS: Record<SearchItemKind, string> = {
  tab: '已开标签',
  command: '快捷指令',
  bookmark: '收藏书签',
  history: '近期历史',
};

const KIND_LABELS: Record<SearchItemKind, string> = {
  tab: '标签',
  command: '指令',
  bookmark: '书签',
  history: '历史',
};

const TAB_GROUP_DOT_COLORS: Record<string, string> = {
  grey: '#64748b',
  blue: '#3b82f6',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#10b981',
  pink: '#ec4899',
  purple: '#8b5cf6',
  cyan: '#06b6d4',
  orange: '#f97316',
};

function resolveGroupDotColor(color?: string): string {
  if (!color) return 'var(--accent)';
  return TAB_GROUP_DOT_COLORS[color] || color;
}

function openCommandPalette(initialItems?: SearchItem[] | null) {
  closeCommandPalette();

  paletteContainer = document.createElement('div');
  paletteContainer.id = 'yitab-command-palette-root';
  paletteContainer.style.position = 'fixed';
  paletteContainer.style.inset = '0';
  paletteContainer.style.zIndex = '2147483647';
  paletteContainer.style.pointerEvents = 'auto';
  document.documentElement.appendChild(paletteContainer);
  applyThemeTo(paletteContainer);

  const shadow = paletteContainer.shadowRoot ?? paletteContainer.attachShadow({ mode: 'open' });
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  shadow.innerHTML = `
    <style>
      /* 对齐 YiTab 主界面设计令牌（中性画布 + 单一强调色，克制层级） */
      :host {
        all: initial;
        display: block;
        --canvas: #f6f7f9;
        --surface: #ffffff;
        --surface-hover: #eef0f5;
        --hairline: #e3e6ec;
        --hairline-strong: #d3d8e0;
        --ink: #14161b;
        --ink-2: #4e5663;
        --ink-3: #666d79;
        --accent: #4f46e5;
        --accent-soft: #ecebfd;
        --ok: #0f9d6e;
        --danger: #c0392b;
        --backdrop: rgba(15, 17, 21, 0.36);
        --shadow: 0 24px 56px -14px rgba(15, 17, 21, 0.24), 0 0 0 1px rgba(20, 22, 27, 0.08);
        --tag-bg: #eef0f5;
        --tag-ink: #4e5663;
        --cmd-bg: #ecebfd;
        --cmd-ink: #4338ca;
        --ok-soft: rgba(15, 157, 110, 0.12);
        --skeleton: #eef0f5;
        --skeleton-shine: #f6f7f9;
      }

      :host([data-theme='dark']) {
        --canvas: #0f1115;
        --surface: #16181d;
        --surface-hover: #1e2127;
        --hairline: #262a31;
        --hairline-strong: #343941;
        --ink: #e8eaee;
        --ink-2: #b3bac5;
        --ink-3: #8f96a2;
        --accent: #8b8bf5;
        --accent-soft: #23243a;
        --ok: #34c793;
        --danger: #f08080;
        --backdrop: rgba(0, 0, 0, 0.58);
        --shadow: 0 28px 64px -14px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.05);
        --tag-bg: #1e2127;
        --tag-ink: #9aa2af;
        --cmd-bg: #23243a;
        --cmd-ink: #a5b4fc;
        --ok-soft: rgba(52, 199, 147, 0.14);
        --skeleton: #1e2127;
        --skeleton-shine: #262a31;
      }

      * {
        box-sizing: border-box;
      }

      .backdrop {
        position: fixed;
        inset: 0;
        background: var(--backdrop);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 12vh 16px 24px;
        animation: yitab-fade-in 0.14s ease-out forwards;
      }

      @keyframes yitab-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .palette-box {
        width: 640px;
        max-width: 100%;
        background: var(--surface);
        color: var(--ink);
        border-radius: 14px;
        box-shadow: var(--shadow);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI',
          'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        animation: yitab-scale-up 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes yitab-scale-up {
        from { opacity: 0; transform: translateY(-10px) scale(0.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @media (prefers-reduced-motion: reduce) {
        .backdrop,
        .palette-box {
          animation: none;
        }
      }

      /* 顶部搜索栏 */
      .search-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 13px 16px;
        border-bottom: 1px solid var(--hairline);
      }

      .search-leading {
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--ink-3);
        flex-shrink: 0;
        transition: color 0.15s ease;
      }

      .search-bar:focus-within .search-leading,
      .search-leading.cmd-mode {
        color: var(--accent);
      }

      .search-input {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        background: transparent;
        font-family: inherit;
        font-size: 15px;
        font-weight: 450;
        color: var(--ink);
        line-height: 1.4;
        padding: 2px 0;
      }

      .search-input::placeholder {
        color: var(--ink-3);
        font-weight: 400;
      }

      .clear-btn {
        display: none;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--ink-3);
        cursor: pointer;
        padding: 0;
        flex-shrink: 0;
        transition: background 0.12s ease, color 0.12s ease;
      }

      .clear-btn.visible {
        display: inline-flex;
      }

      .clear-btn:hover {
        background: var(--surface-hover);
        color: var(--ink);
      }

      .kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 500;
        line-height: 1;
        color: var(--ink-3);
        background: var(--canvas);
        border: 1px solid var(--hairline-strong);
        border-radius: 5px;
        box-shadow: 0 1px 0 var(--hairline-strong);
        flex-shrink: 0;
        user-select: none;
      }

      /* 分类栏 */
      .filter-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 7px 14px;
        background: var(--canvas);
        border-bottom: 1px solid var(--hairline);
      }

      .filter-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        overflow-x: auto;
        scrollbar-width: none;
      }

      .filter-tabs::-webkit-scrollbar {
        display: none;
      }

      .filter-tab {
        border: none;
        background: transparent;
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        color: var(--ink-2);
        padding: 4px 10px;
        border-radius: 7px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.12s ease, color 0.12s ease;
      }

      .filter-tab:hover {
        background: var(--surface-hover);
        color: var(--ink);
      }

      .filter-tab.active {
        background: var(--accent-soft);
        color: var(--accent);
        font-weight: 600;
      }

      .result-count {
        font-size: 11.5px;
        color: var(--ink-3);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
        padding-right: 2px;
      }

      /* 结果列表 */
      .results-list {
        max-height: 400px;
        min-height: 120px;
        overflow-y: auto;
        padding: 6px 8px 8px;
        overscroll-behavior: contain;
      }

      .results-list::-webkit-scrollbar {
        width: 6px;
      }
      .results-list::-webkit-scrollbar-track {
        background: transparent;
      }
      .results-list::-webkit-scrollbar-thumb {
        background: var(--hairline-strong);
        border-radius: 3px;
      }

      .section-header {
        font-size: 11px;
        font-weight: 600;
        color: var(--ink-3);
        padding: 8px 10px 4px;
        user-select: none;
      }

      .section-header:first-child {
        padding-top: 4px;
      }

      .result-item {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 8px 10px 8px 12px;
        border-radius: 9px;
        cursor: pointer;
        position: relative;
        transition: background 0.1s ease;
      }

      .result-item::before {
        content: '';
        position: absolute;
        left: 2px;
        top: 8px;
        bottom: 8px;
        width: 2.5px;
        border-radius: 2px;
        background: transparent;
        transition: background 0.1s ease;
      }

      .result-item:hover {
        background: var(--surface-hover);
      }

      .result-item.selected {
        background: var(--accent-soft);
      }

      .result-item.selected::before {
        background: var(--accent);
      }

      .item-icon-box {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        background: var(--canvas);
        border: 1px solid var(--hairline);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        color: var(--ink-2);
      }

      .result-item.selected .item-icon-box {
        background: var(--surface);
        border-color: transparent;
      }

      .item-icon-img {
        width: 16px;
        height: 16px;
        object-fit: contain;
        border-radius: 3px;
      }

      .item-info {
        flex: 1;
        min-width: 0;
      }

      .item-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .item-title {
        font-size: 13.5px;
        font-weight: 500;
        color: var(--ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.35;
      }

      .item-title mark {
        background: transparent;
        color: var(--accent);
        font-weight: 700;
      }

      .active-badge {
        font-size: 10px;
        font-weight: 600;
        color: var(--ok);
        background: var(--ok-soft);
        padding: 1px 5px;
        border-radius: 4px;
        flex-shrink: 0;
        line-height: 1.4;
      }

      .item-sub {
        font-size: 11.5px;
        color: var(--ink-3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.35;
        margin-top: 1px;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .group-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--ink-2);
        font-weight: 500;
        flex-shrink: 0;
      }

      .group-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .sub-sep {
        width: 2.5px;
        height: 2.5px;
        border-radius: 50%;
        background: var(--hairline-strong);
        flex-shrink: 0;
      }

      .sub-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-trailing {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .kind-tag {
        font-size: 10.5px;
        font-weight: 500;
        padding: 2px 6px;
        border-radius: 5px;
        background: var(--tag-bg);
        color: var(--tag-ink);
        flex-shrink: 0;
      }

      .kind-tag.kind-command {
        background: var(--cmd-bg);
        color: var(--cmd-ink);
      }

      .tab-close-btn {
        display: none;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--ink-3);
        cursor: pointer;
        padding: 0;
        transition: background 0.12s ease, color 0.12s ease;
      }

      .result-item:hover .tab-close-btn,
      .result-item.selected .tab-close-btn {
        display: inline-flex;
      }

      .tab-close-btn:hover {
        background: rgba(192, 57, 43, 0.14);
        color: var(--danger);
      }

      .enter-hint {
        display: none;
        font-size: 11px;
        color: var(--accent);
        font-weight: 500;
        white-space: nowrap;
      }

      .result-item.selected .enter-hint {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }

      /* 空态 / 错误态 / 骨架屏 */
      .state-box {
        padding: 36px 20px;
        text-align: center;
        color: var(--ink-3);
        font-size: 13px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
      }

      .state-title {
        color: var(--ink-2);
        font-weight: 500;
        font-size: 13.5px;
      }

      .state-sub {
        color: var(--ink-3);
        font-size: 12px;
        max-width: 380px;
        line-height: 1.5;
      }

      .retry-btn {
        margin-top: 4px;
        border: 1px solid var(--hairline-strong);
        background: var(--surface);
        color: var(--ink);
        font-family: inherit;
        font-size: 12px;
        font-weight: 500;
        padding: 5px 14px;
        border-radius: 7px;
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease;
      }

      .retry-btn:hover {
        background: var(--surface-hover);
        border-color: var(--accent);
        color: var(--accent);
      }

      .skeleton-row {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 9px 12px;
      }

      .skeleton-icon {
        width: 28px;
        height: 28px;
        border-radius: 7px;
        background: var(--skeleton);
        flex-shrink: 0;
      }

      .skeleton-lines {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .skeleton-line {
        height: 11px;
        border-radius: 4px;
        background: linear-gradient(90deg, var(--skeleton) 25%, var(--skeleton-shine) 50%, var(--skeleton) 75%);
        background-size: 200% 100%;
        animation: yitab-shimmer 1.1s ease-in-out infinite;
      }

      .skeleton-line.short {
        width: 42%;
        height: 9px;
      }

      @keyframes yitab-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* 底部快捷键指引 */
      .footer-bar {
        padding: 8px 16px;
        border-top: 1px solid var(--hairline);
        background: var(--canvas);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 11px;
        color: var(--ink-3);
      }

      .footer-tips {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
      }

      .tip-pair {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
    </style>
    <div class="backdrop" id="yitab-palette-backdrop" role="dialog" aria-modal="true" aria-label="YiTab 全局命令与标签搜索">
      <div class="palette-box">
        <div class="search-bar">
          <div class="search-leading" id="yitab-palette-leading" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <input
            type="text"
            class="search-input"
            id="yitab-palette-input"
            placeholder="搜索标签页、书签、历史，或输入 > 快捷执行指令..."
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="clear-btn" id="yitab-palette-clear" title="清空输入" aria-label="清空输入">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <span class="kbd">Esc</span>
        </div>
        <div class="filter-bar">
          <div class="filter-tabs" role="tablist">
            <button type="button" class="filter-tab active" data-kind="all" role="tab" aria-selected="true">全部</button>
            <button type="button" class="filter-tab" data-kind="tab" role="tab" aria-selected="false">已开标签</button>
            <button type="button" class="filter-tab" data-kind="command" role="tab" aria-selected="false">快捷指令</button>
            <button type="button" class="filter-tab" data-kind="bookmark" role="tab" aria-selected="false">收藏书签</button>
            <button type="button" class="filter-tab" data-kind="history" role="tab" aria-selected="false">近期历史</button>
          </div>
          <span class="result-count" id="yitab-palette-count"></span>
        </div>
        <div class="results-list" id="yitab-palette-results" role="listbox"></div>
        <div class="footer-bar">
          <div class="footer-tips">
            <span class="tip-pair"><span class="kbd">↑</span><span class="kbd">↓</span><span>选择</span></span>
            <span class="tip-pair"><span class="kbd">↵</span><span id="yitab-footer-enter-label">打开</span></span>
            <span class="tip-pair"><span class="kbd">Tab</span><span>切换分类</span></span>
            <span class="tip-pair"><span class="kbd">&gt;</span><span>指令模式</span></span>
          </div>
          <div class="footer-tips">
            <span class="tip-pair" title="在当前标签页打开书签或历史"><span class="kbd">${modKey}↵</span><span>当前页打开</span></span>
          </div>
        </div>
      </div>
    </div>
  `;

  const inputEl = shadow.getElementById('yitab-palette-input') as HTMLInputElement;
  const clearBtn = shadow.getElementById('yitab-palette-clear') as HTMLButtonElement;
  const leadingEl = shadow.getElementById('yitab-palette-leading')!;
  const resultsEl = shadow.getElementById('yitab-palette-results')!;
  const countEl = shadow.getElementById('yitab-palette-count')!;
  const enterLabelEl = shadow.getElementById('yitab-footer-enter-label')!;
  const backdropEl = shadow.getElementById('yitab-palette-backdrop')!;
  const filterBtns = shadow.querySelectorAll<HTMLButtonElement>('.filter-tab');

  const searchIconSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  const commandIconSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';

  // 聚焦输入框
  requestAnimationFrame(() => inputEl?.focus());

  const syncFilterTabsUI = (activeKind: 'all' | SearchItemKind) => {
    filterBtns.forEach((btn) => {
      const isActive = btn.getAttribute('data-kind') === activeKind;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  };

  const syncLeadingUI = (isCommandPrefix: boolean) => {
    leadingEl.classList.toggle('cmd-mode', isCommandPrefix);
    leadingEl.innerHTML = isCommandPrefix ? commandIconSvg : searchIconSvg;
    clearBtn.classList.toggle('visible', currentQuery.length > 0);
  };

  const renderSkeleton = () => {
    resultsEl.innerHTML = `
      <div class="skeleton-row"><div class="skeleton-icon"></div><div class="skeleton-lines"><div class="skeleton-line" style="width:62%"></div><div class="skeleton-line short"></div></div></div>
      <div class="skeleton-row"><div class="skeleton-icon"></div><div class="skeleton-lines"><div class="skeleton-line" style="width:48%"></div><div class="skeleton-line short"></div></div></div>
      <div class="skeleton-row"><div class="skeleton-icon"></div><div class="skeleton-lines"><div class="skeleton-line" style="width:70%"></div><div class="skeleton-line short"></div></div></div>
    `;
  };

  const renderErrorState = (err: unknown) => {
    const rawMsg = err instanceof Error ? err.message : String(err ?? '');
    const isInvalidated =
      rawMsg.includes('CONTEXT_INVALIDATED') || rawMsg.includes('Extension context invalidated');
    countEl.textContent = '';
    resultsEl.innerHTML = `
      <div class="state-box">
        <div class="state-title">${isInvalidated ? '扩展刚完成更新' : '暂时无法获取搜索结果'}</div>
        <div class="state-sub">${
          isInvalidated
            ? '当前页面的扩展连接已失效，刷新页面后即可恢复正常使用。'
            : '后台服务响应超时或连接中断，请点击重试。'
        }</div>
        <button type="button" class="retry-btn" id="yitab-palette-retry">${isInvalidated ? '刷新页面' : '重新加载'}</button>
      </div>
    `;
    shadow.getElementById('yitab-palette-retry')?.addEventListener('click', () => {
      if (isInvalidated) {
        window.location.reload();
      } else {
        void triggerSearch(currentQuery);
      }
    });
  };

  const updateFooterHint = () => {
    const active = currentItems[selectedIdx];
    if (!active) {
      enterLabelEl.textContent = '打开';
      return;
    }
    if (active.kind === 'tab') {
      enterLabelEl.textContent = '切换标签';
    } else if (active.kind === 'command') {
      enterLabelEl.textContent = '执行指令';
    } else {
      enterLabelEl.textContent = '新标签打开';
    }
  };

  const updateSelectionDom = (scrollIntoView: boolean) => {
    const itemEls = shadow.querySelectorAll<HTMLElement>('.result-item');
    itemEls.forEach((el) => {
      const idx = parseInt(el.getAttribute('data-idx') || '-1', 10);
      const isSelected = idx === selectedIdx;
      el.classList.toggle('selected', isSelected);
      el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected && scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    updateFooterHint();
  };

  // 结果渲染
  const renderResults = () => {
    if (!paletteContainer || !paletteContainer.isConnected) return;
    const parsed = parsePaletteQuery(currentQuery, currentFilter);
    const effectiveFilter = parsed.effectiveFilter;
    const trimmedQuery = parsed.query.trim();

    countEl.textContent = currentItems.length > 0 ? `${currentItems.length} 项` : '';
    updateFooterHint();

    if (currentItems.length === 0) {
      resultsEl.innerHTML = `
        <div class="state-box">
          <div class="state-title">没有找到匹配项</div>
          <div class="state-sub">${
            trimmedQuery
              ? '试试更换关键词，按 Tab 切换分类，或输入 > 查看全部快捷指令。'
              : '当前分类暂无可展示内容。'
          }</div>
        </div>
      `;
      return;
    }

    const showSections = effectiveFilter === 'all' && !trimmedQuery;
    const showKindBadge = effectiveFilter === 'all' && Boolean(trimmedQuery);
    let lastKind: SearchItemKind | null = null;

    const htmlParts: string[] = [];
    currentItems.forEach((item, idx) => {
      if (showSections && item.kind !== lastKind) {
        lastKind = item.kind;
        htmlParts.push(`<div class="section-header">${SECTION_LABELS[item.kind]}</div>`);
      }

      const isSelected = idx === selectedIdx;
      const kindLabel = KIND_LABELS[item.kind];
      const kindClass = `kind-${item.kind}`;

      // 高亮多词匹配
      let highlightedTitle = escapeHtml(item.title);
      if (trimmedQuery) {
        const tokens = trimmedQuery
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (tokens.length > 0) {
          const reg = new RegExp(`(${tokens.join('|')})`, 'gi');
          highlightedTitle = highlightedTitle.replace(reg, '<mark>$1</mark>');
        }
      }

      const subtitle = escapeHtml(item.domain || item.description || item.url || '');
      const enterText =
        item.kind === 'tab' ? '切换' : item.kind === 'command' ? '执行' : '打开';

      htmlParts.push(`
        <div class="result-item ${isSelected ? 'selected' : ''}" data-idx="${idx}" role="option" aria-selected="${isSelected ? 'true' : 'false'}">
          <div class="item-icon-box" data-kind="${item.kind}">
            ${
              item.favicon
                ? `<img class="item-icon-img" src="${escapeHtml(item.favicon)}" alt="" />`
                : getCategoryIcon(item.kind)
            }
          </div>
          <div class="item-info">
            <div class="item-title-row">
              <div class="item-title">${highlightedTitle}</div>
              ${item.kind === 'tab' && item.active ? '<span class="active-badge">当前</span>' : ''}
            </div>
            <div class="item-sub">
              ${
                item.groupTitle
                  ? `<span class="group-chip"><span class="group-dot" style="background:${escapeHtml(resolveGroupDotColor(item.groupColor))}"></span><span>${escapeHtml(item.groupTitle)}</span></span><span class="sub-sep"></span>`
                  : ''
              }
              <span class="sub-text">${subtitle}</span>
            </div>
          </div>
          <div class="item-trailing">
            ${
              item.kind === 'tab' && item.tabId != null
                ? `<button type="button" class="tab-close-btn" data-close-tab="${item.tabId}" title="关闭此标签页 (${modKey}⌫)" aria-label="关闭此标签页"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`
                : ''
            }
            ${showKindBadge ? `<span class="kind-tag ${kindClass}">${kindLabel}</span>` : ''}
            <span class="enter-hint">${enterText} ↵</span>
          </div>
        </div>
      `);
    });

    resultsEl.innerHTML = htmlParts.join('');

    // CSP 安全的图标加载失败回退
    resultsEl.querySelectorAll<HTMLImageElement>('.item-icon-img').forEach((img) => {
      img.addEventListener('error', () => {
        const box = img.parentElement;
        if (!box) return;
        const kind = (box.getAttribute('data-kind') as SearchItemKind) || 'tab';
        box.innerHTML = getCategoryIcon(kind);
      });
    });

    // 绑定行交互：悬停同步选中、点击执行、标签快捷关闭
    resultsEl.querySelectorAll<HTMLElement>('.result-item').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
      el.addEventListener('mouseenter', () => {
        if (selectedIdx !== idx) {
          selectedIdx = idx;
          updateSelectionDom(false);
        }
      });
      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        const closeBtn = target?.closest<HTMLButtonElement>('.tab-close-btn');
        if (closeBtn) {
          e.stopPropagation();
          const tabId = parseInt(closeBtn.getAttribute('data-close-tab') || '', 10);
          if (!Number.isNaN(tabId)) {
            void quickCloseTab(tabId);
          }
          return;
        }
        if (currentItems[idx]) {
          void executeItem(currentItems[idx], e.metaKey || e.ctrlKey);
        }
      });
    });

    const selectedEl = shadow.querySelector<HTMLElement>('.result-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  };

  // 面板内直接关闭某个已开标签页
  const quickCloseTab = async (tabId: number) => {
    try {
      await sendRuntimeMessageWithTimeout({ type: 'closeTabs', tabIds: [tabId] }, 3000, 0);
      currentItems = currentItems.filter((item) => !(item.kind === 'tab' && item.tabId === tabId));
      if (selectedIdx >= currentItems.length) {
        selectedIdx = Math.max(0, currentItems.length - 1);
      }
      renderResults();
    } catch (e) {
      console.warn('[YiTab] quick close tab failed:', e);
    }
  };

  // 搜索请求（带序列号防竞态、超时重试、延迟骨架屏与错误回退）
  const triggerSearch = async (rawQuery: string) => {
    const seq = ++searchRequestSeq;
    const parsed = parsePaletteQuery(rawQuery, currentFilter);
    syncLeadingUI(parsed.isCommandPrefix);
    syncFilterTabsUI(parsed.effectiveFilter);

    if (skeletonDelayTimer) {
      clearTimeout(skeletonDelayTimer);
      skeletonDelayTimer = null;
    }
    if (currentItems.length === 0) {
      skeletonDelayTimer = setTimeout(() => {
        if (seq === searchRequestSeq && paletteContainer?.isConnected) {
          renderSkeleton();
        }
      }, 120);
    }

    try {
      const res = await sendRuntimeMessageWithTimeout<{ ok?: boolean; items?: SearchItem[] }>(
        {
          type: 'searchItems',
          query: parsed.query,
          kindFilter: parsed.effectiveFilter,
          limit: 30,
        },
        4500,
        1,
      );
      if (seq !== searchRequestSeq || !paletteContainer?.isConnected) return;
      if (skeletonDelayTimer) {
        clearTimeout(skeletonDelayTimer);
        skeletonDelayTimer = null;
      }
      if (res && res.ok) {
        currentItems = Array.isArray(res.items) ? res.items : [];
        selectedIdx = 0;
        renderResults();
      } else {
        renderErrorState(new Error('INVALID_RESPONSE'));
      }
    } catch (e) {
      if (seq !== searchRequestSeq || !paletteContainer?.isConnected) return;
      if (skeletonDelayTimer) {
        clearTimeout(skeletonDelayTimer);
        skeletonDelayTimer = null;
      }
      console.warn('[YiTab] search error:', e);
      renderErrorState(e);
    }
  };

  // 执行具体项（书签/历史默认新标签打开，按住 Cmd/Ctrl+Enter 在当前页打开）
  const executeItem = async (item: SearchItem, openInCurrentTab = false) => {
    closeCommandPalette();

    try {
      if (item.kind === 'tab' && item.tabId != null) {
        await sendRuntimeMessageWithTimeout(
          {
            type: 'switchTab',
            tabId: item.tabId,
            windowId: item.windowId ?? 0,
            closeSelf: false,
          },
          3000,
          0,
        );
        return;
      }

      if (item.kind === 'command' && item.commandAction) {
        const res = await sendRuntimeMessageWithTimeout<{
          ok?: boolean;
          message?: string;
          copyText?: string;
        }>(
          {
            type: 'executeCommand',
            action: item.commandAction,
          },
          5000,
          0,
        );
        if (res) {
          if (res.copyText) {
            try {
              await navigator.clipboard.writeText(res.copyText);
            } catch (e) {
              console.warn('[YiTab] 写入剪贴板失败:', e);
            }
          }
          if (res.message) {
            showStatusNotice(String(res.message));
          }
        }
        return;
      }

      if (item.url) {
        if (openInCurrentTab) {
          window.location.href = item.url;
        } else {
          await sendRuntimeMessageWithTimeout(
            { type: 'openUrl', url: item.url, newTab: true },
            3000,
            0,
          ).catch(() => {
            window.open(item.url, '_blank', 'noopener,noreferrer');
          });
        }
      }
    } catch (e) {
      console.warn('[YiTab] executeItem failed:', e);
    }
  };

  // 点击背景关闭
  backdropEl.addEventListener('click', (e) => {
    if (e.target === backdropEl) {
      closeCommandPalette();
    }
  });

  // 清空输入
  clearBtn.addEventListener('click', () => {
    inputEl.value = '';
    currentQuery = '';
    inputEl.focus();
    void triggerSearch('');
  });

  // 分类按钮点击
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextKind = (btn.getAttribute('data-kind') as 'all' | SearchItemKind) || 'all';
      currentFilter = nextKind;
      // 如果输入框处于 > 前缀模式但用户主动切到非指令分类，去掉 > 前缀
      if (nextKind !== 'command' && currentQuery.trimStart().startsWith('>')) {
        currentQuery = currentQuery.trimStart().slice(1).trimStart();
        inputEl.value = currentQuery;
      }
      syncFilterTabsUI(nextKind);
      inputEl.focus();
      void triggerSearch(currentQuery);
    });
  });

  // 输入监听
  inputEl.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentQuery = val;
    const parsed = parsePaletteQuery(val, currentFilter);
    syncLeadingUI(parsed.isCommandPrefix);
    syncFilterTabsUI(parsed.effectiveFilter);

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      void triggerSearch(val);
    }, 80);
  });

  // 全局捕获级键盘导航（即便焦点不在输入框，Esc/上下/Tab 仍稳定响应）
  paletteKeydownHandler = (e: KeyboardEvent) => {
    if (!paletteContainer || !paletteContainer.isConnected) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeCommandPalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (currentItems.length > 0) {
        selectedIdx = (selectedIdx + 1) % currentItems.length;
        updateSelectionDom(true);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (currentItems.length > 0) {
        selectedIdx = (selectedIdx - 1 + currentItems.length) % currentItems.length;
        updateSelectionDom(true);
      }
      return;
    }
    if (e.key === 'Enter') {
      // 中文输入法组合选词阶段不触发执行
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      if (currentItems.length > 0 && currentItems[selectedIdx]) {
        void executeItem(currentItems[selectedIdx], e.metaKey || e.ctrlKey);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const kinds: ('all' | SearchItemKind)[] = ['all', 'tab', 'command', 'bookmark', 'history'];
      const curIdx = kinds.indexOf(currentFilter);
      const delta = e.shiftKey ? -1 : 1;
      const nextKind = kinds[(curIdx + delta + kinds.length) % kinds.length];
      currentFilter = nextKind;
      if (nextKind !== 'command' && currentQuery.trimStart().startsWith('>')) {
        currentQuery = currentQuery.trimStart().slice(1).trimStart();
        inputEl.value = currentQuery;
      }
      syncFilterTabsUI(nextKind);
      void triggerSearch(currentQuery);
      return;
    }
    if ((e.key === 'Backspace' && (e.metaKey || e.ctrlKey)) || (e.altKey && e.key.toLowerCase() === 'w')) {
      const active = currentItems[selectedIdx];
      if (active && active.kind === 'tab' && active.tabId != null) {
        e.preventDefault();
        e.stopPropagation();
        void quickCloseTab(active.tabId);
      }
    }
  };
  document.addEventListener('keydown', paletteKeydownHandler, true);

  // 接收 background 推送的首屏数据（仅当尚未输入且停留在「全部」视图时生效）
  paletteApplyInitialItems = (items: SearchItem[]) => {
    if (!paletteContainer?.isConnected) return;
    if (currentQuery.trim() !== '' || currentFilter !== 'all') return;
    if (skeletonDelayTimer) {
      clearTimeout(skeletonDelayTimer);
      skeletonDelayTimer = null;
    }
    searchRequestSeq++;
    currentItems = items;
    selectedIdx = 0;
    renderResults();
  };

  // 优先使用预取首屏数据；未提供时再向 background 请求
  if (Array.isArray(initialItems)) {
    currentItems = initialItems;
    selectedIdx = 0;
    renderResults();
  } else {
    void triggerSearch('');
  }
}

function getCategoryIcon(kind: SearchItemKind): string {
  if (kind === 'command') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  }
  if (kind === 'bookmark') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;
  }
  if (kind === 'history') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="18" x2="12" y2="21"></line></svg>`;
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
