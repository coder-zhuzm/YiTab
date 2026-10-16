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
const config = (mode = 'smart', siteRules = [], whitelist = [], extra = {}) => ({ ...DEFAULTS, matchMode: mode, siteRules, whitelist, ...extra });
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
  ['hash anchors kept by default', '/a#comments', '/a#intro', 'smart', false],
  ['hash slash routes', '/#/project/1', '/#/project/2', 'smart', false],
  ['hashbang routes', '/#!/project/1', '/#!/project/2', 'path', false],
  ['complex hash retained', '/#project?id=1', '/#project?id=2', 'smart', false],
  ['single-segment hash routes distinguished', '/#inbox', '/#sent', 'smart', false],
  ['single-segment hash routes distinguished in path mode', '/#inbox', '/#sent', 'path', false],
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
test('smart/path keep bare domain and www strictly separate', () => {
  for (const other of ['http://example.com/a', 'https://example.com:8443/a', 'https://sub.example.com/a']) assert.equal(matchDuplicate(base + '/a', other, config()), null);
  // 裸域与 www 是两个不同 host：默认不合并，需要合并必须由用户显式声明站点规则。
  // 自动合并会扩大判定范围，把原本放行的两个页面判为重复。
  assert.equal(matchDuplicate(base + '/a', 'https://www.example.com/a', config()), null);
  assert.equal(matchDuplicate(base + '/a', 'https://www.example.com/a', config('path')), null);
  assert.equal(matchDuplicate(base + '/a', 'https://www.example.com/a', config('url')), null);
  // 同域名模式保留其「整站合并」语义，仍视为同一站点
  assert.ok(matchDuplicate(base + '/a', 'https://www.example.com/b', config('domain')));
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
test('www: alias merge only happens when the user declares it', () => {
  // 默认不合并 —— 两条 URL 各自独立
  assert.equal(matchDuplicate(base + '/a', 'https://www.example.com/a', config()), null);
  // 用户显式为裸域写规则后，别名命中生效（层级 1），www 命中该规则
  const alias = config('url', [rule('example.com', 'domain')]);
  assert.ok(matchDuplicate(base + '/a', 'https://www.example.com/b', alias));
  // 用户显式为 www 写规则时，裸域不受影响
  const wwwOnly = config('url', [rule('www.example.com', 'domain')]);
  assert.equal(matchDuplicate(base + '/a', 'https://www.example.com/b', wwwOnly), null);
  assert.ok(matchDuplicate('https://www.example.com/a', 'https://www.example.com/b', wwwOnly));
});

test('R1: an exact www rule is never overridden by its bare-domain alias', () => {
  // 用户为 www.example.com 单独写了 url（严格）规则，就必须生效 ——
  // 裸域 example.com 是别名，层级更低，不得覆盖它，且结果不能依赖数组顺序。
  const exactWww = rule('www.example.com', 'url');
  const bareAlias = rule('example.com', 'domain');
  const candidate = 'https://www.example.com/a';
  const existing = 'https://www.example.com/b';

  for (const [label, rules] of [
    ['bare first', [bareAlias, exactWww]],
    ['www first', [exactWww, bareAlias]],
  ]) {
    const c = config('smart', rules);
    assert.equal(resolveRule(candidate, c).mode, 'url', `${label}: exact www rule must win`);
    assert.equal(matchDuplicate(candidate, existing, c), null, `${label}: strict rule must not match`);
  }

  // 只配置其中一条时，各自按自己的语义生效
  assert.equal(matchDuplicate(candidate, existing, config('smart', [exactWww])), null);
  assert.ok(matchDuplicate(candidate, existing, config('smart', [bareAlias])));
});
test('R1: subdomain rules stay less specific than exact hits', () => {
  const c = config('smart', [
    rule('example.com', 'domain', true),
    rule('www.example.com', 'url'),
  ]);
  assert.equal(resolveRule('https://www.example.com/a', c).mode, 'url');
  // 别名精确命中（层级 1）优先于子域覆盖（层级 2）
  const c2 = config('smart', [
    rule('example.com', 'domain', true),
    rule('www.example.com', 'path'),
  ]);
  assert.equal(resolveRule('https://www.example.com/a', c2).mode, 'path');
  assert.equal(resolveRule('https://other.example.com/a', c2).mode, 'domain');
});
test('R1: rules survive a sanitize/save/reload roundtrip unchanged', () => {
  const input = {
    matchMode: 'smart',
    siteRules: [rule('example.com', 'domain'), rule('www.example.com', 'url')],
  };
  const saved = sanitizeSettings(input);
  assert.deepEqual(saved.siteRules, input.siteRules, 'sanitize must not rewrite or drop either rule');
  // 重载后判定与保存前一致
  const candidate = 'https://www.example.com/a';
  assert.equal(resolveRule(candidate, saved).mode, 'url');
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

test('computeMatchKey retains hashes by default and drops them when configured', () => {
  const smartCfg = config('smart');
  const ignoreCfg = config('smart', [], [], { hashPolicy: 'ignore' });

  // 默认保留：单段 Hash 路由与页内锚点都参与判定，避免把不同页面误判为重复
  assert.notEqual(
    computeMatchKey('https://example.com/doc#intro', smartCfg),
    computeMatchKey('https://example.com/doc#comments', smartCfg),
  );
  assert.notEqual(
    computeMatchKey('https://example.com/doc#intro', smartCfg),
    computeMatchKey('https://example.com/doc', smartCfg),
  );

  // hashPolicy=ignore：Hash 一律丢弃，纯文档站不再因锚点误报
  assert.equal(
    computeMatchKey('https://example.com/doc#intro', ignoreCfg),
    computeMatchKey('https://example.com/doc#comments', ignoreCfg),
  );
  assert.equal(
    computeMatchKey('https://example.com/doc#intro', ignoreCfg),
    computeMatchKey('https://example.com/doc', ignoreCfg),
  );

  // SPA route hashes always differ
  assert.notEqual(
    computeMatchKey('https://example.com/#/dashboard', smartCfg),
    computeMatchKey('https://example.com/#/settings', smartCfg),
  );

  // Tracking query params filtered in smart mode -> same match key
  const track1 = computeMatchKey('https://example.com/p?utm_source=a&id=1', smartCfg);
  const track2 = computeMatchKey('https://example.com/p?utm_source=b&id=1', smartCfg);
  assert.equal(track1, track2);

  // Content param difference -> different match key
  assert.notEqual(track1, computeMatchKey('https://example.com/p?id=2', smartCfg));
});

test('R4: match reason reflects the actual hash policy', () => {
  const url = 'https://example.com/a';
  // smart：仅在追踪参数上有差异才会判为重复
  const tracked = 'https://example.com/a?utm_source=x';
  assert.match(matchDuplicate(url, tracked, config('smart')).reason, /Hash 保留/);
  assert.match(matchDuplicate(url, tracked, config('smart', [], [], { hashPolicy: 'ignore' })).reason, /Hash 已忽略/);

  // path：查询参数被忽略，任何参数差异都会命中；过去无论实际策略如何都硬写「Hash 保留」
  const withParam = 'https://example.com/a?x=1';
  assert.match(matchDuplicate(url, withParam, config('path')).reason, /Hash 保留/);
  assert.match(matchDuplicate(url, withParam, config('path', [], [], { hashPolicy: 'ignore' })).reason, /Hash 已忽略/);

  // 完整地址模式不涉及 Hash 归一化，不应出现该措辞
  assert.doesNotMatch(matchDuplicate(url, url, config('url')).reason, /Hash/);
});

test('matchDuplicate does not collapse distinct single-segment hash routes', () => {
  // mail.google.com/mail/u/0/#inbox 与 #sent 是两个不同页面，绝不能判为重复
  assert.equal(matchDuplicate('https://mail.example.com/u/0/#inbox', 'https://mail.example.com/u/0/#sent', config()), null);
  assert.ok(matchDuplicate('https://mail.example.com/u/0/#inbox', 'https://mail.example.com/u/0/#inbox', config()));
  // 站点可用 hashPolicy=ignore 换回「锚点不敏感」的行为
  assert.ok(matchDuplicate('https://doc.example.com/a#intro', 'https://doc.example.com/a#comments', config('smart', [], [], { hashPolicy: 'ignore' })));
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

test('shouldSkipNavigation: SPA routes are handled by spaPolicy, not matchMode', () => {
  const base = { url: 'https://example.com/#/a', eventType: 'history', lastUrl: 'https://example.com/#/a' };

  // spaPolicy=off 时完全不管站内路由变化
  assert.equal(shouldSkipNavigation({ ...base, settings: config('smart', [], [], { spaPolicy: 'off' }) }).reason, 'spa_ignored');

  // 默认 toast：路由不同则交由页内提示处理（不跳过）
  assert.equal(shouldSkipNavigation({ ...base, settings: config('smart') }).skip, false);

  // history 事件重复提交同一路由时跳过（防抖）
  const key = computeMatchKey('https://example.com/#/a', config('smart'));
  const same = shouldSkipNavigation({
    ...base,
    currentMatchKey: key,
    lastMatchKey: key,
    settings: config('smart'),
  });
  assert.equal(same.skip, true);
  assert.equal(same.reason, 'same_match_key');
});

test('shouldSkipNavigation: explicit allow beats a whitelist-free reload guard', () => {
  const now = 5000;
  const target = 'https://example.com/p';
  const settings = config('smart');
  const res = shouldSkipNavigation({
    url: target,
    eventType: 'committed',
    transitionType: 'reload',
    settings,
    allowedEntry: {
      targetUrl: target,
      matchKey: computeMatchKey(target, settings),
      expiresAt: now + 1000,
    },
    now,
  });
  assert.equal(res.skip, true);
  assert.equal(res.reason, 'allowed_temporary');
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