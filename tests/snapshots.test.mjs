import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCleanDomain,
  analyzeTabsByDomain,
  getDeterministicColor,
  formatTabsExport,
} from '../src/lib/snapshots.ts';

test('extractCleanDomain extracts hostname without leading www', () => {
  assert.equal(extractCleanDomain('https://www.github.com/coder-zhuzm/YiTab'), 'github.com');
  assert.equal(extractCleanDomain('https://github.com/coder-zhuzm/YiTab'), 'github.com');
  assert.equal(extractCleanDomain('http://www.bilibili.com/video/BV123'), 'bilibili.com');
  assert.equal(extractCleanDomain('https://developer.chrome.com/docs/extensions'), 'developer.chrome.com');
  assert.equal(extractCleanDomain('not-a-valid-url'), 'unknown');
});

test('analyzeTabsByDomain clusters tabs by domain with minCount filter', () => {
  const tabs = [
    { id: 1, url: 'https://github.com/coder-zhuzm/YiTab' },
    { id: 2, url: 'https://github.com/coder-zhuzm/blog' },
    { id: 3, url: 'https://github.com/facebook/react' },
    { id: 4, url: 'https://bilibili.com/video/1' },
    { id: 5, url: 'https://www.bilibili.com/video/2' },
    { id: 6, url: 'https://google.com/search?q=yitab' }, // count = 1, should be filtered by default minCount=2
    { id: 7, url: 'chrome://extensions/' }, // internal, should be ignored
  ];

  const analysis = analyzeTabsByDomain(tabs, 2);
  assert.equal(analysis.length, 2);

  // github.com has 3 tabs
  const gh = analysis.find(a => a.domain === 'github.com');
  assert.ok(gh);
  assert.equal(gh.count, 3);
  assert.deepEqual(gh.tabIds, [1, 2, 3]);

  // bilibili.com has 2 tabs
  const bili = analysis.find(a => a.domain === 'bilibili.com');
  assert.ok(bili);
  assert.equal(bili.count, 2);
  assert.deepEqual(bili.tabIds, [4, 5]);

  // With minCount = 1, google.com is included
  const analysisAll = analyzeTabsByDomain(tabs, 1);
  assert.equal(analysisAll.length, 3);
  assert.ok(analysisAll.some(a => a.domain === 'google.com'));
});

test('getDeterministicColor consistently maps strings to tab group colors', () => {
  const color1 = getDeterministicColor('github.com');
  const color2 = getDeterministicColor('github.com');
  assert.equal(color1, color2);
  assert.ok(typeof color1 === 'string' && color1.length > 0);
});

test('formatTabsExport formats tabs to Markdown list, table, URLs, and JSON', () => {
  const tabs = [
    { title: 'YiTab Project', url: 'https://github.com/coder-zhuzm/YiTab' },
    { title: 'React Docs', url: 'https://react.dev' },
  ];

  // Markdown List
  const mdList = formatTabsExport(tabs, 'markdown_list');
  assert.equal(
    mdList,
    '- [YiTab Project](https://github.com/coder-zhuzm/YiTab)\n- [React Docs](https://react.dev)',
  );

  // Markdown Table
  const mdTable = formatTabsExport(tabs, 'markdown_table');
  assert.ok(mdTable.includes('| 序号 | 标签页标题 | 域名 | 链接 |'));
  assert.ok(mdTable.includes('| 1 | YiTab Project | github.com | [打开链接](https://github.com/coder-zhuzm/YiTab) |'));
  assert.ok(mdTable.includes('| 2 | React Docs | react.dev | [打开链接](https://react.dev) |'));

  // URLs Only
  const urlsOnly = formatTabsExport(tabs, 'urls_only');
  assert.equal(urlsOnly, 'https://github.com/coder-zhuzm/YiTab\nhttps://react.dev');

  // JSON
  const jsonText = formatTabsExport(tabs, 'json');
  const parsed = JSON.parse(jsonText);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, 'YiTab Project');
  assert.equal(parsed[0].url, 'https://github.com/coder-zhuzm/YiTab');
  assert.equal(parsed[0].domain, 'github.com');
});
