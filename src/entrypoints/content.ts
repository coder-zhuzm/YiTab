import type { TabInfo } from '@/lib/match';
import type { SearchItem, SearchItemKind } from '@/lib/search';

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    // 1. 监听来自 background 的 SPA 路由重复提醒与全局快捷键指令
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'yitab_spa_duplicate') {
        showDuplicateToast(msg.candidateUrl, msg.targetTab);
        sendResponse({ ok: true });
      } else if (msg && msg.type === 'yitab_toggle_palette') {
        toggleCommandPalette();
        sendResponse({ ok: true });
      }
    });

    // 2. 页面内全局快捷键监听 (Alt+K / Cmd+K)
    window.addEventListener(
      'keydown',
      (e) => {
        // Alt+K or Cmd+K
        const isCmdOrAlt = e.altKey || (e.metaKey && !e.ctrlKey);
        if (isCmdOrAlt && (e.key === 'k' || e.key === 'K')) {
          e.preventDefault();
          e.stopPropagation();
          toggleCommandPalette();
        }
      },
      true,
    );
  },
});

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
      @media (prefers-color-scheme: dark) {
        .card {
          background: rgba(30, 41, 59, 0.92);
          color: #f8fafc;
          border-color: rgba(255, 255, 255, 0.12);
          box-shadow: 0 20px 35px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
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
      @media (prefers-color-scheme: dark) {
        .head-title { color: #f1f5f9; }
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
      @media (prefers-color-scheme: dark) {
        .favicon-box {
          background: #334155;
          border-color: rgba(255, 255, 255, 0.1);
        }
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
      @media (prefers-color-scheme: dark) {
        .tab-title { color: #e2e8f0; }
      }
      .reason-tag {
        display: inline-block;
        background: #eef2ff;
        color: #4338ca;
        font-size: 11px;
        font-weight: 500;
        padding: 1px 7px;
        border-radius: 4px;
        border: 1px solid rgba(99, 102, 241, 0.2);
      }
      @media (prefers-color-scheme: dark) {
        .reason-tag {
          background: rgba(99, 102, 241, 0.2);
          color: #c7d2fe;
          border-color: rgba(99, 102, 241, 0.3);
        }
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
      @media (prefers-color-scheme: dark) {
        .btn-secondary {
          background: #334155;
          color: #cbd5e1;
          border-color: rgba(255, 255, 255, 0.08);
        }
        .btn-secondary:hover {
          background: #475569;
          color: #ffffff;
        }
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
        <button class="btn-primary" id="yitab-switch">切换到该标签</button>
        <button class="btn-secondary" id="yitab-dismiss">留在本页</button>
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
  shadow.getElementById('yitab-dismiss')?.addEventListener('click', dismiss);

  shadow.getElementById('yitab-switch')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'switchTab',
      tabId: targetTab.id,
      windowId: targetTab.windowId,
      closeSelf: false, // SPA 站内导航不强行关闭当前标签
    });
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

function toggleCommandPalette() {
  if (paletteContainer) {
    closeCommandPalette();
    return;
  }
  openCommandPalette();
}

function closeCommandPalette() {
  if (paletteContainer && paletteContainer.parentNode) {
    paletteContainer.parentNode.removeChild(paletteContainer);
    paletteContainer = null;
    currentItems = [];
    currentQuery = '';
    selectedIdx = 0;
  }
}

function openCommandPalette() {
  closeCommandPalette();

  paletteContainer = document.createElement('div');
  paletteContainer.id = 'yitab-command-palette-root';
  paletteContainer.style.position = 'fixed';
  paletteContainer.style.inset = '0';
  paletteContainer.style.zIndex = '2147483647';
  paletteContainer.style.pointerEvents = 'auto';
  document.documentElement.appendChild(paletteContainer);

  const shadow = paletteContainer.shadowRoot ?? paletteContainer.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        display: block;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 13vh;
        box-sizing: border-box;
        animation: yitab-fade-in 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes yitab-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .palette-box {
        width: 620px;
        max-width: 92vw;
        background: #ffffff;
        border-radius: 14px;
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(15, 23, 42, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.9);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif;
        color: #0f172a;
        animation: yitab-scale-up 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @media (prefers-color-scheme: dark) {
        .palette-box {
          background: #1e293b;
          color: #f8fafc;
          border-color: rgba(255, 255, 255, 0.1);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
        }
      }
      @keyframes yitab-scale-up {
        from { opacity: 0; transform: translateY(-14px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .search-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 18px;
        border-bottom: 1px solid #e2e8f0;
      }
      @media (prefers-color-scheme: dark) {
        .search-bar { border-color: #334155; }
      }
      .logo-icon {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 800;
        flex-shrink: 0;
      }
      .search-input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-size: 15px;
        color: inherit;
        line-height: 1.4;
      }
      .search-input::placeholder {
        color: #94a3b8;
      }
      .kbd-hint {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #64748b;
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #cbd5e1;
      }
      @media (prefers-color-scheme: dark) {
        .kbd-hint {
          background: #334155;
          color: #94a3b8;
          border-color: #475569;
        }
      }
      .filter-tabs {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
        overflow-x: auto;
      }
      @media (prefers-color-scheme: dark) {
        .filter-tabs {
          background: #0f172a;
          border-color: #334155;
        }
      }
      .filter-tab {
        border: none;
        background: transparent;
        font-size: 12px;
        color: #64748b;
        padding: 3px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .filter-tab:hover {
        background: #e2e8f0;
        color: #0f172a;
      }
      @media (prefers-color-scheme: dark) {
        .filter-tab:hover {
          background: #1e293b;
          color: #f8fafc;
        }
      }
      .filter-tab.active {
        background: #4f46e5;
        color: #ffffff;
        font-weight: 600;
      }
      .results-list {
        max-height: 380px;
        overflow-y: auto;
        padding: 6px 8px;
      }
      .result-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 9px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.12s ease;
        position: relative;
      }
      .result-item:hover,
      .result-item.selected {
        background: #f1f5f9;
      }
      @media (prefers-color-scheme: dark) {
        .result-item:hover,
        .result-item.selected {
          background: #334155;
        }
      }
      .result-item.selected {
        box-shadow: inset 0 0 0 1.5px #4f46e5;
      }
      .item-icon-box {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
      }
      @media (prefers-color-scheme: dark) {
        .item-icon-box { background: #0f172a; }
      }
      .item-icon-img {
        width: 16px;
        height: 16px;
        object-fit: contain;
      }
      .item-info {
        flex: 1;
        min-width: 0;
      }
      .item-title {
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.4;
      }
      .item-title mark {
        background: transparent;
        color: #4f46e5;
        font-weight: 700;
      }
      @media (prefers-color-scheme: dark) {
        .item-title mark { color: #818cf8; }
      }
      .item-sub {
        font-size: 11px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      @media (prefers-color-scheme: dark) {
        .item-sub { color: #94a3b8; }
      }
      .kind-tag {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 4px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .kind-tab { background: #e0e7ff; color: #4338ca; }
      .kind-command { background: #fae8ff; color: #86198f; }
      .kind-bookmark { background: #dcfce7; color: #15803d; }
      .kind-history { background: #ffedd5; color: #c2410c; }
      @media (prefers-color-scheme: dark) {
        .kind-tab { background: rgba(99, 102, 241, 0.25); color: #c7d2fe; }
        .kind-command { background: rgba(217, 70, 239, 0.25); color: #f5d0fe; }
        .kind-bookmark { background: rgba(34, 197, 94, 0.25); color: #bbf7d0; }
        .kind-history { background: rgba(249, 115, 22, 0.25); color: #fed7aa; }
      }
      .empty-tip {
        padding: 36px 20px;
        text-align: center;
        color: #94a3b8;
        font-size: 13px;
      }
      .footer-bar {
        padding: 8px 18px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #64748b;
      }
      @media (prefers-color-scheme: dark) {
        .footer-bar {
          background: #0f172a;
          border-color: #334155;
          color: #94a3b8;
        }
      }
      .footer-tips {
        display: flex;
        align-items: center;
        gap: 12px;
      }
    </style>
    <div class="backdrop" id="yitab-palette-backdrop">
      <div class="palette-box">
        <div class="search-bar">
          <div class="logo-icon">Yi</div>
          <input
            type="text"
            class="search-input"
            id="yitab-palette-input"
            placeholder="搜索标签页、书签、历史或快捷指令..."
            autocomplete="off"
            spellcheck="false"
          />
          <span class="kbd-hint">Esc 关闭</span>
        </div>
        <div class="filter-tabs">
          <button class="filter-tab active" data-kind="all">全部</button>
          <button class="filter-tab" data-kind="tab">已开标签</button>
          <button class="filter-tab" data-kind="command">快捷指令</button>
          <button class="filter-tab" data-kind="bookmark">收藏书签</button>
          <button class="filter-tab" data-kind="history">近期历史</button>
        </div>
        <div class="results-list" id="yitab-palette-results">
          <div class="empty-tip">正在加载...</div>
        </div>
        <div class="footer-bar">
          <span id="yitab-palette-count">共 0 项</span>
          <div class="footer-tips">
            <span>↑ ↓ 导航</span>
            <span>↵ 确认执行</span>
            <span>Tab 切换分类</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const inputEl = shadow.getElementById('yitab-palette-input') as HTMLInputElement;
  const resultsEl = shadow.getElementById('yitab-palette-results')!;
  const countEl = shadow.getElementById('yitab-palette-count')!;
  const backdropEl = shadow.getElementById('yitab-palette-backdrop')!;
  const filterBtns = shadow.querySelectorAll<HTMLButtonElement>('.filter-tab');

  // 聚焦输入框
  setTimeout(() => inputEl?.focus(), 50);

  // 点击背景关闭
  backdropEl.addEventListener('click', (e) => {
    if (e.target === backdropEl) {
      closeCommandPalette();
    }
  });

  // 分类按钮点击
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = (btn.getAttribute('data-kind') as 'all' | SearchItemKind) || 'all';
      triggerSearch(currentQuery);
    });
  });

  // 输入监听
  inputEl.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    currentQuery = val;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      triggerSearch(val);
    }, 100);
  });

  // 全键盘导航
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIdx = (selectedIdx + 1) % currentItems.length;
        renderResults();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length > 0) {
        selectedIdx = (selectedIdx - 1 + currentItems.length) % currentItems.length;
        renderResults();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (currentItems.length > 0 && currentItems[selectedIdx]) {
        executeItem(currentItems[selectedIdx]);
      }
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const kinds: ('all' | SearchItemKind)[] = ['all', 'tab', 'command', 'bookmark', 'history'];
      const curIdx = kinds.indexOf(currentFilter);
      const nextKind = kinds[(curIdx + 1) % kinds.length];
      currentFilter = nextKind;
      filterBtns.forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-kind') === nextKind);
      });
      triggerSearch(currentQuery);
      return;
    }
  });

  // 搜索请求
  const triggerSearch = async (query: string) => {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'searchItems',
        query,
        kindFilter: currentFilter,
        limit: 30,
      });
      if (res && res.ok) {
        currentItems = res.items || [];
        selectedIdx = 0;
        renderResults();
      }
    } catch (e) {
      console.warn('[YiTab] search error:', e);
    }
  };

  // 结果渲染
  const renderResults = () => {
    countEl.textContent = `找到 ${currentItems.length} 项`;
    if (currentItems.length === 0) {
      resultsEl.innerHTML = `<div class="empty-tip">未找到匹配项，可尝试搜索其他关键词</div>`;
      return;
    }

    resultsEl.innerHTML = currentItems
      .map((item, idx) => {
        const isSelected = idx === selectedIdx;
        const kindLabel =
          item.kind === 'tab'
            ? '标签'
            : item.kind === 'command'
              ? '指令'
              : item.kind === 'bookmark'
                ? '书签'
                : '历史';

        const kindClass = `kind-${item.kind}`;

        // 高亮关键词
        let highlightedTitle = escapeHtml(item.title);
        if (currentQuery.trim()) {
          const qEsc = escapeHtml(currentQuery.trim());
          const reg = new RegExp(`(${qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          highlightedTitle = highlightedTitle.replace(reg, '<mark>$1</mark>');
        }

        const subtitle = escapeHtml(item.domain || item.description || item.url || '');

        return `
          <div class="result-item ${isSelected ? 'selected' : ''}" data-idx="${idx}">
            <div class="item-icon-box">
              ${
                item.favicon
                  ? `<img class="item-icon-img" src="${escapeHtml(item.favicon)}" alt="" onerror="this.style.display='none'" />`
                  : getCategoryIcon(item.kind)
              }
            </div>
            <div class="item-info">
              <div class="item-title">${highlightedTitle}</div>
              <div class="item-sub">
                ${
                  item.groupTitle
                    ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${escapeHtml(
                        item.groupColor || '#4f46e5',
                      )}"></span><span>${escapeHtml(item.groupTitle)}</span> · `
                    : ''
                }
                <span>${subtitle}</span>
              </div>
            </div>
            <span class="kind-tag ${kindClass}">${kindLabel}</span>
          </div>
        `;
      })
      .join('');

    // 点击执行
    shadow.querySelectorAll<HTMLElement>('.result-item').forEach((el) => {
      const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
      el.addEventListener('click', () => {
        if (currentItems[idx]) {
          executeItem(currentItems[idx]);
        }
      });
    });

    // 自动滚动选中项至视野中央
    const selectedEl = shadow.querySelector<HTMLElement>('.result-item.selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  };

  // 执行具体项
  const executeItem = async (item: SearchItem) => {
    closeCommandPalette();

    if (item.kind === 'tab' && item.tabId != null) {
      await chrome.runtime.sendMessage({
        type: 'switchTab',
        tabId: item.tabId,
        windowId: item.windowId ?? 0,
        closeSelf: false,
      });
      return;
    }

    if (item.kind === 'command' && item.commandAction) {
      const res = await chrome.runtime.sendMessage({
        type: 'executeCommand',
        action: item.commandAction,
      });
      if (res && res.message) {
        alert(res.message);
      }
      return;
    }

    if (item.url) {
      window.location.href = item.url;
    }
  };

  // 初始加载当前所有标签
  triggerSearch('');
}

function getCategoryIcon(kind: SearchItemKind): string {
  if (kind === 'command') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  }
  if (kind === 'bookmark') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`;
  }
  if (kind === 'history') {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
