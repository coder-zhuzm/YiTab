import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppVersion, APP_VERSION } from '../src/lib/version.ts';
import pkg from '../package.json' with { type: 'json' };

test('getAppVersion correctly returns package.json version in non-extension environment', () => {
  assert.equal(getAppVersion(), pkg.version);
  assert.equal(APP_VERSION, `v${pkg.version}`);
  // 必须是合法的 SemVer 格式（如 1.1.0）
  assert.match(getAppVersion(), /^\d+\.\d+\.\d+/);
});

test('getAppVersion prioritizes chrome.runtime.getManifest() when available', () => {
  const originalChrome = globalThis.chrome;
  try {
    // 模拟 Chrome 扩展运行时返回更新版本
    globalThis.chrome = {
      runtime: {
        getManifest: () => ({
          name: 'YiTab 一签',
          version: '9.9.9',
        }),
      },
    };

    assert.equal(getAppVersion(), '9.9.9');
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('getAppVersion falls back to package.json when getManifest throws', () => {
  const originalChrome = globalThis.chrome;
  try {
    globalThis.chrome = {
      runtime: {
        getManifest: () => {
          throw new Error('context invalidated');
        },
      },
    };

    assert.equal(getAppVersion(), pkg.version);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
