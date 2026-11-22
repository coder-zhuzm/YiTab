import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchQuery } from '../src/lib/network-utils.ts';

test('plain query: no explicit engine, exact-match branch may run', () => {
  const r = parseSearchQuery('github');
  assert.equal(r.explicitEngine, false);
  assert.equal(r.engine.id, 'google');
  assert.equal(r.cleanQuery, 'github');
  assert.equal(r.isAddress, false);
});

test('plain query with surrounding spaces is trimmed', () => {
  const r = parseSearchQuery('  github  ');
  assert.equal(r.explicitEngine, false);
  assert.equal(r.cleanQuery, 'github');
});

test('engine prefix: explicit engine, exact-match branch must not run', () => {
  const r = parseSearchQuery('g github');
  assert.equal(r.explicitEngine, true);
  assert.equal(r.engine.id, 'google');
  assert.equal(r.cleanQuery, 'github');
  assert.equal(r.isAddress, false);
});

test('engine prefix for another engine', () => {
  const r = parseSearchQuery('b 深度学习');
  assert.equal(r.explicitEngine, true);
  assert.equal(r.engine.id, 'baidu');
  assert.equal(r.cleanQuery, '深度学习');
});

test('direct address: no explicit engine', () => {
  const r = parseSearchQuery('github.com');
  assert.equal(r.explicitEngine, false);
  assert.equal(r.isAddress, true);
  assert.equal(r.targetUrl, 'https://github.com');
});

test('empty query: no explicit engine', () => {
  const r = parseSearchQuery('   ');
  assert.equal(r.explicitEngine, false);
  assert.equal(r.cleanQuery, '');
});
