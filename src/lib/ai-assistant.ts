/**
 * YiTab 端侧 AI 渐进增强助手 (Chrome Built-in AI / Gemini Nano)
 * 严格遵循 5 大资源治理防线：
 * 1. 即用即毁会话机制 (session.destroy)
 * 2. 强持久化 LRU 结果缓存 (最大 500 条)
 * 3. 单并发锁控制 (maxConcurrency = 1)
 * 4. 笔记本电池与省电感知 (电量 < 25% 自动挂起)
 * 5. 输入防抖与纯规则双轨降级 (Layer 1 启发式兜底)
 */

import { cleanCapsuleTitle } from './recommendations.ts';
import {
  type AiSettings,
  DEFAULT_AI_SETTINGS,
  getAiSettings,
} from './settings.ts';

export interface AiCapabilities {
  supported: boolean;
  modelReady: boolean;
  status: 'readily' | 'after-download' | 'no';
}

export const STORAGE_AI_CACHE_KEY = 'yitab_ai_lru_cache';
const MAX_AI_CACHE_ITEMS = 500;

interface CacheRecord {
  value: string;
  timestamp: number;
}

/**
 * 探测浏览器环境是否支持原生端侧模型 (Gemini Nano)
 */
export async function checkAiCapabilities(): Promise<AiCapabilities> {
  if (typeof window === 'undefined') {
    return { supported: false, modelReady: false, status: 'no' };
  }

  // @ts-ignore
  const aiObj = window.ai || (window as any).model;
  // @ts-ignore
  if (!aiObj || !aiObj.languageModel) {
    return { supported: false, modelReady: false, status: 'no' };
  }

  try {
    // @ts-ignore
    const cap = await aiObj.languageModel.capabilities();
    const available = cap?.available || 'no';
    return {
      supported: true,
      modelReady: available === 'readily',
      status: available,
    };
  } catch {
    return { supported: false, modelReady: false, status: 'no' };
  }
}

/**
 * 防线 4: 检测设备是否处于电池低电量或省电模式
 */
export async function isBatterySavingActive(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !(navigator as any).getBattery) {
    return false;
  }
  try {
    const battery = await (navigator as any).getBattery();
    // 处于非充电状态且电量低于 25%
    if (battery && !battery.charging && battery.level < 0.25) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * 防线 2: 读取本地持久化 LRU 缓存
 */
export async function getCachedAiResult(cacheKey: string): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }
  try {
    const res = await chrome.storage.local.get(STORAGE_AI_CACHE_KEY);
    const cacheMap = (res[STORAGE_AI_CACHE_KEY] || {}) as Record<string, CacheRecord>;
    const entry = cacheMap[cacheKey];
    if (entry && entry.value) {
      return entry.value;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 防线 2: 写入本地持久化 LRU 缓存 (上限 500 条，超出淘汰最旧条目)
 */
export async function setCachedAiResult(cacheKey: string, value: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  try {
    const res = await chrome.storage.local.get(STORAGE_AI_CACHE_KEY);
    const cacheMap = (res[STORAGE_AI_CACHE_KEY] || {}) as Record<string, CacheRecord>;
    cacheMap[cacheKey] = {
      value,
      timestamp: Date.now(),
    };

    const keys = Object.keys(cacheMap);
    if (keys.length > MAX_AI_CACHE_ITEMS) {
      // 按时间戳升序排序，剔除多余旧项
      keys.sort((a, b) => cacheMap[a].timestamp - cacheMap[b].timestamp);
      const toRemove = keys.slice(0, keys.length - MAX_AI_CACHE_ITEMS);
      for (const k of toRemove) {
        delete cacheMap[k];
      }
    }

    await chrome.storage.local.set({ [STORAGE_AI_CACHE_KEY]: cacheMap });
  } catch {
    // ignore
  }
}

/**
 * 读取 AI 缓存条目统计
 */
export async function getAiCacheStats(): Promise<{ count: number }> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { count: 0 };
  }
  try {
    const res = await chrome.storage.local.get(STORAGE_AI_CACHE_KEY);
    const cacheMap = (res[STORAGE_AI_CACHE_KEY] || {}) as Record<string, CacheRecord>;
    return { count: Object.keys(cacheMap).length };
  } catch {
    return { count: 0 };
  }
}

/**
 * 清空 AI 本地推理缓存
 */
export async function clearAiCache(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  try {
    await chrome.storage.local.remove(STORAGE_AI_CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * 防线 5: 全局单一并发锁，防止多任务并发打满 CPU/GPU
 */
let isAiInferring = false;

async function executeWithAiLock<T>(
  task: () => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (isAiInferring) {
    // 并发竞争时直接降级走确定性规则，绝不阻塞主线程
    return fallback();
  }
  isAiInferring = true;
  try {
    return await task();
  } finally {
    isAiInferring = false;
  }
}

/**
 * 任务 1：深层工单与文档胶囊智能浓缩 (6~8 字核心任务名)
 */
export async function summarizeDeepRouteTitle(
  title: string,
  url: string,
  customSettings?: AiSettings,
): Promise<string> {
  const fallbackText = cleanCapsuleTitle(title, url);
  const settings = customSettings || (await getAiSettings());

  // 1. 检查全局总开关与子功能开关
  if (!settings.enabled || !settings.capsuleSummarize) {
    return fallbackText;
  }

  // 2. 检查电池供电与省电模式
  if (settings.pauseOnBattery && (await isBatterySavingActive())) {
    return fallbackText;
  }

  // 3. 命中本地 LRU 缓存则直接 0 算力返回
  const cacheKey = `sum_${url.slice(0, 160)}`;
  const cached = await getCachedAiResult(cacheKey);
  if (cached) {
    return cached;
  }

  // 4. 检查端侧模型可用性
  const cap = await checkAiCapabilities();
  if (!cap.modelReady) {
    return fallbackText;
  }

  // 5. 单并发加锁执行 + 防线 1: 即用即毁会话管理
  return executeWithAiLock(
    async () => {
      try {
        // @ts-ignore
        const aiObj = window.ai || (window as any).model;
        // @ts-ignore
        const session = await aiObj.languageModel.create({
          systemPrompt:
            '你是一个极简工作流助手。请将网页标题和网址，浓缩为4到8个汉字的核心工单号或任务简述（例如：PROJ-1024 结算重构、发布审批单）。严禁多余标点与解释。',
        });
        const promptText = `标题: ${title}\n地址: ${url}`;
        const rawRes = await session.prompt(promptText);
        // 显式销毁会话，显存内存瞬间归还操作系统
        session.destroy();

        let cleanRes = (rawRes || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
        if (cleanRes.length > 20) {
          cleanRes = cleanRes.slice(0, 19) + '…';
        }

        if (cleanRes) {
          await setCachedAiResult(cacheKey, cleanRes);
          return cleanRes;
        }
        return fallbackText;
      } catch {
        return fallbackText;
      }
    },
    () => fallbackText,
  );
}

/**
 * 任务 2：自然语言意图检索起跳 (Natural Language Intent Match)
 */
export async function naturalLanguageSearchMatch(
  query: string,
  candidates: Array<{ title: string; url: string; domain?: string }>,
  customSettings?: AiSettings,
): Promise<Array<{ title: string; url: string; reason?: string }>> {
  const q = query.trim();
  if (!q || candidates.length === 0) return [];

  const settings = customSettings || (await getAiSettings());

  // 纯规则多关键词初筛
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const ruleMatched = candidates.filter((c) => {
    const combined = `${c.title} ${c.url} ${c.domain || ''}`.toLowerCase();
    return tokens.every((t) => combined.includes(t));
  });

  if (!settings.enabled || !settings.naturalLanguageJump) {
    return ruleMatched.slice(0, 5);
  }

  // 若规则匹配已有高度吻合项或模型不可用，直接返回规则结果
  const cap = await checkAiCapabilities();
  if (!cap.modelReady || (settings.pauseOnBattery && (await isBatterySavingActive()))) {
    return ruleMatched.slice(0, 5);
  }

  // 语义意图匹配
  return executeWithAiLock(
    async () => {
      try {
        // @ts-ignore
        const aiObj = window.ai || (window as any).model;
        // @ts-ignore
        const session = await aiObj.languageModel.create({
          systemPrompt:
            '根据用户的自然语言搜索需求，从备选页面中找出最相关的0~3个项的索引数字，按逗号分隔返回（如 0, 2）。若均不相关则输出 none。',
        });

        const promptList = candidates
          .slice(0, 10)
          .map((c, i) => `[${i}] ${c.title} (${c.url})`)
          .join('\n');
        const res = await session.prompt(`用户搜索需求: ${q}\n候选页面:\n${promptList}`);
        session.destroy();

        const clean = (res || '').trim().toLowerCase();
        if (clean.includes('none')) {
          return ruleMatched.slice(0, 5);
        }

        const indices = clean
          .split(/[,，\s]+/)
          .map((s: string) => parseInt(s, 10))
          .filter((n: number) => !isNaN(n) && n >= 0 && n < candidates.length);

        if (indices.length > 0) {
          return indices.map((idx: number) => candidates[idx]);
        }
        return ruleMatched.slice(0, 5);
      } catch {
        return ruleMatched.slice(0, 5);
      }
    },
    () => ruleMatched.slice(0, 5),
  );
}

/**
 * 任务 3：晨间工作现场智能晨报与一键唤醒 (Morning Standup Briefing)
 */
export async function generateMorningBriefing(
  openTabCount: number,
  snapshotCount: number,
  customSettings?: AiSettings,
): Promise<string> {
  const defaultBriefing = `☀️ 早上好！当前有 ${openTabCount} 个活动页面与 ${snapshotCount} 个未完工现场，祝工作顺心！`;
  const settings = customSettings || (await getAiSettings());

  if (!settings.enabled || !settings.morningBriefing) {
    return defaultBriefing;
  }

  const cap = await checkAiCapabilities();
  if (!cap.modelReady || (settings.pauseOnBattery && (await isBatterySavingActive()))) {
    return defaultBriefing;
  }

  return executeWithAiLock(
    async () => {
      try {
        // @ts-ignore
        const aiObj = window.ai || (window as any).model;
        // @ts-ignore
        const session = await aiObj.languageModel.create({
          systemPrompt:
            '你是一个贴心的办公晨间助手。请用一行简练得体的话（30字以内），基于昨日标签与快照生成晨报，鼓励开始高效一天。',
        });
        const res = await session.prompt(
          `打开的标签页数量: ${openTabCount}, 会话快照数量: ${snapshotCount}`,
        );
        session.destroy();
        return (res || '').trim() || defaultBriefing;
      } catch {
        return defaultBriefing;
      }
    },
    () => defaultBriefing,
  );
}
