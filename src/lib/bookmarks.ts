/**
 * YiTab 书签生态与数据维护工具库
 * 包含书签遍历、智能去重、死链/失效检查、推荐合并算法以及标准 Netscape HTML 备份导出
 */

import { extractHostname } from './search.ts';

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  folderPath: string[];
  dateAdded?: number;
  isInvalid?: boolean;
  invalidReason?: string;
}

export interface BookmarkDuplicateGroup {
  groupKey: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  items: BookmarkItem[];
  recommendedKeepId: string;
  isExactUrl: boolean;
}

export interface BookmarkScanReport {
  totalBookmarks: number;
  totalFolders: number;
  duplicateGroupCount: number;
  duplicateBookmarkCount: number;
  redundantCount: number; // 可清理的多余副本数量
  invalidCount: number;
  groups: BookmarkDuplicateGroup[];
  invalidItems: BookmarkItem[];
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
]);

/** 规范化书签 URL，用于智能去重比较 */
export function normalizeBookmarkUrl(rawUrl: string, smart = true): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return trimmed;
    }

    if (!smart) {
      return parsed.href;
    }

    // 智能模式：移除 tracking 参数、排序查询参数、忽略普通页面锚点
    const params = new Map<string, string[]>();
    for (const [k, v] of parsed.searchParams.entries()) {
      const lowerKey = k.toLowerCase();
      if (!lowerKey.startsWith('utm_') && !TRACKING_PARAMS.has(lowerKey)) {
        if (!params.has(k)) params.set(k, []);
        params.get(k)!.push(v);
      }
    }

    // 按 key 字典序排序
    const sortedKeys = Array.from(params.keys()).sort();
    const cleanParams = new URLSearchParams();
    for (const k of sortedKeys) {
      for (const val of params.get(k)!) {
        cleanParams.append(k, val);
      }
    }

    // 检查 hash 是否为前端路由 (如 #/login 或 #!/path)
    let cleanHash = '';
    if (parsed.hash && (/^#[/!]/u.test(parsed.hash) || parsed.hash.includes('?'))) {
      cleanHash = parsed.hash;
    }

    const host = parsed.hostname.replace(/^www\./i, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    const searchStr = cleanParams.toString() ? `?${cleanParams.toString()}` : '';
    return `${parsed.protocol}//${host}${port}${pathname}${searchStr}${cleanHash}`;
  } catch {
    return trimmed;
  }
}

/** 递归展平书签树，提取所有有效书签与文件夹路径 */
export function flattenBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  currentPath: string[] = [],
): { bookmarks: BookmarkItem[]; folderCount: number } {
  let bookmarks: BookmarkItem[] = [];
  let folderCount = 0;

  for (const node of nodes) {
    if (node.url) {
      // 叶子节点：具体书签
      const item: BookmarkItem = {
        id: node.id,
        title: node.title?.trim() || node.url,
        url: node.url,
        domain: extractHostname(node.url) || 'unknown',
        folderPath: [...currentPath],
        dateAdded: node.dateAdded,
      };

      // 校验 URL 有效性
      try {
        const u = new URL(node.url);
        if (!/^https?:|file:|chrome:|edge:/i.test(u.protocol)) {
          item.isInvalid = true;
          item.invalidReason = `不支持或不安全的协议: ${u.protocol}`;
        }
      } catch {
        item.isInvalid = true;
        item.invalidReason = '无效的 URL 格式';
      }

      bookmarks.push(item);
    } else if (node.children) {
      // 目录节点：文件夹
      folderCount += 1;
      const nextPath = node.title ? [...currentPath, node.title.trim()] : currentPath;
      const sub = flattenBookmarkTree(node.children, nextPath);
      bookmarks = bookmarks.concat(sub.bookmarks);
      folderCount += sub.folderCount;
    }
  }

  return { bookmarks, folderCount };
}

/** 计算书签项的质量保留分，用于智能推荐保留最佳书签 */
export function computeBookmarkKeepScore(item: BookmarkItem): number {
  let score = 0;

  // 1. 文件夹组织深度奖励：在较深分类目录下的书签更有整理价值，书签栏根目录分值较低
  const depth = item.folderPath.length;
  score += depth * 20;

  // 2. 标题质量奖励：有自定义标题优于纯 URL 作为标题
  const title = item.title.trim();
  if (title && title !== item.url) {
    score += 30;
    score += Math.min(title.length, 10);
  }

  // 3. 干净 URL 奖励：去除营销追踪参数 (utm_* 等) 的原始地址更优先保留
  const hasTracking = /[?&](utm_|gclid|fbclid|dclid|msclkid)/i.test(item.url);
  if (hasTracking) {
    score -= 25;
  } else {
    score += 15;
  }

  // 4. 历史久远度：创建时间越早（说明是原始收藏），稍微加分
  if (item.dateAdded && item.dateAdded > 0) {
    // 归一化时间加分 (0~10分)
    const ageDays = (Date.now() - item.dateAdded) / (1000 * 60 * 60 * 24);
    score += Math.min(Math.floor(ageDays / 30), 10);
  }

  return score;
}

/** 智能推选出推荐保留的书签 ID */
export function selectRecommendedKeepId(items: BookmarkItem[]): string {
  if (!items.length) return '';
  if (items.length === 1) return items[0].id;

  let bestItem = items[0];
  let bestScore = computeBookmarkKeepScore(bestItem);

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    const score = computeBookmarkKeepScore(item);
    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    } else if (score === bestScore) {
      // 平局时优先保留创建时间较早的（最早添加）
      if ((item.dateAdded ?? Infinity) < (bestItem.dateAdded ?? Infinity)) {
        bestItem = item;
      }
    }
  }

  return bestItem.id;
}

/** 扫描全量书签树并生成重复与异常健康检测报告 */
export function scanBookmarkDuplicates(
  tree: chrome.bookmarks.BookmarkTreeNode[],
): BookmarkScanReport {
  const { bookmarks, folderCount } = flattenBookmarkTree(tree);

  const groupMap = new Map<string, BookmarkItem[]>();
  const invalidItems: BookmarkItem[] = [];

  for (const bm of bookmarks) {
    if (bm.isInvalid) {
      invalidItems.push(bm);
      continue;
    }

    const normKey = normalizeBookmarkUrl(bm.url, true);
    if (!normKey) {
      invalidItems.push({ ...bm, isInvalid: true, invalidReason: '空或无法解析的地址' });
      continue;
    }

    const list = groupMap.get(normKey) ?? [];
    list.push(bm);
    groupMap.set(normKey, list);
  }

  const groups: BookmarkDuplicateGroup[] = [];
  let redundantCount = 0;
  let duplicateBookmarkCount = 0;

  for (const [normKey, items] of groupMap.entries()) {
    if (items.length > 1) {
      duplicateBookmarkCount += items.length;
      redundantCount += items.length - 1;

      // 检查是否全为完全相同原始 URL
      const isExact = items.every((it) => it.url === items[0].url);
      const recommendedKeepId = selectRecommendedKeepId(items);

      // 选取最具代表性的标题
      const bestTitle =
        items.find((it) => it.id === recommendedKeepId)?.title || items[0].title || normKey;

      groups.push({
        groupKey: normKey,
        normalizedUrl: normKey,
        domain: items[0].domain || extractHostname(normKey),
        title: bestTitle,
        items,
        recommendedKeepId,
        isExactUrl: isExact,
      });
    }
  }

  // 按重复数量从多到少排序
  groups.sort((a, b) => b.items.length - a.items.length);

  return {
    totalBookmarks: bookmarks.length,
    totalFolders: folderCount,
    duplicateGroupCount: groups.length,
    duplicateBookmarkCount,
    redundantCount,
    invalidCount: invalidItems.length,
    groups,
    invalidItems,
  };
}

/** 计算一键推荐清理方案要删除的书签 ID 列表 */
export function computeRecommendedDeletePlan(groups: BookmarkDuplicateGroup[]): {
  deleteIds: string[];
  keepIds: string[];
} {
  const deleteIds: string[] = [];
  const keepIds: string[] = [];

  for (const g of groups) {
    keepIds.push(g.recommendedKeepId);
    for (const it of g.items) {
      if (it.id !== g.recommendedKeepId) {
        deleteIds.push(it.id);
      }
    }
  }

  return { deleteIds, keepIds };
}

function escapeBookmarkHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 导出为标准 Netscape Bookmark HTML 格式（可被各类主流浏览器直接无缝导入） */
export function exportBookmarksAsNetscapeHtml(
  tree: chrome.bookmarks.BookmarkTreeNode[],
): string {
  const nowUnix = Math.floor(Date.now() / 1000);

  function renderNode(node: chrome.bookmarks.BookmarkTreeNode, indent = '    '): string {
    if (node.url) {
      const title = escapeBookmarkHtml(node.title || node.url);
      const safeUrl = node.url.replace(/"/g, '&quot;');
      const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : nowUnix;
      return `${indent}<DT><A HREF="${safeUrl}" ADD_DATE="${addDate}">${title}</A>\n`;
    }

    if (node.children) {
      const title = escapeBookmarkHtml(node.title || 'Bookmarks');
      const addDate = node.dateAdded ? Math.floor(node.dateAdded / 1000) : nowUnix;
      let out = `${indent}<DT><H3 ADD_DATE="${addDate}">${title}</H3>\n`;
      out += `${indent}<DL><p>\n`;
      for (const child of node.children) {
        out += renderNode(child, indent + '    ');
      }
      out += `${indent}</DL><p>\n`;
      return out;
    }

    return '';
  }

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file by YiTab. -->
<!-- Do not edit with a regular text editor if you want to preserve format. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;

  for (const rootNode of tree) {
    if (rootNode.id === '0' || !rootNode.title) {
      if (rootNode.children) {
        for (const child of rootNode.children) {
          html += renderNode(child, '    ');
        }
      }
    } else {
      html += renderNode(rootNode, '    ');
    }
  }

  html += '</DL><p>\n';
  return html;
}

/** 导出书签为结构化 JSON 格式 */
export function exportBookmarksAsJson(tree: chrome.bookmarks.BookmarkTreeNode[]): string {
  const { bookmarks } = flattenBookmarkTree(tree);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      generator: 'YiTab (https://github.com/coder-zhuzm/YiTab)',
      totalBookmarks: bookmarks.length,
      bookmarks: bookmarks.map((b) => ({
        id: b.id,
        title: b.title,
        url: b.url,
        domain: b.domain,
        folderPath: b.folderPath.join(' / '),
        dateAdded: b.dateAdded ? new Date(b.dateAdded).toISOString() : undefined,
      })),
    },
    null,
    2,
  );
}
