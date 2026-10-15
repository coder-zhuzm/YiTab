import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreStringMatch,
  computeItemScore,
  filterAndRankItems,
  escapeOmniboxXml,
  formatOmniboxSuggest,
  ACTION_COMMANDS,
  extractHostname,
} from '../src/lib/search.ts';

test('extractHostname extracts domain without leading www', () => {
  assert.equal(extractHostname('https://www.github.com/coder-zhuzm/YiTab'), 'github.com');
  assert.equal(extractHostname('https://developer.chrome.com/docs/extensions'), 'developer.chrome.com');
  assert.equal(extractHostname('http://localhost:3000/app'), 'localhost');
  assert.equal(extractHostname(''), '');
  assert.equal(extractHostname('not-a-valid-url'), '');
});

test('scoreStringMatch scores exact, prefix, word boundary, and substring correctly', () => {
  // 1. Exact match
  assert.equal(scoreStringMatch('github', 'github'), 100);

  // 2. Prefix match
  assert.equal(scoreStringMatch('git', 'github'), 85);

  // 3. Word boundary match
  assert.equal(scoreStringMatch('tab', 'Yi Tab Extension'), 75);
  assert.equal(scoreStringMatch('doc', 'api.doc.example.com'), 75);

  // 4. Substring match
  assert.ok(scoreStringMatch('hub', 'github') >= 40);
  assert.ok(scoreStringMatch('tab', 'YiTab Extension') >= 60);

  // 5. Fuzzy subsequence match
  assert.equal(scoreStringMatch('gh', 'github'), 30);

  // 6. Non-match
  assert.equal(scoreStringMatch('xyz', 'github'), 0);
  assert.equal(scoreStringMatch('', 'github'), 0);
});

test('computeItemScore calculates multi-token score with category boosting', () => {
  const tabItem = {
    id: 'tab:1',
    kind: 'tab',
    title: 'Issue #42: Dual-layer navigation interception · coder-zhuzm/YiTab',
    url: 'https://github.com/coder-zhuzm/YiTab/issues/42',
    domain: 'github.com',
    active: true,
  };

  const bookmarkItem = {
    id: 'bm:1',
    kind: 'bookmark',
    title: 'GitHub Issues Dashboard',
    url: 'https://github.com/issues',
    domain: 'github.com',
  };

  const commandItem = {
    id: 'cmd:auto_group',
    kind: 'command',
    title: '按域名智能归拢标签',
    description: '将当前窗口相同域名的网页自动聚合成彩色标签组',
    commandAction: 'auto_group',
  };

  // Search "github issue" -> tab matches both tokens
  const tabScore = computeItemScore('github issue', tabItem);
  assert.ok(tabScore > 50, `Tab score should be high, got ${tabScore}`);

  // Search "github" -> tab scores higher than bookmark due to tab category and active boost
  const tabSingle = computeItemScore('github', tabItem);
  const bmSingle = computeItemScore('github', bookmarkItem);
  assert.ok(tabSingle > bmSingle, 'Active tab should score higher than bookmark for same keyword');

  // Search "归拢" -> matches command
  const cmdScore = computeItemScore('归拢', commandItem);
  assert.ok(cmdScore > 50, `Command score should be positive, got ${cmdScore}`);

  // Non-matching token fails the AND condition
  const failScore = computeItemScore('github nonexistingkeyword', tabItem);
  assert.equal(failScore, 0, 'Missing token should return 0');
});

test('filterAndRankItems ranks higher scoring items first and supports kind filtering', () => {
  const items = [
    {
      id: 'hist:1',
      kind: 'history',
      title: 'Old Chrome Extension Doc',
      url: 'https://developer.chrome.com/docs/extensions/mv2',
      domain: 'developer.chrome.com',
    },
    {
      id: 'tab:1',
      kind: 'tab',
      title: 'Chrome Extensions MV3 Migration Guide',
      url: 'https://developer.chrome.com/docs/extensions/develop/migrate',
      domain: 'developer.chrome.com',
      active: true,
    },
    {
      id: 'cmd:open_options',
      kind: 'command',
      title: '打开规则配置中心',
      description: '配置去重规则',
      commandAction: 'open_options',
    },
  ];

  // Search "chrome" across all
  const allRanked = filterAndRankItems(items, 'chrome', 'all');
  assert.equal(allRanked.length, 2);
  assert.equal(allRanked[0].id, 'tab:1', 'Active tab should rank first');
  assert.equal(allRanked[1].id, 'hist:1');

  // Filter only history
  const historyOnly = filterAndRankItems(items, 'chrome', 'history');
  assert.equal(historyOnly.length, 1);
  assert.equal(historyOnly[0].id, 'hist:1');

  // Filter only commands
  const cmdOnly = filterAndRankItems(items, '配置', 'command');
  assert.equal(cmdOnly.length, 1);
  assert.equal(cmdOnly[0].id, 'cmd:open_options');

  // Empty query returns list up to limit
  const emptyQuery = filterAndRankItems(items, '', 'all', 2);
  assert.equal(emptyQuery.length, 2);
});

test('escapeOmniboxXml escapes XML entities required by Chrome Omnibox', () => {
  const raw = `Tom & Jerry <cartoon> "2024" 'best'`;
  const escaped = escapeOmniboxXml(raw);
  assert.equal(escaped, 'Tom &amp; Jerry &lt;cartoon&gt; &quot;2024&quot; &apos;best&apos;');
  assert.ok(!escaped.includes('<cartoon>'));
  assert.ok(!escaped.includes('& '));
});

test('formatOmniboxSuggest formats tab, command, and bookmark suggestions with valid markup', () => {
  const tabItem = {
    id: 'tab:42',
    kind: 'tab',
    title: 'React 18 & TypeScript Guide',
    url: 'https://react.dev/learn',
    domain: 'react.dev',
    tabId: 42,
    windowId: 1,
  };

  const suggestion = formatOmniboxSuggest(tabItem, 'React');
  assert.equal(suggestion.content, 'tab:42:1');
  assert.ok(suggestion.description.includes('<match>[标签]</match>'));
  assert.ok(suggestion.description.includes('<match>React</match>'));
  assert.ok(suggestion.description.includes('&amp;'));
  assert.ok(suggestion.description.includes('<dim>- react.dev</dim>'));

  const cmdItem = {
    id: 'cmd:auto_group',
    kind: 'command',
    title: '按域名智能归拢标签',
    commandAction: 'auto_group',
    description: '自动分组',
  };
  const cmdSuggest = formatOmniboxSuggest(cmdItem, '归拢');
  assert.equal(cmdSuggest.content, 'action:auto_group');
  assert.ok(cmdSuggest.description.includes('<match>[指令]</match>'));
  assert.ok(cmdSuggest.description.includes('<match>归拢</match>'));
});

test('ACTION_COMMANDS contains required productivity commands', () => {
  const actions = ACTION_COMMANDS.map((c) => c.action);
  assert.ok(actions.includes('auto_group'));
  assert.ok(actions.includes('ungroup_all'));
  assert.ok(actions.includes('save_snapshot'));
  assert.ok(actions.includes('export_markdown'));
  assert.ok(actions.includes('export_table'));
  assert.ok(actions.includes('open_options'));
  assert.ok(actions.includes('close_duplicates'));

  for (const cmd of ACTION_COMMANDS) {
    assert.ok(cmd.title.length > 0);
    assert.ok(cmd.description.length > 0);
    assert.ok(cmd.keywords.length > 0);
  }
});
