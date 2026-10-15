import type { TabInfo } from '@/lib/match';

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    // 监听来自 background 的 SPA 路由重复提醒
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === 'yitab_spa_duplicate') {
        showDuplicateToast(msg.candidateUrl, msg.targetTab);
        sendResponse({ ok: true });
      }
    });
  },
});

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
