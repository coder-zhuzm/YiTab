import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntranetHost,
  isDirectAddress,
  parseSearchQuery,
  generateSvgFavicon,
  formatTimeGreeting,
  SEARCH_ENGINES,
} from '../src/lib/network-utils.ts';
import {
  DEFAULT_PINNED_GROUPS,
  DEFAULT_PINNED_ITEMS,
} from '../src/lib/pinned.ts';

test('isIntranetHost accurately identifies private and intranet hostnames', () => {
  // 本地回路
  assert.equal(isIntranetHost('localhost'), true);
  assert.equal(isIntranetHost('localhost:3000'), true);
  assert.equal(isIntranetHost('127.0.0.1'), true);
  assert.equal(isIntranetHost('::1'), true);

  // IPv4 私有网段
  assert.equal(isIntranetHost('10.0.1.20'), true);
  assert.equal(isIntranetHost('172.16.0.1'), true);
  assert.equal(isIntranetHost('172.31.255.255'), true);
  assert.equal(isIntranetHost('192.168.1.1'), true);
  assert.equal(isIntranetHost('192.168.100.254:8080'), true);
  assert.equal(isIntranetHost('169.254.1.1'), true);

  // 企业内部 DNS 与局域网后缀
  assert.equal(isIntranetHost('gitlab.corp'), true);
  assert.equal(isIntranetHost('jenkins.internal'), true);
  assert.equal(isIntranetHost('nas.local'), true);
  assert.equal(isIntranetHost('oa.corp:8888'), true);
  assert.equal(isIntranetHost('wiki.oa'), true);
  assert.equal(isIntranetHost('router.lan'), true);

  // 纯内部单名
  assert.equal(isIntranetHost('gitlab'), true);
  assert.equal(isIntranetHost('jira'), true);

  // 公网域名应当为 false
  assert.equal(isIntranetHost('github.com'), false);
  assert.equal(isIntranetHost('google.com'), false);
  assert.equal(isIntranetHost('v2ex.com'), false);
  assert.equal(isIntranetHost('1.1.1.1'), false);
  assert.equal(isIntranetHost('8.8.8.8'), false);
});

test('isDirectAddress recognizes network addresses and port shortcuts', () => {
  // 完整协议
  assert.deepEqual(isDirectAddress('http://example.com'), {
    isAddress: true,
    url: 'http://example.com',
  });
  assert.deepEqual(isDirectAddress('https://192.168.1.100:8443/login'), {
    isAddress: true,
    url: 'https://192.168.1.100:8443/login',
  });

  // 本地端口简写
  assert.deepEqual(isDirectAddress(':3000'), {
    isAddress: true,
    url: 'http://localhost:3000',
  });
  assert.deepEqual(isDirectAddress(':8080/dashboard'), {
    isAddress: true,
    url: 'http://localhost:8080/dashboard',
  });

  // localhost 各种形态
  assert.deepEqual(isDirectAddress('localhost:5173'), {
    isAddress: true,
    url: 'http://localhost:5173',
  });
  assert.deepEqual(isDirectAddress('localhost/api'), {
    isAddress: true,
    url: 'http://localhost/api',
  });

  // IPv4 地址
  assert.deepEqual(isDirectAddress('192.168.1.1:8080'), {
    isAddress: true,
    url: 'http://192.168.1.1:8080',
  });
  assert.deepEqual(isDirectAddress('10.20.30.40/metrics'), {
    isAddress: true,
    url: 'http://10.20.30.40/metrics',
  });

  // 内部与公共域名路径
  assert.deepEqual(isDirectAddress('gitlab.corp/projects'), {
    isAddress: true,
    url: 'http://gitlab.corp/projects',
  });
  assert.deepEqual(isDirectAddress('github.com/coder-zhuzm/YiTab'), {
    isAddress: true,
    url: 'http://github.com/coder-zhuzm/YiTab',
  });

  // 普通搜索词绝不误判为地址
  assert.equal(isDirectAddress('react 19 教程').isAddress, false);
  assert.equal(isDirectAddress('hello world').isAddress, false);
  assert.equal(isDirectAddress('how to use yitab').isAddress, false);
});

test('parseSearchQuery parses engine prefixes and direct jump routes', () => {
  // 前缀切换测试
  const gRes = parseSearchQuery('g react hooks');
  assert.equal(gRes.engine.id, 'google');
  assert.equal(gRes.cleanQuery, 'react hooks');
  assert.equal(gRes.isAddress, false);

  const bRes = parseSearchQuery('b 强化学习');
  assert.equal(bRes.engine.id, 'baidu');
  assert.equal(bRes.cleanQuery, '强化学习');
  assert.equal(bRes.isAddress, false);

  const ghRes = parseSearchQuery('gh wxt chrome extension');
  assert.equal(ghRes.engine.id, 'github');
  assert.equal(ghRes.cleanQuery, 'wxt chrome extension');
  assert.equal(ghRes.isAddress, false);

  const wRes = parseSearchQuery('w typescript');
  assert.equal(wRes.engine.id, 'bing');
  assert.equal(wRes.cleanQuery, 'typescript');
  assert.equal(wRes.isAddress, false);

  // 地址直达优先测试
  const portRes = parseSearchQuery(':5173');
  assert.equal(portRes.isAddress, true);
  assert.equal(portRes.targetUrl, 'http://localhost:5173');

  const ipRes = parseSearchQuery('192.168.10.22:8080/portal');
  assert.equal(ipRes.isAddress, true);
  assert.equal(ipRes.targetUrl, 'http://192.168.10.22:8080/portal');

  // 默认回退引擎测试
  const defRes = parseSearchQuery('普通搜索内容', 'baidu');
  assert.equal(defRes.engine.id, 'baidu');
  assert.equal(defRes.cleanQuery, '普通搜索内容');
  assert.equal(defRes.isAddress, false);
});

test('generateSvgFavicon generates high-contrast, deterministic SVG initials', () => {
  const svg1 = generateSvgFavicon('GitLab 内部仓库', 'gitlab.corp');
  assert.match(svg1, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(svg1), /<svg/);
  // 中文取首字
  assert.match(decodeURIComponent(svg1), /G/);

  const svg2 = generateSvgFavicon('Jenkins', 'jenkins.internal');
  assert.match(decodeURIComponent(svg2), /JE/);

  // 相同输入必须确定性一致
  const svg3 = generateSvgFavicon('Jenkins', 'jenkins.internal');
  assert.equal(svg2, svg3);
});

test('formatTimeGreeting formats clean time and greeting text', () => {
  const morning = new Date(2026, 9, 15, 9, 30);
  const mRes = formatTimeGreeting(morning);
  assert.equal(mRes.timeStr, '09:30');
  assert.equal(mRes.greeting, '上午好');
  assert.match(mRes.dateStr, /10月15日/);

  const night = new Date(2026, 9, 15, 23, 15);
  const nRes = formatTimeGreeting(night);
  assert.equal(nRes.timeStr, '23:15');
  assert.equal(nRes.greeting, '夜深了');
});

test('DEFAULT_PINNED_GROUPS and DEFAULT_PINNED_ITEMS are valid and non-empty', () => {
  assert.equal(DEFAULT_PINNED_GROUPS.length >= 3, true);
  assert.equal(DEFAULT_PINNED_ITEMS.length >= 3, true);
  for (const item of DEFAULT_PINNED_ITEMS) {
    assert.ok(item.id);
    assert.ok(item.title);
    assert.ok(item.url);
    assert.ok(item.groupId);
  }
});
