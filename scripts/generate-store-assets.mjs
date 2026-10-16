// Generates production-ready Chrome Web Store assets strictly adhering to Google specifications:
// - Screenshots: 1280 x 800 px (16:10 aspect ratio)
// - Promotional Tile: 440 x 280 px
// - Icon: 128 x 128 px
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const outDir = resolve(new URL('../docs/store-assets', import.meta.url).pathname);
const screenshotsDir = join(outDir, 'screenshots');
await mkdir(screenshotsDir, { recursive: true });

// Copy 128x128 icon
const srcIcon = resolve(new URL('../public/icon.png', import.meta.url).pathname);
await copyFile(srcIcon, join(outDir, 'icon-128.png'));
console.log('✔ Icon prepared: docs/store-assets/icon-128.png (128x128)');

const testServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Issue #42: Optimize dual-layer navigation interception · coder-zhuzm/YiTab</title></head><body><h1>Project Dashboard</h1></body></html>`);
});
await new Promise(r => testServer.listen(0, '127.0.0.1', r));
const serverPort = testServer.address().port;
const serverBase = `http://127.0.0.1:${serverPort}`;

const profile = await mkdtemp(join(tmpdir(), 'yitab-store-'));
const extension = resolve(new URL('../.output/chrome-mv3', import.meta.url).pathname);
const port = 9339;
const proc = spawn(
  '/usr/bin/chromium',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const delay = ms => new Promise(r => setTimeout(r, ms));
async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { const value = await fn(); if (value) return value; } catch {} await delay(100); }
  throw new Error(`Timeout: ${label}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let n = 0; const pending = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result);
    }
  };
  const call = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++n;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    call,
    close: () => ws.close(),
    evaluate: async expression => {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
  };
}

let browser;
try {
  const worker = await until(async () => (await targets()).find(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')), 'extension worker');
  const origin = `chrome-extension://${new URL(worker.url).hostname}`;
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = await connect(browserInfo.webSocketDebuggerUrl);

  // 1. Screenshot 1: Smart Interception Confirm Card (1280x800)
  {
    const { targetId: optId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const optTarget = await until(async () => (await targets()).find(t => t.id === optId), 'optTarget');
    const optClient = await connect(optTarget.webSocketDebuggerUrl);
    await optClient.evaluate(`chrome.storage.sync.set({ matchMode: 'smart', interceptMode: 'ask' })`);
    optClient.close();

    const { targetId: firstTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=slack&tab=discussion` });
    const firstTarget = await until(async () => (await targets()).find(t => t.id === firstTabId), 'first tab');
    const firstClient = await connect(firstTarget.webSocketDebuggerUrl);
    await until(() => firstClient.evaluate('document.readyState === "complete"'), 'first tab loaded');

    const { targetId: dupId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=second&tab=discussion` });
    const confirmTarget = await until(async () => (await targets()).find(t => t.id === dupId && t.url.includes('/confirm.html')), 'confirm target');
    const confirmClient = await connect(confirmTarget.webSocketDebuggerUrl);
    await confirmClient.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(() => confirmClient.evaluate(`document.body.innerText.includes('找到 1 个匹配标签')`), 'confirm rendered');
    await delay(600);
    const { data } = await confirmClient.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshotsDir, '1-smart-interception.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/screenshots/1-smart-interception.png (1280x800)');
    confirmClient.close();
    firstClient.close();
  }

  // Seed Mock Data for NewTab and Palette
  {
    const { targetId: seedTargetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const seedTarget = await until(async () => (await targets()).find(t => t.id === seedTargetId), 'seedTarget');
    const seedClient = await connect(seedTarget.webSocketDebuggerUrl);
    await until(() => seedClient.evaluate('Boolean(window.chrome?.storage?.sync)'), 'seed storage ready');
    await seedClient.evaluate(`(async () => {
      await chrome.storage.sync.set({
        yitab_ai_settings: {
          enabled: true,
          capsuleSummarize: true,
          naturalLanguageJump: true,
          taskAutoGrouping: true,
          bookmarkSmartTagging: true,
        }
      });
      await chrome.storage.local.set({
        yitab_history_recommendations: [
          {
            domain: 'github.com',
            primaryUrl: 'https://github.com/coder-zhuzm/YiTab',
            title: 'GitHub - coder-zhuzm/YiTab',
            score: 95,
            capsule: {
              url: 'https://github.com/coder-zhuzm/YiTab/pull/42',
              title: 'PR #42: 重构智能双层拦截引擎与新标签页启动器',
              cleanTitle: 'PR #42: 智能双层拦截'
            }
          },
          {
            domain: 'jira.corp.internal',
            primaryUrl: 'https://jira.corp.internal',
            title: 'Jira Software Internal Issue Tracker',
            score: 91,
            capsule: {
              url: 'https://jira.corp.internal/browse/PROJ-8899',
              title: 'PROJ-8899 订单超时支付状态回滚异常排查',
              cleanTitle: 'PROJ-8899: 超时排查'
            }
          },
          {
            domain: 'localhost:8080',
            primaryUrl: 'http://localhost:8080',
            title: '本地开发调试服务 :8080',
            score: 88,
            capsule: {
              url: 'http://localhost:8080/debug/pprof',
              title: 'Go Runtime pprof Performance Profile',
              cleanTitle: 'pprof 性能分析'
            }
          },
          {
            domain: 'console.aliyun.com',
            primaryUrl: 'https://console.aliyun.com',
            title: '阿里云管理控制台',
            score: 85,
            capsule: {
              url: 'https://console.aliyun.com/ecs/detail/i-bp18',
              title: 'ECS 实例详情 (i-bp18...) 生产集群 Node-02',
              cleanTitle: 'ECS 生产节点-02'
            }
          }
        ],
        yitab_session_snapshots: [
          {
            id: 'snap_yesterday',
            name: '昨日下班工作现场 (结算排错与架构重构)',
            createdAt: Date.now() - 3600 * 14 * 1000,
            tabs: [
              { id: 1, title: 'GitHub PR #42', url: 'https://github.com/coder-zhuzm/YiTab/pull/42' },
              { id: 2, title: 'Jira PROJ-8899', url: 'https://jira.corp.internal/browse/PROJ-8899' },
              { id: 3, title: 'Aliyun Console ECS', url: 'https://console.aliyun.com' },
              { id: 4, title: 'Localhost Grafana :3000', url: 'http://localhost:3000' }
            ]
          }
        ]
      });

      try {
        const otherFolder = await chrome.bookmarks.create({ title: '常用研发工具' });
        await chrome.bookmarks.create({ parentId: otherFolder.id, title: 'GitHub 组织仓库', url: 'https://github.com' });
        await chrome.bookmarks.create({ parentId: otherFolder.id, title: 'GitLab 内部代码托管', url: 'https://gitlab.corp.internal' });
        await chrome.bookmarks.create({ parentId: otherFolder.id, title: 'Jenkins CI/CD 流水线', url: 'http://ci.oa:8080' });
        await chrome.bookmarks.create({ parentId: otherFolder.id, title: 'Sentry 错误追踪监控', url: 'https://sentry.io' });

        const docFolder = await chrome.bookmarks.create({ title: '技术文档与规范' });
        await chrome.bookmarks.create({ parentId: docFolder.id, title: 'React 18 官方文档', url: 'https://react.dev' });
        await chrome.bookmarks.create({ parentId: docFolder.id, title: 'WXT 扩展框架指南', url: 'https://wxt.dev' });
        await chrome.bookmarks.create({ parentId: docFolder.id, title: 'MDN Web 开发技术', url: 'https://developer.mozilla.org' });
        await chrome.bookmarks.create({ parentId: docFolder.id, title: 'Ant Design 5 组件库', url: 'https://ant.design' });
      } catch {}
    })()`);
    seedClient.close();
  }

  // 2. Screenshot 2: Smart Launcher New Tab (1280x800)
  {
    const { targetId } = await browser.call('Target.createTarget', { url: `${origin}/newtab.html` });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'newtab target');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(() => client.evaluate(`document.body.innerText.includes('猜你想开') && document.body.innerText.includes('常用研发工具')`), 'newtab fully rendered');
    await delay(800);
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshotsDir, '2-smart-launcher-newtab.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/screenshots/2-smart-launcher-newtab.png (1280x800)');
    client.close();
  }

  // 3. Screenshot 3: Global Command Palette (1280x800)
  {
    const { targetId } = await browser.call('Target.createTarget', { url: `${serverBase}/dashboard` });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'palette target tab');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(() => client.evaluate('document.readyState === "complete"'), 'target loaded');
    await delay(300);

    await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true }))`);
    await until(() => client.evaluate(`Boolean(document.getElementById('yitab-command-palette-root'))`), 'palette opened');
    await delay(600);

    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshotsDir, '3-command-palette.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/screenshots/3-command-palette.png (1280x800)');
    client.close();
  }

  // 4. Screenshot 4: Bookmarks Governance & Diagnostics (1280x800)
  {
    const { targetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'options target for bookmarks');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(() => client.evaluate(`document.body.innerText.includes('书签健康与生态治理')`), 'options loaded');
    await client.evaluate(`(() => {
      const tabHeader = [...document.querySelectorAll('.ant-tabs-tab')].find(el => el.innerText.includes('书签健康'));
      tabHeader?.click();
    })()`);
    await delay(600);
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshotsDir, '4-bookmarks-governance.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/screenshots/4-bookmarks-governance.png (1280x800)');
    client.close();
  }

  // 5. Screenshot 5: Matching Options & Fine-grained Rules (1280x800)
  {
    const { targetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'options target');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until(() => client.evaluate(`document.body.innerText.includes('智能匹配')`), 'options rendered');
    await delay(600);
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(screenshotsDir, '5-options-settings.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/screenshots/5-options-settings.png (1280x800)');
    client.close();
  }

  // 6. Generate Promotional Tile (440x280)
  {
    const promoHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 440px; height: 280px; overflow: hidden;
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #fff; display: flex; flex-direction: column; justify-content: space-between;
    padding: 32px; position: relative;
  }
  .bg-glow {
    position: absolute; right: -40px; top: -40px; width: 220px; height: 220px;
    background: radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, transparent 70%);
  }
  .header { display: flex; align-items: center; gap: 16px; z-index: 1; }
  .logo-box {
    width: 60px; height: 60px; background: #4f46e5; border-radius: 14px;
    display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3); border: 2px solid rgba(255, 255, 255, 0.2);
  }
  .logo-bar { width: 36px; height: 14px; background: #e0e7ff; border-radius: 3px; }
  .brand-title { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .brand-sub { font-size: 13px; color: #c7d2fe; margin-top: 2px; }
  .features { display: flex; flex-wrap: wrap; gap: 8px; z-index: 1; margin-top: 12px; }
  .tag {
    background: rgba(255, 255, 255, 0.12); backdrop-filter: blur(8px);
    border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px;
    padding: 5px 10px; font-size: 11px; font-weight: 500; color: #e0e7ff;
  }
  .footer {
    display: flex; justify-content: space-between; align-items: center; z-index: 1;
    font-size: 11px; color: #a5b4fc; border-top: 1px solid rgba(255, 255, 255, 0.15);
    padding-top: 12px;
  }
  .badge-privacy {
    background: #10b981; color: #fff; font-weight: 600; font-size: 10px;
    padding: 3px 8px; border-radius: 20px;
  }
</style>
</head>
<body>
  <div class="bg-glow"></div>
  <div class="header">
    <div class="logo-box">
      <div class="logo-bar"></div>
      <div class="logo-bar"></div>
    </div>
    <div>
      <div class="brand-title">YiTab 一签</div>
      <div class="brand-sub">Chrome 标签页去重与极速启动套件</div>
    </div>
  </div>
  <div class="features">
    <div class="tag">⚡ 智能去重拦截</div>
    <div class="tag">⌨️ Alt+K 全局面板</div>
    <div class="tag">📑 极速新标签页</div>
    <div class="tag">🧹 书签重复清理</div>
  </div>
  <div class="footer">
    <span>100% 离线本地运算 · 零数据上报</span>
    <span class="badge-privacy">PRIVACY FIRST</span>
  </div>
</body>
</html>`;
    const { targetId } = await browser.call('Target.createTarget', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(promoHtml) });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'promo target');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, 'promo-tile-440x280.png'), Buffer.from(data, 'base64'));
    console.log('✔ Captured: docs/store-assets/promo-tile-440x280.png (440x280)');
    client.close();
  }

  console.log('\n🎉 All Chrome Web Store visual assets generated successfully!');
} finally {
  browser?.close();
  proc.kill('SIGTERM');
  await new Promise(r => proc.once('exit', r));
  testServer.close();
  await delay(300);
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {}
}
