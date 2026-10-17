/**
 * YiTab 书签快捷直展矩阵 (Bookmarks Direct Matrix)
 * 将收藏夹按根文件夹或核心分类平铺展示，支持毫秒级关键字检索与一键直达
 */

import type { BookmarkItem } from './bookmarks.ts';
import { flattenBookmarkTree } from './bookmarks.ts';

export interface BookmarkFolderCard {
  id: string;
  name: string;
  folderPath: string[];
  totalCount: number;
  /** 默认用于紧凑展示的前 N 项（搜索命中时为全部匹配项） */
  items: BookmarkItem[];
  /** 该分类下全量书签，支持展开全部与全量检索，彻底消除截断限制 */
  allItems?: BookmarkItem[];
}

/**
 * 将平铺书签列表按文件夹分类聚合成卡片分组
 */
export function groupBookmarksByFolders(
  bookmarks: BookmarkItem[],
  maxCards = 12,
  itemsPerCard = 6,
): BookmarkFolderCard[] {
  const folderMap = new Map<string, BookmarkItem[]>();

  for (const b of bookmarks) {
    if (!b.url || b.isInvalid) continue;
    // 取有意义的最后一级或核心文件夹名称
    const folder =
      b.folderPath.length > 0
        ? b.folderPath[b.folderPath.length - 1]
        : '未分类书签';

    if (!folderMap.has(folder)) {
      folderMap.set(folder, []);
    }
    folderMap.get(folder)!.push(b);
  }

  // 转换为卡片数组
  const cards: BookmarkFolderCard[] = [];
  for (const [folderName, items] of folderMap.entries()) {
    cards.push({
      id: `fld_${folderName}`,
      name: folderName,
      folderPath: items[0]?.folderPath || [folderName],
      totalCount: items.length,
      items: items.slice(0, itemsPerCard),
      allItems: items,
    });
  }

  // 数量多的分类排在前面
  cards.sort((a, b) => b.totalCount - a.totalCount);
  return cards.slice(0, maxCards);
}

/**
 * 实时过滤书签卡片与书签项（在全量 allItems 中检索，无截断死角）
 */
export function filterBookmarkCards(
  cards: BookmarkFolderCard[],
  keyword: string,
): BookmarkFolderCard[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return cards;

  const tokens = q.split(/\s+/).filter(Boolean);

  const result: BookmarkFolderCard[] = [];
  for (const card of cards) {
    const pool = card.allItems || card.items;
    const matchedItems = pool.filter((item) => {
      const combined = `${item.title} ${item.url} ${item.domain || ''} ${(item.folderPath || []).join(' ')}`.toLowerCase();
      return tokens.every((token) => combined.includes(token));
    });

    if (matchedItems.length > 0 || tokens.every((token) => card.name.toLowerCase().includes(token))) {
      result.push({
        ...card,
        // 搜索时把匹配项完整呈现，不受切片截断限制
        items: matchedItems.length > 0 ? matchedItems : card.items,
        allItems: card.allItems || card.items,
      });
    }
  }

  return result;
}

/**
 * 从 Chrome 获取并聚类书签目录
 */
export async function loadBookmarkCards(): Promise<BookmarkFolderCard[]> {
  if (typeof chrome === 'undefined' || !chrome.bookmarks?.getTree) {
    return [];
  }
  try {
    const tree = await chrome.bookmarks.getTree();
    const flattened = flattenBookmarkTree(tree);
    return groupBookmarksByFolders(flattened.bookmarks);
  } catch {
    return [];
  }
}
