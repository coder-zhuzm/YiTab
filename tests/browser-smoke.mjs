// Isolated Chromium profile: never modifies the user's browser or settings.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// Create a lightweight local HTTP server for serving real HTML documents (for SPA and committed navigation)
const testServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><head><title>YiTab Test App</title></head><body><h1>YiTab App</h1></body></html>');
});
await new Promise(r => testServer.listen(0, '127.0.0.1', r));
const serverPort = testServer.address().port;
const serverBase = `http://127.0.0.1:${serverPort}`;

const profile = await mkdtemp(join(tmpdir(), 'yitab-test-'));
const extension = resolve(new URL('../.output/chrome-mv3', import.meta.url).pathname);
const port = 9337;
const proc = spawn('/usr/bin/chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, 'about:blank'], { stdio: 'ignore' });
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
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { ok, fail } = pending.get(m.id); pending.delete(m.id); m.error ? fail(new Error(JSON.stringify(m.error))) : ok(m.result); } };
  const call = (method, params = {}) => new Promise((ok, fail) => { const id = ++n; pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params })); });
  return { call, close: () => ws.close(), evaluate: async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  } };
}

let browser, options, doc1, confirm, clientSpa;
try {
  const worker = await until(async () => (await targets()).find(t => t.type === 'service_worker' && t.url.startsWith('chrome-extension://')), 'extension worker');
  const origin = `chrome-extension://${new URL(worker.url).hostname}`;
  const browserInfo = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser = await connect(browserInfo.webSocketDebuggerUrl);

  // --- Part 1: Options UI & Sequential Settings Persistence ---
  const { targetId } = await browser.call('Target.createTarget', { url: `${origin}/options.html` });
  const optionTarget = await until(async () => (await targets()).find(t => t.id === targetId), 'options target');
  options = await connect(optionTarget.webSocketDebuggerUrl);
  const text = await until(() => options.evaluate(`document.body.innerText.includes('智能匹配') && document.body.innerText`), 'options UI');
  assert.ok(text.includes('网站例外规则'));
  assert.ok(text.includes('同路径'));
  assert.ok(text.includes('刷新页面时忽略拦截') || text.includes('刷新控制'));
  await options.evaluate(`chrome.storage.sync.set({matchMode:'smart',interceptMode:'ask',whitelist:[],siteRules:[],ignoreReload:true})`);

  // Assert real Radio updates storage, then preserve changed value on next update.
  await options.call('Page.reload');
  await until(() => options.evaluate(`document.querySelector('input[value="path"]') && !document.querySelector('input[value="path"]').disabled`), 'radio ready');
  await options.evaluate(`document.querySelector('input[value="path"]').click()`);
  await until(() => options.evaluate(`chrome.storage.sync.get('matchMode').then(s=>s.matchMode==='path')`), 'path saved');
  await until(() => options.evaluate(`!document.querySelector('input[value="ask"]').disabled`), 'save finished');
  await options.evaluate(`document.querySelector('input[value="auto"]').click()`);
  await until(() => options.evaluate(`chrome.storage.sync.get(['matchMode','interceptMode']).then(s=>s.matchMode==='path'&&s.interceptMode==='auto')`), 'sequential save');
  assert.ok((await options.evaluate(`document.body.innerText`)).includes('可能跳到不同内容'));

  // Reset to smart + ask mode for duplicate detection tests
  await options.evaluate(`chrome.storage.sync.set({matchMode:'smart',interceptMode:'ask'})`);
  await delay(200);

  // --- Part 2: Committed Navigation & Confirmation Page Redesign ---
  await browser.call('Target.createTarget', { url: `${serverBase}/docA?utm_source=first` });
  const doc1Target = await until(async () => (await targets()).find(t => t.url.includes('utm_source=first')), 'first document');
  doc1 = await connect(doc1Target.webSocketDebuggerUrl);
  await until(() => doc1.evaluate('document.readyState === "complete"'), 'first doc loaded');

  const { targetId: duplicateId } = await browser.call('Target.createTarget', { url: `${serverBase}/docA?utm_source=second` });
  const duplicate = await until(async () => (await targets()).find(t => t.id === duplicateId && t.url.includes('/confirm.html')), 'confirmation');
  confirm = await connect(duplicate.webSocketDebuggerUrl);
  const confirmText = await until(() => confirm.evaluate(`document.body.innerText.includes('找到 1 个匹配标签') && document.body.innerText`), 'match count rendered');
  assert.ok(confirmText.includes('智能匹配'), 'match mode rendered');
  assert.ok(confirmText.includes('切换到所选标签'), 'sticky header switch button');
  assert.ok(confirmText.includes('仍要打开'), 'open anyway button');
  assert.ok(confirmText.includes('复制完整地址'), 'copy full address link');
  assert.ok(confirmText.includes('查看详情'), 'view details link');

  // Verify "仍要打开" navigation preserves target without closing existing tabs
  await confirm.evaluate(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('仍要打开')).click()`);
  await until(async () => (await targets()).find(t => t.id === duplicateId && t.url.includes('utm_source=second')), 'open anyway preserves target');
  assert.ok((await targets()).find(t => t.url.includes('utm_source=first')), 'first document remains open');

  // Verify reload does NOT trigger interception on doc1 when ignoreReload is enabled (default)
  await doc1.call('Page.reload');
  await delay(500);
  const doc1AfterReload = (await targets()).find(t => t.id === doc1Target.id);
  assert.ok(doc1AfterReload.url.includes('utm_source=first'), 'reload preserves doc1 without intercept');
  assert.ok(!doc1AfterReload.url.includes('/confirm.html'), 'reload does not bounce doc1 to confirm.html');

  // Verify reload DOES trigger interception on doc1 when ignoreReload is explicitly turned off
  await options.evaluate(`chrome.storage.sync.set({ ignoreReload: false })`);
  await delay(300);
  await doc1.call('Page.reload');
  await until(async () => (await targets()).find(t => t.id === doc1Target.id && t.url.includes('/confirm.html')), 'reload intercepted when ignoreReload is false');
  // Re-enable ignoreReload
  await options.evaluate(`chrome.storage.sync.set({ ignoreReload: true })`);
  await delay(300);

  // --- Part 3: SPA Navigation & Non-intrusive in-page Toast ---
  const { targetId: spaTabId } = await browser.call('Target.createTarget', { url: `${serverBase}/spa?page=home` });
  const spaTarget = await until(async () => (await targets()).find(t => t.id === spaTabId && t.url.includes('page=home')), 'SPA target tab');
  clientSpa = await connect(spaTarget.webSocketDebuggerUrl);
  await until(() => clientSpa.evaluate('document.readyState === "complete"'), 'SPA doc loaded');
  await delay(500);

  // Trigger SPA pushState to match docA
  await clientSpa.evaluate(`history.pushState(null, '', '/docA?utm_source=spa_nav')`);
  await until(async () => clientSpa.evaluate(`Boolean(document.getElementById('yitab-spa-toast-root'))`), 'SPA toast mounted');
  const toastCardText = await clientSpa.evaluate(`document.getElementById('yitab-spa-toast-root').shadowRoot.querySelector('.card').innerText`);
  assert.ok(toastCardText.includes('已有匹配标签'), 'toast header');
  assert.ok(toastCardText.includes('智能匹配'), 'toast reason');
  assert.ok(toastCardText.includes('切换到该标签'), 'switch button');
  assert.ok(toastCardText.includes('留在本页'), 'stay button');

  // Click '留在本页'
  await clientSpa.evaluate(`document.getElementById('yitab-spa-toast-root').shadowRoot.getElementById('yitab-dismiss').click()`);
  await until(async () => !(await clientSpa.evaluate(`Boolean(document.getElementById('yitab-spa-toast-root'))`)), 'SPA toast dismissed');

  // --- Part 4: Popup UI (Organize, Search, Snapshots, Export) ---
  const { targetId: popupId } = await browser.call('Target.createTarget', { url: `${origin}/popup.html` });
  const popupTarget = await until(async () => (await targets()).find(t => t.id === popupId), 'popup target');
  const popupClient = await connect(popupTarget.webSocketDebuggerUrl);
  const popupText = await until(() => popupClient.evaluate(`document.body.innerText.includes('域名智能聚合') && document.body.innerText`), 'popup UI rendered');
  assert.ok(popupText.includes('标签归拢'), 'popup organize tab');
  assert.ok(popupText.includes('快速检索'), 'popup search tab');
  assert.ok(popupText.includes('书签健康'), 'popup bookmarks tab');
  assert.ok(popupText.includes('会话快照'), 'popup snapshots tab');
  assert.ok(popupText.includes('休眠') || popupText.includes('内存'), 'tab memory optimizer');
  popupClient.close();

  // --- Part 5: In-Page Command Palette (Alt+K) & Unified Search ---
  await clientSpa.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', altKey: true, bubbles: true, cancelable: true }))`);
  await until(() => clientSpa.evaluate(`Boolean(document.getElementById('yitab-command-palette-root'))`), 'command palette mounted on Alt+K');
  const paletteText = await clientSpa.evaluate(`document.getElementById('yitab-command-palette-root').shadowRoot.querySelector('.palette-box').innerText`);
  assert.ok(paletteText.includes('全部'), 'palette filter tab all');
  assert.ok(paletteText.includes('已开标签'), 'palette filter tab tabs');
  assert.ok(paletteText.includes('快捷指令'), 'palette filter tab commands');

  // Input search query
  await clientSpa.evaluate(`(() => {
    const root = document.getElementById('yitab-command-palette-root')?.shadowRoot;
    const input = root?.getElementById('yitab-palette-input');
    if (input) {
      input.value = '归拢';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await until(() => clientSpa.evaluate(`
    Boolean(document.getElementById('yitab-command-palette-root')?.shadowRoot?.querySelector('.palette-box')?.innerText.includes('按域名智能归拢标签'))
  `), 'search results filtered for command');

  // Close palette on Esc
  await clientSpa.evaluate(`(() => {
    const root = document.getElementById('yitab-command-palette-root')?.shadowRoot;
    const input = root?.getElementById('yitab-palette-input');
    input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  await until(async () => !(await clientSpa.evaluate(`Boolean(document.getElementById('yitab-command-palette-root'))`)), 'palette dismissed on Esc');

  // Verify background executeCommand via options page
  const cmdResult = await options.evaluate(`
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'executeCommand', action: 'auto_group' }, res => resolve(res));
    })
  `);
  assert.ok(cmdResult && cmdResult.ok, 'executeCommand returns ok');

  console.log('PASS: options render, controlled Radio sequential saves, broad-mode warning, smart interception, match reason, open-anyway keeps both tabs, SPA in-page toast detection and dismiss, popup UI tabs, in-page Command Palette Alt+K spotlight search, and background command execution.');
} finally {
  options?.close();
  doc1?.close();
  confirm?.close();
  clientSpa?.close();
  browser?.close();
  proc.kill('SIGTERM');
  await new Promise(r => proc.once('exit', r));
  testServer.close();
  await rm(profile, { recursive: true, force: true });
}
