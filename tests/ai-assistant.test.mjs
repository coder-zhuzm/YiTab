import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkAiCapabilities,
  isBatterySavingActive,
  getCachedAiResult,
  setCachedAiResult,
  getAiCacheStats,
  clearAiCache,
  summarizeDeepRouteTitle,
  naturalLanguageSearchMatch,
  generateMorningBriefing,
  STORAGE_AI_CACHE_KEY,
} from '../src/lib/ai-assistant.ts';

// 模拟 chrome.storage.local
const mockStorage = new Map();
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => {
        if (typeof key === 'string') {
          return { [key]: mockStorage.get(key) };
        }
        return {};
      },
      set: async (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          mockStorage.set(k, v);
        }
      },
      remove: async (key) => {
        mockStorage.delete(key);
      },
    },
  },
};

test('checkAiCapabilities returns graceful fallback in non-ai environment', async () => {
  const cap = await checkAiCapabilities();
  assert.equal(cap.supported, false);
  assert.equal(cap.modelReady, false);
  assert.equal(cap.status, 'no');
});

test('isBatterySavingActive accurately detects low battery state', async () => {
  // 1. 无 battery api 时返回 false
  assert.equal(await isBatterySavingActive(), false);

  // 2. 模拟正在充电，无论电量多低都不判定为省电挂起
  globalThis.navigator.getBattery = async () => ({
    charging: true,
    level: 0.1,
  });
  assert.equal(await isBatterySavingActive(), false);

  // 3. 模拟未插电且电量低于 25% (如 18%) -> 触发省电挂起
  globalThis.navigator.getBattery = async () => ({
    charging: false,
    level: 0.18,
  });
  assert.equal(await isBatterySavingActive(), true);

  // 4. 模拟未插电但电量充沛 (如 80%) -> 不触发省电
  globalThis.navigator.getBattery = async () => ({
    charging: false,
    level: 0.8,
  });
  assert.equal(await isBatterySavingActive(), false);

  delete globalThis.navigator.getBattery;
});

test('persistent LRU cache stores, retrieves, reports stats and clears', async () => {
  mockStorage.clear();

  // 初始为空
  assert.equal(await getCachedAiResult('test_key'), null);
  assert.deepEqual(await getAiCacheStats(), { count: 0 });

  // 写入并读取
  await setCachedAiResult('test_key', 'PROJ-1024 结算重构');
  assert.equal(await getCachedAiResult('test_key'), 'PROJ-1024 结算重构');
  assert.deepEqual(await getAiCacheStats(), { count: 1 });

  // 清空缓存
  await clearAiCache();
  assert.equal(await getCachedAiResult('test_key'), null);
  assert.deepEqual(await getAiCacheStats(), { count: 0 });
});

test('summarizeDeepRouteTitle falls back to cleanCapsuleTitle when AI disabled or unavailable', async () => {
  const title = 'PROJ-8899 订单超时支付自动关闭工单 - Jira';
  const url = 'https://jira.corp.internal/browse/PROJ-8899';

  // 当 AI 关闭时，纯规则直接提取工单号与简介
  const result = await summarizeDeepRouteTitle(title, url, {
    enabled: false,
    capsuleSummarize: true,
    naturalLanguageJump: true,
    taskAutoGrouping: true,
    bookmarkSmartTagging: false,
    morningBriefing: true,
    pauseOnBattery: true,
  });

  assert.ok(result.includes('PROJ-8899'));
});

test('summarizeDeepRouteTitle uses AI and destroys session when available', async () => {
  let sessionDestroyed = false;
  let receivedPrompt = '';

  // 模拟 window.ai 环境
  globalThis.window = {
    ai: {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => ({
          prompt: async (p) => {
            receivedPrompt = p;
            return 'PROJ-8899 订单超时处理';
          },
          destroy: () => {
            sessionDestroyed = true;
          },
        }),
      },
    },
  };

  mockStorage.clear();

  const title = 'PROJ-8899 订单超时支付自动关闭工单 - Jira';
  const url = 'https://jira.corp.internal/browse/PROJ-8899';

  const result = await summarizeDeepRouteTitle(title, url, {
    enabled: true,
    capsuleSummarize: true,
    naturalLanguageJump: true,
    taskAutoGrouping: true,
    bookmarkSmartTagging: false,
    morningBriefing: true,
    pauseOnBattery: false,
  });

  assert.equal(result, 'PROJ-8899 订单超时处理');
  assert.equal(sessionDestroyed, true); // 验证防线 1: 会话被即时销毁
  assert.ok(receivedPrompt.includes('PROJ-8899'));

  // 验证防线 2: 结果已被写入 LRU 缓存，二次访问无需调用 AI
  sessionDestroyed = false;
  const cachedResult = await summarizeDeepRouteTitle(title, url, {
    enabled: true,
    capsuleSummarize: true,
    naturalLanguageJump: true,
    taskAutoGrouping: true,
    bookmarkSmartTagging: false,
    morningBriefing: true,
    pauseOnBattery: false,
  });
  assert.equal(cachedResult, 'PROJ-8899 订单超时处理');
  assert.equal(sessionDestroyed, false); // 未再次唤起会话

  delete globalThis.window;
});

test('naturalLanguageSearchMatch uses rule multi-token filtering when AI disabled', async () => {
  const candidates = [
    { title: 'Kubernetes Pod 故障排查手册', url: 'https://k8s.io/docs/troubleshoot' },
    { title: 'Docker 镜像瘦身实战', url: 'https://docs.docker.com/best-practices' },
    { title: 'GitLab 权限审批 PR #82', url: 'https://gitlab.corp/mr/82' },
  ];

  const matched = await naturalLanguageSearchMatch('权限 PR', candidates, {
    enabled: false,
    capsuleSummarize: true,
    naturalLanguageJump: true,
    taskAutoGrouping: true,
    bookmarkSmartTagging: false,
    morningBriefing: true,
    pauseOnBattery: true,
  });

  assert.equal(matched.length, 1);
  assert.equal(matched[0].title, 'GitLab 权限审批 PR #82');
});

test('generateMorningBriefing returns friendly greeting', async () => {
  const briefing = await generateMorningBriefing(6, 2, {
    enabled: false,
    capsuleSummarize: true,
    naturalLanguageJump: true,
    taskAutoGrouping: true,
    bookmarkSmartTagging: false,
    morningBriefing: true,
    pauseOnBattery: true,
  });

  assert.ok(briefing.includes('6 个活动页面'));
  assert.ok(briefing.includes('2 个未完工现场'));
});
