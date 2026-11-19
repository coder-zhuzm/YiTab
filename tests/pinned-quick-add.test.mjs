import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPinnedByUrl,
  normalizePinnedUrl,
} from '../src/lib/pinned.ts';

test('normalizePinnedUrl strips tracking params and root trailing slash', () => {
  assert.equal(
    normalizePinnedUrl('https://GitHub.com/?utm_source=twitter&fbclid=123'),
    'https://github.com',
  );
  assert.equal(
    normalizePinnedUrl('https://github.com/coder-zhuzm/YiTab/?utm_medium=social'),
    'https://github.com/coder-zhuzm/YiTab',
  );
  assert.equal(
    normalizePinnedUrl('https://example.com/search?q=yitab&utm_campaign=launch'),
    'https://example.com/search?q=yitab',
  );
});

test('findPinnedByUrl deduplicates equivalent URLs across tracking params and trailing slash', () => {
  const data = {
    groups: [{ id: 'dev', name: '常用研发工具', order: 1 }],
    items: [
      {
        id: 'pin_1',
        title: 'GitHub',
        url: 'https://github.com',
        groupId: 'dev',
        createdAt: 1,
      },
    ],
  };

  const hit1 = findPinnedByUrl(data, 'https://github.com/?utm_source=abc');
  assert.equal(hit1?.id, 'pin_1');

  const miss = findPinnedByUrl(data, 'https://github.com/explore');
  assert.equal(miss, undefined);
});
