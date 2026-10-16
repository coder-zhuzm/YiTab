import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntranetHost,
  isDirectAddress,
  parseSearchQuery,
  resolveTargetUrl,
  resolveShortcutUrl,
  canonicalUrlKey,
  generateSvgFavicon,
  formatTimeGreeting,
  SEARCH_ENGINES,
} from '../src/lib/network-utils.ts';
import { PUBLIC_TLDS } from '../src/lib/public-tlds.ts';
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

  // 内部与公共域名路径。
  // ⚠️ 行为变更（有意，逐项说明）：
  //   旧实现里带路径的域名路径走的是 `http://`，而同一主机不带路径时走 `https://` ——
  //   同一主机因是否带路径而得到不同协议，这是既有缺陷。
  //   现统一由 defaultsToHttp() 决定：内网/本机 -> http，公共域名 -> https。
  assert.deepEqual(isDirectAddress('gitlab.corp/projects'), {
    isAddress: true,
    url: 'https://gitlab.corp/projects',
  });
  assert.deepEqual(isDirectAddress('github.com/coder-zhuzm/YiTab'), {
    isAddress: true,
    url: 'https://github.com/coder-zhuzm/YiTab',
  });

  // 普通搜索词绝不误判为地址
  assert.equal(isDirectAddress('react 19 教程').isAddress, false);
  assert.equal(isDirectAddress('hello world').isAddress, false);
  assert.equal(isDirectAddress('how to use yitab').isAddress, false);
  // isIntranetHost 对任意单节字符串都返回 true，不能单独用它判定地址
  assert.equal(isDirectAddress('普通搜索内容').isAddress, false);
  assert.equal(isDirectAddress('hello').isAddress, false);
});

test('resolveTargetUrl preserves explicit protocol, port, path, query and hash', () => {
  // 边界 1：显式协议优先，其余部分不得被擅自替换或丢弃
  for (const input of [
    'http://example.com',
    'https://example.com:8443/login?next=%2Fdash#section',
    'http://192.168.1.100:8080/portal?tab=1#top',
    'https://gitlab.corp/a/b/c?x=1&y=2#frag',
    'http://localhost:3000/api/v1?debug=1',
  ]) {
    assert.deepEqual(resolveTargetUrl(input), { isAddress: true, url: input }, `must keep ${input} verbatim`);
  }

  // 非 http/https 协议一律拒绝，避免把可执行内容当成地址
  for (const bad of ['javascript:alert(1)', 'data:text/html,<h1>x', 'file:///etc/passwd', 'ftp://example.com']) {
    assert.equal(resolveTargetUrl(bad).isAddress, false, `${bad} must not be treated as a web address`);
  }
});

test('resolveTargetUrl keeps intranet direct-jump behaviour', () => {
  // 边界 2：既有内网直达规则保持不变
  assert.deepEqual(resolveTargetUrl(':3000'), { isAddress: true, url: 'http://localhost:3000' });
  assert.deepEqual(resolveTargetUrl(':8080/dashboard'), { isAddress: true, url: 'http://localhost:8080/dashboard' });
  assert.deepEqual(resolveTargetUrl('localhost:5173'), { isAddress: true, url: 'http://localhost:5173' });
  assert.deepEqual(resolveTargetUrl('192.168.1.1:8080'), { isAddress: true, url: 'http://192.168.1.1:8080' });
  assert.deepEqual(resolveTargetUrl('10.20.30.40/metrics'), { isAddress: true, url: 'http://10.20.30.40/metrics' });
  // 无协议时的默认协议：内网/本机 -> http，公共域名 -> https
  assert.equal(resolveTargetUrl('nas.local').url, 'https://nas.local');
  assert.equal(resolveTargetUrl('127.0.0.1:9000').url, 'http://127.0.0.1:9000');
});

test('resolveTargetUrl: one input yields one URL for every consumer', () => {
  // 边界 4：补全、预览、保存、打开必须消费同一份解析结果。
  // 这里锁定「同一输入重复解析结果稳定」，防止各处各自另猜。
  const inputs = [
    'github.com/coder-zhuzm/YiTab',
    'https://example.com:8443/a?b=1#c',
    ':5173',
    'gitlab.corp/login',
    '192.168.1.100:8080/x',
  ];
  for (const input of inputs) {
    const first = resolveTargetUrl(input);
    for (let i = 0; i < 5; i++) {
      assert.deepEqual(resolveTargetUrl(input), first, `${input} must resolve deterministically`);
    }
    // 保存路径与直达路径共用同一解析结果
    assert.deepEqual(resolveShortcutUrl(input), { ok: first.isAddress, url: first.url });
  }
});

test('resolveShortcutUrl requires a valid web address but never invents one', () => {
  // 边界 3：快捷方式表单要求有效地址，且不得把普通搜索词变成网址
  assert.deepEqual(resolveShortcutUrl('github.com'), { ok: true, url: 'https://github.com' });
  assert.deepEqual(resolveShortcutUrl('https://example.com/a?b=1#c'), {
    ok: true,
    url: 'https://example.com/a?b=1#c',
  });
  assert.deepEqual(resolveShortcutUrl('localhost:3000'), { ok: true, url: 'http://localhost:3000' });

  for (const word of ['react 19 教程', 'hello world', '普通搜索内容', 'how to use yitab']) {
    assert.deepEqual(resolveShortcutUrl(word), { ok: false, url: '' }, `${word} must not become a URL`);
  }
  assert.deepEqual(resolveShortcutUrl('javascript:alert(1)'), { ok: false, url: '' });
});

test('address detection does not swallow ordinary search input', () => {
  // 反例：规则 5 曾把「含点」当作地址的充分条件，于是 `1.2` 被解析成
  // `https://1.2`，再被浏览器 URL 解析当成 IPv4 简写 `https://1.0.0.2/` —— 搜索变导航。
  for (const word of ['1.2', 'v1.2', '1.2.3', '3.14', 'release 1.2']) {
    assert.equal(resolveTargetUrl(word).isAddress, false, `${word} must stay a search term`);
  }
  // 版本号/小数不得被当作 IP：IPv4 必须严格四段且每段 0–255
  assert.equal(resolveTargetUrl('1.2.3.4').isAddress, true);
  assert.equal(resolveTargetUrl('999.1.1.1').isAddress, false, 'out-of-range octet is not an IPv4');
  assert.equal(resolveTargetUrl('1.2.3.256').isAddress, false);

  // 单段主机名仍需端口或路径这类显式信号，否则不认
  assert.equal(resolveTargetUrl('hello').isAddress, false);
  assert.equal(resolveTargetUrl('hello:8080').isAddress, true);
  assert.equal(resolveTargetUrl('wiki/docs').isAddress, true);
});

test('invalid ports are rejected by both the direct-jump and the save path', () => {
  // 反例：`localhost:99999` 曾出现「直达判定为地址、保存判定无效」的分裂。
  // 候选识别与最终校验必须衔接，两条路径结论一致。
  for (const bad of [
    'localhost:99999',
    'localhost:0',
    'localhost:65536',
    '192.168.1.1:99999',
    'example.com:70000',
    ':99999',
  ]) {
    assert.equal(resolveTargetUrl(bad).isAddress, false, `${bad} is not a usable address`);
    assert.deepEqual(resolveShortcutUrl(bad), { ok: false, url: '' }, `${bad} must be rejected on save too`);
  }

  // 合法端口边界必须保留
  assert.deepEqual(resolveTargetUrl('localhost:65535'), { isAddress: true, url: 'http://localhost:65535' });
  assert.deepEqual(resolveTargetUrl('localhost:1'), { isAddress: true, url: 'http://localhost:1' });
});

test('every successful candidate goes through the same final validation', () => {
  // 反例：localhost / IPv4 / 端口简写分支曾提前 return，绕过最终校验。
  // `192.168.001.009` 因此出现「直达判为地址、保存判为无效」的分裂。
  for (const bad of ['192.168.001.009', '192.168.001.009:8080', '10.0.00.1', '010.1.1.1']) {
    assert.equal(resolveTargetUrl(bad).isAddress, false, `${bad} is not a usable address`);
    assert.deepEqual(resolveShortcutUrl(bad), { ok: false, url: '' }, `${bad} must be rejected on save too`);
  }

  // 全量一致性：直达与保存对同一输入的结论必须永远相同
  const inputs = [
    'https://example.com/a?b=1#c',
    'example.design',
    'github.com',
    'localhost:5173',
    ':3000',
    '192.168.1.1:8080',
    '192.168.001.009',
    'localhost:99999',
    '1.2',
    'package.json',
    'javascript:alert(1)',
    '',
  ];
  for (const input of inputs) {
    const direct = resolveTargetUrl(input);
    const save = resolveShortcutUrl(input);
    assert.equal(
      direct.isAddress,
      save.ok,
      `${input}: direct-jump and save must agree (${direct.isAddress} vs ${save.ok})`,
    );
  }
});

test('address detection does not depend on a finite TLD allowlist', () => {
  // 反例：多段域名曾要求命中 TLD 白名单，导致 `.design`、`.museum` 这类
  // 真实后缀在无协议时被当作搜索词（带协议却能通过），行为自相矛盾。
  for (const input of [
    'example.design',
    'example.design/projects',
    'example.museum',
    'example.museum/visit',
    'example.photography',
    'example.engineering',
  ]) {
    assert.equal(resolveTargetUrl(input).isAddress, true, `${input} must be a usable address`);
  }

  // 但不能因此把普通文件名/搜索词也放行。
  // 这里只列末段**不是**真实 TLD 的输入：`.py` / `.sh` / `.md` / `.rs` / `.ai` / `.cc`
  // 等都是真实 TLD，按「真实 TLD 优先」会走地址分支，其取舍见下面的专项用例。
  for (const word of [
    'package.json',
    'notes.txt',
    'index.html',
    'config.yml',
    'data.csv',
    '1.2',
    'v1.2',
    '3.14',
    '1.2.3',
    'hello',
    'release 1.2',
  ]) {
    assert.equal(resolveTargetUrl(word).isAddress, false, `${word} must stay a search term`);
  }

  // 已知残留：既不在 IANA 快照、也不在扩展名表的末段仍会被当作地址。
  // 这是启发式的固有取舍，在此显式记录而非假装不存在。
  assert.equal(
    resolveTargetUrl('lodash.debounce').isAddress,
    true,
    'known limitation: an unknown suffix is treated as a TLD',
  );
});

test('a real TLD is never vetoed by the file-extension heuristic', () => {
  // 反例：扩展名启发式曾否决真实 TLD —— `.ai` / `.cc` / `.sh` / `.rs` / `.md`
  // 同时出现在扩展名表里，导致 example.ai 等在无协议时被判为搜索词。
  // 判定顺序必须是「真实 TLD 优先」，文件名启发式只能用于其余后缀。
  for (const tld of ['ai', 'cc', 'sh', 'rs', 'md']) {
    // 裸域名
    assert.deepEqual(
      resolveTargetUrl(`example.${tld}`),
      { isAddress: true, url: `https://example.${tld}` },
      `example.${tld} must be a usable address`,
    );
    // 带路径
    assert.deepEqual(
      resolveTargetUrl(`example.${tld}/docs`),
      { isAddress: true, url: `https://example.${tld}/docs` },
      `example.${tld}/docs must be a usable address`,
    );
    // 保存路径与直达一致
    assert.deepEqual(resolveShortcutUrl(`example.${tld}`), {
      ok: true,
      url: `https://example.${tld}`,
    });
  }

  // 取舍：末段是真实 TLD 时一律按域名处理，无法再逐例猜测「这是文件名还是域名」。
  // 因此 `README.md`、`main.py`、`script.sh` 这类输入会被当作地址 ——
  // `.md`(摩尔多瓦)、`.py`(巴拉圭)、`.sh`(圣赫勒拿)、`.rs`(塞尔维亚)、`.ai`(安圭拉)
  // 都是真实存在的顶级域名。这是让它们可用的必然代价，相对 HEAD 是行为变化，
  // 在此显式记录而非假装不存在。
  for (const ambiguous of ['README.md', 'main.py', 'script.sh', 'notes.rs', 'example.ai']) {
    assert.equal(
      resolveTargetUrl(ambiguous).isAddress,
      true,
      `${ambiguous}: a real TLD wins over the filename heuristic (accepted tradeoff)`,
    );
  }
});

test('the generated TLD snapshot is a plausible IANA dataset', () => {
  // 防止生成的快照被截断或写坏后悄悄改变地址判定行为
  assert.ok(PUBLIC_TLDS.size > 1000, `expected a full IANA snapshot, got ${PUBLIC_TLDS.size}`);
  assert.ok(PUBLIC_TLDS.has('com') && PUBLIC_TLDS.has('cn') && PUBLIC_TLDS.has('dev'));
  // 本轮修复所依赖的几个「既是扩展名又是真实 TLD」的后缀
  for (const tld of ['ai', 'cc', 'sh', 'rs', 'md', 'design', 'museum']) {
    assert.ok(PUBLIC_TLDS.has(tld), `.${tld} must be present in the snapshot`);
  }
  // 只应包含小写字母数字与连字符
  for (const tld of PUBLIC_TLDS) {
    assert.match(tld, /^[a-z0-9-]+$/, `unexpected entry: ${tld}`);
  }
});

test('the real-TLD table eliminates ambiguity without rejecting unknown suffixes', () => {
  // 该表用于消歧，**不是**拒绝未知后缀的白名单：
  // 不在 IANA 快照里的后缀仍走结构判定，因此新增/未收录的 TLD 不会让地址失效。
  for (const input of [
    'example.design',
    'example.museum',
    'example.engineering',
    'example.photography',
    'example.notarealtld',
  ]) {
    assert.equal(resolveTargetUrl(input).isAddress, true, `${input} must still be usable`);
  }

  // 而末段既非真实 TLD、又命中扩展名表的输入必须继续被挡下
  // （注意：`main.py` / `script.sh` 因 .py / .sh 是真实 TLD 而不在此列）
  for (const word of ['package.json', 'notes.txt', 'app.tsx', 'config.yml', 'index.html', 'data.csv']) {
    assert.equal(resolveTargetUrl(word).isAddress, false, `${word} must stay a search term`);
  }
});

test('canonicalUrlKey keeps metadata matching consistent with address parsing', () => {
  // 元数据精确匹配用的归一 key：只消除表示差异，不合并语义差异
  assert.equal(canonicalUrlKey('https://example.com'), canonicalUrlKey('https://example.com/'));
  assert.equal(canonicalUrlKey('https://Example.COM:443/'), canonicalUrlKey('https://example.com/'));
  assert.notEqual(canonicalUrlKey('https://example.com/'), canonicalUrlKey('https://example.com:8443/'));
  assert.notEqual(canonicalUrlKey('https://example.com/#1'), canonicalUrlKey('https://example.com/#2'));
  assert.equal(canonicalUrlKey('1.2'), '', 'a search term has no comparable URL key');
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
