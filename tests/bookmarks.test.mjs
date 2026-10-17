import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBookmarkUrl,
  flattenBookmarkTree,
  computeBookmarkKeepScore,
  selectRecommendedKeepId,
  scanBookmarkDuplicates,
  computeRecommendedDeletePlan,
  exportBookmarksAsNetscapeHtml,
  exportBookmarksAsJson,
  backupBookmarksBeforeClean,
  BOOKMARK_BACKUPS_KEY,
} from '../src/lib/bookmarks.ts';

test('normalizeBookmarkUrl strips tracking params, normalizes www, and preserves route hash', () => {
  // 1. Strips tracking params
  const raw1 = 'https://www.github.com/coder-zhuzm/YiTab?utm_source=twitter&utm_medium=social&page=1';
  const norm1 = normalizeBookmarkUrl(raw1);
  assert.equal(norm1, 'https://github.com/coder-zhuzm/YiTab?page=1');

  // 2. Ignores normal comment anchor but preserves route hash
  const raw2 = 'https://example.com/article#comments';
  assert.equal(normalizeBookmarkUrl(raw2), 'https://example.com/article');

  const raw3 = 'https://example.com/app/#/dashboard?tab=overview';
  assert.equal(normalizeBookmarkUrl(raw3), 'https://example.com/app#/dashboard?tab=overview');

  // 3. Normalizes query param order
  const raw4 = 'https://example.com/search?b=2&a=1';
  const raw5 = 'https://example.com/search?a=1&b=2';
  assert.equal(normalizeBookmarkUrl(raw4), normalizeBookmarkUrl(raw5));

  // 4. Trailing slash normalization
  assert.equal(normalizeBookmarkUrl('https://example.com/path/'), 'https://example.com/path');
});

test('flattenBookmarkTree extracts bookmarks, keeps folder paths, and flags invalid items', () => {
  const tree = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: '书签栏',
          children: [
            {
              id: '10',
              title: 'YiTab GitHub',
              url: 'https://github.com/coder-zhuzm/YiTab',
              dateAdded: 1700000000000,
            },
            {
              id: '2',
              title: '开发工具',
              children: [
                {
                  id: '20',
                  title: 'React 官方文档',
                  url: 'https://react.dev/learn',
                  dateAdded: 1710000000000,
                },
                {
                  id: '21',
                  title: '坏链书签',
                  url: 'javascript:void(0)',
                  dateAdded: 1715000000000,
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const { bookmarks, folderCount } = flattenBookmarkTree(tree);
  assert.equal(bookmarks.length, 3);
  assert.equal(folderCount, 3); // 根、书签栏、开发工具

  const bm10 = bookmarks.find((b) => b.id === '10');
  assert.ok(bm10);
  assert.deepEqual(bm10.folderPath, ['书签栏']);
  assert.equal(bm10.domain, 'github.com');
  assert.equal(bm10.isInvalid, undefined);

  const bm20 = bookmarks.find((b) => b.id === '20');
  assert.ok(bm20);
  assert.deepEqual(bm20.folderPath, ['书签栏', '开发工具']);

  const bm21 = bookmarks.find((b) => b.id === '21');
  assert.ok(bm21);
  assert.equal(bm21.isInvalid, true);
  assert.ok(bm21.invalidReason?.includes('不安全'));
});

test('computeBookmarkKeepScore and selectRecommendedKeepId select best item to keep', () => {
  const itemInRoot = {
    id: 'bm:root',
    title: 'https://github.com/coder-zhuzm/YiTab', // 纯 URL 标题
    url: 'https://github.com/coder-zhuzm/YiTab',
    domain: 'github.com',
    folderPath: ['书签栏'],
    dateAdded: 1720000000000,
  };

  const itemInSubFolder = {
    id: 'bm:subfolder',
    title: 'YiTab 一签 - Chrome 标签页管理套件', // 完整描述性标题
    url: 'https://github.com/coder-zhuzm/YiTab',
    domain: 'github.com',
    folderPath: ['书签栏', '开源项目', '前端扩展'], // 深度分类目录
    dateAdded: 1710000000000, // 更早添加
  };

  const scoreRoot = computeBookmarkKeepScore(itemInRoot);
  const scoreSub = computeBookmarkKeepScore(itemInSubFolder);
  assert.ok(scoreSub > scoreRoot, 'Organized bookmark with descriptive title should score higher');

  const keepId = selectRecommendedKeepId([itemInRoot, itemInSubFolder]);
  assert.equal(keepId, 'bm:subfolder');
});

test('scanBookmarkDuplicates identifies exact and smart duplicate groups', () => {
  const tree = [
    {
      id: '1',
      title: '书签栏',
      children: [
        {
          id: '101',
          title: 'YiTab Repo',
          url: 'https://github.com/coder-zhuzm/YiTab',
          dateAdded: 1700000000000,
        },
        {
          id: '102',
          title: 'YiTab Twitter Link',
          url: 'https://github.com/coder-zhuzm/YiTab?utm_source=twitter',
          dateAdded: 1710000000000,
        },
        {
          id: '103',
          title: 'Unique Bookmark',
          url: 'https://vite.dev',
          dateAdded: 1720000000000,
        },
      ],
    },
  ];

  const report = scanBookmarkDuplicates(tree);
  assert.equal(report.totalBookmarks, 3);
  assert.equal(report.duplicateGroupCount, 1);
  assert.equal(report.duplicateBookmarkCount, 2);
  assert.equal(report.redundantCount, 1);

  const group = report.groups[0];
  assert.equal(group.normalizedUrl, 'https://github.com/coder-zhuzm/YiTab');
  assert.equal(group.items.length, 2);
  assert.equal(group.recommendedKeepId, '101'); // 101 has dateAdded earlier and non-tracking title

  const plan = computeRecommendedDeletePlan(report.groups);
  assert.deepEqual(plan.deleteIds, ['102']);
  assert.deepEqual(plan.keepIds, ['101']);
});

test('exportBookmarksAsNetscapeHtml and exportBookmarksAsJson produce standard formats', () => {
  const tree = [
    {
      id: '1',
      title: '书签栏',
      children: [
        {
          id: '10',
          title: 'YiTab & Extensions',
          url: 'https://github.com/coder-zhuzm/YiTab',
          dateAdded: 1700000000000,
        },
      ],
    },
  ];

  // Netscape HTML
  const html = exportBookmarksAsNetscapeHtml(tree);
  assert.ok(html.includes('<!DOCTYPE NETSCAPE-Bookmark-file-1>'));
  assert.ok(html.includes('<H1>Bookmarks</H1>'));
  assert.ok(html.includes('<H3'));
  assert.ok(html.includes('书签栏'));
  assert.ok(html.includes('<A HREF="https://github.com/coder-zhuzm/YiTab"'));
  assert.ok(html.includes('YiTab &amp; Extensions')); // XML entity escaped

  // JSON
  const jsonStr = exportBookmarksAsJson(tree);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.totalBookmarks, 1);
  assert.equal(parsed.bookmarks[0].title, 'YiTab & Extensions');
  assert.equal(parsed.bookmarks[0].domain, 'github.com');
  assert.equal(parsed.bookmarks[0].url, 'https://github.com/coder-zhuzm/YiTab');
});

test('normalizeBookmarkUrl preserves deep and single-segment route hashes to prevent duplicate collapse', () => {
  // 单段深层路由如 #route/a vs #route/b 必须区分
  const routeA = normalizeBookmarkUrl('https://example.com/#route/a');
  const routeB = normalizeBookmarkUrl('https://example.com/#route/b');
  assert.equal(routeA, 'https://example.com/#route/a');
  assert.equal(routeB, 'https://example.com/#route/b');
  assert.notEqual(routeA, routeB);

  // 参数型 hash
  const queryHash = normalizeBookmarkUrl('https://example.com/app#page?id=123');
  assert.equal(queryHash, 'https://example.com/app#page?id=123');

  // 网页应用与邮件单段路由如 #inbox vs #sent 必须保留
  const gmailInbox = normalizeBookmarkUrl('https://mail.google.com/mail/u/0/#inbox');
  const gmailSent = normalizeBookmarkUrl('https://mail.google.com/mail/u/0/#sent');
  assert.equal(gmailInbox, 'https://mail.google.com/mail/u/0#inbox');
  assert.equal(gmailSent, 'https://mail.google.com/mail/u/0#sent');
  assert.notEqual(gmailInbox, gmailSent);
});

test('backupBookmarksBeforeClean automatically saves snapshots to storage and rotates to max 5', async () => {
  const store = new Map();
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store.get(key) }),
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) {
            store.set(k, v);
          }
        },
      },
    },
  };

  const sampleTree = [
    {
      id: '1',
      title: '书签栏',
      children: [
        { id: '10', title: 'Test 1', url: 'https://example.com/1' },
      ],
    },
  ];

  // 连续备份 6 次
  for (let i = 1; i <= 6; i++) {
    await backupBookmarksBeforeClean(sampleTree, `Clean reason ${i}`);
  }

  const backups = store.get(BOOKMARK_BACKUPS_KEY);
  assert.equal(backups.length, 5); // 严格上限 5 份
  assert.equal(backups[0].reason, 'Clean reason 6'); // 最新在最前
  assert.equal(backups[4].reason, 'Clean reason 2'); // 最旧的被轮转淘汰

  // 验证防抖机制：同原因高频调用不消耗新的轮转插槽
  const snap1 = await backupBookmarksBeforeClean(sampleTree, 'Same Clean Session');
  const snap2 = await backupBookmarksBeforeClean(sampleTree, 'Same Clean Session');
  assert.equal(snap1.id, snap2.id, 'High-frequency deletions with identical reason should reuse snapshot');
});
