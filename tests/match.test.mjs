import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchDuplicate,
  resolveRule,
  inWhitelist,
  computeMatchKey,
  shouldSkipNavigation,
} from '../src/lib/match.ts';
import { sanitizeSettings, DEFAULTS, getSettings, setSettings } from '../src/lib/settings.ts';
const base = 'https://example.com';
const config = (mode = 'smart', siteRules = [], whitelist = []) => ({ ...DEFAULTS, matchMode: mode, siteRules, whitelist });
const cases = [
  ['different routes', '/article/1', '/article/2', 'smart', false],
  ['same page', '/article/1', '/article/1', 'smart', true],
  ['utm noise', '/a?utm_source=x', '/a?utm_source=y', 'smart', true],
  ['click tracking', '/a?fbclid=x&gclid=z', '/a', 'smart', true],
  ['unknown parameter preserved', '/a?source=x', '/a?source=y', 'smart', false],
  ['video IDs', '/watch?v=A', '/watch?v=B', 'smart', false],
  ['search terms', '/search?q=react', '/search?q=vue', 'smart', false],
  ['pages', '/list?page=1', '/list?page=2', 'smart', false],
  ['query order', '/a?a=1&b=2', '/a?b=2&a=1', 'smart', true],
  ['same-key order retained', '/a?a=1&a=2', '/a?a=2&a=1', 'smart', false],
  ['anchor ignored', '/a#comments', '/a#intro', 'smart', true],
  ['hash slash routes', '/#/project/1', '/#/project/2', 'smart', false],
  ['hashbang routes', '/#!/project/1', '/#!/project/2', 'path', false],
  ['complex hash retained', '/#project?id=1', '/#project?id=2', 'smart', false],
  ['trailing slash preserved', '/a', '/a/', 'smart', false],
  ['path ignores params', '/watch?v=A', '/watch?v=B', 'path', true],
  ['path different routes', '/a', '/b', 'path', false],
  ['path preserves route hash', '/#/a', '/#/b', 'path', false],
  ['exact preserves tracking', '/a?utm_source=x', '/a?utm_source=y', 'url', false],
  ['exact preserves anchors', '/a#x', '/a#y', 'url', false],
  ['exact preserves param order', '/a?a=1&b=2', '/a?b=2&a=1', 'url', false],
  ['domain broad', '/a?x=1', '/b?x=2', 'domain', true],
  ['duplicate params not lost', '/a?x=1&x=2', '/a?x=2', 'smart', false],
];
for (const [label, a, b, mode, expected] of cases) test(label, () => assert.equal(!!matchDuplicate(base + a, base + b, config(mode)), expected));
test('smart keeps protocol port and hostname', () => {
  for (const other of ['http://example.com/a', 'https://example.com:8443/a', 'https://www.example.com/a', 'https://sub.example.com/a']) assert.equal(matchDuplicate(base + '/a', other, config()), null);
});
test('internal or invalid URLs never match', () => {
  for (const u of ['chrome://settings', 'file:///a', 'not-a-url', 'javascript:alert(1)']) assert.equal(matchDuplicate(u, u, config('domain')), null);
});
test('legacy www domain matching', () => assert.ok(matchDuplicate(base + '/a', 'https://www.example.com/b', config('domain'))));
const rule = (domain, mode = 'smart', includeSubdomains = false, ignoredParams = []) => ({ domain, mode, includeSubdomains, ignoredParams });
test('site-specific tracking parameters', () => {
  const c = config('url', [rule('example.com', 'smart', false, ['share'])]);
  assert.ok(matchDuplicate(base + '/a?share=1&id=4', base + '/a?share=2&id=4', c));
  assert.equal(matchDuplicate(base + '/a?share=1&id=4', base + '/a?share=2&id=5', c), null);
});
test('exact site does not cover subdomain', () => assert.equal(resolveRule('https://sub.example.com', config('url', [rule('example.com', 'domain')])).mode, 'url'));
test('subdomains require explicit switch and boundaries', () => {
  const c = config('url', [rule('example.com', 'domain', true)]);
  assert.equal(resolveRule('https://sub.example.com', c).mode, 'domain');
  assert.equal(resolveRule('https://notexample.com', c).mode, 'url');
});
test('most specific site and exact take precedence', () => {
  const c = config('url', [rule('example.com', 'domain', true), rule('sub.example.com', 'path', true), rule('sub.example.com', 'smart')]);
  assert.equal(resolveRule('https://sub.example.com', c).mode, 'smart');
  assert.equal(resolveRule('https://nested.sub.example.com', c).mode, 'path');
});
test('whitelist takes priority even with site rule', () => {
  assert.equal(matchDuplicate(base + '/a', base + '/b', config('domain', [rule('example.com', 'domain')], ['example.com'])), null);
  assert.ok(inWhitelist('https://www.example.com', ['example.com']));
  assert.equal(inWhitelist('https://notexample.com', ['example.com']), false);
});
test('fresh defaults versus migration', () => {
  assert.equal(sanitizeSettings({}).matchMode, 'smart');
  assert.equal(sanitizeSettings({}).ignoreReload, true);
  assert.equal(sanitizeSettings({ ignoreReload: false }).ignoreReload, false);
  for (const mode of ['url', 'domain']) assert.equal(sanitizeSettings({ matchMode: mode }).matchMode, mode);
  assert.deepEqual(sanitizeSettings({ matchMode: 'domain' }).siteRules, []);
});
test('rule sanitization and domain normalization', () => {
  const s = sanitizeSettings({ siteRules: [rule('https://EXAMPLE.com/a', 'smart', false, [' share ', 'share']), rule('bad host', 'domain')], whitelist: ['https://EXAMPLE.com', 'example.com'] });
  assert.deepEqual(s.siteRules, [rule('example.com', 'smart', false, ['share'])]);
  assert.deepEqual(s.whitelist, ['example.com']);
});
test('settings save roundtrip and storage invalidation', async () => {
  let stored = { matchMode: 'domain', interceptMode: 'ask', whitelist: [], ignoreReload: true };
  const listeners = [];
  globalThis.chrome = { storage: { sync: { get: async () => structuredClone(stored), set: async value => { stored = structuredClone(value); } }, onChanged: { addListener: cb => listeners.push(cb) } } };
  assert.equal((await getSettings()).matchMode, 'domain');
  assert.equal((await getSettings()).ignoreReload, true);
  await setSettings({ matchMode: 'smart' });
  await setSettings({ interceptMode: 'auto' });
  await setSettings({ ignoreReload: false });
  assert.equal(stored.matchMode, 'smart');
  assert.equal(stored.ignoreReload, false);
  stored.matchMode = 'path';
  stored.ignoreReload = true;
  listeners[0]({ matchMode: {}, ignoreReload: {} }, 'sync');
  assert.equal((await getSettings()).matchMode, 'path');
  assert.equal((await getSettings()).ignoreReload, true);
});

test('computeMatchKey handles anchors and SPA route hashes appropriately', () => {
  const smartCfg = config('smart');
  // Simple in-page anchors are ignored -> identical match key (no false alarm on fragment navigation)
  const key1 = computeMatchKey('https://example.com/doc#intro', smartCfg);
  const key2 = computeMatchKey('https://example.com/doc#comments', smartCfg);
  const keyBase = computeMatchKey('https://example.com/doc', smartCfg);
  assert.equal(key1, key2);
  assert.equal(key1, keyBase);

  // SPA route hashes are retained -> different match keys (properly triggers duplicate detection)
  const routeKey1 = computeMatchKey('https://example.com/#/dashboard', smartCfg);
  const routeKey2 = computeMatchKey('https://example.com/#/settings', smartCfg);
  assert.notEqual(routeKey1, routeKey2);

  // Tracking query params filtered in smart mode -> same match key
  const track1 = computeMatchKey('https://example.com/p?utm_source=a&id=1', smartCfg);
  const track2 = computeMatchKey('https://example.com/p?utm_source=b&id=1', smartCfg);
  assert.equal(track1, track2);

  // Content param difference -> different match key
  const contentDiff = computeMatchKey('https://example.com/p?id=2', smartCfg);
  assert.notEqual(track1, contentDiff);
});

test('shouldSkipNavigation correctly filters reloads, history, and temporary allowed entries', () => {
  const settings = { ...DEFAULTS, ignoreReload: true };
  const target = 'https://example.com/article';

  // 1. Reload by transitionType
  const reloadRes = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    transitionType: 'reload',
    settings,
  });
  assert.equal(reloadRes.skip, true);
  assert.equal(reloadRes.reason, 'reload_or_history');

  // 2. Same URL in committed event (in-place reload)
  const inPlaceRes = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    lastUrl: target,
    settings,
  });
  assert.equal(inPlaceRes.skip, true);
  assert.equal(inPlaceRes.reason, 'reload_or_history');

  // 3. Forward/Back history navigation
  const historyRes = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    transitionQualifiers: ['forward_back'],
    settings,
  });
  assert.equal(historyRes.skip, true);
  assert.equal(historyRes.reason, 'reload_or_history');

  // 4. Temporary allowed within expiration
  const now = 1000;
  const allowedRes = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    settings,
    allowedEntry: { targetUrl: target, matchKey: null, expiresAt: 2000 },
    now,
  });
  assert.equal(allowedRes.skip, true);
  assert.equal(allowedRes.reason, 'allowed_temporary');

  // 5. Expired allowed entry should not skip
  const expiredRes = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    settings,
    allowedEntry: { targetUrl: target, matchKey: null, expiresAt: 500 },
    now,
  });
  assert.equal(expiredRes.skip, false);

  // 6. Normal new navigation to different URL should not skip
  const normalNav = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    lastUrl: 'https://example.com/other',
    settings,
  });
  assert.equal(normalNav.skip, false);
});

test('shouldSkipNavigation: ignores reload when ignoreReload is enabled (default)', () => {
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/',
    eventType: 'committed',
    transitionType: 'reload',
    lastUrl: 'https://www.baidu.com/',
    currentMatchKey: computeMatchKey('https://www.baidu.com/', settings),
    settings,
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'reload_or_history');
});

test('shouldSkipNavigation: intercepts reload when ignoreReload is explicitly disabled', () => {
  const settings = { ...config('smart'), ignoreReload: false };
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/',
    eventType: 'committed',
    transitionType: 'reload',
    lastUrl: 'https://www.baidu.com/',
    currentMatchKey: computeMatchKey('https://www.baidu.com/', settings),
    settings,
  });
  assert.equal(res.skip, false);
});

test('shouldSkipNavigation: ignores in-place re-submit on same URL in committed event', () => {
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/',
    eventType: 'committed',
    transitionType: 'typed', // user pressed Enter in address bar on same URL
    lastUrl: 'https://www.baidu.com/',
    currentMatchKey: computeMatchKey('https://www.baidu.com/', settings),
    settings,
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'reload_or_history');
});

test('shouldSkipNavigation: ignores history forward_back navigation', () => {
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/article/1',
    eventType: 'committed',
    transitionType: 'link',
    transitionQualifiers: ['forward_back'],
    lastUrl: 'https://www.baidu.com/article/2',
    currentMatchKey: computeMatchKey('https://www.baidu.com/article/1', settings),
    settings,
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'reload_or_history');
});

test('shouldSkipNavigation: does NOT skip when opening a brand new tab to matching URL', () => {
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/',
    eventType: 'committed',
    transitionType: 'typed',
    transitionQualifiers: ['from_address_bar'],
    lastUrl: '', // brand new tab
    currentMatchKey: computeMatchKey('https://www.baidu.com/', settings),
    settings,
  });
  assert.equal(res.skip, false);
});

test('shouldSkipNavigation: does NOT skip when navigating to a different URL in existing tab', () => {
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: 'https://www.baidu.com/',
    eventType: 'committed',
    transitionType: 'typed',
    lastUrl: 'https://www.google.com/',
    currentMatchKey: computeMatchKey('https://www.baidu.com/', settings),
    settings,
  });
  assert.equal(res.skip, false);
});

test('shouldSkipNavigation: respects whitelist and temporary allowed entry', () => {
  const settings = { ...config('smart'), whitelist: ['baidu.com'] };
  const resWhite = shouldSkipNavigation({
    url: 'https://www.baidu.com/new-page',
    eventType: 'committed',
    transitionType: 'link',
    lastUrl: 'https://www.google.com/',
    currentMatchKey: computeMatchKey('https://www.baidu.com/new-page', settings),
    settings,
  });
  assert.equal(resWhite.skip, true);
  assert.equal(resWhite.reason, 'whitelist');

  const now = 1000000;
  const normalSettings = config('smart');
  const resAllowed = shouldSkipNavigation({
    url: 'https://example.com/p',
    eventType: 'committed',
    transitionType: 'link',
    lastUrl: '',
    currentMatchKey: computeMatchKey('https://example.com/p', normalSettings),
    settings: normalSettings,
    allowedEntry: {
      targetUrl: 'https://example.com/p',
      matchKey: computeMatchKey('https://example.com/p', normalSettings),
      expiresAt: now + 5000,
    },
    now,
  });
  assert.equal(resAllowed.skip, true);
  assert.equal(resAllowed.reason, 'allowed_temporary');

  // Expired allowed entry
  const resExpired = shouldSkipNavigation({
    url: 'https://example.com/p',
    eventType: 'committed',
    transitionType: 'link',
    lastUrl: '',
    currentMatchKey: computeMatchKey('https://example.com/p', normalSettings),
    settings: normalSettings,
    allowedEntry: {
      targetUrl: 'https://example.com/p',
      matchKey: computeMatchKey('https://example.com/p', normalSettings),
      expiresAt: now - 100,
    },
    now,
  });
  assert.equal(resExpired.skip, false);
});