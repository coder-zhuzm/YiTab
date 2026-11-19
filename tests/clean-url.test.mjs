import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCleanMarkdownLink, stripTrackingParams } from '../src/lib/clean-url.ts';

test('stripTrackingParams removes utm and tracking noise while keeping content params and hash', () => {
  assert.equal(
    stripTrackingParams('https://example.com/article?id=42&utm_source=x&fbclid=abc#section-2'),
    'https://example.com/article?id=42#section-2',
  );
  assert.equal(
    stripTrackingParams('https://www.bilibili.com/video/BV1xx?spm_id_from=333.1007&vd_source=abc&p=2'),
    'https://www.bilibili.com/video/BV1xx?p=2',
  );
  assert.equal(
    stripTrackingParams('https://github.com/coder-zhuzm/YiTab'),
    'https://github.com/coder-zhuzm/YiTab',
  );
});

test('formatCleanMarkdownLink escapes brackets and cleans tracking params', () => {
  assert.equal(
    formatCleanMarkdownLink('[RFC] YiTab Design', 'https://example.com/doc?v=1&utm_medium=chat'),
    '[\\[RFC\\] YiTab Design](https://example.com/doc?v=1)',
  );
});
