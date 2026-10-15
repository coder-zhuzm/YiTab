// Automatically captures high-resolution Retina screenshots of YiTab's core UI surfaces.
// Run: node scripts/capture-previews.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

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

  const outDir = resolve(new URL('../docs/images', import.meta.url).pathname);

  // 1. Screenshot Options Page (Retina 2x)
  {
    const { targetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'options target');
    const client = await connect(target.webSocketDebuggerUrl);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 2, mobile: false });
    await until(() => client.evaluate(`document.body.innerText.includes('智能匹配')`), 'options rendered');
    await delay(600);
    const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, 'yitab-preview-options.png'), Buffer.from(data, 'base64'));
    console.log('Captured: docs/images/yitab-preview-options.png');
    client.close();
  }

  // 2. Screenshot Confirm Page (Retina 2x)
  {
    // Ensure interceptMode is 'ask'
    const { targetId: optId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
    const optTarget = await until(async () => (await targets()).find(t => t.id === optId), 'optTarget');
    const optClient = await connect(optTarget.webSocketDebuggerUrl);
    await optClient.evaluate(`chrome.storage.sync.set({ matchMode: 'smart', interceptMode: 'ask' })`);
    optClient.close();

    // Open first tab
    const { targetId: firstTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=slack&tab=discussion` });
    const firstTarget = await until(async () => (await targets()).find(t => t.id === firstTabId), 'first tab');
    const firstClient = await connect(firstTarget.webSocketDebuggerUrl);
    await until(() => firstClient.evaluate('document.readyState === "complete"'), 'first tab loaded');

    // Open duplicate tab -> triggers interception to confirm.html
    const { targetId: dupId } = await browser.call('Target.createTarget', { url: `${serverBase}/issues/42?utm_source=second&tab=discussion` });
    const confirmTarget = await until(async () => (await targets()).find(t => t.id === dupId && t.url.includes('/confirm.html')), 'confirm target');
    const confirmClient = await connect(confirmTarget.webSocketDebuggerUrl);
    await confirmClient.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 2, mobile: false });
    await until(() => confirmClient.evaluate(`document.body.innerText.includes('找到 1 个匹配标签')`), 'confirm rendered');
    await delay(600);
    const { data } = await confirmClient.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, 'yitab-preview-confirm.png'), Buffer.from(data, 'base64'));
    console.log('Captured: docs/images/yitab-preview-confirm.png');
    confirmClient.close();
    firstClient.close();
  }

  // 3. Screenshot SPA Toast Banner (Retina 2x)
  {
    const initialUrl = `${serverBase}/issues/99?tab=code`;
    const { targetId } = await browser.call('Target.createTarget', { url: initialUrl });
    const target = await until(async () => (await targets()).find(t => t.id === targetId), 'spa base tab');
    const clientInitial = await connect(target.webSocketDebuggerUrl);
    await until(() => clientInitial.evaluate('document.readyState === "complete"'), 'spa base loaded');

    const { targetId: spaTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/dashboard` });
    const spaTarget = await until(async () => (await targets()).find(t => t.id === spaTabId && t.url.includes('/dashboard')), 'SPA tab target');
    const clientSpa = await connect(spaTarget.webSocketDebuggerUrl);
    await clientSpa.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 600, deviceScaleFactor: 2, mobile: false });
    await until(() => clientSpa.evaluate('document.readyState === "complete"'), 'SPA tab loaded');
    await delay(500);

    await clientSpa.evaluate(`history.pushState(null, '', '/issues/99?tab=code')`);
    await until(() => clientSpa.evaluate(`Boolean(document.getElementById('yitab-spa-toast-root'))`), 'toast mounted');
    await delay(500);

    const { data } = await clientSpa.call('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 760, y: 0, width: 440, height: 260, scale: 2 },
    });
    await writeFile(join(outDir, 'yitab-preview-spa-toast.png'), Buffer.from(data, 'base64'));
    console.log('Captured: docs/images/yitab-preview-spa-toast.png');
    clientInitial.close();
    clientSpa.close();
  }

  console.log('All screenshots successfully updated!');
} finally {
  browser?.close();
  proc.kill('SIGTERM');
  await new Promise(r => proc.once('exit', r));
  testServer.close();
  await rm(profile, { recursive: true, force: true });
}
