/**
 * YiTab 搜索与命令执行引擎
 * 提供跨已开标签页 (Tabs)、书签 (Bookmarks)、历史记录 (History) 与快捷指令 (Commands) 的统一检索与排序
 */

export type SearchItemKind = 'tab' | 'bookmark' | 'history' | 'command';

export interface SearchItem {
  id: string;
  kind: SearchItemKind;
  title: string;
  url?: string;
  domain?: string;
  favicon?: string;
  tabId?: number;
  windowId?: number;
  active?: boolean;
  groupId?: number;
  groupTitle?: string;
  groupColor?: string;
  description?: string;
  commandAction?: string;
  score?: number;
}

export interface ActionCommand {
  id: string;
  action: string;
  title: string;
  description: string;
  keywords: string[];
  icon: string;
}

/** 内置全局快捷指令库 */
export const ACTION_COMMANDS: ActionCommand[] = [
  {
    id: 'cmd:auto_group',
    action: 'auto_group',
    title: '按域名智能归拢标签',
    description: '将当前窗口相同域名的网页（≥2项）自动聚合成彩色标签组',
    keywords: ['group', 'domain', 'fenlei', 'fenzu', 'guilong', '域名', '分组', '归拢', '整理'],
    icon: 'group',
  },
  {
    id: 'cmd:ungroup_all',
    action: 'ungroup_all',
    title: '解散全部标签分组',
    description: '解散当前窗口的所有 Chrome 原生标签组，还原平铺状态',
    keywords: ['ungroup', 'jiesan', 'chexiao', 'huanyuan', '解散', '撤销', '还原', '取消分组'],
    icon: 'ungroup',
  },
  {
    id: 'cmd:save_snapshot',
    action: 'save_snapshot',
    title: '保存当前会话快照',
    description: '暂存当前窗口全部标签页为可恢复的会话快照',
    keywords: ['snapshot', 'save', 'kuaizhao', 'baocun', '快照', '保存', '备份'],
    icon: 'snapshot',
  },
  {
    id: 'cmd:export_markdown',
    action: 'export_markdown',
    title: '以 Markdown 列表复制全部标签',
    description: '将当前窗口标签整理为 - [标题](链接) 格式并写入剪贴板',
    keywords: ['export', 'markdown', 'md', 'list', 'daochu', 'fuzhi', '导出', '复制', '列表'],
    icon: 'markdown',
  },
  {
    id: 'cmd:export_table',
    action: 'export_table',
    title: '以 Markdown 表格复制全部标签',
    description: '将当前窗口标签整理为格式化的 Markdown 表格并写入剪贴板',
    keywords: ['export', 'table', 'biaoge', '表格', '复制'],
    icon: 'table',
  },
  {
    id: 'cmd:export_urls',
    action: 'export_urls',
    title: '复制所有标签网址 (纯文本)',
    description: '将所有标签 URL 按行提取并复制到剪贴板',
    keywords: ['export', 'urls', 'link', 'lianjie', '纯网址', '提取链接'],
    icon: 'url',
  },
  {
    id: 'cmd:open_options',
    action: 'open_options',
    title: '打开规则配置中心',
    description: '配置去重匹配粒度（智能/URL/路径/域名）与白名单规则',
    keywords: ['options', 'settings', 'shezhi', 'peizhi', 'guize', '设置', '配置', '规则', '选项'],
    icon: 'settings',
  },
  {
    id: 'cmd:close_duplicates',
    action: 'close_duplicates',
    title: '一键扫描并清理重复标签',
    description: '关闭当前窗口中与现有标签重复的冗余页面',
    keywords: ['clean', 'dedup', 'chongfu', 'qingli', '清理', '去重', '关闭重复'],
    icon: 'clean',
  },
];

/** 提取干净的显示域名 */
export function extractHostname(urlStr?: string): string {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * 字符串模糊匹配与评分算法
 * @param query 用户输入的搜索词
 * @param target 被匹配的目标文本
 * @returns 匹配得分（0 表示不匹配）
 */
export function scoreStringMatch(query: string, target: string): number {
  if (!query || !target) return 0;
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 100; // 完全一致
  if (t.startsWith(q)) return 85; // 前缀匹配
  if (t.includes(' ' + q) || t.includes('.' + q) || t.includes('/' + q) || t.includes('-' + q)) {
    return 75; // 词边界匹配
  }
  const subIdx = t.indexOf(q);
  if (subIdx !== -1) {
    // 子串匹配，越靠前分数越高
    return Math.max(40, 70 - Math.min(30, subIdx * 2));
  }

  // 简易子序列模糊匹配 (Fuzzy subsequence match)
  let qIdx = 0;
  let matches = 0;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++;
      matches++;
    }
  }
  if (qIdx === q.length) {
    // 字符全按序出现
    return 30;
  }

  return 0;
}

/**
 * 多关键字综合评分计算
 */
export function computeItemScore(query: string, item: SearchItem): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;

  const tokens = q.split(/\s+/).filter(Boolean);

  let totalScore = 0;

  for (const token of tokens) {
    // 匹配标题
    const titleScore = scoreStringMatch(token, item.title);
    // 匹配域名
    const domainScore = item.domain ? scoreStringMatch(token, item.domain) : 0;
    // 匹配 URL
    const urlScore = item.url ? scoreStringMatch(token, item.url) : 0;
    // 匹配描述 / 关键字
    const descScore = item.description ? scoreStringMatch(token, item.description) : 0;

    const tokenBest = Math.max(
      titleScore * 1.0,
      domainScore * 0.85,
      urlScore * 0.7,
      descScore * 0.75,
    );

    if (tokenBest === 0) {
      // 必须包含全部搜索词（AND 逻辑）
      return 0;
    }
    totalScore += tokenBest;
  }

  // 类别加权
  if (item.kind === 'tab') {
    totalScore += 25; // 优先展现已开标签页
    if (item.active) totalScore += 10;
  } else if (item.kind === 'command') {
    totalScore += 20; // 快捷指令次之
  } else if (item.kind === 'bookmark') {
    totalScore += 15; // 书签
  } else if (item.kind === 'history') {
    totalScore += 5; // 历史记录
  }

  return totalScore;
}

/**
 * 过滤与排序结果
 */
export function filterAndRankItems(
  items: SearchItem[],
  query: string,
  kindFilter: 'all' | SearchItemKind = 'all',
  limit = 30,
): SearchItem[] {
  const filtered = kindFilter === 'all' ? items : items.filter((i) => i.kind === kindFilter);

  if (!query.trim()) {
    return filtered.slice(0, limit);
  }

  const scored: SearchItem[] = [];
  for (const item of filtered) {
    const score = computeItemScore(query, item);
    if (score > 0) {
      scored.push({ ...item, score });
    }
  }

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.slice(0, limit);
}

/**
 * XML 特殊字符转义（供 Chrome Omnibox API 使用）
 */
export function escapeOmniboxXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 将检索项格式化为 Chrome Omnibox SuggestResult
 */
export function formatOmniboxSuggest(
  item: SearchItem,
  query: string,
): { content: string; description: string } {
  let content = item.url || '';
  if (item.kind === 'tab' && item.tabId != null) {
    content = `tab:${item.tabId}:${item.windowId ?? 0}`;
  } else if (item.kind === 'command' && item.commandAction) {
    content = `action:${item.commandAction}`;
  }

  const prefixTag =
    item.kind === 'tab'
      ? '[标签]'
      : item.kind === 'command'
        ? '[指令]'
        : item.kind === 'bookmark'
          ? '[书签]'
          : '[历史]';

  const cleanTitle = escapeOmniboxXml(item.title);
  const cleanDomain = escapeOmniboxXml(item.domain || item.description || '');

  // 高亮 query
  const qEsc = escapeOmniboxXml(query.trim());
  let highlightedTitle = cleanTitle;
  if (qEsc && cleanTitle.toLowerCase().includes(qEsc.toLowerCase())) {
    const reg = new RegExp(`(${qEsc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    highlightedTitle = cleanTitle.replace(reg, '<match>$1</match>');
  }

  const description = `<match>${prefixTag}</match> ${highlightedTitle} <dim>- ${cleanDomain}</dim>`;

  return { content, description };
}
