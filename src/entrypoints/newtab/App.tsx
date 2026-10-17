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
  HistoryOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UpOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  ConfigProvider,
  Dropdown,
  Empty,
  Form,
  Input,
  type InputRef,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Tag,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import {
  filterBookmarkCards,
  loadBookmarkCards,
  type BookmarkFolderCard,
} from '@/lib/bookmarks-matrix';
import type { BookmarkItem } from '@/lib/bookmarks';
import {
  browserFaviconUrl,
  formatLiveStatusGreeting,
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
  type PinnedGroup,
  type PinnedItem,
  type IconMode,
  type ProfileMode,
  type SearchEngine,
} from '@/lib/newtab-types';
import {
  addPinnedGroup,
  addPinnedItem,
  deletePinnedGroup,
  deletePinnedItem,
  getNewTabSettings,
  getPinnedData,
  saveNewTabSettings,
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
  generateMorningBriefing,
  naturalLanguageSearchMatch,
} from '@/lib/ai-assistant';
import {
  getAiSettings,
  type AiSettings,
  DEFAULT_AI_SETTINGS,
} from '@/lib/settings';

const { Text, Title } = Typography;

export default function NewTabApp() {
  // 主题检测
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // 时钟问候语
  const [greetingInfo, setGreetingInfo] = useState(() => formatTimeGreeting());

  // 固钉数据
  const [pinnedData, setPinnedData] = useState<PinnedData>({
    groups: [],
    items: [],
  });
  const [activeGroupId, setActiveGroupId] = useState<string>('all');

  // 新标签页设置
  const [settings, setSettings] = useState<NewTabSettings>(DEFAULT_NEWTAB_SETTINGS);

  // 快捷方式表单：URL 预览 + 提示 + 名称建议
  // 请求编号/会话编号/名称来源由 controller 持有（见 shortcut-meta.ts），
  // 它们必须在异步回调里同步读到最新值，放 React state 会读到闭包快照。
  const [shortcutPreview, setShortcutPreview] = useState('');
  const [shortcutHint, setShortcutHint] = useState('');
  const [suggestedTitle, setSuggestedTitle] = useState<TitleCandidate | null>(null);

  // 当前已开标签页映射 (用于已开检测)
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: number; url: string; title: string; windowId?: number }>
  >([]);

  // 猜你想开智能推选
  const [recommendations, setRecommendations] = useState<RecommendedStation[]>([]);

  // 书签看板状态
  const [bookmarkCards, setBookmarkCards] = useState<BookmarkFolderCard[]>([]);
  const [bookmarkSearch, setBookmarkSearch] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [editingBookmark, setEditingBookmark] = useState<BookmarkItem | null>(null);
  const [bookmarkForm] = Form.useForm();

  // 会话现场恢复
  const [recentSnapshot, setRecentSnapshot] = useState<SessionSnapshot | null>(null);

  // 端侧 AI 设置与智能晨报
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [morningBriefing, setMorningBriefing] = useState<string>('');

  // 搜索框状态
  const [searchInput, setSearchInput] = useState('');
  const [activeEngine, setActiveEngine] = useState<SearchEngine>(SEARCH_ENGINES[0]);
  const [searchSuggestions, setSearchSuggestions] = useState<SearchItem[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<InputRef>(null);

  // 模态框状态
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<PinnedItem | null>(null);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [groupForm] = Form.useForm();

  // 全键盘快捷键: 按 '/' 键自动聚焦搜索框，按 Escape 失焦
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 监听系统深浅色切换
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // 时钟定时刷新
  useEffect(() => {
    const timer = setInterval(() => {
      setGreetingInfo(formatTimeGreeting());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  // 初始化加载数据
  useEffect(() => {
    async function loadInitialData() {
      // 1. 优先读取持久化缓存，实现首屏 <30ms 极速直出
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

      // 1.1 根据当前工作/个人模式还原选中的搜索引擎
      const initialEngineId =
        nSettings.profile === 'home'
          ? nSettings.homeEngineId || nSettings.defaultEngineId
          : nSettings.workEngineId || nSettings.defaultEngineId;
      const matchedEngine =
        SEARCH_ENGINES.find((e) => e.id === initialEngineId) ||
        SEARCH_ENGINES[0];
      setActiveEngine(matchedEngine);

      // 2. 查询已开标签
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

      // 3. 空闲时异步刷新历史推荐并更新缓存 (零阻塞首屏渲染)
      refreshAndCacheRecommendations(8).then(async (fresh) => {
        if (fresh && fresh.length > 0) {
          setRecommendations(fresh);

          // 渐进增强：若启用了端侧 AI 且胶囊浓缩开启，异步微调标题
          const aiSet = await getAiSettings();
          if (aiSet.enabled && aiSet.capsuleSummarize) {
            for (const rec of fresh) {
              if (rec.capsule) {
                summarizeDeepRouteTitle(rec.capsule.title, rec.capsule.url, aiSet).then((aiTitle) => {
                  if (aiTitle) {
                    setRecommendations((prev) =>
                      prev.map((item) =>
                        item.domain === rec.domain && item.capsule
                          ? { ...item, capsule: { ...item.capsule, cleanTitle: aiTitle } }
                          : item,
                      ),
                    );
                  }
                });
              }
            }
          }
        }
      });

      // 4. 读取书签平铺目录与最近会话快照
      loadBookmarkCards().then((cards) => setBookmarkCards(cards));
      const snapsPromise = getSnapshots();
      snapsPromise.then((snaps) => {
        if (snaps && snaps.length > 0) {
          setRecentSnapshot(snaps[0]);
        }
      });

      // 5. 立即计算基于真实时段与标签/快照的动态问候语 (0 毫秒首屏直出，彻底杜绝写死)
      snapsPromise.then(async (snaps) => {
        const snapCount = Array.isArray(snaps) ? snaps.length : 0;
        const liveGreeting = formatLiveStatusGreeting(initialOpenTabs.length, snapCount);
        setMorningBriefing(liveGreeting);

        // 探测端侧 AI 配置，若可用且开启则由 Gemini Nano 渐进增强
        const aiSet = await getAiSettings();
        setAiSettings(aiSet);
        if (aiSet.enabled && aiSet.morningBriefing) {
          const briefing = await generateMorningBriefing(initialOpenTabs.length, snapCount, aiSet);
          if (briefing) {
            setMorningBriefing(briefing);
          }
        }
      });
    }
    loadInitialData();
  }, []);

  // 搜索输入解析
  const parsedSearch = useMemo(() => {
    return parseSearchQuery(searchInput, activeEngine.id);
  }, [searchInput, activeEngine]);

  /**
   * 图标来源解析。默认首字母 SVG（本地、零请求）；
   * browser 模式用 Chrome 本地图标库，失败时回退到首字母 SVG。
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

  // 搜索建议与自然语言智能意图起跳 (严格内置 400ms 防抖)
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchSuggestions([]);
      setSelectedSuggestionIndex(-1);
      return;
    }

    const timer = setTimeout(async () => {
      const items: SearchItem[] = openTabs.map((t) => ({
        id: `tab_${t.id}`,
        kind: 'tab',
        title: t.title,
        url: t.url,
        tabId: t.id,
        windowId: t.windowId,
        domain: new URL(t.url || 'https://example.com').hostname,
      }));

      const ranked = filterAndRankItems(items, searchInput.trim(), 'all', 6);

      // 若启用了端侧 AI 自然语言意图起跳，且输入长度 >= 3，异步意图补全
      if (aiSettings.enabled && aiSettings.naturalLanguageJump && searchInput.trim().length >= 3) {
        try {
          const validCandidates = items.filter(
            (it): it is SearchItem & { url: string } => Boolean(it.url),
          );
          const matched = await naturalLanguageSearchMatch(
            searchInput.trim(),
            validCandidates,
            aiSettings,
          );
          if (matched.length > 0) {
            const aiItems: SearchItem[] = matched.map((m) => {
              const original = items.find((it) => it.url === m.url);
              return original || {
                id: `ai_${m.url}`,
                kind: 'tab',
                title: m.title,
                url: m.url,
                domain: new URL(m.url).hostname,
              };
            });
            // 归并去重
            const merged = [...aiItems];
            for (const r of ranked) {
              if (!merged.some((m) => m.url === r.url)) {
                merged.push(r);
              }
            }
            setSearchSuggestions(merged.slice(0, 6));
            setSelectedSuggestionIndex(-1);
            return;
          }
        } catch {
          // ignore
        }
      }

      setSearchSuggestions(ranked);
      setSelectedSuggestionIndex(-1);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchInput, openTabs, aiSettings]);

  // 导航打开链接逻辑
  const handleOpenUrl = (targetUrl: string, inNewTab = false) => {
    if (!targetUrl) return;

    // 检查是否已有完全匹配的标签页
    const foundTab = openTabs.find((t) => t.url === targetUrl);
    if (foundTab && typeof chrome !== 'undefined' && chrome.tabs?.update) {
      chrome.tabs.update(foundTab.id, { active: true });
      if (foundTab.windowId !== undefined && chrome.windows?.update) {
        chrome.windows.update(foundTab.windowId, { focused: true });
      }
      return;
    }

    if (inNewTab || settings.openInNewTab) {
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: targetUrl });
      } else {
        window.open(targetUrl, '_blank');
      }
    } else {
      window.location.href = targetUrl;
    }
  };

  // 激活搜索建议项
  const handleActivateSearchItem = (item: SearchItem) => {
    if (item.tabId && typeof chrome !== 'undefined' && chrome.tabs?.update) {
      chrome.tabs.update(item.tabId, { active: true });
      if (item.windowId && chrome.windows?.update) {
        chrome.windows.update(item.windowId, { focused: true });
      }
    } else if (item.url) {
      handleOpenUrl(item.url);
    }
  };

  // 键盘方向键切换建议项
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
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

  // 回车提交搜索或直达 (支持键盘高亮建议直接跳转)
  const handleSearchSubmit = (e?: React.KeyboardEvent<HTMLInputElement>) => {
    if (e?.nativeEvent?.isComposing) {
      return;
    }
    if (!searchInput.trim()) return;

    // 1. 若当前用户通过方向键显式高亮选中了建议项，直接切换或打开
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

    // 搜索模板跳转
    const engine = parsedSearch.engine || activeEngine;
    const searchUrl = engine.urlTemplate.replace(
      '%s',
      encodeURIComponent(parsedSearch.cleanQuery),
    );
    handleOpenUrl(searchUrl);
  };

  // 切换工作与个人模式（独立记忆搜索引擎、内网卡片过滤、分组自适应）
  const handleToggleProfile = async (newProfile: ProfileMode) => {
    const updated = await saveNewTabSettings({ profile: newProfile });
    setSettings(updated);
    // 恢复对应模式下记忆的搜索引擎
    const targetEngineId =
      newProfile === 'home'
        ? updated.homeEngineId || updated.defaultEngineId
        : updated.workEngineId || updated.defaultEngineId;
    const targetEngine =
      SEARCH_ENGINES.find((e) => e.id === targetEngineId) || SEARCH_ENGINES[0];
    setActiveEngine(targetEngine);
    // 模式切换时自适应分组（如有个人/生活相关分组或工作分组）
    if (newProfile === 'home') {
      const homeGroup = pinnedData.groups.find((g) =>
        /生活|个人|常用|home|life/i.test(g.name),
      );
      if (homeGroup) setActiveGroupId(homeGroup.id);
    } else {
      const workGroup = pinnedData.groups.find((g) =>
        /工作|开发|技术|work|dev/i.test(g.name),
      );
      if (workGroup) setActiveGroupId(workGroup.id);
    }
  };

  // 切换搜索引擎并同步记忆至对应模式
  const handleSelectEngine = async (engine: SearchEngine) => {
    setActiveEngine(engine);
    const updates =
      settings.profile === 'home'
        ? { homeEngineId: engine.id }
        : { workEngineId: engine.id };
    const updated = await saveNewTabSettings(updates);
    setSettings(updated);
  };

  // 切换图标来源：首字母 SVG（默认）/ 浏览器本地图标库
  const handleToggleIconMode = async (iconMode: IconMode) => {
    const updated = await saveNewTabSettings({ iconMode });
    setSettings(updated);
  };

  // 过滤当前分组卡片（个人模式下过滤内网卡片）
  const filteredItems = useMemo(() => {
    let list = pinnedData.items;
    if (settings.profile === 'home') {
      list = list.filter((item) => {
        let hostname = '';
        try {
          hostname = new URL(item.url).hostname;
        } catch {
          hostname = item.url;
        }
        return !isIntranetHost(hostname);
      });
    }
    if (activeGroupId === 'all') return list;
    return list.filter((i) => i.groupId === activeGroupId);
  }, [pinnedData, activeGroupId, settings.profile]);

  // 猜你想开：个人模式下过滤纯内网服务
  const displayRecommendations = useMemo(() => {
    if (settings.profile === 'home') {
      return recommendations.filter((r) => !r.isIntranet);
    }
    return recommendations;
  }, [recommendations, settings.profile]);

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

  // 打开添加/编辑模态框
  const handleOpenItemModal = (item?: PinnedItem) => {
    // 开新会话：作废上一条所有在途请求，避免旧建议/旧提示串到这一条
    metaController.beginSession(item != null);

    if (item) {
      setEditingItem(item);
      form.setFieldsValue(item);
    } else {
      setEditingItem(null);
      form.resetFields();
      form.setFieldsValue({
        groupId:
          activeGroupId === 'all'
            ? pinnedData.groups[0]?.id || 'dev'
            : activeGroupId,
      });
    }
    setItemModalVisible(true);
  };

  /** 关闭弹窗：结束会话，作废在途请求 */
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

  // 保存固钉卡片
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
      const refreshed = await getPinnedData();
      setPinnedData(refreshed);
      // 保存成功即结束会话，作废在途请求
      handleCloseItemModal();
    } catch {
      // 表单校验失败
    }
  };

  // 删除固钉卡片
  const handleDeleteItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deletePinnedItem(id);
    const refreshed = await getPinnedData();
    setPinnedData(refreshed);
  };

  // 新增分组
  const handleSaveGroup = async () => {
    try {
      const values = await groupForm.validateFields();
      await addPinnedGroup(values.name);
      const refreshed = await getPinnedData();
      setPinnedData(refreshed);
      setGroupModalVisible(false);
      groupForm.resetFields();
    } catch {
      // 校验失败
    }
  };

  const [messageApi, contextHolder] = message.useMessage();
  const [snapshotDismissed, setSnapshotDismissed] = useState(false);

  // 过滤书签目录卡片（全量检索）
  const displayBookmarkCards = useMemo(() => {
    return filterBookmarkCards(bookmarkCards, bookmarkSearch);
  }, [bookmarkCards, bookmarkSearch]);

  // 折叠/展开书签文件夹
  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // 后台静默打开书签
  const handleOpenBookmarkInBackground = (url: string) => {
    if (!url) return;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url, active: false });
      messageApi.success('已在后台标签页打开');
    } else {
      window.open(url, '_blank');
    }
  };

  // 复制书签网址
  const handleCopyUrl = async (url: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      messageApi.success('已复制网址到剪贴板');
    } catch {
      messageApi.error('复制网址失败');
    }
  };

  // 一键在后台打开该目录下所有书签
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

  // 保存修改的书签
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
        const refreshed = await loadBookmarkCards();
        setBookmarkCards(refreshed);
      } else {
        messageApi.info('当前环境不支持直接更新 Chrome 书签');
      }
      setEditingBookmark(null);
    } catch {
      // 校验失败
    }
  };

  // 删除书签
  const handleDeleteBookmark = (item: BookmarkItem) => {
    Modal.confirm({
      title: '确认删除书签？',
      content: `确定从 Chrome 收藏夹中永久删除「${item.title}」吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        if (typeof chrome !== 'undefined' && chrome.bookmarks?.remove) {
          await chrome.bookmarks.remove(item.id);
          messageApi.success('书签已删除');
          const refreshed = await loadBookmarkCards();
          setBookmarkCards(refreshed);
        } else {
          messageApi.info('当前环境不支持直接删除 Chrome 书签');
        }
      },
    });
  };

  // 一键恢复会话快照
  const handleRestoreSnapshot = async (snapshot: SessionSnapshot) => {
    if (!snapshot.tabs || snapshot.tabs.length === 0) return;
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      for (const tab of snapshot.tabs) {
        if (tab.url) {
          chrome.tabs.create({ url: tab.url, active: false });
        }
      }
      messageApi.success(`已在后台开启 ${snapshot.tabs.length} 个标签页`);
    } else {
      snapshot.tabs.slice(0, 5).forEach((t) => {
        if (t.url) window.open(t.url, '_blank');
      });
      messageApi.success(`已恢复会话页面`);
    }
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 8,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif",
        },
      }}
    >
      {contextHolder}
      <div className="newtab-container">
        {/* 顶部状态与模式切换栏 */}
        <header className="newtab-header">
          <div>
            <div className="greeting-time">{greetingInfo.timeStr}</div>
            <div className="greeting-subtitle">
              {greetingInfo.greeting} · {greetingInfo.dateStr}
            </div>
          </div>

          <Space direction="horizontal" size="middle">
            <Radio.Group
              value={settings.profile}
              onChange={(e) => handleToggleProfile(e.target.value)}
              buttonStyle="solid"
              size="small"
            >
              <Radio.Button value="work">🏢 办公内网</Radio.Button>
              <Radio.Button value="home">🏠 个人模式</Radio.Button>
            </Radio.Group>

            <Tooltip
              title={
                settings.iconMode === 'browser'
                  ? '当前：浏览器图标（来自 Chrome 本地图标库）。未访问过的站点会显示浏览器默认图标。'
                  : '当前：首字母图标（本地生成，零网络请求）'
              }
            >
              <Radio.Group
                value={settings.iconMode}
                onChange={(e) => void handleToggleIconMode(e.target.value)}
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="initials">首字母</Radio.Button>
                <Radio.Button value="browser">浏览器图标</Radio.Button>
              </Radio.Group>
            </Tooltip>

            <Tooltip title="打开 YiTab 控制中心">
              <Button
                type="text"
                shape="circle"
                icon={<SettingOutlined />}
                onClick={() => {
                  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
                    chrome.runtime.openOptionsPage();
                  } else {
                    window.open('options.html', '_blank');
                  }
                }}
              />
            </Tooltip>
          </Space>
        </header>

        {/* ☀️ 晨间工作现场智能简报 */}
        {morningBriefing && (
          <div
            style={{
              maxWidth: 760,
              width: '100%',
              margin: '-12px auto 0',
              padding: '8px 14px',
              borderRadius: 8,
              background: isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.06)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              color: isDark ? '#93c5fd' : '#2563eb',
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}
          >
            <span>{morningBriefing}</span>
            {recentSnapshot && (
              <Button
                type="link"
                size="small"
                style={{ fontSize: 11, padding: 0, height: 'auto', fontWeight: 600 }}
                onClick={() => handleRestoreSnapshot(recentSnapshot)}
              >
                一键唤醒工作现场 ↗
              </Button>
            )}
          </div>
        )}

        {/* 极简全能聚合搜索条 */}
        <div className="search-section">
          <Card
            styles={{ body: { padding: '8px 12px' } }}
            style={{
              borderRadius: 12,
              boxShadow: isSearchFocused
                ? '0 6px 20px rgba(59, 130, 246, 0.15)'
                : '0 2px 10px rgba(0, 0, 0, 0.04)',
              border: isSearchFocused
                ? '1px solid #3b82f6'
                : isDark
                  ? '1px solid #334155'
                  : '1px solid #e2e8f0',
              transition: 'all 0.2s ease',
            }}
          >
            <Space direction="horizontal" style={{ width: '100%' }}>
              <Dropdown
                menu={{
                  items: SEARCH_ENGINES.map((e) => ({
                    key: e.id,
                    label: `${e.icon} ${e.name} [前缀: ${e.prefix}]`,
                    onClick: () => handleSelectEngine(e),
                  })),
                }}
                trigger={['click']}
              >
                <Button type="text" size="middle" style={{ padding: '0 8px', fontWeight: 600 }}>
                  {activeEngine.icon} {activeEngine.name} <SwapOutlined style={{ fontSize: 11 }} />
                </Button>
              </Dropdown>

              <Input
                ref={searchInputRef}
                autoFocus
                bordered={false}
                placeholder={
                  parsedSearch.isAddress
                    ? `⏎ 直达网络地址: ${parsedSearch.targetUrl}`
                    : activeEngine.placeholder
                }
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                onKeyDown={handleSearchKeyDown}
                onPressEnter={handleSearchSubmit}
                style={{ fontSize: 15 }}
                suffix={
                  searchInput ? (
                    <Button
                      type="primary"
                      size="small"
                      icon={<SearchOutlined />}
                      onClick={() => handleSearchSubmit()}
                    >
                      {parsedSearch.isAddress ? '直达' : '搜索'}
                    </Button>
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        background: isDark ? '#334155' : '#f1f5f9',
                        padding: '1px 6px',
                        borderRadius: 4,
                        userSelect: 'none',
                      }}
                    >
                      / 聚焦
                    </span>
                  )
                }
              />
            </Space>

            {/* 搜索建议与已开标签快速直达 */}
            {isSearchFocused && searchSuggestions.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  borderTop: isDark ? '1px solid #334155' : '1px solid #f1f5f9',
                  paddingTop: 8,
                }}
              >
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                  已开标签智能匹配 (按上下键选择，回车或点击直接切换):
                </div>
                {searchSuggestions.map((item, index) => {
                  const isSelected = index === selectedSuggestionIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleActivateSearchItem(item)}
                      onMouseEnter={() => setSelectedSuggestionIndex(index)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        background: isSelected
                          ? isDark
                            ? 'rgba(59, 130, 246, 0.25)'
                            : 'rgba(59, 130, 246, 0.1)'
                          : 'transparent',
                        border: isSelected
                          ? '1px solid #3b82f6'
                          : '1px solid transparent',
                      }}
                    >
                      <Space direction="horizontal" size="small" style={{ overflow: 'hidden' }}>
                        <Tag color={isSelected ? 'blue' : 'cyan'}>已开标签</Tag>
                        <Text style={{ fontSize: 13, fontWeight: isSelected ? 600 : 500 }} ellipsis>
                          {item.title}
                        </Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {item.domain} {isSelected ? '⏎ 切换' : '↗'}
                      </Text>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* 💡 猜你想开 (智能推选引擎 + 胶囊双态直达) */}
        {displayRecommendations.length > 0 && (
          <div className="recommendations-section">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Title level={5} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ThunderboltOutlined style={{ color: '#f59e0b' }} /> 猜你想开
                <span style={{ fontSize: 11, fontWeight: 'normal', color: '#94a3b8' }}>
                  基于 RFT 衰减模型与当前时段智能推荐
                </span>
              </Title>
            </div>

            <div className="recommendations-grid">
              {displayRecommendations.map((rec) => {
                return (
                  <div
                    key={`rec_${rec.domain}`}
                    className="recommendation-card"
                    onClick={() => {
                      if (rec.isOpen && rec.openTabId && typeof chrome !== 'undefined') {
                        chrome.tabs.update(rec.openTabId, { active: true });
                        if (rec.openWindowId && chrome.windows?.update) {
                          chrome.windows.update(rec.openWindowId, { focused: true });
                        }
                      } else {
                        handleOpenUrl(rec.primaryUrl);
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img
                        className="pinned-icon"
                        src={iconFor(rec.primaryUrl, rec.title, 64).src}
                        alt={rec.title}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = iconFor(rec.primaryUrl, rec.title, 64).fallback;
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="pinned-title">{rec.title}</div>
                        <div className="pinned-url">{rec.domain}</div>
                      </div>

                      {rec.isOpen && (
                        <Tooltip title="该站点已在后台窗口打开，点击直接切换">
                          <Tag
                            color="success"
                            icon={<CheckCircleFilled />}
                            style={{ margin: 0, padding: '0 4px', fontSize: 10 }}
                          >
                            已打开
                          </Tag>
                        </Tooltip>
                      )}

                      {rec.isIntranet && !rec.isOpen && (
                        <Tag color="geekblue" style={{ margin: 0, padding: '0 4px', fontSize: 10 }}>
                          内网
                        </Tag>
                      )}
                    </div>

                    {/* 深层路由恢复上下文微胶囊 */}
                    {rec.capsule && (
                      <div
                        className="resume-capsule"
                        title={`上次访问: ${rec.capsule.title}\n地址: ${rec.capsule.url}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenUrl(rec.capsule!.url);
                        }}
                      >
                        <ClockCircleOutlined style={{ fontSize: 11 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          继续上次: {rec.capsule.cleanTitle}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.8 }}>↗</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 固钉工作台 (Pinned Matrix) */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <Space direction="horizontal" size="middle">
              <Title level={5} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AppstoreOutlined style={{ color: '#3b82f6' }} /> 固钉工作台
              </Title>
              <Radio.Group
                value={activeGroupId}
                onChange={(e) => setActiveGroupId(e.target.value)}
                size="small"
              >
                <Radio.Button value="all">全部 ({pinnedData.items.length})</Radio.Button>
                {pinnedData.groups.map((g) => {
                  const count = pinnedData.items.filter((i) => i.groupId === g.id).length;
                  return (
                    <Radio.Button key={g.id} value={g.id}>
                      {g.name} ({count})
                    </Radio.Button>
                  );
                })}
              </Radio.Group>
            </Space>

            <Space direction="horizontal" size="small">
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setGroupModalVisible(true)}
              >
                新建分组
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => handleOpenItemModal()}
              >
                添加快捷方式
              </Button>
            </Space>
          </div>

          {filteredItems.length === 0 ? (
            <Card style={{ borderRadius: 10, textAlign: 'center', padding: '30px 0' }}>
              <Empty description="该分组暂无固钉快捷应用">
                <Button type="primary" size="small" onClick={() => handleOpenItemModal()}>
                  立即添加第一个应用
                </Button>
              </Empty>
            </Card>
          ) : (
            <div className="pinned-grid">
              {filteredItems.map((item) => {
                let hostname = '';
                try {
                  hostname = new URL(item.url).hostname;
                } catch {
                  hostname = item.url;
                }

                const isIntranet = isIntranetHost(hostname);
                const isOpen = openTabs.some((t) => t.url === item.url);

                return (
                  <div
                    key={item.id}
                    className="pinned-card"
                    onClick={() => handleOpenUrl(item.url)}
                  >
                    <img
                      className="pinned-icon"
                      src={iconFor(item.url, item.title, 64).src}
                      alt={item.title}
                      onError={(e) => {
                        // 失败时自愈为优雅的矢量 SVG Favicon
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = iconFor(item.url, item.title, 64).fallback;
                      }}
                    />

                    <div className="pinned-info">
                      <div className="pinned-title">{item.title}</div>
                      <div className="pinned-url">{hostname || item.url}</div>
                    </div>

                    {isOpen && (
                      <Tooltip title="当前标签页已在后台打开，点击直接激活">
                        <Tag
                          color="success"
                          icon={<CheckCircleFilled />}
                          style={{ margin: 0, padding: '0 4px', fontSize: 10 }}
                        >
                          已打开
                        </Tag>
                      </Tooltip>
                    )}

                    {isIntranet && !isOpen && (
                      <Tag color="geekblue" style={{ margin: 0, padding: '0 4px', fontSize: 10 }}>
                        内网
                      </Tag>
                    )}

                    <div
                      style={{
                        position: 'absolute',
                        right: 8,
                        top: 8,
                        display: 'none',
                      }}
                      className="pinned-actions"
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenItemModal(item);
                        }}
                      />
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => handleDeleteItem(item.id, e)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 📑 书签看板 (Bookmarks Board) */}
        {bookmarkCards.length > 0 && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <Title level={5} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                <BookOutlined style={{ color: '#10b981' }} /> 书签看板
                <span style={{ fontSize: 11, fontWeight: 'normal', color: '#94a3b8' }}>
                  按常用目录聚合速览
                </span>
              </Title>

              <Input
                placeholder="快速筛选书签或目录..."
                prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
                value={bookmarkSearch}
                onChange={(e) => setBookmarkSearch(e.target.value)}
                allowClear
                size="small"
                style={{ width: 220, borderRadius: 6 }}
              />
            </div>

            {displayBookmarkCards.length === 0 ? (
              <Card style={{ borderRadius: 10, textAlign: 'center', padding: '20px 0' }}>
                <Empty description="未找到匹配的书签项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </Card>
            ) : (
              <div className="bookmark-matrix-grid">
                {displayBookmarkCards.map((card) => {
                  const isSearching = Boolean(bookmarkSearch.trim());
                  const isExpanded = expandedFolderIds.has(card.id);
                  const itemsToRender = isSearching
                    ? card.items
                    : isExpanded
                      ? card.allItems || card.items
                      : card.items;

                  return (
                    <div key={card.id} className="bookmark-folder-card">
                      <div className="bookmark-folder-header">
                        <Space direction="horizontal" size="small" style={{ overflow: 'hidden' }}>
                          <FolderOpenOutlined style={{ color: '#f59e0b', fontSize: 15 }} />
                          <Text strong style={{ fontSize: 13 }} ellipsis>
                            {card.name}
                          </Text>
                        </Space>
                        <Space direction="horizontal" size="small">
                          <Tag style={{ margin: 0, fontSize: 10 }}>{card.totalCount} 项</Tag>
                          <Tooltip title="在后台一键打开该目录下全部书签">
                            <Button
                              type="text"
                              size="small"
                              style={{ padding: '0 4px', height: 22, fontSize: 11, color: '#10b981' }}
                              icon={<RocketOutlined />}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenFolderAll(card);
                              }}
                            >
                              全部打开
                            </Button>
                          </Tooltip>
                        </Space>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {itemsToRender.map((item) => {
                          const bookmarkMenuItems = [
                            {
                              key: 'open-new-tab',
                              icon: <GlobalOutlined />,
                              label: '在新标签页打开',
                              onClick: () => handleOpenUrl(item.url, true),
                            },
                            {
                              key: 'open-bg',
                              icon: <RocketOutlined />,
                              label: '后台静默打开',
                              onClick: () => handleOpenBookmarkInBackground(item.url),
                            },
                            {
                              key: 'copy-url',
                              icon: <CopyOutlined />,
                              label: '复制网址',
                              onClick: () => handleCopyUrl(item.url),
                            },
                            {
                              type: 'divider' as const,
                            },
                            {
                              key: 'edit',
                              icon: <EditOutlined />,
                              label: '修改书签',
                              onClick: () => {
                                setEditingBookmark(item);
                                bookmarkForm.setFieldsValue({
                                  title: item.title,
                                  url: item.url,
                                });
                              },
                            },
                            {
                              key: 'delete',
                              icon: <DeleteOutlined />,
                              danger: true,
                              label: '删除书签',
                              onClick: () => handleDeleteBookmark(item),
                            },
                          ];

                          return (
                            <Dropdown
                              key={item.id}
                              menu={{ items: bookmarkMenuItems }}
                              trigger={['contextMenu']}
                            >
                              <div
                                className="bookmark-link-item"
                                onClick={() => handleOpenUrl(item.url)}
                                title={`${item.title}\n${item.url}\n(右键呼出书签操作菜单)`}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1 }}>
                                  <img
                                    src={iconFor(item.url, item.title, 32).src}
                                    alt=""
                                    style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }}
                                    onError={(e) => {
                                      e.currentTarget.onerror = null;
                                      e.currentTarget.src = iconFor(item.url, item.title, 32).fallback;
                                    }}
                                  />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {item.title}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 6 }}>
                                  <span className="bookmark-domain-text">
                                    {item.domain}
                                  </span>
                                  <Dropdown menu={{ items: bookmarkMenuItems }} trigger={['click']}>
                                    <Button
                                      type="text"
                                      size="small"
                                      className="bookmark-item-more-btn"
                                      icon={<MoreOutlined style={{ fontSize: 12 }} />}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </Dropdown>
                                </div>
                              </div>
                            </Dropdown>
                          );
                        })}
                      </div>

                      {card.totalCount > 6 && !isSearching && (
                        <div
                          className="bookmark-folder-expand-btn"
                          onClick={() => toggleFolderExpand(card.id)}
                        >
                          {isExpanded ? (
                            <Space size={4}>
                              <UpOutlined style={{ fontSize: 10 }} />
                              <span>收起</span>
                            </Space>
                          ) : (
                            <Space size={4}>
                              <DownOutlined style={{ fontSize: 10 }} />
                              <span>展开更多 (共 {card.totalCount} 项)</span>
                            </Space>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 🗂️ 会话现场恢复栏 (Session Resume Bar) */}
        {recentSnapshot && !snapshotDismissed && recentSnapshot.tabs.length > 0 && (
          <div className="session-resume-bar">
            <Space direction="horizontal" size="middle">
              <RocketOutlined style={{ color: '#3b82f6', fontSize: 18 }} />
              <div>
                <Text strong style={{ fontSize: 13.5 }}>
                  上次工作现场: {recentSnapshot.name}
                </Text>
                <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                  包含 {recentSnapshot.tabs.length} 个页面快照 · 保存于{' '}
                  {new Date(recentSnapshot.createdAt).toLocaleDateString()}{' '}
                  {new Date(recentSnapshot.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </Space>

            <Space direction="horizontal" size="small">
              <Button
                type="primary"
                size="small"
                icon={<RocketOutlined />}
                onClick={() => handleRestoreSnapshot(recentSnapshot)}
              >
                一键恢复现场 ({recentSnapshot.tabs.length})
              </Button>
              <Tooltip title="不再提示本次快照">
                <Button
                  type="text"
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => setSnapshotDismissed(true)}
                />
              </Tooltip>
            </Space>
          </div>
        )}

        {/* 添加/编辑固钉模态框 */}
        <Modal
          title={editingItem ? '编辑快捷方式' : '添加快捷方式'}
          open={itemModalVisible}
          onOk={handleSaveItem}
          onCancel={handleCloseItemModal}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            {/* URL 前置：先填地址，名称才可自动补全 */}
            <Form.Item
              name="url"
              label="网络网址 (支持内网 IP 与端口)"
              rules={[{ required: true, message: '请输入网址' }]}
              extra={
                shortcutHint ? (
                  <span style={{ fontSize: 12, color: '#64748b' }}>{shortcutHint}</span>
                ) : shortcutPreview ? (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    将保存为 {shortcutPreview}
                  </span>
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
              <div style={{ marginTop: -8, marginBottom: 16, fontSize: 12, color: '#64748b' }}>
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
                options={pinnedData.groups.map((g) => ({
                  value: g.id,
                  label: g.name,
                }))}
              />
            </Form.Item>
          </Form>
        </Modal>

        {/* 添加分组模态框 */}
        <Modal
          title="新建应用分组"
          open={groupModalVisible}
          onOk={handleSaveGroup}
          onCancel={() => setGroupModalVisible(false)}
          okText="创建"
          cancelText="取消"
          destroyOnClose
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

        {/* 修改书签模态框 */}
        <Modal
          title="修改 Chrome 收藏夹书签"
          open={editingBookmark !== null}
          onOk={handleSaveBookmark}
          onCancel={() => setEditingBookmark(null)}
          okText="保存修改"
          cancelText="取消"
          destroyOnClose
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
