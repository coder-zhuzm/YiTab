import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupLocalTitle,
  shouldApplyAutoTitle,
  createShortcutMetaController,
  HISTORY_LOOKBACK_MS,
  HISTORY_MAX_RESULTS,
} from '../src/lib/shortcut-meta.ts';
import { resolveShortcutUrl, canonicalUrlKey } from '../src/lib/network-utils.ts';

const TARGET = 'https://example.com/a?b=1#c';

function makeApi({ tabs = [], history = [], tabsThrow = false, historyThrow = false } = {}) {
  const calls = { tabs: 0, history: [] };
  return {
    calls,
    queryTabs: async () => {
      calls.tabs++;
      if (tabsThrow) throw new Error('tabs failed');
      return tabs;
    },
    searchHistory: async (url, startTime, maxResults) => {
      calls.history.push({ url, startTime, maxResults });
      if (historyThrow) throw new Error('history failed');
      return history;
    },
  };
}

test('lookupLocalTitle prefers an exact tab match', async () => {
  const api = makeApi({
    tabs: [
      { url: 'https://other.test/', title: '别的页面' },
      { url: TARGET, title: '精确命中的标签标题' },
    ],
    history: [{ url: TARGET, title: '历史标题' }],
  });

  const got = await lookupLocalTitle(api, TARGET);
  assert.deepEqual(got, { title: '精确命中的标签标题', source: 'tab', url: TARGET });
  assert.equal(api.calls.history.length, 0, 'must not hit history when a tab already matched');
});

test('lookupLocalTitle falls back to history and filters results exactly', async () => {
  const api = makeApi({
    tabs: [{ url: 'https://unrelated.test/', title: '无关标签' }],
    // history.search 的 text 是自由文本查询，会返回近似结果，必须再次精确过滤
    history: [
      { url: 'https://example.com/a?b=2#c', title: '近似但不是同一地址' },
      { url: TARGET, title: '历史里的准确标题' },
    ],
  });

  const got = await lookupLocalTitle(api, TARGET);
  assert.deepEqual(got, { title: '历史里的准确标题', source: 'history', url: TARGET });
});

test('lookupLocalTitle bounds the history query explicitly', async () => {
  const now = 1_700_000_000_000;
  const api = makeApi({ history: [] });

  await lookupLocalTitle(api, TARGET, now);

  assert.equal(api.calls.history.length, 1);
  const call = api.calls.history[0];
  assert.equal(call.url, TARGET);
  assert.equal(call.maxResults, HISTORY_MAX_RESULTS);
  assert.equal(
    call.startTime,
    now - HISTORY_LOOKBACK_MS,
    'must not fall back to the 24h default lookback',
  );
});

test('lookupLocalTitle never blocks on failures and never invents a title', async () => {
  const bothFail = makeApi({ tabsThrow: true, historyThrow: true });
  assert.equal(await lookupLocalTitle(bothFail, TARGET), null);

  const empty = makeApi({ tabs: [{ url: TARGET, title: '   ' }], history: [] });
  assert.equal(await lookupLocalTitle(empty, TARGET), null, 'blank titles are not candidates');

  assert.equal(await lookupLocalTitle(makeApi(), ''), null);
});

// --- 问题 3：URL 归一后才能命中本地标题 ---------------------------------

test('lookupLocalTitle matches after canonicalizing representation differences', async () => {
  // 复现：输入 example.com 解析为 https://example.com，而浏览器标签 URL 是 https://example.com/
  const api = makeApi({ tabs: [{ url: 'https://example.com/', title: 'Example 站点' }] });
  const got = await lookupLocalTitle(api, resolveShortcutUrl('example.com').url);
  assert.deepEqual(
    got,
    { title: 'Example 站点', source: 'tab', url: 'https://example.com' },
    'trailing-slash difference must not block the match',
  );

  // 主机名大小写
  const upper = makeApi({ tabs: [{ url: 'https://EXAMPLE.com/', title: '大小写不同' }] });
  assert.equal((await lookupLocalTitle(upper, 'https://example.com')).title, '大小写不同');

  // 显式默认端口
  const defPort = makeApi({ tabs: [{ url: 'https://example.com:443/', title: '显式默认端口' }] });
  assert.equal((await lookupLocalTitle(defPort, 'https://example.com')).title, '显式默认端口');

  // 非默认端口是不同地址，不得命中
  const otherPort = makeApi({ tabs: [{ url: 'https://example.com:8443/', title: '别的端口' }] });
  assert.equal(await lookupLocalTitle(otherPort, 'https://example.com'), null);
});

test('canonicalUrlKey normalizes representation but keeps semantics distinct', () => {
  // 归一：这些必须相等
  assert.equal(canonicalUrlKey('https://example.com'), canonicalUrlKey('https://example.com/'));
  assert.equal(canonicalUrlKey('https://EXAMPLE.com'), canonicalUrlKey('https://example.com'));
  assert.equal(canonicalUrlKey('https://example.com:443/'), canonicalUrlKey('https://example.com/'));
  assert.equal(canonicalUrlKey('http://example.com:80/'), canonicalUrlKey('http://example.com/'));

  // 保留：这些必须不同
  const distinct = [
    ['http://example.com/', 'https://example.com/'], // 协议
    ['https://example.com/', 'https://example.com:8443/'], // 非默认端口
    ['https://example.com/a', 'https://example.com/b'], // 路径
    ['https://example.com/a', 'https://example.com/a/'], // 路径尾斜杠是真实差异
    ['https://example.com/?x=1', 'https://example.com/'], // 查询
    ['https://example.com/#1', 'https://example.com/#2'], // Hash
    ['https://www.example.com/', 'https://example.com/'], // www 不合并
  ];
  for (const [a, b] of distinct) {
    assert.notEqual(canonicalUrlKey(a), canonicalUrlKey(b), `${a} vs ${b} must stay distinct`);
  }

  // 不可解析 -> 空串（调用方据此判定「不可比较」而非「相等」）
  assert.equal(canonicalUrlKey('not a url'), '');
  assert.equal(canonicalUrlKey('javascript:alert(1)'), '');
  assert.equal(canonicalUrlKey(''), '');
});

// --- 问题 1 & 2：真实异步回调的覆盖与串写 --------------------------------

/**
 * 用可控 Promise 驱动**源码里真实的 controller**（不是静态参数），
 * 这样才证明得了组件不会覆盖用户输入或把旧会话结果写进新会话。
 */
function makeHarness({ candidate = null } = {}) {
  const pending = [];
  const state = { url: '', title: '', preview: '', hint: '', suggested: null };
  const writes = [];

  const controller = createShortcutMetaController({
    readUrl: () => state.url,
    readTitle: () => state.title,
    resolve: resolveShortcutUrl,
    lookup: (targetUrl) =>
      new Promise((resolve) => {
        pending.push({ targetUrl, resolve });
      }),
    writeTitle: (t) => {
      writes.push(t);
      state.title = t;
    },
    setPreview: (v) => {
      state.preview = v;
    },
    setHint: (v) => {
      state.hint = v;
    },
    setSuggestedTitle: (v) => {
      state.suggested = v;
    },
  });

  return {
    controller,
    state,
    writes,
    pending,
    /** 让最近一次挂起的查询返回（模拟异步完成） */
    settleLast() {
      const last = pending[pending.length - 1];
      assert.ok(last, 'no pending lookup to settle');
      last.resolve(candidate);
    },
  };
}

test('a user-typed title survives a slower in-flight auto lookup', async () => {
  // 复现问题 1：先自动填入 -> 再次失焦发起查询 -> 查询期间用户改名 -> 旧查询返回覆盖用户输入
  const h = makeHarness({ candidate: { title: '异步候选', source: 'history', url: 'https://example.com' } });

  h.state.url = 'example.com';
  const first = h.controller.onUrlBlur();
  h.settleLast();
  await first;
  assert.equal(h.state.title, '异步候选', 'first lookup fills the auto title');
  assert.equal(h.controller.currentSource(), 'auto');

  // 第二次失焦，查询挂起
  const second = h.controller.onUrlBlur();
  assert.equal(h.state.hint, '正在查找本地名称…');

  // 查询期间用户手动改名 —— 必须同步生效，在途回调要能立刻看到
  h.state.title = '用户手填的名称';
  h.controller.onTitleInput();

  h.settleLast();
  await second;

  assert.equal(h.state.title, '用户手填的名称', 'auto result must never overwrite a user-typed title');
  assert.equal(h.controller.currentSource(), 'user');
  assert.deepEqual(h.writes, ['异步候选'], 'no second write happened');
});

test('a stale lookup cannot leak its suggestion or hint into a new modal session', async () => {
  // 复现问题 2：编辑 A -> 查询挂起 -> 关闭弹窗 -> 打开 B -> A 的结果返回
  const h = makeHarness({
    candidate: { title: 'A 的候选', source: 'history', url: 'https://a.test' },
  });

  // 会话 A：编辑已有条目
  h.controller.beginSession(true);
  h.state.url = 'a.test';
  h.state.title = 'A 的名称';
  const sessionA = h.controller.onUrlBlur();

  // 未等返回就关闭弹窗，然后打开 B（新增）
  h.controller.endSession();
  h.controller.beginSession(false);
  h.state.url = 'b.test';
  h.state.title = '';
  h.state.hint = '';
  h.state.suggested = null;

  h.settleLast();
  await sessionA;

  assert.equal(h.state.suggested, null, 'stale suggestion must not appear in the new session');
  assert.equal(h.state.hint, '', 'stale hint must not appear in the new session');
  assert.equal(h.state.title, '', 'stale result must not write a title into the new session');
  assert.deepEqual(h.writes, []);
});

test('a stale lookup cannot leak after the URL changes', async () => {
  const h = makeHarness({
    candidate: { title: '旧地址的候选', source: 'tab', url: 'https://old.test' },
  });

  h.controller.beginSession(false);
  h.state.url = 'old.test';
  const inflight = h.controller.onUrlBlur();

  // URL 被改写 -> 在途查询立即失效
  h.state.url = 'new.test';
  h.controller.invalidate();

  h.settleLast();
  await inflight;

  assert.equal(h.state.title, '', 'no title written for an abandoned URL');
  assert.equal(h.state.suggested, null);
  assert.deepEqual(h.writes, []);
});

test('a suggestion from a previous URL cannot be applied to the current one', async () => {
  const h = makeHarness();
  h.controller.beginSession(false);
  h.state.url = 'a.test';

  const stale = { title: 'A 的建议', source: 'history', url: 'https://a.test' };
  h.state.url = 'b.test';
  assert.equal(h.controller.applySuggestion(stale), false, 'stale suggestion must be rejected');
  assert.deepEqual(h.writes, []);

  // 属于当前 URL 的建议可以应用，且应用后名称归用户，后续自动结果不再覆盖
  h.state.url = 'b.test';
  const fresh = { title: 'B 的建议', source: 'history', url: resolveShortcutUrl('b.test').url };
  assert.equal(h.controller.applySuggestion(fresh), true);
  assert.equal(h.state.title, 'B 的建议');
  assert.equal(h.controller.currentSource(), 'user');
});

test('editing an existing item keeps its name and only offers a suggestion', async () => {
  const h = makeHarness({
    candidate: { title: '本地候选', source: 'tab', url: 'https://example.com' },
  });

  h.controller.beginSession(true);
  h.state.url = 'example.com';
  h.state.title = '我自己的名字';
  const inflight = h.controller.onUrlBlur();
  h.settleLast();
  await inflight;

  assert.equal(h.state.title, '我自己的名字', 'editing must not overwrite the stored name');
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.state.suggested, {
    title: '本地候选',
    source: 'tab',
    url: 'https://example.com',
  });
});

test('shouldApplyAutoTitle rejects stale requests and changed URLs', () => {
  const base = {
    requestId: 1,
    latestRequestId: 1,
    requestUrl: TARGET,
    currentUrl: TARGET,
    titleSource: 'empty',
    currentTitle: '',
    candidateSource: 'tab',
    isEditing: false,
  };

  assert.equal(shouldApplyAutoTitle(base), true);
  assert.equal(shouldApplyAutoTitle({ ...base, requestId: 0 }), false, 'older request loses');
  assert.equal(shouldApplyAutoTitle({ ...base, currentUrl: 'https://other.test/' }), false);
  assert.equal(shouldApplyAutoTitle({ ...base, isEditing: true }), false);
  assert.equal(shouldApplyAutoTitle({ ...base, titleSource: 'user' }), false);
  assert.equal(shouldApplyAutoTitle({ ...base, titleSource: 'auto' }), true, 'auto may follow the URL');
  assert.equal(
    shouldApplyAutoTitle({ ...base, currentTitle: '已填内容' }),
    false,
    'empty source must not clobber existing text',
  );
});
