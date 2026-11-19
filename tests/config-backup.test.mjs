import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_BACKUP_SCHEMA_VERSION, parseConfigBackup } from '../src/lib/config-backup.ts';

test('parseConfigBackup accepts valid payload and sanitizes rules', () => {
  const payload = {
    schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-11-19T00:00:00.000Z',
    appVersion: 'v1.3.1',
    themeMode: 'dark',
    settings: {
      matchMode: 'smart',
      interceptMode: 'ask',
      whitelist: ['GitHub.com', 'https://example.com/path'],
      siteRules: [
        { domain: 'docs.example.com', mode: 'path', ignoredParams: ['ref'], includeSubdomains: true },
      ],
      ignoreReload: true,
      hashPolicy: 'keep',
      spaPolicy: 'toast',
    },
    newTabSettings: { openInNewTab: true, iconMode: 'browser' },
    pinnedData: {
      groups: [{ id: 'dev', name: '开发', order: 1 }],
      items: [
        { id: 'p1', title: 'GitHub', url: 'https://github.com', groupId: 'dev', createdAt: 1 },
        { id: 'p2', title: 'Bad', url: 'javascript:alert(1)', groupId: 'dev', createdAt: 2 },
      ],
    },
    aiSettings: { enabled: false },
  };

  const res = parseConfigBackup(JSON.stringify(payload));
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.data.settings.whitelist, ['github.com', 'example.com']);
    assert.equal(res.data.themeMode, 'dark');
    assert.equal(res.data.pinnedData.items.length, 1);
    assert.equal(res.data.pinnedData.items[0].url, 'https://github.com');
  }
});

test('parseConfigBackup rejects malformed JSON and unsupported schema version', () => {
  const badJson = parseConfigBackup('{broken');
  assert.equal(badJson.ok, false);

  const badVersion = parseConfigBackup(JSON.stringify({ schemaVersion: 999 }));
  assert.equal(badVersion.ok, false);

  const missingPinned = parseConfigBackup(
    JSON.stringify({ schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION, settings: {} }),
  );
  assert.equal(missingPinned.ok, false);
});
