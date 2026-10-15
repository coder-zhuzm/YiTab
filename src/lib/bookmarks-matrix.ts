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
  items: BookmarkItem[];
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
    });
  }

  // 数量多的分类排在前面
  cards.sort((a, b) => b.totalCount - a.totalCount);
  return cards.slice(0, maxCards);
}

/**
 * 实时过滤书签卡片与书签项
 */
export function filterBookmarkCards(
  cards: BookmarkFolderCard[],
  keyword: string,
): BookmarkFolderCard[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return cards;

  const result: BookmarkFolderCard[] = [];
  for (const card of cards) {
    const matchedItems = card.items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        (item.domain && item.domain.toLowerCase().includes(q)),
    );

    if (matchedItems.length > 0 || card.name.toLowerCase().includes(q)) {
      result.push({
        ...card,
        items: matchedItems.length > 0 ? matchedItems : card.items,
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
