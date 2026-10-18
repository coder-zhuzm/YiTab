// Automatically captures high-resolution Retina screenshots of YiTab's core UI surfaces.
// Each surface is captured twice: light (default file name) and dark (`-dark` suffix).
// Run: node scripts/capture-previews.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

/** Chromium 内核可执行文件：优先 CHROME_PATH，其次各平台常见安装位置。
 *  注意：Chrome 137+ 的品牌版已移除 --load-extension，需用 Chrome for Testing / Chromium。 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  // Playwright 缓存的 Chrome for Testing（支持 --load-extension）
  ...['1223'].flatMap((v) => [
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-${v}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    `${process.env.HOME}/.cache/ms-playwright/chromium-${v}/chrome-linux64/chrome`,
  ]),
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  throw new Error(`未找到 Chromium 内核，请设置 CHROME_PATH。已尝试：\n${CHROME_CANDIDATES.join('\n')}`);
}

const testServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html><html><head><title>Issue #42: Optimize dual-layer navigation interception · coder-zhuzm/YiTab</title></head><body><h1>Project Dashboard</h1></body></html>`);
});
await new Promise(r => testServer.listen(0, '127.0.0.1', r));
const serverPort = testServer.address().port;
const serverBase = `http://127.0.0.1:${serverPort}`;

const profile = await mkdtemp(join(tmpdir(), 'yitab-preview-'));
const extension = resolve(new URL('../.output/chrome-mv3', import.meta.url).pathname);
const port = 9338;
const proc = spawn(
  chromePath,
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
    ws,
    call,
    close: () => ws.close(),
    evaluate: async expression => {
      const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    },
  };
}

const outDir = resolve(new URL('../docs/images', import.meta.url).pathname);
const THEMES = ['light', 'dark'];

/** 显式模拟系统配色，避免受构建机自身主题影响。 */
async function emulateTheme(client, theme) {
  await client.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme }],
  });
}

function fileFor(name, theme) {
  return join(outDir, theme === 'dark' ? `${name}-dark.png` : `${name}.png`);
}

async function saveScreenshot(client, name, theme, extra = {}) {
  await delay(600);
  const { data } = await client.call('Page.captureScreenshot', { format: 'png', ...extra });
  await writeFile(fileFor(name, theme), Buffer.from(data, 'base64'));
  console.log(`Captured: docs/images/${theme === 'dark' ? `${name}-dark.png` : `${name}.png`}`);
}

/** 打开页面 → 设置配色 → 等待渲染 → 截图。 */
async function capturePage({ url, name, width, height, readyText, afterReady, clip }) {
  for (const theme of THEMES) {
    const { targetId } = await browser.call('Target.createTarget', { url });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), `${name} target`);
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
    await emulateTheme(client, theme);
    // 配色需在渲染前生效：重新加载一次，避免 React 首帧沿用系统主题
    await client.call('Page.reload', { ignoreCache: false });
    await until(() => client.evaluate('document.readyState === "complete"'), `${name} reloaded`);
    await until(() => client.evaluate(`document.body.innerText.includes(${JSON.stringify(readyText)})`), `${name} rendered`);
    if (afterReady) await afterReady(client);
    await saveScreenshot(client, name, theme, clip ? { clip } : {});
    client.close();
    await browser.call('Target.closeTarget', { targetId });
  }
}

let browser;
try {
  const worker = await until(
    async () =>
      (await targets()).find(
        (t) => t.type === 'service_worker' && t.url.endsWith('/background.js'),
      ),
    'extension worker',
  );
  const origin = `chrome-extension://${new URL(worker.url).hostname}`;
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = await connect(browserInfo.webSocketDebuggerUrl);

  // 1. Options Page
  await capturePage({
    url: `${origin}/options.html`,
    name: 'yitab-preview-options',
    width: 1280,
    height: 960,
    readyText: '去重拦截策略',
  });

  // 2. Confirm Page（先准备一次重复打开，产生 confirm.html）
  {
    const { targetId: optId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const optTarget = await until(async () => (await targets()).find(t => t.id === optId), 'optTarget');
    const optClient = await connect(optTarget.webSocketDebuggerUrl);
    await optClient.evaluate(`chrome.storage.sync.set({ matchMode: 'smart', interceptMode: 'ask' })`);
    optClient.close();
    await browser.call('Target.closeTarget', { targetId: optId });

    const { targetId: firstTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=slack&tab=discussion` });
    const firstTarget = await until(async () => (await targets()).find(t => t.id === firstTabId), 'first tab');
    const firstClient = await connect(firstTarget.webSocketDebuggerUrl);
    await until(() => firstClient.evaluate('document.readyState === "complete"'), 'first tab loaded');

    const { targetId: dupId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=second&tab=discussion` });
    const confirmTarget = await until(async () => (await targets()).find(t => t.id === dupId && t.url.includes('/confirm.html')), 'confirm target');

    for (const theme of THEMES) {
      const confirmClient = await connect(confirmTarget.webSocketDebuggerUrl);
      await confirmClient.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 2, mobile: false });
      await emulateTheme(confirmClient, theme);
      await confirmClient.call('Page.reload', { ignoreCache: false });
      await until(() => confirmClient.evaluate('document.readyState === "complete"'), 'confirm reloaded');
      await until(() => confirmClient.evaluate(`document.body.innerText.includes('找到 1 个匹配标签')`), 'confirm rendered');
      await saveScreenshot(confirmClient, 'yitab-preview-confirm', theme);
      confirmClient.close();
    }
    firstClient.close();
  }

  // 3. SPA Toast Banner（pushState 后浮窗才出现，故配色需在 pushState 之前设置）
  {
    for (const theme of THEMES) {
      const { targetId: baseId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/99?tab=code` });
      const baseTarget = await until(async () => (await targets()).find(t => t.id === baseId), 'spa base tab');
      const clientInitial = await connect(baseTarget.webSocketDebuggerUrl);
      await until(() => clientInitial.evaluate('document.readyState === "complete"'), 'spa base loaded');

      const { targetId: spaTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/dashboard` });
      const spaTarget = await until(async () => (await targets()).find(t => t.id === spaTabId && t.url.includes('/dashboard')), 'SPA tab target');
      const clientSpa = await connect(spaTarget.webSocketDebuggerUrl);
      await clientSpa.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 600, deviceScaleFactor: 2, mobile: false });
      await emulateTheme(clientSpa, theme);
      await until(() => clientSpa.evaluate('document.readyState === "complete"'), 'SPA tab loaded');
      await delay(400);

      await clientSpa.evaluate(`history.pushState(null, '', '/issues/99?tab=code')`);
      await until(() => clientSpa.evaluate(`Boolean(document.getElementById('yitab-spa-toast-root'))`), 'toast mounted');

      await saveScreenshot(clientSpa, 'yitab-preview-spa-toast', theme, {
        clip: { x: 760, y: 0, width: 440, height: 260, scale: 2 },
      });
      clientInitial.close();
      clientSpa.close();
      await browser.call('Target.closeTarget', { targetId: baseId });
      await browser.call('Target.closeTarget', { targetId: spaTabId });
    }
  }

  // 4. Popup UI
  await capturePage({
    url: `${origin}/popup.html`,
    name: 'yitab-preview-popup',
    width: 400,
    height: 580,
    readyText: '域名智能聚合',
  });

  // 5. Global Command Palette（Alt+K 触发，需在触发前设定配色）
  {
    for (const theme of THEMES) {
      const { targetId } = await browser.call('Target.createTarget', { url: `${serverBase}/dashboard` });
      const target = await until(async () => (await targets()).find(t => t.id === targetId), 'palette target tab');
      const client = await connect(target.webSocketDebuggerUrl);
      await client.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 720, deviceScaleFactor: 2, mobile: false });
      await emulateTheme(client, theme);
      await until(() => client.evaluate('document.readyState === "complete"'), 'target loaded');
      await delay(400);

      await client.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true }))`);
      await until(() => client.evaluate(`Boolean(document.getElementById('yitab-command-palette-root'))`), 'palette opened');

      await saveScreenshot(client, 'yitab-preview-palette', theme);
      client.close();
      await browser.call('Target.closeTarget', { targetId });
    }
  }

  // 6. Bookmarks Health & Maintenance in Options
  await capturePage({
    url: `${origin}/options.html`,
    name: 'yitab-preview-bookmarks',
    width: 1280,
    height: 960,
    readyText: '书签健康与生态治理',
    afterReady: async (client) => {
      await client.evaluate(`(() => {
        const tabHeader = [...document.querySelectorAll('.ant-tabs-tab')].find(el => el.innerText.includes('书签健康'));
        tabHeader?.click();
      })()`);
      await delay(600);
    },
  });

  // 7. New Tab Smart Launcher
  {
    // Seed rich mock data into chrome.storage.local for an authentic, realistic preview
    const { targetId: seedTargetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const seedTarget = await until(async () => (await targets()).find(t => t.id === seedTargetId), 'seedTarget');
    const seedClient = await connect(seedTarget.webSocketDebuggerUrl);
    await until(() => seedClient.evaluate('Boolean(window.chrome?.storage?.sync)'), 'seed storage ready');
    await seedClient.evaluate(`(async () => {
      // 1. Seed AI Settings
      await chrome.storage.sync.set({
        yitab_ai_settings: {
          enabled: true,
          capsuleSummarize: true,
          naturalLanguageJump: true,
          taskAutoGrouping: true,
          bookmarkSmartTagging: true,
          morningBriefing: true,
          pauseOnBattery: true,
        }
      });

      // 2. Seed History URLs
      const mockHistoryUrls = [
        'https://github.com/coder-zhuzm/YiTab/pull/42',
        'https://jira.corp.internal/browse/PROJ-8899',
        'http://localhost:8080/debug/pprof',
        'https://console.aliyun.com/ecs/detail/i-bp18',
        'https://v2ex.com/t/1089221',
        'https://developer.chrome.com/docs/extensions/reference/api/tabs'
      ];
      for (const url of mockHistoryUrls) {
        try {
          await chrome.history.addUrl({ url });
        } catch {}
      }

      // 3. Seed Rich Recommendation Cards and Snapshots
      await chrome.storage.local.set({
        yitab_recommendations_cache: [
          {
            domain: 'github.com',
            primaryUrl: 'https://github.com',
            title: 'GitHub: Let’s build from here',
            score: 96,
            capsule: {
              url: 'https://github.com/coder-zhuzm/YiTab/pull/42',
              title: 'Pull Request #42: Optimize dual-layer navigation interception',
              cleanTitle: 'PR #42: 优化双层拦截'
            }
          },
          {
            domain: 'jira.corp.internal',
            primaryUrl: 'https://jira.corp.internal',
            title: 'Jira Software · 企业敏捷看板',
            score: 92,
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
          },
          {
            domain: 'v2ex.com',
            primaryUrl: 'https://v2ex.com',
            title: 'V2EX 技术创意社区',
            score: 79,
            capsule: {
              url: 'https://v2ex.com/t/1089221',
              title: '探讨 Chromium MV3 下端侧大模型 API 的资源回收最佳实践',
              cleanTitle: 'Chromium MV3 端侧AI探讨'
            }
          },
          {
            domain: 'developer.chrome.com',
            primaryUrl: 'https://developer.chrome.com',
            title: 'Chrome for Developers',
            score: 74,
            capsule: {
              url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
              title: 'chrome.tabs API Documentation Reference',
              cleanTitle: 'chrome.tabs API 参考'
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

      // 3. Seed Mock Bookmarks
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

        const opsFolder = await chrome.bookmarks.create({ title: '运维与内网环境' });
        await chrome.bookmarks.create({ parentId: opsFolder.id, title: 'K8s 容器管理平台', url: 'http://10.20.0.15:30000' });
        await chrome.bookmarks.create({ parentId: opsFolder.id, title: 'Grafana 链路监控看板', url: 'http://192.168.1.100:3000' });
        await chrome.bookmarks.create({ parentId: opsFolder.id, title: '内网知识库与 Wiki', url: 'http://wiki.corp.internal' });
      } catch (err) {
        console.error('Failed to create mock bookmarks:', err);
      }
    })()`);
    seedClient.close();
    await browser.call('Target.closeTarget', { targetId: seedTargetId });

    await capturePage({
      url: `${origin}/newtab.html`,
      name: 'yitab-preview-newtab',
      width: 1280,
      height: 1040,
      readyText: '常用研发工具',
    });
  }

  console.log('All screenshots successfully updated!');
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
