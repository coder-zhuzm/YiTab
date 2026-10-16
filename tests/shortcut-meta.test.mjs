import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupLocalTitle,
  shouldApplyAutoTitle,
  HISTORY_LOOKBACK_MS,
  HISTORY_MAX_RESULTS,
} from '../src/lib/shortcut-meta.ts';

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

  const [call] = api.calls.history;
  assert.equal(call.url, TARGET);
  assert.equal(call.maxResults, HISTORY_MAX_RESULTS, 'must cap result count');
  assert.equal(call.startTime, now - HISTORY_LOOKBACK_MS, 'must set an explicit lookback window');
});

test('lookupLocalTitle never blocks on failures and never invents a title', async () => {
  assert.equal(await lookupLocalTitle(makeApi({ tabsThrow: true, historyThrow: true }), TARGET), null);
  assert.equal(await lookupLocalTitle(makeApi({ tabsThrow: true, historyThrow: true }), TARGET), null);
  // 空标题不算命中
  assert.equal(await lookupLocalTitle(makeApi({ tabs: [{ url: TARGET, title: '   ' }] }), TARGET), null);
  assert.equal(await lookupLocalTitle(makeApi({}), ''), null);
});

const base = {
  requestId: 2,
  latestRequestId: 2,
  requestUrl: TARGET,
  currentUrl: TARGET,
  titleSource: 'empty',
  currentTitle: '',
  candidateSource: 'tab',
  isEditing: false,
};

test('shouldApplyAutoTitle rejects stale requests and changed URLs', () => {
  assert.equal(shouldApplyAutoTitle({ ...base, requestId: 1, latestRequestId: 2 }), false);
  assert.equal(shouldApplyAutoTitle({ ...base, currentUrl: 'https://example.com/other' }), false);
});

test('shouldApplyAutoTitle never overwrites a user-authored title', () => {
  assert.equal(shouldApplyAutoTitle({ ...base, titleSource: 'user', currentTitle: '我手填的名字' }), false);
  // 来源标记为 auto 但字段里已有内容 -> 允许随 URL 更新
  assert.equal(shouldApplyAutoTitle({ ...base, titleSource: 'auto', currentTitle: '旧自动名' }), true);
  // 来源为空但字段有内容（用户刚输入、事件尚未回写）-> 保守不覆盖
  assert.equal(shouldApplyAutoTitle({ ...base, titleSource: 'empty', currentTitle: '正在输入' }), false);
});

test('shouldApplyAutoTitle only suggests when editing an existing item', () => {
  assert.equal(shouldApplyAutoTitle({ ...base, isEditing: true }), false);
  assert.equal(shouldApplyAutoTitle({ ...base, isEditing: false }), true);
});
