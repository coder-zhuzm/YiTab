import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  BookOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  MoreOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  SettingOutlined,
  UpOutlined,
} from '@ant-design/icons';
import {
  Button,
  ConfigProvider,
  Dropdown,
  Form,
  Input,
  type InputRef,
  message,
  Modal,
  Popconfirm,
  Select,
  theme,
} from 'antd';
import {
  filterBookmarkCards,
  loadBookmarkCards,
  type BookmarkFolderCard,
} from '@/lib/bookmarks-matrix';
import type { BookmarkItem } from '@/lib/bookmarks';
import {
  browserFaviconUrl,
  formatTimeGreeting,
  generateSvgFavicon,
  isIntranetHost,
  parseSearchQuery,
  resolveShortcutUrl,
  SEARCH_ENGINES,
} from '@/lib/network-utils';
import {
  createShortcutMetaController,
  lookupLocalTitle,
  type TitleCandidate,
} from '@/lib/shortcut-meta';
import {
  DEFAULT_NEWTAB_SETTINGS,
  type NewTabSettings,
  type PinnedData,
  type PinnedItem,
  type ProfileMode,
  type SearchEngine,
} from '@/lib/newtab-types';
import {
  addPinnedGroup,
  addPinnedItem,
  addPinnedItemIfAbsent,
  deletePinnedGroup,
  deletePinnedItem,
  findPinnedByUrl,
  getNewTabSettings,
  getPinnedData,
  normalizePinnedUrl,
  renamePinnedGroup,
  reorderPinnedItems,
  saveNewTabSettings,
  STORAGE_PINNED_KEY,
  updatePinnedItem,
} from '@/lib/pinned';
import {
  getCachedRecommendations,
  refreshAndCacheRecommendations,
  type RecommendedStation,
} from '@/lib/recommendations';
import { filterAndRankItems, type SearchItem } from '@/lib/search';
import { getSnapshots, type SessionSnapshot } from '@/lib/snapshots';
import {
  summarizeDeepRouteTitle,
  naturalLanguageSearchMatch,
} from '@/lib/ai-assistant';
import { getAiSettings, type AiSettings, DEFAULT_AI_SETTINGS } from '@/lib/settings';
import { applyThemeToDocument, useThemeMode } from '@/lib/theme-mode';
import {
  getDefaultPaletteShortcut,
  getPaletteShortcut,
  matchesPaletteShortcut,
  PALETTE_SHORTCUT_STORAGE_KEY,
  sanitizePaletteShortcut,
  type PaletteShortcutConfig,
} from '@/lib/palette-shortcut';
import { ThemeModeButton } from '@/components/ThemeToggle';
import { AdaptiveFavicon } from '@/components/AdaptiveFavicon';
import { sendToBackground } from '@/lib/messaging';

/** 「继续上次」最多展示的入口数 */
const RESUME_LIMIT = 3;
/** 书签文件夹默认展示条数，超出折叠 */
const BOOKMARK_PREVIEW_LIMIT = 5;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * 搜索引擎矢量图标：统一 1.75px 描边几何图标，替代原生 Emoji 占位
 */
function EngineGlyph({ id }: { id: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (id === 'github') {
    return (
      <svg {...common}>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  if (id === 'baidu') {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <line x1="20" y1="20" x2="16.2" y2="16.2" />
      </svg>
    );
  }
  if (id === 'bing') {
    return (
      <svg {...common}>
        <polygon points="12 2 19 21 12 17 5 21 12 2" />
      </svg>
    );
  }
  if (id === 'zhihu') {
    return (
      <svg {...common}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <line x1="3.6" y1="9" x2="20.4" y2="9" />
      <line x1="3.6" y1="15" x2="20.4" y2="15" />
      <path d="M12 3a13.5 13.5 0 0 0 0 18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18" />
    </svg>
  );
}

export default function NewTabApp() {
  const { isDark, mode: themeMode, setMode: setThemeMode } = useThemeMode();

  // CSS 令牌由 data-theme 驱动；「跟随系统」已在 useThemeMode 内解析成 isDark。
  useEffect(() => {
    applyThemeToDocument(isDark, isDark ? '#0b0d11' : '#f2f4f7');
  }, [isDark]);

  const [greetingInfo, setGreetingInfo] = useState(() => formatTimeGreeting());

  const [pinnedData, setPinnedData] = useState<PinnedData>({ groups: [], items: [] });
  const [activeGroupId, setActiveGroupId] = useState<string>('all');

  const [settings, setSettings] = useState<NewTabSettings>(DEFAULT_NEWTAB_SETTINGS);

  // 快捷方式表单：URL 预览 + 提示 + 名称建议
  // 请求编号/会话编号/名称来源由 controller 持有（见 shortcut-meta.ts），
  // 它们必须在异步回调里同步读到最新值，放 React state 会读到闭包快照。
  const [shortcutPreview, setShortcutPreview] = useState('');
  const [shortcutHint, setShortcutHint] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState<TitleCandidate | null>(null);

  const [openTabs, setOpenTabs] = useState<
    Array<{ id: number; url: string; title: string; windowId?: number }>
  >([]);

  const [recommendations, setRecommendations] = useState<RecommendedStation[]>([]);

  const [bookmarkCards, setBookmarkCards] = useState<BookmarkFolderCard[]>([]);
  const [bookmarkSearch, setBookmarkSearch] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  // 正在确认删除的磁贴。Popconfirm 渲染在 body 上，鼠标移过去时磁贴失去 :hover，
  // 操作按钮会 display:none 导致锚点消失、气泡跟着关闭。用它把按钮钉住。
  const [confirmingItemId, setConfirmingItemId] = useState<string | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkItem | null>(null);
  const [bookmarkForm] = Form.useForm();

  const [recentSnapshot, setRecentSnapshot] = useState<SessionSnapshot | null>(null);

  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);

  const [searchInput, setSearchInput] = useState('');
  const [activeEngine, setActiveEngine] = useState<SearchEngine>(SEARCH_ENGINES[0]);
  const [aiSearchSuggestions, setAiSearchSuggestions] = useState<SearchItem[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<InputRef>(null);

  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<PinnedItem | null>(null);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string } | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [groupForm] = Form.useForm();

  // 按 '/' 或开启的命令面板快捷键（如 ⌘ K）聚焦搜索框，Escape 失焦
  const paletteShortcutRef = useRef<PaletteShortcutConfig>(getDefaultPaletteShortcut());
  useEffect(() => {
    void getPaletteShortcut().then((cfg) => {
      paletteShortcutRef.current = cfg;
    });
    const onStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'sync' && PALETTE_SHORTCUT_STORAGE_KEY in changes) {
        paletteShortcutRef.current = sanitizePaletteShortcut(
          changes[PALETTE_SHORTCUT_STORAGE_KEY].newValue,
        );
      }
    };
    chrome.storage?.onChanged?.addListener(onStorageChange);

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (matchesPaletteShortcut(e, paletteShortcutRef.current)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      chrome.storage?.onChanged?.removeListener(onStorageChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setGreetingInfo(formatTimeGreeting());
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setGreetingInfo(formatTimeGreeting()), 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function loadInitialData() {
      // 1. 先读持久化缓存，首屏直接出内容
      const [pData, nSettings, cachedRecs] = await Promise.all([
        getPinnedData(),
        getNewTabSettings(),
        getCachedRecommendations(),
      ]);
      setPinnedData(pData);
      setSettings(nSettings);
      if (cachedRecs && cachedRecs.length > 0) {
        setRecommendations(cachedRecs);
      }

      // 1.1 按当前模式还原搜索引擎
      const initialEngineId =
        nSettings.profile === 'home'
          ? nSettings.homeEngineId || nSettings.defaultEngineId
          : nSettings.workEngineId || nSettings.defaultEngineId;
      setActiveEngine(
        SEARCH_ENGINES.find((e) => e.id === initialEngineId) || SEARCH_ENGINES[0],
      );

      // 2. 已开标签（用于「已打开」检测与搜索建议）
      let initialOpenTabs: Array<{ id: number; url: string; title: string; windowId?: number }> = [];
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        try {
          const tabs = await chrome.tabs.query({});
          initialOpenTabs = tabs
            .filter((t) => t.id && t.url)
            .map((t) => ({
              id: t.id!,
              url: t.url!,
              title: t.title || '',
              windowId: t.windowId,
            }));
          setOpenTabs(initialOpenTabs);
        } catch {
          // ignore
        }
      }

      // 3. 空闲时刷新历史推荐
      refreshAndCacheRecommendations(8).then(async (fresh) => {
        if (!fresh || fresh.length === 0) return;
        setRecommendations(fresh);

        // 渐进增强：开启端侧 AI 且胶囊浓缩时异步微调标题
        const aiSet = await getAiSettings();
        if (aiSet.enabled && aiSet.capsuleSummarize) {
          for (const rec of fresh) {
            if (!rec.capsule) continue;
            summarizeDeepRouteTitle(rec.capsule.title, rec.capsule.url, aiSet).then((aiTitle) => {
              if (!aiTitle) return;
              setRecommendations((prev) =>
                prev.map((item) =>
                  item.domain === rec.domain && item.capsule
                    ? { ...item, capsule: { ...item.capsule, cleanTitle: aiTitle } }
                    : item,
                ),
              );
            });
          }
        }
      });

      // 4. 书签目录与会话快照
      loadBookmarkCards().then((cards) => setBookmarkCards(cards));
      getSnapshots().then((snaps) => {
        if (snaps && snaps.length > 0) setRecentSnapshot(snaps[0]);
      });

      // 5. 端侧 AI 配置
      const aiSet = await getAiSettings();
      setAiSettings(aiSet);
    }
    loadInitialData();
  }, []);

  // 实时同步已开标签（tabs 事件节流 + 页面重新可见时刷新）
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const syncTabs = () => {
      if (timer) return;
      timer = setTimeout(async () => {
        timer = null;
        try {
          const tabs = await chrome.tabs.query({});
          setOpenTabs(
            tabs
              .filter((t) => t.id && t.url)
              .map((t) => ({
                id: t.id!,
                url: t.url!,
                title: t.title || '',
                windowId: t.windowId,
              })),
          );
        } catch {
          // ignore
        }
      }, 250);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncTabs();
    };

    chrome.tabs.onCreated?.addListener(syncTabs);
    chrome.tabs.onRemoved?.addListener(syncTabs);
    chrome.tabs.onUpdated?.addListener(syncTabs);
    document.addEventListener('visibilitychange', onVisibility);

    // 同步来自 Popup / 右键菜单 / 命令面板的新增快捷方式
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'local' && STORAGE_PINNED_KEY in changes) {
        void getPinnedData().then(setPinnedData);
      }
    };
    chrome.storage?.onChanged?.addListener(onStorageChanged);

    return () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onCreated?.removeListener(syncTabs);
      chrome.tabs.onRemoved?.removeListener(syncTabs);
      chrome.tabs.onUpdated?.removeListener(syncTabs);
      chrome.storage?.onChanged?.removeListener(onStorageChanged);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const parsedSearch = useMemo(
    () => parseSearchQuery(searchInput, activeEngine.id),
    [searchInput, activeEngine],
  );

  /**
   * 图标来源解析。默认浏览器本地图标库（零请求）；
   * 失败或未选中 browser 时回退到首字母 SVG。
   * 不做占位图检测 —— 未访问过的站点显示浏览器默认图属正常结果。
   */
  const iconFor = useCallback(
    (pageUrl: string, title: string, size: number): { src: string; fallback: string } => {
      const fallback = generateSvgFavicon(title, pageUrl);
      if (settings.iconMode !== 'browser') return { src: fallback, fallback };
      return { src: browserFaviconUrl(pageUrl, size) || fallback, fallback };
    },
    [settings.iconMode],
  );

  // 个人模式下过滤内网后的可见快捷方式
  const visiblePinnedItems = useMemo(
    () =>
      settings.profile === 'home'
        ? pinnedData.items.filter((item) => !isIntranetHost(hostnameOf(item.url)))
        : pinnedData.items,
    [pinnedData.items, settings.profile],
  );

  // 本地毫秒级全能聚合搜索（已开标签 + 快捷方式 + 书签，零防抖即时出结果）
  const localSearchSuggestions = useMemo(() => {
    const q = searchInput.trim();
    if (!q) return [];

    const tabItems: SearchItem[] = openTabs.map((t) => ({
      id: `tab_${t.id}`,
      kind: 'tab',
      title: t.title,
      url: t.url,
      tabId: t.id,
      windowId: t.windowId,
      domain: hostnameOf(t.url),
    }));

    const pinnedSearchItems: SearchItem[] = visiblePinnedItems.map((p) => ({
      id: `pin_${p.id}`,
      kind: 'bookmark',
      title: p.title,
      url: p.url,
      domain: hostnameOf(p.url),
      groupTitle: '快捷方式',
    }));

    const bookmarkSearchItems: SearchItem[] = [];
    for (const card of bookmarkCards) {
      const pool = card.allItems || card.items;
      for (const bm of pool) {
        if (!bm.url || bm.isInvalid) continue;
        bookmarkSearchItems.push({
          id: `bm_${bm.id}`,
          kind: 'bookmark',
          title: bm.title,
          url: bm.url,
          domain: bm.domain || hostnameOf(bm.url),
          groupTitle: card.name,
        });
      }
    }

    return filterAndRankItems(
      [...tabItems, ...pinnedSearchItems, ...bookmarkSearchItems],
      q,
      'all',
      8,
    );
  }, [searchInput, openTabs, visiblePinnedItems, bookmarkCards]);

  // 端侧 AI 自然语言意图补全（仅 AI 开启且输入 ≥ 3 字时走 400ms 防抖异步增强）
  useEffect(() => {
    const q = searchInput.trim();
    setSelectedSuggestionIndex(-1);
    if (!q || !aiSettings.enabled || !aiSettings.naturalLanguageJump || q.length < 3) {
      setAiSearchSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      const tabItems: Array<SearchItem & { url: string }> = openTabs
        .filter((t) => Boolean(t.url))
        .map((t) => ({
          id: `tab_${t.id}`,
          kind: 'tab',
          title: t.title,
          url: t.url,
          tabId: t.id,
          windowId: t.windowId,
          domain: hostnameOf(t.url),
        }));
      try {
        const matched = await naturalLanguageSearchMatch(q, tabItems, aiSettings);
        const aiItems: SearchItem[] = matched.map((m) => {
          const original = tabItems.find((it) => it.url === m.url);
          return (
            original || {
              id: `ai_${m.url}`,
              kind: 'tab',
              title: m.title,
              url: m.url,
              domain: hostnameOf(m.url),
            }
          );
        });
        setAiSearchSuggestions(aiItems);
      } catch {
        setAiSearchSuggestions([]);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput, openTabs, aiSettings]);

  const searchSuggestions = useMemo(() => {
    if (aiSearchSuggestions.length === 0) return localSearchSuggestions;
    const merged = [...aiSearchSuggestions];
    for (const r of localSearchSuggestions) {
      if (!merged.some((m) => m.url && m.url === r.url)) merged.push(r);
    }
    return merged.slice(0, 8);
  }, [aiSearchSuggestions, localSearchSuggestions]);

  const switchToExistingTab = useCallback(
    (tabId: number, windowId: number | undefined, closeSelf: boolean) => {
      if (typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function') {
        void sendToBackground({
          type: 'switchTab',
          tabId,
          windowId: windowId ?? 0,
          closeSelf,
        }).catch(() => {
          chrome.tabs?.update?.(tabId, { active: true });
          if (windowId !== undefined) chrome.windows?.update?.(windowId, { focused: true });
        });
        return;
      }
      chrome.tabs?.update?.(tabId, { active: true });
      if (windowId !== undefined) chrome.windows?.update?.(windowId, { focused: true });
    },
    [],
  );

  const handleOpenUrl = useCallback(
    (targetUrl: string, inNewTab = false) => {
      if (!targetUrl) return;

      // 已有相同（归一化后一致）地址的标签页：切换过去，并在非「保留工作台」模式下关闭当前临时新标签页
      const targetNorm = normalizePinnedUrl(targetUrl);
      const foundTab = openTabs.find((t) => normalizePinnedUrl(t.url) === targetNorm);
      if (foundTab && typeof chrome !== 'undefined' && typeof chrome.tabs?.update === 'function') {
        switchToExistingTab(foundTab.id, foundTab.windowId, !inNewTab && !settings.openInNewTab);
        return;
      }

      if (inNewTab || settings.openInNewTab) {
        if (typeof chrome !== 'undefined' && typeof chrome.tabs?.create === 'function') {
          chrome.tabs.create({ url: targetUrl });
        } else {
          window.open(targetUrl, '_blank');
        }
      } else {
        window.location.href = targetUrl;
      }
    },
    [openTabs, settings.openInNewTab, switchToExistingTab],
  );

  const handleActivateSearchItem = (item: SearchItem) => {
    if (item.tabId && typeof chrome !== 'undefined' && typeof chrome.tabs?.update === 'function') {
      switchToExistingTab(item.tabId, item.windowId, !settings.openInNewTab);
    } else if (item.url) {
      handleOpenUrl(item.url);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      if (searchSuggestions.length > 0) {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev < searchSuggestions.length - 1 ? prev + 1 : -1,
        );
      }
    } else if (e.key === 'ArrowUp') {
      if (searchSuggestions.length > 0) {
        e.preventDefault();
        setSelectedSuggestionIndex((prev) =>
          prev === -1 ? searchSuggestions.length - 1 : prev - 1,
        );
      }
    } else if (e.key === 'Escape') {
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleSearchSubmit = (e?: React.KeyboardEvent<HTMLInputElement>) => {
    if (e?.nativeEvent?.isComposing) return;
    if (!searchInput.trim()) return;

    // 键盘高亮选中建议项时直接切换/打开
    if (
      selectedSuggestionIndex >= 0 &&
      selectedSuggestionIndex < searchSuggestions.length
    ) {
      handleActivateSearchItem(searchSuggestions[selectedSuggestionIndex]);
      return;
    }

    if (parsedSearch.isAddress && parsedSearch.targetUrl) {
      handleOpenUrl(parsedSearch.targetUrl);
      return;
    }

    const engine = parsedSearch.engine || activeEngine;
    handleOpenUrl(
      engine.urlTemplate.replace('%s', encodeURIComponent(parsedSearch.cleanQuery)),
    );
  };

  const handleToggleProfile = async (newProfile: ProfileMode) => {
    const updated = await saveNewTabSettings({ profile: newProfile });
    setSettings(updated);
    const targetEngineId =
      newProfile === 'home'
        ? updated.homeEngineId || updated.defaultEngineId
        : updated.workEngineId || updated.defaultEngineId;
    setActiveEngine(SEARCH_ENGINES.find((e) => e.id === targetEngineId) || SEARCH_ENGINES[0]);

    // 模式切换时自适应分组
    if (newProfile === 'home') {
      const homeGroup = pinnedData.groups.find((g) => /生活|个人|常用|home|life/i.test(g.name));
      if (homeGroup) setActiveGroupId(homeGroup.id);
    } else {
      const workGroup = pinnedData.groups.find((g) => /工作|开发|技术|work|dev/i.test(g.name));
      if (workGroup) setActiveGroupId(workGroup.id);
    }
  };

  const handleSelectEngine = async (engine: SearchEngine) => {
    setActiveEngine(engine);
    const updates =
      settings.profile === 'home' ? { homeEngineId: engine.id } : { workEngineId: engine.id };
    setSettings(await saveNewTabSettings(updates));
  };

  // 书签区展开/收起：即时生效并写回设置，下次打开沿用
  const handleToggleBookmarks = async () => {
    const next = !settings.bookmarksExpanded;
    setSettings((prev) => ({ ...prev, bookmarksExpanded: next }));
    setSettings(await saveNewTabSettings({ bookmarksExpanded: next }));
  };

  // 过滤当前分组卡片（个人模式下过滤内网卡片）
  const filteredItems = useMemo(() => {
    let list = pinnedData.items;
    if (settings.profile === 'home') {
      list = list.filter((item) => !isIntranetHost(hostnameOf(item.url)));
    }
    if (activeGroupId === 'all') return list;
    return list.filter((i) => i.groupId === activeGroupId);
  }, [pinnedData, activeGroupId, settings.profile]);

  // 「继续上次」：深层路由胶囊优先，其次会话快照；个人模式过滤内网
  const resumeEntries = useMemo(() => {
    const entries: Array<{
      key: string;
      title: string;
      url?: string;
      iconUrl?: string;
      snapshot?: SessionSnapshot;
    }> = [];

    for (const rec of recommendations) {
      if (!rec.capsule) continue;
      if (settings.profile === 'home' && rec.isIntranet) continue;
      entries.push({
        key: `capsule_${rec.domain}`,
        title: rec.capsule.cleanTitle,
        url: rec.capsule.url,
        iconUrl: rec.capsule.url,
      });
      if (entries.length >= RESUME_LIMIT) break;
    }

    if (recentSnapshot && recentSnapshot.tabs.length > 0 && entries.length < RESUME_LIMIT) {
      entries.push({
        key: `snapshot_${recentSnapshot.id}`,
        title: `上次工作现场 · ${recentSnapshot.tabs.length} 个页面`,
        snapshot: recentSnapshot,
      });
    }

    return entries;
  }, [recommendations, recentSnapshot, settings.profile]);

  // 快捷方式名称补全的状态机。持有请求编号/会话编号/名称来源，
  // 使异步回调在返回时读到的是**最新**状态而非闭包快照。
  const metaController = useMemo(
    () =>
      createShortcutMetaController({
        readUrl: () => form.getFieldValue('url'),
        readTitle: () => form.getFieldValue('title'),
        resolve: resolveShortcutUrl,
        lookup: (targetUrl) =>
          lookupLocalTitle(
            {
              queryTabs: () =>
                chrome.tabs.query({}).then((ts) => ts.map((t) => ({ url: t.url, title: t.title }))),
              searchBookmarks: (url) =>
                typeof chrome !== 'undefined' && chrome.bookmarks?.search
                  ? chrome.bookmarks
                      .search(url)
                      .then((bs) => bs.map((b) => ({ url: b.url, title: b.title })))
                  : Promise.resolve([]),
              searchHistory: (url, startTime, maxResults) =>
                chrome.history.search({ text: url, startTime, maxResults }),
            },
            targetUrl,
          ),
        writeTitle: (title) => form.setFieldsValue({ title }),
        setPreview: setShortcutPreview,
        setHint: setShortcutHint,
        setSuggestedTitle,
      }),
    [form],
  );

  const handleOpenItemModal = (item?: PinnedItem, prefillUrl?: string) => {
    // 开新会话：作废上一条所有在途请求，避免旧建议/旧提示串到这一条
    metaController.beginSession(item != null);

    if (item) {
      setEditingItem(item);
      form.setFieldsValue(item);
    } else {
      setEditingItem(null);
      form.resetFields();
      form.setFieldsValue({
        url: prefillUrl || undefined,
        groupId:
          activeGroupId === 'all' ? pinnedData.groups[0]?.id || 'dev' : activeGroupId,
      });
    }
    setItemModalVisible(true);
    if (!item && prefillUrl) {
      setTimeout(() => void metaController.onUrlBlur(), 0);
    }
  };

  // 工作台空白处 Cmd+V / Ctrl+V 粘贴网址直接弹出预填添加框
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (itemModalVisible || groupModalVisible || editingBookmark !== null) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const text = e.clipboardData?.getData('text')?.trim() || '';
      if (!text) return;
      const resolved = resolveShortcutUrl(text);
      if (resolved.ok) {
        e.preventDefault();
        handleOpenItemModal(undefined, resolved.url);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [itemModalVisible, groupModalVisible, editingBookmark, activeGroupId, pinnedData.groups]);

  // 添加弹窗顶部快速候选（当前已开标签 + 历史推荐，自动排除已在工作台的站点）
  const quickPickCandidates = useMemo(() => {
    const list: Array<{ key: string; title: string; url: string; source: 'tab' | 'rec' }> = [];
    const seen = new Set<string>();
    for (const t of openTabs) {
      if (!/^https?:\/\//i.test(t.url)) continue;
      if (findPinnedByUrl(pinnedData, t.url)) continue;
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      list.push({ key: `tab_${t.id}`, title: t.title || hostnameOf(t.url), url: t.url, source: 'tab' });
      if (list.length >= 6) return list;
    }
    for (const rec of recommendations) {
      const recUrl = rec.primaryUrl;
      if (!/^https?:\/\//i.test(recUrl)) continue;
      if (findPinnedByUrl(pinnedData, recUrl)) continue;
      if (seen.has(recUrl)) continue;
      seen.add(recUrl);
      list.push({ key: `rec_${rec.domain}`, title: rec.title || rec.domain, url: recUrl, source: 'rec' });
      if (list.length >= 6) return list;
    }
    return list;
  }, [openTabs, recommendations, pinnedData]);

  // 书签行一键固定到工作台
  const handlePinBookmark = async (bm: BookmarkItem) => {
    const groupId = activeGroupId === 'all' ? pinnedData.groups[0]?.id : activeGroupId;
    const res = await addPinnedItemIfAbsent({ title: bm.title, url: bm.url, groupId });
    setPinnedData(await getPinnedData());
    if (res.added) {
      messageApi.success(`已固定「${res.item.title}」到「${res.groupName}」`);
    } else {
      messageApi.info(`「${res.item.title}」已在工作台「${res.groupName}」中`);
    }
  };

  // 书签目录一键导入为工作台分组
  const handleImportFolderAsGroup = async (card: BookmarkFolderCard) => {
    const pool = (card.allItems || card.items).filter(
      (it) => it.url && !it.isInvalid && /^https?:\/\//i.test(it.url),
    );
    if (pool.length === 0) {
      messageApi.warning('该目录下没有可导入的有效网页书签');
      return;
    }
    const existingGroup = pinnedData.groups.find((g) => g.name === card.name);
    const group = existingGroup ?? (await addPinnedGroup(card.name));
    let addedCount = 0;
    for (const bm of pool.slice(0, 24)) {
      const res = await addPinnedItemIfAbsent({ title: bm.title, url: bm.url, groupId: group.id });
      if (res.added) addedCount++;
    }
    setPinnedData(await getPinnedData());
    setActiveGroupId(group.id);
    if (addedCount > 0) {
      messageApi.success(`已将「${card.name}」的 ${addedCount} 个书签导入到工作台`);
    } else {
      messageApi.info(`「${card.name}」中的书签均已在工作台`);
    }
  };

  const handleCloseItemModal = () => {
    metaController.endSession();
    setItemModalVisible(false);
  };

  /** URL 失焦：先规范化地址，再异步查本地名称候选。查询失败不阻塞手填。 */
  const handleUrlBlur = useCallback(() => {
    void metaController.onUrlBlur();
  }, [metaController]);

  /** 用户真实输入标题 -> 名称归用户所有，后续自动结果不得覆盖 */
  const handleTitleChange = useCallback(() => {
    metaController.onTitleInput();
  }, [metaController]);

  /** URL 被改写 -> 在途查询立即失效，不等它返回 */
  const handleUrlChange = useCallback(() => {
    metaController.invalidate();
  }, [metaController]);

  const handleSaveItem = async () => {
    try {
      const values = await form.validateFields();
      // 保存、预览、补全共用同一个解析结果；不再各自补协议
      const resolved = resolveShortcutUrl(String(values.url ?? ''));
      if (!resolved.ok) {
        setShortcutHint('请填写有效的网址（http/https）');
        return;
      }

      if (editingItem) {
        // 保留既有 customIcon 等未在表单中暴露的字段，避免保存时意外清空
        await updatePinnedItem({
          ...editingItem,
          title: String(values.title ?? '').trim(),
          url: resolved.url,
          groupId: values.groupId,
        });
      } else {
        await addPinnedItem({
          title: String(values.title ?? '').trim(),
          url: resolved.url,
          groupId: values.groupId,
        });
      }
      setPinnedData(await getPinnedData());
      handleCloseItemModal();
    } catch {
      // 表单校验失败
    }
  };

  /** 删除快捷方式。确认交给调用处的 Popconfirm，鼠标无需离开按钮 */
  const handleDeleteItem = async (item: PinnedItem) => {
    await deletePinnedItem(item.id);
    setPinnedData(await getPinnedData());
  };

  const handleOpenGroupModal = (group?: { id: string; name: string }) => {
    if (group) {
      setEditingGroup(group);
      groupForm.setFieldsValue({ name: group.name });
    } else {
      setEditingGroup(null);
      groupForm.resetFields();
    }
    setGroupModalVisible(true);
  };

  const handleSaveGroup = async () => {
    try {
      const values = await groupForm.validateFields();
      if (editingGroup) {
        await renamePinnedGroup(editingGroup.id, values.name);
        messageApi.success('分组已重命名');
      } else {
        await addPinnedGroup(values.name);
      }
      setPinnedData(await getPinnedData());
      setGroupModalVisible(false);
      setEditingGroup(null);
      groupForm.resetFields();
    } catch {
      // 校验失败
    }
  };

  const handleDeleteGroup = (group: { id: string; name: string }) => {
    if (pinnedData.groups.length <= 1) {
      messageApi.warning('至少需要保留一个分组');
      return;
    }
    modal.confirm({
      title: `删除分组「${group.name}」？`,
      content: '该分组下的快捷方式会自动移入第一个分组，不会丢失。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deletePinnedGroup(group.id);
        setPinnedData(await getPinnedData());
        if (activeGroupId === group.id) setActiveGroupId('all');
        messageApi.success('分组已删除');
      },
    });
  };

  const handleDropTile = async (targetId: string) => {
    if (!draggingItemId || draggingItemId === targetId) return;
    await reorderPinnedItems(draggingItemId, targetId);
    setPinnedData(await getPinnedData());
    setDraggingItemId(null);
    setDragOverItemId(null);
  };

  const [messageApi, messageContextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();

  const displayBookmarkCards = useMemo(
    () => filterBookmarkCards(bookmarkCards, bookmarkSearch),
    [bookmarkCards, bookmarkSearch],
  );

  const totalBookmarkCount = useMemo(
    () => bookmarkCards.reduce((n, c) => n + c.totalCount, 0),
    [bookmarkCards],
  );

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const handleOpenBookmarkInBackground = (url: string) => {
    if (!url) return;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url, active: false });
      messageApi.success('已在后台标签页打开');
    } else {
      window.open(url, '_blank');
    }
  };

  const handleCopyUrl = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      messageApi.success('已复制网址到剪贴板');
    } catch {
      messageApi.error('复制网址失败');
    }
  };

  const handleOpenFolderAll = (card: BookmarkFolderCard) => {
    const pool = card.allItems || card.items;
    const validItems = pool.filter((it) => it.url && !it.isInvalid);
    if (validItems.length === 0) {
      messageApi.warning('该目录下无有效网址');
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      for (const it of validItems) {
        chrome.tabs.create({ url: it.url, active: false });
      }
      messageApi.success(`已在后台打开该目录下全部 ${validItems.length} 个书签`);
    } else {
      validItems.slice(0, 5).forEach((it) => window.open(it.url, '_blank'));
      messageApi.success(`已打开 ${Math.min(validItems.length, 5)} 个书签`);
    }
  };

  const handleSaveBookmark = async () => {
    if (!editingBookmark) return;
    try {
      const values = await bookmarkForm.validateFields();
      if (typeof chrome !== 'undefined' && chrome.bookmarks?.update) {
        await chrome.bookmarks.update(editingBookmark.id, {
          title: String(values.title ?? '').trim(),
          url: String(values.url ?? '').trim(),
        });
        messageApi.success('书签修改成功');
        setBookmarkCards(await loadBookmarkCards());
      } else {
        messageApi.info('当前环境不支持直接更新 Chrome 书签');
      }
      setEditingBookmark(null);
    } catch {
      // 校验失败
    }
  };

  const handleDeleteBookmark = (item: BookmarkItem) => {
    modal.confirm({
      title: '确认删除书签？',
      content: `确定从 Chrome 收藏夹中永久删除「${item.title}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (typeof chrome !== 'undefined' && chrome.bookmarks?.remove) {
          await chrome.bookmarks.remove(item.id);
          messageApi.success('书签已删除');
          setBookmarkCards(await loadBookmarkCards());
        } else {
          messageApi.info('当前环境不支持直接删除 Chrome 书签');
        }
      },
    });
  };

  const handleRestoreSnapshot = (snapshot: SessionSnapshot) => {
    if (!snapshot.tabs || snapshot.tabs.length === 0) return;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      for (const tab of snapshot.tabs) {
        if (tab.url) chrome.tabs.create({ url: tab.url, active: false });
      }
      messageApi.success(`已在后台开启 ${snapshot.tabs.length} 个标签页`);
    } else {
      snapshot.tabs.slice(0, 5).forEach((t) => {
        if (t.url) window.open(t.url, '_blank');
      });
      messageApi.success('已恢复会话页面');
    }
  };

  /** 单条书签的操作菜单，右键与「更多」按钮共用 */
  const bookmarkMenuItems = (item: BookmarkItem) => {
    const alreadyPinned = Boolean(findPinnedByUrl(pinnedData, item.url));
    return [
      {
        key: 'pin-to-newtab',
        icon: alreadyPinned ? <PushpinFilled /> : <PushpinOutlined />,
        label: alreadyPinned ? '已在工作台' : '固定到工作台',
        disabled: alreadyPinned,
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          void handlePinBookmark(item);
        },
      },
      { type: 'divider' as const },
      {
        key: 'open-new-tab',
        icon: <GlobalOutlined />,
        label: '在新标签页打开',
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          handleOpenUrl(item.url, true);
        },
      },
      {
        key: 'open-bg',
        icon: <RocketOutlined />,
        label: '后台静默打开',
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          handleOpenBookmarkInBackground(item.url);
        },
      },
      {
        key: 'copy-url',
        icon: <CopyOutlined />,
        label: '复制网址',
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          void handleCopyUrl(item.url);
        },
      },
      { type: 'divider' as const },
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: '修改书签',
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          setEditingBookmark(item);
          bookmarkForm.setFieldsValue({ title: item.title, url: item.url });
        },
      },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        danger: true,
        label: '删除书签',
        onClick: ({ domEvent }: { domEvent?: React.SyntheticEvent }) => {
          domEvent?.stopPropagation();
          handleDeleteBookmark(item);
        },
      },
    ];
  };

  const groupChips = [
    { id: 'all', name: '全部', count: visiblePinnedItems.length },
    ...pinnedData.groups.map((g) => ({
      id: g.id,
      name: g.name,
      count: visiblePinnedItems.filter((i) => i.groupId === g.id).length,
    })),
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#60a5fa' : '#2563eb',
          borderRadius: 8,
          colorBgContainer: isDark ? '#13161c' : '#ffffff',
          colorBgElevated: isDark ? '#13161c' : '#ffffff',
          colorBorder: isDark ? '#232833' : '#dfe4ec',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      {messageContextHolder}
      {modalContextHolder}
      <div className="yt-shell">
        {/* ---------- 顶部：时钟 / 模式 / 搜索 / 设置 ---------- */}
        <header className="yt-top">
          <div>
            <div className="yt-clock-row">
              <div className="yt-clock">{greetingInfo.timeStr}</div>
              <span className="yt-date-pill">
                {greetingInfo.dateStr} · {greetingInfo.greeting}
              </span>
            </div>
            <div className="yt-meta">
              <span className="yt-status-item">
                <span className="yt-live-dot" aria-hidden="true" />
                当前 <b>{openTabs.length}</b> 个活动页面
              </span>
              {recentSnapshot && recentSnapshot.tabs.length > 0 && (
                <>
                  <span className="sep" aria-hidden="true" />
                  <span className="yt-status-item">
                    <b>{recentSnapshot.tabs.length}</b> 个未完工现场
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="yt-top-actions">
            <div className="yt-search">
              <div className="yt-search-box">
                <Dropdown
                  menu={{
                    items: SEARCH_ENGINES.map((e) => ({
                      key: e.id,
                      icon: <EngineGlyph id={e.id} />,
                      label: `${e.name} [前缀: ${e.prefix}]`,
                      onClick: () => void handleSelectEngine(e),
                    })),
                  }}
                  trigger={['click']}
                >
                  <button type="button" className="yt-engine" title="切换搜索引擎">
                    <span className="yt-engine-glyph">
                      <EngineGlyph id={activeEngine.id} />
                    </span>
                    <span>{activeEngine.name}</span>
                    <DownOutlined style={{ fontSize: 9 }} />
                  </button>
                </Dropdown>
                <Input
                  ref={searchInputRef}
                  autoFocus
                  variant="borderless"
                  placeholder={
                    parsedSearch.isAddress
                      ? `⏎ 直达网络地址: ${parsedSearch.targetUrl}`
                      : '搜索或输入网址'
                  }
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                  onKeyDown={handleSearchKeyDown}
                  onPressEnter={handleSearchSubmit}
                  style={{ fontSize: 13, padding: 0 }}
                />
                {!searchInput && <span className="yt-kbd">/</span>}
              </div>

              {isSearchFocused && searchSuggestions.length > 0 && (
                <div className="yt-suggest">
                  <div className="yt-suggest-hint">已开标签 · 快捷方式 · 书签（↑↓ 选择，回车直达）</div>
                  {searchSuggestions.map((item, index) => {
                    const kindLabel =
                      item.kind === 'tab'
                        ? '标签'
                        : item.id.startsWith('pin_')
                          ? '快捷'
                          : '书签';
                    return (
                      <div
                        key={item.id}
                        className="yt-suggest-item"
                        role="option"
                        aria-selected={index === selectedSuggestionIndex}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleActivateSearchItem(item)}
                        onMouseEnter={() => setSelectedSuggestionIndex(index)}
                      >
                        <span className={`yt-suggest-tag ${item.kind === 'tab' ? 'tab' : ''}`}>
                          {kindLabel}
                        </span>
                        <span className="t">{item.title}</span>
                        <span className="d">{item.domain}</span>
                        <span className="d">{index === selectedSuggestionIndex ? '⏎' : '↗'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="yt-seg" role="group" aria-label="模式">
              <button
                type="button"
                aria-pressed={settings.profile === 'work'}
                onClick={() => void handleToggleProfile('work')}
              >
                办公内网
              </button>
              <button
                type="button"
                aria-pressed={settings.profile === 'home'}
                onClick={() => void handleToggleProfile('home')}
              >
                个人
              </button>
            </div>

            <ThemeModeButton
              mode={themeMode}
              onChange={setThemeMode}
              ink3="var(--ink-2)"
              className="yt-icon-btn"
            />

            <button
              type="button"
              className="yt-icon-btn"
              title="打开 YiTab 控制中心"
              aria-label="设置"
              onClick={() => {
                if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
                  chrome.runtime.openOptionsPage();
                } else {
                  window.open('options.html', '_blank');
                }
              }}
            >
              <SettingOutlined style={{ fontSize: 15 }} />
            </button>
          </div>
        </header>

        {/* ---------- 主工作台甲板：分组轨 + 磁贴 + 继续上次 ---------- */}
        <section className="yt-deck" aria-label="快捷工作台">
          <div className="yt-groupbar">
            {groupChips.map((g) => {
              const chipButton = (
                <button
                  key={g.id}
                  type="button"
                  className="yt-gchip"
                  aria-current={activeGroupId === g.id}
                  title={g.id === 'all' ? '全部快捷方式' : '右键可重命名或删除分组'}
                  onClick={() => setActiveGroupId(g.id)}
                >
                  {g.name}
                  <span className="n">{g.count}</span>
                </button>
              );
              if (g.id === 'all') return chipButton;
              return (
                <Dropdown
                  key={g.id}
                  trigger={['contextMenu']}
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        icon: <EditOutlined />,
                        label: '重命名分组',
                        onClick: () => handleOpenGroupModal({ id: g.id, name: g.name }),
                      },
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        danger: true,
                        disabled: pinnedData.groups.length <= 1,
                        label: '删除分组',
                        onClick: () => handleDeleteGroup({ id: g.id, name: g.name }),
                      },
                    ],
                  }}
                >
                  {chipButton}
                </Dropdown>
              );
            })}
            <span className="spacer" />
            <button type="button" className="yt-text-btn" onClick={() => handleOpenGroupModal()}>
              <PlusOutlined style={{ fontSize: 11 }} />
              <span>新建分组</span>
            </button>
            <button
              type="button"
              className="yt-text-btn accent"
              onClick={() => handleOpenItemModal()}
            >
              <PlusOutlined style={{ fontSize: 11 }} />
              <span>添加快捷方式</span>
            </button>
          </div>

          {/* ---------- 快捷方式磁贴 ---------- */}
          {filteredItems.length === 0 ? (
            <div className="yt-empty">
              <p>「{groupChips.find((g) => g.id === activeGroupId)?.name}」还没有快捷方式。</p>
              <button type="button" className="yt-btn" onClick={() => handleOpenItemModal()}>
                <PlusOutlined /> 添加快捷方式
              </button>
            </div>
          ) : (
            <div className="yt-tiles">
            {filteredItems.map((item) => {
              const hostname = hostnameOf(item.url);
              const isIntranet = isIntranetHost(hostname);
              const itemNorm = normalizePinnedUrl(item.url);
              const isOpen = openTabs.some((t) => normalizePinnedUrl(t.url) === itemNorm);
              const icon = iconFor(item.url, item.title, 64);

              return (
                <div
                  key={item.id}
                  className={`yt-tile${draggingItemId === item.id ? ' dragging' : ''}${dragOverItemId === item.id && draggingItemId !== item.id ? ' drag-over' : ''}`}
                  title={`${item.title}\n${item.url}\n(可拖拽调整排序)`}
                  role="link"
                  tabIndex={0}
                  draggable={!confirmingItemId}
                  onDragStart={(e) => {
                    setDraggingItemId(item.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (!draggingItemId || draggingItemId === item.id) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverItemId !== item.id) setDragOverItemId(item.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverItemId === item.id) setDragOverItemId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleDropTile(item.id);
                  }}
                  onDragEnd={() => {
                    setDraggingItemId(null);
                    setDragOverItemId(null);
                  }}
                  onClick={() => {
                    // 确认气泡挂在 body 上，React 事件仍会冒泡到这里；
                    // 有气泡打开时忽略，避免点「删除」顺带把页面导航走。
                    if (confirmingItemId) return;
                    handleOpenUrl(item.url);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (confirmingItemId) return;
                      handleOpenUrl(item.url);
                    }
                  }}
                >
                  <span className={`icon${settings.iconMode === 'browser' ? ' real' : ''}`}>
                    <AdaptiveFavicon src={icon.src} fallback={icon.fallback} isDark={isDark} />
                    {isOpen && <span className="dot open" title="已在后台打开" />}
                    {!isOpen && isIntranet && <span className="dot intranet" title="内网地址" />}
                  </span>
                  <span className="label">{item.title}</span>
                  <span className={`tile-actions${confirmingItemId === item.id ? ' pinned' : ''}`}>
                    <button
                      className="tile-act"
                      title="编辑快捷方式"
                      aria-label="编辑快捷方式"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenItemModal(item);
                      }}
                    >
                      <EditOutlined style={{ fontSize: 12 }} />
                    </button>
                    <Popconfirm
                      title="删除这个快捷方式？"
                      description={item.title}
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      open={confirmingItemId === item.id}
                      onOpenChange={(open) => setConfirmingItemId(open ? item.id : null)}
                      onConfirm={() => {
                        setConfirmingItemId(null);
                        void handleDeleteItem(item);
                      }}
                    >
                      <button
                        className="tile-act danger"
                        title="删除快捷方式"
                        aria-label="删除快捷方式"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DeleteOutlined style={{ fontSize: 12 }} />
                      </button>
                    </Popconfirm>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ---------- 继续上次 ---------- */}
        {resumeEntries.length > 0 && (
          <div className="yt-resume">
            <span className="cap">继续上次</span>
            {resumeEntries.map((entry) => {
              const icon = entry.iconUrl
                ? iconFor(entry.iconUrl, entry.title, 32)
                : null;
              return (
                <button
                  key={entry.key}
                  className="yt-chip"
                  title={entry.url || entry.title}
                  onClick={() => {
                    if (entry.snapshot) handleRestoreSnapshot(entry.snapshot);
                    else if (entry.url) handleOpenUrl(entry.url);
                  }}
                >
                  {icon ? (
                    <AdaptiveFavicon src={icon.src} fallback={icon.fallback} isDark={isDark} />
                  ) : (
                    <ClockCircleOutlined style={{ fontSize: 12 }} />
                  )}
                  <span>{entry.title}</span>
                  <span className="u">↗</span>
                </button>
              );
            })}
          </div>
        )}

        </section>

        {/* ---------- 书签 ---------- */}
        {bookmarkCards.length > 0 && (
          <section
            className={`yt-bookmarks${settings.bookmarksExpanded ? ' is-expanded' : ''}`}
          >
            <div className="yt-bm-head">
              <span className="yt-bm-title">
                <BookOutlined /> 书签
                <span className="n">{totalBookmarkCount} 项</span>
              </span>
              <label className="yt-bm-search">
                <SearchOutlined style={{ fontSize: 12 }} />
                <input
                  placeholder="筛选书签"
                  aria-label="筛选书签"
                  value={bookmarkSearch}
                  onChange={(e) => setBookmarkSearch(e.target.value)}
                />
                {bookmarkSearch && (
                  <button
                    type="button"
                    className="yt-bm-clear"
                    aria-label="清空筛选"
                    onClick={() => setBookmarkSearch('')}
                  >
                    <CloseOutlined style={{ fontSize: 10 }} />
                  </button>
                )}
              </label>
              <span className="spacer" />
              <button
                className="yt-bm-toggle"
                aria-expanded={settings.bookmarksExpanded}
                onClick={() => void handleToggleBookmarks()}
              >
                <span>{settings.bookmarksExpanded ? '收起' : '展开'}</span>
                <DownOutlined style={{ fontSize: 11 }} />
              </button>
            </div>

            {settings.bookmarksExpanded && (
              <div className="yt-bm-panel">
                {displayBookmarkCards.length === 0 ? (
                  <div className="yt-empty" style={{ marginTop: 16 }}>
                    <p>没有匹配「{bookmarkSearch}」的书签。</p>
                  </div>
                ) : (
                  displayBookmarkCards.map((card) => {
                    const isSearching = Boolean(bookmarkSearch.trim());
                    const isExpanded = expandedFolderIds.has(card.id);
                    const pool = card.allItems || card.items;
                    const itemsToRender = isSearching
                      ? card.items
                      : isExpanded
                        ? pool
                        : pool.slice(0, BOOKMARK_PREVIEW_LIMIT);
                    const hiddenCount = pool.length - itemsToRender.length;

                    return (
                      <div key={card.id} className="yt-bm-folder">
                        <div className="yt-bm-folder-head">
                          <span className="fname">
                            <FolderOpenOutlined style={{ fontSize: 13 }} />
                            {card.name}
                          </span>
                          <span className="fn">{card.totalCount}</span>
                          <span className="spacer" />
                          <button
                            className="yt-bm-openall"
                            title="将该目录下书签一键导入为工作台快捷方式分组"
                            onClick={() => void handleImportFolderAsGroup(card)}
                          >
                            <PushpinOutlined style={{ fontSize: 11 }} /> 导入为分组
                          </button>
                          <button
                            className="yt-bm-openall"
                            title="在后台打开该目录下全部书签"
                            onClick={() => handleOpenFolderAll(card)}
                          >
                            <RocketOutlined style={{ fontSize: 11 }} /> 全部打开
                          </button>
                        </div>

                        <div className="yt-bm-links">
                          {itemsToRender.map((item) => {
                            const icon = iconFor(item.url, item.title, 32);
                            return (
                              <Dropdown
                                key={item.id}
                                menu={{ items: bookmarkMenuItems(item) }}
                                trigger={['contextMenu']}
                              >
                                <div
                                  className="yt-bm-row"
                                  role="link"
                                  tabIndex={0}
                                  title={`${item.title}\n${item.url}\n(右键呼出更多操作)`}
                                  onClick={(e) => {
                                    if (
                                      (e.target as HTMLElement)?.closest(
                                        '.bacts, .ant-dropdown, .ant-dropdown-menu-item, .ant-dropdown-menu',
                                      )
                                    ) {
                                      return;
                                    }
                                    handleOpenUrl(item.url);
                                  }}
                                  onKeyDown={(e) => {
                                    if (
                                      e.target === e.currentTarget &&
                                      (e.key === 'Enter' || e.key === ' ')
                                    ) {
                                      e.preventDefault();
                                      handleOpenUrl(item.url);
                                    }
                                  }}
                                >
                                  <span className="fi">
                                    <AdaptiveFavicon src={icon.src} fallback={icon.fallback} isDark={isDark} />
                                  </span>
                                  <span className="bt">{item.title}</span>
                                  <span className="bd">{item.domain}</span>
                                  <span className="bacts">
                                    <button
                                      className="yt-bact"
                                      title={findPinnedByUrl(pinnedData, item.url) ? '已在工作台' : '固定到工作台'}
                                      aria-label="固定到工作台"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handlePinBookmark(item);
                                      }}
                                    >
                                      {findPinnedByUrl(pinnedData, item.url) ? (
                                        <PushpinFilled style={{ fontSize: 12, color: 'var(--accent)' }} />
                                      ) : (
                                        <PushpinOutlined style={{ fontSize: 12 }} />
                                      )}
                                    </button>
                                    <button
                                      className="yt-bact"
                                      title="在新标签页打开"
                                      aria-label="在新标签页打开"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenUrl(item.url, true);
                                      }}
                                    >
                                      <GlobalOutlined style={{ fontSize: 12 }} />
                                    </button>
                                    <button
                                      className="yt-bact"
                                      title="复制网址"
                                      aria-label="复制网址"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleCopyUrl(item.url);
                                      }}
                                    >
                                      <CopyOutlined style={{ fontSize: 12 }} />
                                    </button>
                                    <button
                                      className="yt-bact"
                                      title="修改书签"
                                      aria-label="修改书签"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingBookmark(item);
                                        bookmarkForm.setFieldsValue({
                                          title: item.title,
                                          url: item.url,
                                        });
                                      }}
                                    >
                                      <EditOutlined style={{ fontSize: 12 }} />
                                    </button>
                                    <Dropdown
                                      menu={{ items: bookmarkMenuItems(item) }}
                                      trigger={['click']}
                                    >
                                      <button
                                        className="yt-bact"
                                        title="更多操作"
                                        aria-label="更多操作"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <MoreOutlined style={{ fontSize: 12 }} />
                                      </button>
                                    </Dropdown>
                                  </span>
                                </div>
                              </Dropdown>
                            );
                          })}
                        </div>

                        {hiddenCount > 0 && (
                          <button
                            className="yt-bm-more-row"
                            onClick={() => toggleFolderExpand(card.id)}
                          >
                            还有 {hiddenCount} 项 · 展开
                          </button>
                        )}
                        {isExpanded && pool.length > BOOKMARK_PREVIEW_LIMIT && (
                          <button
                            className="yt-bm-more-row"
                            onClick={() => toggleFolderExpand(card.id)}
                          >
                            <UpOutlined style={{ fontSize: 10 }} /> 收起
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </section>
        )}

        {/* ---------- 模态框 ---------- */}
        <Modal
          title={editingItem ? '编辑快捷方式' : '添加快捷方式'}
          open={itemModalVisible}
          onOk={handleSaveItem}
          onCancel={handleCloseItemModal}
          okText="保存"
          cancelText="取消"
          destroyOnHidden
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            {!editingItem && quickPickCandidates.length > 0 && (
              <div className="yt-quickpick">
                <div className="yt-quickpick-title">
                  从已开标签 / 常用站点快速填入（点击即填）
                </div>
                <div className="yt-quickpick-list">
                  {quickPickCandidates.map((cand) => (
                    <button
                      key={cand.key}
                      type="button"
                      className="yt-quickpick-chip"
                      title={cand.url}
                      onClick={() => {
                        form.setFieldsValue({ url: cand.url, title: cand.title });
                        metaController.onTitleInput();
                        const resolved = resolveShortcutUrl(cand.url);
                        setShortcutPreview(resolved.ok ? resolved.url : cand.url);
                        setShortcutHint('');
                        setSuggestedTitle(null);
                      }}
                    >
                      <span className="tag">{cand.source === 'tab' ? '标签' : '常用'}</span>
                      <span className="name">{cand.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* URL 前置：先填地址，名称才可自动补全 */}
            <Form.Item
              name="url"
              label="网络网址 (支持内网 IP 与端口)"
              rules={[{ required: true, message: '请输入网址' }]}
              extra={
                shortcutHint ? (
                  <span style={{ fontSize: 12 }}>{shortcutHint}</span>
                ) : shortcutPreview ? (
                  <span style={{ fontSize: 12 }}>将保存为 {shortcutPreview}</span>
                ) : null
              }
            >
              <Input
                placeholder="例如: https://github.com 或 192.168.1.100:8080"
                onChange={handleUrlChange}
                onBlur={handleUrlBlur}
              />
            </Form.Item>
            <Form.Item
              name="title"
              label="网站/系统名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input
                placeholder="例如: GitLab 公司代码仓、Jira 看板"
                onChange={handleTitleChange}
              />
            </Form.Item>
            {suggestedTitle && (
              <div style={{ marginTop: -8, marginBottom: 16, fontSize: 12 }}>
                建议名称（来自
                {suggestedTitle.source === 'tab'
                  ? '当前标签'
                  : suggestedTitle.source === 'bookmark'
                    ? '本地书签'
                    : suggestedTitle.source === 'history'
                      ? '浏览历史'
                      : suggestedTitle.source === 'preset'
                        ? '知名站点'
                        : '域名匹配'}
                ）：
                <Button
                  type="link"
                  size="small"
                  style={{ padding: '0 4px', height: 'auto', fontSize: 12 }}
                  onClick={() => metaController.applySuggestion(suggestedTitle)}
                >
                  {suggestedTitle.title}
                </Button>
              </div>
            )}
            <Form.Item
              name="groupId"
              label="所属分组"
              rules={[{ required: true, message: '请选择分组' }]}
            >
              <Select
                options={pinnedData.groups.map((g) => ({ value: g.id, label: g.name }))}
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title={editingGroup ? '重命名分组' : '新建分组'}
          open={groupModalVisible}
          onOk={handleSaveGroup}
          onCancel={() => {
            setGroupModalVisible(false);
            setEditingGroup(null);
          }}
          okText={editingGroup ? '保存' : '创建'}
          cancelText="取消"
          destroyOnHidden
        >
          <Form form={groupForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="name"
              label="分组名称"
              rules={[{ required: true, message: '请输入分组名称' }]}
            >
              <Input placeholder="例如: 核心微服务、QA 测试环境" />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="修改 Chrome 收藏夹书签"
          open={editingBookmark !== null}
          onOk={handleSaveBookmark}
          onCancel={() => setEditingBookmark(null)}
          okText="保存修改"
          cancelText="取消"
          destroyOnHidden
        >
          <Form form={bookmarkForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="title"
              label="书签名称"
              rules={[{ required: true, message: '请输入书签名称' }]}
            >
              <Input placeholder="书签名称" />
            </Form.Item>
            <Form.Item
              name="url"
              label="网址 (URL)"
              rules={[{ required: true, message: '请输入有效网址' }]}
            >
              <Input placeholder="https://..." />
            </Form.Item>
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  );
}
