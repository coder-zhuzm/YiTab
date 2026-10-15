/**
 * YiTab 智能推选引擎 (Recommendations Engine)
 * 基于 RFT（Recency, Frequency, Time-of-Day）自适应时间衰减模型
 * 实现主域名直达与深层路由恢复微胶囊 (Resume Context Capsule) 双态架构
 */

import { isIntranetHost } from './network-utils.ts';

export interface ResumeCapsule {
  url: string;
  title: string;
  cleanTitle: string;
  lastVisitTime: number;
}

export interface RecommendedStation {
  domain: string;
  primaryUrl: string;
  title: string;
  score: number;
  visitCount: number;
  lastVisitTime: number;
  capsule?: ResumeCapsule;
  isOpen?: boolean;
  openTabId?: number;
  openWindowId?: number;
  isIntranet?: boolean;
}

export const STORAGE_RECOMMENDATIONS_CACHE_KEY = 'yitab_recommendations_cache';

/** 7 天半衰期 (毫秒) */
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** 需清洗脱敏的临时凭据与追踪参数 */
const SENSITIVE_OR_TRACKING_PARAMS = new Set([
  'token',
  'access_token',
  'jwt',
  'auth',
  'authcode',
  'session_id',
  'jsessionid',
  'phpsessid',
  '_t',
  't',
  'ts',
  'timestamp',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
]);

/** 常见无需生成胶囊的浅层/无状态路径 */
const SHALLOW_PATHS = new Set([
  '',
  '/',
  '/home',
  '/home/',
  '/index.html',
  '/index.htm',
  '/index.php',
  '/dashboard',
  '/dashboard/',
  '/feed',
  '/welcome',
  '/login',
  '/signin',
  '/logout',
]);

/**
 * 判断 URL 是否属于具有深度工作上下文的页面
 */
export function isDeepRoute(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  try {
    const u = new URL(urlStr);
    const path = u.pathname.toLowerCase();

    // 浅层根路径不生成胶囊
    if (SHALLOW_PATHS.has(path)) {
      // 除非带有业务性查询参数 (如 ?id=... 或 ?issue=...)
      const hasContentQuery = Array.from(u.searchParams.keys()).some((k) =>
        ['id', 'issue', 'ticket', 'pr', 'task', 'doc', 'project', 'item'].includes(
          k.toLowerCase(),
        ),
      );
      return hasContentQuery;
    }

    // 常见工作/内容路由模式
    const deepPattern =
      /\/(issues|pull|merge_requests|ticket|task|doc|wiki|article|post|p|item|project|repo|commits|compare|browse)\/[\w.-]+/i;
    if (deepPattern.test(path)) {
      return true;
    }

    // 多级路径 (深于 2 级，如 /user/repo/tree/main)
    const segments = path.split('/').filter(Boolean);
    if (segments.length >= 2) {
      return true;
    }

    // 查询参数含有业务内容
    if (u.search && u.search.length > 3) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * 脱敏与清洗深层路由 URL，剔除临时身份令牌与追踪垃圾
 */
export function sanitizeResumeUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const keysToDelete: string[] = [];

    u.searchParams.forEach((_, key) => {
      const lower = key.toLowerCase();
      if (
        SENSITIVE_OR_TRACKING_PARAMS.has(lower) ||
        lower.startsWith('utm_') ||
        lower.startsWith('spm')
      ) {
        keysToDelete.push(key);
      }
    });

    for (const key of keysToDelete) {
      u.searchParams.delete(key);
    }

    // 清洗空 Hash
    if (u.hash === '#' || u.hash === '') {
      u.hash = '';
    }

    return u.toString();
  } catch {
    return urlStr;
  }
}

/**
 * 启发式提炼页面标题中的核心任务名（去除网站通用后缀与冗余词）
 */
export function cleanCapsuleTitle(rawTitle: string, urlStr: string): string {
  let title = (rawTitle || '').trim();
  if (!title) {
    // 降级从 URL 提取
    try {
      const u = new URL(urlStr);
      const segs = u.pathname.split('/').filter(Boolean);
      return segs.slice(-1)[0] || u.hostname;
    } catch {
      return '查看详情';
    }
  }

  // 1. 去除常见的网站后缀 (要求连接符前后有空格，或为明确分隔符如 · | —)
  title = title.replace(/\s+[-—–|·_]\s+(Jira|GitHub|GitLab|Confluence|Jenkins|知乎|掘金|V2EX|Stack Overflow|Google|百度).*$/i, '');
  title = title.replace(/\s+[-—–|·_]\s+[\w一-龥]{2,15}$/, '');

  // 2. 检查是否包含标准工单编号 (如 PROJ-1024, #128)
  const ticketMatch = title.match(/([A-Z]{2,10}-\d+|#\d+)/);
  if (ticketMatch) {
    const ticketId = ticketMatch[1];
    // 提取工单号之后的一句话
    const afterTicket = title.slice(title.indexOf(ticketId) + ticketId.length).replace(/^[:：\s-]+/, '').trim();
    if (afterTicket) {
      const snippet = afterTicket.slice(0, 10);
      return `${ticketId} ${snippet}${afterTicket.length > 10 ? '..' : ''}`;
    }
    return ticketId;
  }

  // 3. 截断控制在 14 字符内
  if (title.length > 14) {
    return `${title.slice(0, 13)}…`;
  }

  return title;
}

/**
 * 计算访问时段上下文权重
 */
export function getTimeOfDayMultiplier(
  title: string,
  urlStr: string,
  hour: number,
  isWeekend: boolean,
): number {
  const combined = (title + ' ' + urlStr).toLowerCase();

  if (isWeekend) {
    // 周末偏好技术社区、影音、学习
    if (/v2ex|zhihu|bilibili|youtube|reddit|hacker|blog|news|music/.test(combined)) {
      return 1.35;
    }
    return 1.0;
  }

  // 早间专注 (08:30 - 11:30): 晨会、工单、日历、待办
  if (hour >= 8 && hour < 12) {
    if (/jira|oa|mail|task|standup|todo|calendar|portal|dashboard|kanban/.test(combined)) {
      return 1.3;
    }
  }

  // 下午研发核心时段 (13:30 - 18:30): 仓库、代码、PR、监控、API
  if (hour >= 13 && hour < 19) {
    if (/gitlab|github|pr|pull|commit|api|grafana|jenkins|deploy|k8s|cloud|debug/.test(combined)) {
      return 1.3;
    }
  }

  // 晚间复盘/学习时段 (19:00 - 24:00)
  if (hour >= 19 && hour <= 23) {
    if (/docs|doc|react|vue|book|article|post|v2ex|github/.test(combined)) {
      return 1.25;
    }
  }

  return 1.0;
}

/**
 * 计算单条历史访问的 RFT 得分
 */
export function computeRftScore(
  visit: {
    lastVisitTime: number;
    visitCount: number;
    typedCount?: number;
    title?: string;
    url?: string;
  },
  now = Date.now(),
): number {
  const elapsed = Math.max(0, now - visit.lastVisitTime);
  // 半衰期衰减因子
  const recencyDecay = Math.pow(0.5, elapsed / HALF_LIFE_MS);

  // 频次得分为对数递增，直接在地址栏键入 typedCount 享有高权重
  const frequencyScore =
    Math.log(1 + (visit.visitCount || 1)) * 1.5 + (visit.typedCount || 0) * 2.0;

  // 时段上下文加成
  const dateObj = new Date(now);
  const todMultiplier = getTimeOfDayMultiplier(
    visit.title || '',
    visit.url || '',
    dateObj.getHours(),
    dateObj.getDay() === 0 || dateObj.getDay() === 6,
  );

  return frequencyScore * recencyDecay * todMultiplier;
}

/**
 * 提取主站规范 URL（协议 + 主机名 + 可选端口）
 */
export function extractPrimaryUrl(urlStr: string): { domain: string; primaryUrl: string } {
  try {
    const u = new URL(urlStr);
    const domain = u.hostname.toLowerCase();
    const primaryUrl = `${u.protocol}//${u.host}/`;
    return { domain, primaryUrl };
  } catch {
    return { domain: urlStr, primaryUrl: urlStr };
  }
}

/**
 * 从 Chrome 历史记录列表中计算聚合推荐站点
 */
export function aggregateHistoryRecommendations(
  historyItems: Array<{
    url?: string;
    title?: string;
    lastVisitTime?: number;
    visitCount?: number;
    typedCount?: number;
  }>,
  limit = 8,
  now = Date.now(),
): RecommendedStation[] {
  // 按 domain 归拢聚合
  const domainMap = new Map<
    string,
    {
      domain: string;
      primaryUrl: string;
      bestTitle: string;
      totalScore: number;
      totalVisits: number;
      latestVisitTime: number;
      latestDeepItem?: { url: string; title: string; time: number };
    }
  >();

  for (const item of historyItems) {
    if (!item.url || !item.lastVisitTime) continue;
    // 忽略扩展自身页面及内部页面
    if (item.url.startsWith('chrome://') || item.url.startsWith('chrome-extension://')) {
      continue;
    }

    const { domain, primaryUrl } = extractPrimaryUrl(item.url);
    if (!domain) continue;

    const itemScore = computeRftScore(
      {
        lastVisitTime: item.lastVisitTime,
        visitCount: item.visitCount || 1,
        typedCount: item.typedCount || 0,
        title: item.title,
        url: item.url,
      },
      now,
    );

    const existing = domainMap.get(domain);
    if (!existing) {
      domainMap.set(domain, {
        domain,
        primaryUrl,
        bestTitle: item.title || domain,
        totalScore: itemScore,
        totalVisits: item.visitCount || 1,
        latestVisitTime: item.lastVisitTime,
        latestDeepItem: isDeepRoute(item.url)
          ? { url: item.url, title: item.title || '', time: item.lastVisitTime }
          : undefined,
      });
    } else {
      existing.totalScore += itemScore;
      existing.totalVisits += item.visitCount || 1;
      if (item.lastVisitTime > existing.latestVisitTime) {
        existing.latestVisitTime = item.lastVisitTime;
        if (item.title && item.title.trim()) {
          existing.bestTitle = item.title;
        }
      }
      // 记录最近打开的深层上下文页面
      if (isDeepRoute(item.url)) {
        if (!existing.latestDeepItem || item.lastVisitTime > existing.latestDeepItem.time) {
          existing.latestDeepItem = {
            url: item.url,
            title: item.title || '',
            time: item.lastVisitTime,
          };
        }
      }
    }
  }

  // 排序筛选 Top N
  const ranked = Array.from(domainMap.values())
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, limit);

  return ranked.map((entry) => {
    let capsule: ResumeCapsule | undefined;
    if (entry.latestDeepItem) {
      const sanitized = sanitizeResumeUrl(entry.latestDeepItem.url);
      const cleanTitle = cleanCapsuleTitle(entry.latestDeepItem.title, sanitized);
      capsule = {
        url: sanitized,
        title: entry.latestDeepItem.title,
        cleanTitle,
        lastVisitTime: entry.latestDeepItem.time,
      };
    }

    return {
      domain: entry.domain,
      primaryUrl: entry.primaryUrl,
      title: entry.bestTitle || entry.domain,
      score: entry.totalScore,
      visitCount: entry.totalVisits,
      lastVisitTime: entry.latestVisitTime,
      capsule,
      isIntranet: isIntranetHost(entry.domain),
    };
  });
}

/**
 * 读取本地缓存的推荐结果 (供冷启动 < 30ms 瞬时渲染)
 */
export async function getCachedRecommendations(): Promise<RecommendedStation[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return [];
  }
  try {
    const res = await chrome.storage.local.get(STORAGE_RECOMMENDATIONS_CACHE_KEY);
    const cached = res[STORAGE_RECOMMENDATIONS_CACHE_KEY] as RecommendedStation[] | undefined;
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

/**
 * 异步刷新并写回推荐缓存
 */
export async function refreshAndCacheRecommendations(
  limit = 8,
): Promise<RecommendedStation[]> {
  if (typeof chrome === 'undefined' || !chrome.history?.search) {
    return [];
  }

  try {
    // 读取过去 30 天的高频访问记录 (上限 400 条)
    const startTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const historyItems = await chrome.history.search({
      text: '',
      startTime,
      maxResults: 400,
    });

    const recommendations = aggregateHistoryRecommendations(historyItems, limit);

    // 查询当前已开标签并打标
    if (chrome.tabs?.query) {
      const tabs = await chrome.tabs.query({});
      for (const rec of recommendations) {
        const found = tabs.find((t) => {
          if (!t.url) return false;
          try {
            return new URL(t.url).hostname.toLowerCase() === rec.domain;
          } catch {
            return false;
          }
        });
        if (found) {
          rec.isOpen = true;
          rec.openTabId = found.id;
          rec.openWindowId = found.windowId;
        }
      }
    }

    // 写回本地缓存
    if (chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_RECOMMENDATIONS_CACHE_KEY]: recommendations,
      });
    }

    return recommendations;
  } catch {
    return [];
  }
}
