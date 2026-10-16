import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeTabAfterSwitch, isLastTabInWindow, switchToTab } from '../src/lib/tab-close.ts';

/** 可控的 tabs 替身：记录所有破坏性调用，便于断言「绝未调用 remove」。 */
function makeApi({
  tab,
  siblings = [],
  siblingsByWindow = null,
  queryThrows = false,
  removeThrows = false,
  updateThrows = false,
  beforeQuery = null,
} = {}) {
  const calls = { get: 0, query: 0, queryWindows: [], remove: [], update: [] };
  return {
    calls,
    // tab 可以是单个对象，也可以是按调用顺序返回的序列（末项重复），
    // 用于模拟「两次 get 之间源标签发生了变化」
    get: async (tabId) => {
      calls.get++;
      const next = Array.isArray(tab) ? (tab.length > 1 ? tab.shift() : tab[0]) : tab;
      if (!next) throw new Error('No tab with id ' + tabId);
      return next;
    },
    query: async ({ windowId }) => {
      calls.query++;
      calls.queryWindows.push(windowId);
      // 屏障：让测试在「窗口查询进行中」注入状态变化，而不是调用前预设 stale
      if (beforeQuery) await beforeQuery();
      if (queryThrows) throw new Error('query failed');
      return siblingsByWindow ? (siblingsByWindow[windowId] ?? []) : siblings;
    },
    remove: async (tabId) => {
      calls.remove.push(tabId);
      if (removeThrows) throw new Error('remove failed');
    },
    update: async (tabId, props) => {
      calls.update.push({ tabId, ...props });
      if (updateThrows) throw new Error('update failed');
      return { id: tabId, ...props };
    },
  };
}

const SOURCE = 'https://example.com/dup';
const CONFIRM = 'chrome-extension://abc/confirm.html?u=https%3A%2F%2Fexample.com%2Fdup';

test('R2: source tab moved to another window during the await is not closed', async () => {
  // 源标签原本在窗口 A（还有别的标签）；await 期间用户把它拖进窗口 B，成了 B 的唯一标签。
  // 删除前必须重新 get，读到实时 windowId=B 并发现它是最后一个标签 -> 只能退回空白页。
  const api = makeApi({
    tab: { url: SOURCE, windowId: 2 }, // 实时：已在窗口 B
    siblings: [{ id: 9, windowId: 2 }], // 窗口 B 里只有它自己
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => false);

  assert.equal(outcome, 'reset_to_newtab');
  assert.deepEqual(api.calls.remove, [], 'must not remove the tab that is alone in its window');
  assert.deepEqual(api.calls.update, [{ tabId: 1, url: 'chrome://newtab' }]);
});

test('R2: source tab still sharing its window is closed normally', async () => {
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }, { id: 2 }],
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => false);

  assert.equal(outcome, 'closed');
  assert.deepEqual(api.calls.remove, [1]);
});

test('R2: source tab that navigated away during the await is left alone', async () => {
  const api = makeApi({
    tab: { url: 'https://elsewhere.test/page', windowId: 1 },
    siblings: [{ id: 1 }, { id: 2 }],
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'user navigated the source tab; do not close it');
  assert.equal(api.calls.query, 0, 'should bail before the window query');
});

test('R2: a newer navigation event invalidates the pending close', async () => {
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }, { id: 2 }],
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => true);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, []);
});

test('R2: tab already gone is a no-op', async () => {
  const api = makeApi({ tab: null });
  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => false);
  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, []);
});

test('R3: window query failure must abort the close, never remove', async () => {
  // 单标签窗口里 tabs.query 抛错：HEAD 会把源标签留下，若把「无法判断」当成可删就会关掉窗口
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    queryThrows: true,
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'unknown window state must never lead to a remove');
  assert.deepEqual(api.calls.update, [], 'and must not navigate the tab either');
});

test('R3: isLastTabInWindow reports unknown instead of guessing', async () => {
  assert.equal(await isLastTabInWindow(makeApi({ queryThrows: true }), 1), 'unknown');
  assert.equal(await isLastTabInWindow(makeApi({ siblings: [{ id: 1 }] }), 1), 'yes');
  assert.equal(await isLastTabInWindow(makeApi({ siblings: [{ id: 1 }, { id: 2 }] }), 1), 'no');
});

test('R3: a failed remove propagates instead of being silently swallowed', async () => {
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }, { id: 2 }],
    removeThrows: true,
  });

  await assert.rejects(() => closeTabAfterSwitch(api, 1, SOURCE, () => false));
});

/* ------------------------------------------------------------------ *
 * 问题 1：确认页切换后必须真正关闭源确认页
 * ------------------------------------------------------------------ */

test('Issue1: switching from the confirmation page closes the source confirmation tab', async () => {
  // 确认页自己发起 switchTab，此时源标签就是一个非空 URL 的确认页。
  // 若调用方传空 expectedUrl，守卫会因「URL 不匹配」永远返回 skipped，源确认页永远留着。
  const api = makeApi({
    tab: { url: CONFIRM, windowId: 1 },
    siblings: [{ id: 5 }, { id: 6 }],
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'closed');
  assert.deepEqual(api.calls.remove, [5], 'source confirmation tab must be closed');
});

test('Issue1: source tab that left the confirmation page is preserved', async () => {
  // 用户趁切换的空档在源标签里导航去了别处 -> 不能关掉它
  const api = makeApi({
    tab: { url: 'https://elsewhere.test/', windowId: 1 },
    siblings: [{ id: 5 }, { id: 6 }],
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, []);
});

test('Issue1: confirmation page alone in its window falls back to a new tab page', async () => {
  const api = makeApi({
    tab: { url: CONFIRM, windowId: 1 },
    siblings: [{ id: 5 }],
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'reset_to_newtab');
  assert.deepEqual(api.calls.remove, [], 'must not close the last tab of a window');
  assert.deepEqual(api.calls.update, [{ tabId: 5, url: 'chrome://newtab' }]);
});

test('Issue1: an empty expectedUrl must not disable the URL check', async () => {
  // 空 expectedUrl 是「无法校验」而非「跳过校验」——守卫不应据此关闭任意内容的标签。
  // 调用方必须传入真实 URL；这里直接锁定该契约，防止有人靠删掉校验来"修"问题。
  const api = makeApi({
    tab: { url: 'https://user-was-typing.test/form', windowId: 1 },
    siblings: [{ id: 5 }, { id: 6 }],
  });

  const outcome = await closeTabAfterSwitch(api, 5, '', () => false);

  assert.equal(outcome, 'skipped', 'empty expectedUrl must not be treated as "matches anything"');
  assert.deepEqual(api.calls.remove, []);
});

/* ------------------------------------------------------------------ *
 * 问题 2：窗口查询期间的状态变化必须使关闭计划失效
 * ------------------------------------------------------------------ */

test('Issue2: navigation during the window query cancels the remove', async () => {
  // 窗口查询挂起期间发生新导航 -> 查询返回后必须重新检查，不能继续 remove
  let stale = false;
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }, { id: 2 }],
    beforeQuery: async () => {
      stale = true; // 屏障：正是在「查询进行中」这一刻状态变了
    },
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => stale);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'must re-check staleness AFTER the query resolves');
});

test('Issue2: navigation during the window query cancels the new-tab reset', async () => {
  // 唯一标签分支同样必须在查询后复核
  let stale = false;
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }],
    beforeQuery: async () => {
      stale = true;
    },
  });

  const outcome = await closeTabAfterSwitch(api, 1, SOURCE, () => stale);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.update, [], 'must not navigate a tab whose plan went stale');
});

test('Issue2: a fresh plan still proceeds on both branches', async () => {
  const closed = makeApi({ tab: { url: SOURCE, windowId: 1 }, siblings: [{ id: 1 }, { id: 2 }] });
  assert.equal(await closeTabAfterSwitch(closed, 1, SOURCE, () => false), 'closed');

  const reset = makeApi({ tab: { url: SOURCE, windowId: 1 }, siblings: [{ id: 1 }] });
  assert.equal(await closeTabAfterSwitch(reset, 1, SOURCE, () => false), 'reset_to_newtab');
});

test('Issue2b: source navigating away DURING the window query cancels the close', async () => {
  // 关键：调用方（switchToTab）传的是恒 false 的 isStale，窗口移动也不改导航 seq，
  // 因此只靠 isStale() 挡不住这种情况 —— 必须在查询后重新读取源标签自身。
  const api = makeApi({
    // 第一次 get：确认页；第二次 get（查询后复核）：已导航到别处
    tab: [
      { url: CONFIRM, windowId: 1 },
      { url: 'https://user-typing.test/form', windowId: 1 },
    ],
    siblings: [{ id: 5 }, { id: 6 }],
    // 屏障：正是在窗口查询挂起期间发生导航
    beforeQuery: async () => {},
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'source navigated during the query; must not close it');
});

test('Issue2b: source moving to another window DURING the query cancels the close', async () => {
  // 源标签原本在窗口 1（还有别的标签）→ 查询窗口 1 会返回多个标签，看起来"可以删"。
  // 但查询期间用户把它拖进窗口 2，而它在窗口 2 是唯一标签 —— 删掉会连窗口 2 一起关。
  // 必须在查询后重新读取源标签的 windowId，并用它重新判断。
  const api = makeApi({
    tab: [
      { url: CONFIRM, windowId: 1 }, // 查询前
      { url: CONFIRM, windowId: 2 }, // 查询后：已移到窗口 2
    ],
    // 按被查询的窗口返回：窗口 1 有多个标签，窗口 2 只有它自己
    siblingsByWindow: { 1: [{ id: 5 }, { id: 6 }, { id: 7 }], 2: [{ id: 5 }] },
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'window changed during the query; old close plan must be cancelled');
});

test('Issue2b: any window change invalidates the plan, even into a roomier window', async () => {
  // 契约：只要源标签的 windowId 与本次计数所用的不一致，旧计划一律作废（不做二次计数重试）。
  // 这是刻意选择的安全侧 —— 代价是极窄竞态下源确认页可能残留，用户手动关闭即可。
  const api = makeApi({
    tab: [
      { url: CONFIRM, windowId: 1 },
      { url: CONFIRM, windowId: 2 },
    ],
    siblingsByWindow: { 1: [{ id: 5 }, { id: 6 }], 2: [{ id: 5 }, { id: 8 }] },
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, []);
});

test('Issue2b: an unchanged source still closes, and the count uses its live window', async () => {
  const api = makeApi({
    tab: { url: CONFIRM, windowId: 3 },
    siblingsByWindow: { 3: [{ id: 5 }, { id: 6 }] },
  });

  const outcome = await closeTabAfterSwitch(api, 5, CONFIRM, () => false);

  assert.equal(outcome, 'closed');
  assert.deepEqual(api.calls.queryWindows, [3], 'must count tabs in the window the source is actually in');
});

/* ------------------------------------------------------------------ *
 * 问题 3：重置失败不得伪报成功
 * ------------------------------------------------------------------ */

test('Issue3: a failed new-tab reset propagates instead of reporting success', async () => {
  const api = makeApi({
    tab: { url: SOURCE, windowId: 1 },
    siblings: [{ id: 1 }],
    updateThrows: true,
  });

  await assert.rejects(
    () => closeTabAfterSwitch(api, 1, SOURCE, () => false),
    'a rejected update must not be reported as reset_to_newtab',
  );
});

/* ------------------------------------------------------------------ *
 * 问题 1 调用链：switchToTab 必须自己记录源标签地址
 * ------------------------------------------------------------------ */

function makeSwitchApi({ tab, siblings = [] } = {}) {
  const api = makeApi({ tab, siblings });
  api.focusWindow = async (windowId) => {
    api.calls.focusWindow = (api.calls.focusWindow ?? 0) + 1;
    return { id: windowId };
  };
  return api;
}

test('Issue1 chain: switchToTab closes the source confirmation page end-to-end', async () => {
  const api = makeSwitchApi({
    tab: { url: CONFIRM, windowId: 1 },
    siblings: [{ id: 5 }, { id: 6 }],
  });

  const outcome = await switchToTab(api, { tabId: 6, windowId: 1, closeSelf: true }, 5);

  assert.equal(outcome, 'closed');
  assert.deepEqual(api.calls.remove, [5], 'the confirmation tab must actually be closed');
  assert.ok(api.calls.update.some((u) => u.tabId === 6 && u.active === true), 'target must be activated');
  assert.equal(api.calls.focusWindow, 1, 'target window must be focused');
});

test('Issue1 chain: switchToTab preserves the source tab if it moved on', async () => {
  // 第一次 get（切换前记录地址）看到的是确认页；第二次 get（关闭前复核）它已经导航到别处
  const api = makeSwitchApi({
    tab: [
      { url: CONFIRM, windowId: 1 },
      { url: 'https://user-typing.test/form', windowId: 1 },
    ],
    siblings: [{ id: 5 }, { id: 6 }],
  });

  const outcome = await switchToTab(api, { tabId: 6, windowId: 1, closeSelf: true }, 5);

  assert.equal(outcome, 'skipped');
  assert.deepEqual(api.calls.remove, [], 'source navigated away during the switch; do not close it');
});

test('Issue1 chain: switchToTab never closes the last tab of a window', async () => {
  const api = makeSwitchApi({ tab: { url: CONFIRM, windowId: 1 }, siblings: [{ id: 5 }] });

  const outcome = await switchToTab(api, { tabId: 6, windowId: 1, closeSelf: true }, 5);

  assert.equal(outcome, 'reset_to_newtab');
  assert.deepEqual(api.calls.remove, []);
  assert.ok(api.calls.update.some((u) => u.tabId === 5 && u.url === 'chrome://newtab'));
});

test('Issue1 chain: closeSelf=false only activates the target', async () => {
  const api = makeSwitchApi({ tab: { url: CONFIRM, windowId: 1 }, siblings: [{ id: 5 }, { id: 6 }] });

  const outcome = await switchToTab(api, { tabId: 6, windowId: 1, closeSelf: false }, 5);

  assert.equal(outcome, 'noop');
  assert.deepEqual(api.calls.remove, []);
  assert.equal(api.calls.get, 0, 'no need to read the source tab when not closing it');
});

test('Issue1 chain: a vanished source tab is a no-op, not an error', async () => {
  const api = makeSwitchApi({ tab: null, siblings: [{ id: 6 }] });

  const outcome = await switchToTab(api, { tabId: 6, windowId: 1, closeSelf: true }, 5);

  assert.equal(outcome, 'noop');
  assert.deepEqual(api.calls.remove, []);
});
