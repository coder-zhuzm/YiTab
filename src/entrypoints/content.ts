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
        color: #111318;
        box-shadow: 0 0 0 1px oklch(0 0 0 / 0.08), 0 12px 28px -8px rgba(17, 19, 24, 0.18);
        border-radius: 999px;
        padding: 8px 16px;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', sans-serif;
        -webkit-font-smoothing: antialiased;
        font-size: 13px;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }
      :host([data-theme='dark']) .pill {
        background: #13161c;
        color: #edf0f5;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 16px 36px -10px rgba(0, 0, 0, 0.65);
      }
      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #0f766e;
        flex: none;
      }
      :host([data-theme='dark']) .dot {
        background: #2dd4bf;
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
    toastContainer.style.maxWidth = 'min(390px, calc(100vw - 40px))';
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

      /* 深色：对齐主界面 Precision Slate 令牌 */
      :host([data-theme='dark']) .card {
        background: #13161c;
        color: #edf0f5;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 24px 48px -12px rgba(0, 0, 0, 0.72);
      }

      :host([data-theme='dark']) .brand-pill {
        background: #1a1e26;
        color: #a6b0c0;
        border-color: #232833;
      }

      :host([data-theme='dark']) .brand-dot {
        background: #60a5fa;
      }

      :host([data-theme='dark']) .head-title { color: #edf0f5; }

      :host([data-theme='dark']) .close-btn { color: #939dae; }
      :host([data-theme='dark']) .close-btn:hover {
        color: #edf0f5;
        background: #1d222b;
      }

      :host([data-theme='dark']) .favicon-box {
        background: #1a1e26;
        outline-color: oklch(1 0 0 / 0.1);
      }

      :host([data-theme='dark']) .tab-title { color: #edf0f5; }

      :host([data-theme='dark']) .reason-tag {
        color: #939dae;
      }

      :host([data-theme='dark']) .btn-secondary {
        background: #1a1e26;
        color: #a6b0c0;
        border-color: #232833;
      }
      :host([data-theme='dark']) .btn-secondary:hover {
        background: #232833;
        color: #edf0f5;
      }

      :host([data-theme='dark']) .btn-link {
        color: #939dae;
      }
      :host([data-theme='dark']) .btn-link:hover {
        color: #60a5fa;
        background: rgba(96, 165, 250, 0.14);
      }

      :host([data-theme='dark']) .countdown-track {
        background: #232833;
      }
      :host([data-theme='dark']) .countdown-bar {
        background: #60a5fa;
      }
      :host([data-theme='dark']) :focus-visible {
        outline-color: #60a5fa;
      }

      :focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
        border-radius: 6px;
      }

      .card {
        position: relative;
        overflow: hidden;
        background: #ffffff;
        color: #111318;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        font-size: 13px;
        line-height: 1.5;
        border-radius: 12px;
        box-shadow: 0 0 0 1px oklch(0 0 0 / 0.08), 0 18px 36px -12px rgba(17, 19, 24, 0.18);
        padding: 14px 14px 18px;
        box-sizing: border-box;
        animation: yitab-slide-in 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      .card.closing {
        animation: yitab-slide-out 150ms ease-out forwards;
      }
      @keyframes yitab-slide-in {
        from { opacity: 0; transform: translateY(-8px) scale(0.98); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes yitab-slide-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-6px) scale(0.98); }
      }
      @media (prefers-reduced-motion: reduce) {
        .card, .card.closing { animation: none; }
        .countdown-bar { animation: none; }
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
      }
      .title-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .brand-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #eaeef4;
        color: #464f5e;
        border: 1px solid #dfe4ec;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 6px;
        letter-spacing: 0.01em;
      }
      .brand-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #2563eb;
      }
      .head-title {
        font-weight: 600;
        font-size: 13px;
        color: #111318;
      }

      .close-btn {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        color: #667085;
        cursor: pointer;
        padding: 0;
        border-radius: 6px;
        transition: background-color 140ms ease-out, color 140ms ease-out, transform 140ms ease-out;
      }
      .close-btn::after {
        content: '';
        position: absolute;
        inset: -8px;
      }
      .close-btn:hover {
        color: #111318;
        background: #eaeef4;
      }
      .close-btn:active {
        transform: scale(0.96);
      }
      .content {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        margin-bottom: 12px;
      }
      .favicon-box {
        width: 30px;
        height: 30px;
        flex-shrink: 0;
        border-radius: 7px;
        background: #eaeef4;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        outline: 1px solid oklch(0 0 0 / 0.1);
        outline-offset: -1px;
        margin-top: 1px;
      }

      .favicon-img {
        width: 18px;
        height: 18px;
        object-fit: contain;
        border-radius: 4px;
      }
      .text-area {
        flex: 1;
        min-width: 0;
      }
      .tab-title {
        font-weight: 500;
        color: #111318;
        font-size: 13px;
        line-height: 1.4;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 3px;
      }

      .reason-tag {
        display: block;
        color: #525d70;
        font-size: 11.5px;
        font-weight: 400;
        line-height: 1.4;
      }

      .actions {
        display: flex;
        gap: 7px;
        align-items: center;
      }
      .btn-primary {
        position: relative;
        background: #2563eb;
        color: #ffffff;
        border: none;
        height: 30px;
        padding: 0 12px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 140ms ease-out, transform 140ms ease-out;
      }
      .btn-primary::after {
        content: '';
        position: absolute;
        inset: -5px -1px;
      }
      .btn-primary:hover {
        background: #1d4ed8;
      }
      .btn-primary:active {
        transform: scale(0.96);
      }
      .btn-secondary {
        position: relative;
        background: #eaeef4;
        color: #464f5e;
        border: 1px solid #dfe4ec;
        height: 30px;
        padding: 0 11px;
        border-radius: 7px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 140ms ease-out, color 140ms ease-out, transform 140ms ease-out;
      }
      .btn-secondary::after {
        content: '';
        position: absolute;
        inset: -5px -1px;
      }
      .btn-secondary:hover {
        background: #dfe4ec;
        color: #111318;
      }
      .btn-secondary:active {
        transform: scale(0.96);
      }
      .btn-link {
        position: relative;
        margin-left: auto;
        background: transparent;
        border: none;
        color: #525d70;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
        height: 28px;
        padding: 0 8px;
        border-radius: 6px;
        transition: color 140ms ease-out, background-color 140ms ease-out, transform 140ms ease-out;
      }
      .btn-link::after {
        content: '';
        position: absolute;
        inset: -6px -1px;
      }
      .btn-link:hover {
        color: #2563eb;
        background: rgba(37, 99, 235, 0.09);
      }
      .btn-link:active {
        transform: scale(0.96);
      }

      .countdown-track {
        position: absolute;
        bottom: 8px;
        left: 12px;
        right: 12px;
        height: 2px;
        border-radius: 1px;
        overflow: hidden;
        background: #dfe4ec;
      }
      .countdown-bar {
        height: 100%;
        background: #2563eb;
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
          <span class="brand-pill">
            <span class="brand-dot" aria-hidden="true"></span>
            YiTab
          </span>
          <span class="head-title">已有匹配标签</span>
        </div>
        <button class="close-btn" id="yitab-close" title="留在本页" aria-label="留在本页">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="content">
        <div class="favicon-box">
          ${
            favicon
              ? `<img class="favicon-img" src="${escapeHtml(favicon)}" alt="" onerror="this.style.display='none'" />`
              : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#525d70" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="18" x2="12" y2="21"></line></svg>`
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
      <div class="countdown-track"><div class="countdown-bar"></div></div>
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
      /* 对齐 YiTab Precision Slate 设计令牌（冷灰/石墨表面层级 + 单一钴蓝信号色） */
      :host {
        all: initial;
        display: block;
        --canvas: #f2f4f7;
        --surface: #ffffff;
        --surface-well: #eaeef4;
        --surface-hover: #f4f6f9;
        --hairline: #dfe4ec;
        --hairline-strong: #c8d0dc;
        --ink: #111318;
        --ink-2: #464f5e;
        --ink-3: #525d70;
        --accent: #2563eb;
        --accent-soft: rgba(37, 99, 235, 0.09);
        --accent-ring: rgba(37, 99, 235, 0.24);
        --ok: #0f766e;
        --ok-soft: rgba(15, 118, 110, 0.10);
        --danger: #dc2626;
        --danger-soft: rgba(220, 38, 38, 0.10);
        --backdrop: rgba(17, 19, 24, 0.42);
        --shadow: 0 0 0 1px oklch(0 0 0 / 0.08), 0 24px 56px -14px rgba(17, 19, 24, 0.24);
        --tag-bg: #eaeef4;
        --tag-ink: #464f5e;
        --cmd-bg: rgba(37, 99, 235, 0.10);
        --cmd-ink: #1d4ed8;
        --skeleton: #eaeef4;
        --skeleton-shine: #f4f6f9;
        --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC',
          'Segoe UI', 'Microsoft YaHei', sans-serif;
        --font-mono: ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace;
      }

      :host([data-theme='dark']) {
        --canvas: #0b0d11;
        --surface: #13161c;
        --surface-well: #1a1e26;
        --surface-hover: #1d222b;
        --hairline: #232833;
        --hairline-strong: #323947;
        --ink: #edf0f5;
        --ink-2: #a6b0c0;
        --ink-3: #939dae;
        --accent: #60a5fa;
        --accent-soft: rgba(96, 165, 250, 0.14);
        --accent-ring: rgba(96, 165, 250, 0.28);
        --ok: #2dd4bf;
        --ok-soft: rgba(45, 212, 191, 0.14);
        --danger: #f87171;
        --danger-soft: rgba(248, 113, 113, 0.14);
        --backdrop: rgba(0, 0, 0, 0.62);
        --shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 28px 64px -14px rgba(0, 0, 0, 0.78);
        --tag-bg: #1a1e26;
        --tag-ink: #a6b0c0;
        --cmd-bg: rgba(96, 165, 250, 0.14);
        --cmd-ink: #93c5fd;
        --skeleton: #1a1e26;
        --skeleton-shine: #232833;
      }

      * {
        box-sizing: border-box;
      }

      ::selection {
        background: var(--accent-soft);
        color: var(--ink);
      }

      :focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
        border-radius: 6px;
      }

      .search-input:focus-visible {
        outline: none;
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
        border-radius: 12px;
        box-shadow: var(--shadow);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: var(--font-sans);
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        caret-color: var(--accent);
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
        position: relative;
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
        transition: background-color 120ms ease-out, color 120ms ease-out, transform 120ms ease-out;
      }

      .clear-btn::after {
        content: '';
        position: absolute;
        inset: -9px;
      }

      .clear-btn.visible {
        display: inline-flex;
      }

      .clear-btn:hover {
        background: var(--surface-well);
        color: var(--ink);
      }

      .clear-btn:active {
        transform: scale(0.96);
      }

      .kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 500;
        line-height: 1;
        color: var(--ink-3);
        background: var(--surface-well);
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
        background: var(--surface-well);
        border-bottom: 1px solid var(--hairline);
      }

      .filter-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        min-width: 0;
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
        border-radius: 6px;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease-out, color 120ms ease-out, transform 120ms ease-out;
      }

      .filter-tab:hover {
        background: var(--surface-hover);
        color: var(--ink);
      }

      .filter-tab:active {
        transform: scale(0.96);
      }

      .filter-tab.active {
        background: var(--surface);
        color: var(--ink);
        font-weight: 600;
        box-shadow: 0 1px 2px rgba(17, 19, 24, 0.08), 0 0 0 1px var(--hairline);
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
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
        position: relative;
        transition: background-color 100ms ease-out, box-shadow 100ms ease-out;
      }

      .result-item:hover {
        background: var(--surface-hover);
      }

      .result-item.selected {
        background: var(--accent-soft);
        box-shadow: inset 0 0 0 1px var(--accent-ring);
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
        font-family: var(--font-mono);
        font-size: 11px;
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
        position: relative;
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
        transition: background-color 120ms ease-out, color 120ms ease-out, transform 120ms ease-out;
      }

      .tab-close-btn::after {
        content: '';
        position: absolute;
        inset: -9px -4px;
      }

      .tab-close-btn:active {
        transform: scale(0.96);
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
        background: var(--surface-well);
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
        white-space: nowrap;
      }

      @media (max-width: 520px) {
        .filter-tab {
          padding: 4px 7px;
          font-size: 11.5px;
        }
        .footer-bar {
          flex-wrap: wrap;
          gap: 6px 12px;
        }
        .footer-tips {
          gap: 8px 10px;
        }
      }
    </style>
    <div class="backdrop" id="yitab-palette-backdrop" role="dialog" aria-modal="true" aria-label="YiTab 全局命令与标签搜索">
      <div class="palette-box">
        <div class="search-bar">
          <div class="search-leading" id="yitab-palette-leading" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <input
            type="text"
            class="search-input"
            id="yitab-palette-input"
            placeholder="搜索标签、书签、历史，或 > 执行指令..."
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="clear-btn" id="yitab-palette-clear" title="清空输入" aria-label="清空输入">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
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
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
  const commandIconSvg =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';

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
                ? `<button type="button" class="tab-close-btn" data-close-tab="${item.tabId}" title="关闭此标签页 (${modKey}⌫)" aria-label="关闭此标签页"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`
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
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`;
  }
  if (kind === 'bookmark') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;
  }
  if (kind === 'history') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="18" x2="12" y2="21"></line></svg>`;
}

function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
