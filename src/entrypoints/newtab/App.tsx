import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  BookOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined,
  ThunderboltOutlined,
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
import {
  formatTimeGreeting,
  generateSvgFavicon,
  isDirectAddress,
  isIntranetHost,
  parseSearchQuery,
  SEARCH_ENGINES,
} from '@/lib/network-utils';
import type {
  NewTabSettings,
  PinnedData,
  PinnedGroup,
  PinnedItem,
  ProfileMode,
  SearchEngine,
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
  const [settings, setSettings] = useState<NewTabSettings>({
    profile: 'work',
    defaultEngineId: 'google',
    openInNewTab: false,
    showGreeting: true,
  });

  // 当前已开标签页映射 (用于已开检测)
  const [openTabs, setOpenTabs] = useState<
    Array<{ id: number; url: string; title: string; windowId: number }>
  >([]);

  // 猜你想开智能推选
  const [recommendations, setRecommendations] = useState<RecommendedStation[]>([]);

  // 书签快捷平铺看板
  const [bookmarkCards, setBookmarkCards] = useState<BookmarkFolderCard[]>([]);
  const [bookmarkSearch, setBookmarkSearch] = useState('');

  // 会话现场恢复
  const [recentSnapshot, setRecentSnapshot] = useState<SessionSnapshot | null>(null);

  // 搜索框状态
  const [searchInput, setSearchInput] = useState('');
  const [activeEngine, setActiveEngine] = useState<SearchEngine>(SEARCH_ENGINES[0]);
  const [searchSuggestions, setSearchSuggestions] = useState<SearchItem[]>([]);
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

      const matchedEngine =
        SEARCH_ENGINES.find((e) => e.id === nSettings.defaultEngineId) ||
        SEARCH_ENGINES[0];
      setActiveEngine(matchedEngine);

      // 2. 查询已开标签
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
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
      }

      // 3. 空闲时异步刷新历史推荐并更新缓存 (零阻塞首屏渲染)
      refreshAndCacheRecommendations(8).then((fresh) => {
        if (fresh && fresh.length > 0) {
          setRecommendations(fresh);
        }
      });

      // 4. 读取书签平铺目录与最近会话快照
      loadBookmarkCards().then((cards) => setBookmarkCards(cards));
      getSnapshots().then((snaps) => {
        if (snaps && snaps.length > 0) {
          setRecentSnapshot(snaps[0]);
        }
      });
    }
    loadInitialData();
  }, []);

  // 搜索输入解析
  const parsedSearch = useMemo(() => {
    return parseSearchQuery(searchInput, activeEngine.id);
  }, [searchInput, activeEngine]);

  // 搜索建议防抖计算
  useEffect(() => {
    if (!searchInput.trim()) {
      setSearchSuggestions([]);
      return;
    }

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
    setSearchSuggestions(ranked);
  }, [searchInput, openTabs]);

  // 导航打开链接逻辑
  const handleOpenUrl = (targetUrl: string, inNewTab = false) => {
    if (!targetUrl) return;

    // 检查是否已有完全匹配的标签页
    const foundTab = openTabs.find((t) => t.url === targetUrl);
    if (foundTab && typeof chrome !== 'undefined' && chrome.tabs?.update) {
      chrome.tabs.update(foundTab.id, { active: true });
      if (chrome.windows?.update) {
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

  // 回车提交搜索或直达
  const handleSearchSubmit = () => {
    if (!searchInput.trim()) return;

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

  // 切换工作与个人模式
  const handleToggleProfile = async (newProfile: ProfileMode) => {
    const updated = await saveNewTabSettings({ profile: newProfile });
    setSettings(updated);
  };

  // 过滤当前分组卡片
  const filteredItems = useMemo(() => {
    if (activeGroupId === 'all') return pinnedData.items;
    return pinnedData.items.filter((i) => i.groupId === activeGroupId);
  }, [pinnedData, activeGroupId]);

  // 打开添加/编辑模态框
  const handleOpenItemModal = (item?: PinnedItem) => {
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

  // 保存固钉卡片
  const handleSaveItem = async () => {
    try {
      const values = await form.validateFields();
      let formattedUrl = values.url.trim();
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`;
      }

      if (editingItem) {
        await updatePinnedItem({
          ...editingItem,
          title: values.title.trim(),
          url: formattedUrl,
          groupId: values.groupId,
        });
      } else {
        await addPinnedItem({
          title: values.title.trim(),
          url: formattedUrl,
          groupId: values.groupId,
        });
      }
      const refreshed = await getPinnedData();
      setPinnedData(refreshed);
      setItemModalVisible(false);
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

  // 过滤书签目录卡片
  const displayBookmarkCards = useMemo(() => {
    return filterBookmarkCards(bookmarkCards, bookmarkSearch);
  }, [bookmarkCards, bookmarkSearch]);

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
                    onClick: () => setActiveEngine(e),
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
                onPressEnter={handleSearchSubmit}
                style={{ fontSize: 15 }}
                suffix={
                  searchInput ? (
                    <Button
                      type="primary"
                      size="small"
                      icon={<SearchOutlined />}
                      onClick={handleSearchSubmit}
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
                  已开标签智能匹配 (按回车或点击直接切换):
                </div>
                {searchSuggestions.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      if (item.tabId && typeof chrome !== 'undefined') {
                        chrome.tabs.update(item.tabId, { active: true });
                        if (item.windowId && chrome.windows?.update) {
                          chrome.windows.update(item.windowId, { focused: true });
                        }
                      } else if (item.url) {
                        handleOpenUrl(item.url);
                      }
                    }}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = isDark ? '#334155' : '#f1f5f9';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <Space direction="horizontal" size="small" style={{ overflow: 'hidden' }}>
                      <Tag color="cyan">已开标签</Tag>
                      <Text style={{ fontSize: 13, fontWeight: 500 }} ellipsis>
                        {item.title}
                      </Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {item.domain} ↗
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* 💡 猜你想开 (智能推选引擎 + 胶囊双态直达) */}
        {recommendations.length > 0 && (
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
              {recommendations.map((rec) => {
                const svgFallback = generateSvgFavicon(rec.title, rec.domain);
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
                        src={`https://www.google.com/s2/favicons?domain=${rec.domain}&sz=64`}
                        alt={rec.title}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = svgFallback;
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
                const svgFallback = generateSvgFavicon(item.title, hostname);

                return (
                  <div
                    key={item.id}
                    className="pinned-card"
                    onClick={() => handleOpenUrl(item.url)}
                  >
                    <img
                      className="pinned-icon"
                      src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=64`}
                      alt={item.title}
                      onError={(e) => {
                        // 失败时自愈为优雅的矢量 SVG Favicon
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = svgFallback;
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

        {/* 📑 书签快捷直展矩阵 (Bookmarks Direct Matrix) */}
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
                <BookOutlined style={{ color: '#10b981' }} /> 书签直展矩阵
                <span style={{ fontSize: 11, fontWeight: 'normal', color: '#94a3b8' }}>
                  按目录平铺聚合
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
                {displayBookmarkCards.map((card) => (
                  <div key={card.id} className="bookmark-folder-card">
                    <div className="bookmark-folder-header">
                      <Space direction="horizontal" size="small" style={{ overflow: 'hidden' }}>
                        <FolderOpenOutlined style={{ color: '#f59e0b', fontSize: 15 }} />
                        <Text strong style={{ fontSize: 13 }} ellipsis>
                          {card.name}
                        </Text>
                      </Space>
                      <Tag style={{ margin: 0, fontSize: 10 }}>{card.totalCount} 项</Tag>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {card.items.map((item) => {
                        const fallback = generateSvgFavicon(item.title, item.domain || 'bm');
                        return (
                          <div
                            key={item.id}
                            className="bookmark-link-item"
                            onClick={() => handleOpenUrl(item.url)}
                            title={item.title}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${item.domain || 'chrome'}&sz=32`}
                                alt=""
                                style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0 }}
                                onError={(e) => {
                                  e.currentTarget.onerror = null;
                                  e.currentTarget.src = fallback;
                                }}
                              />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.title}
                              </span>
                            </div>
                            <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0, marginLeft: 6 }}>
                              {item.domain}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
          onCancel={() => setItemModalVisible(false)}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="title"
              label="网站/系统名称"
              rules={[{ required: true, message: '请输入名称' }]}
            >
              <Input placeholder="例如: GitLab 公司代码仓、Jira 看板" />
            </Form.Item>
            <Form.Item
              name="url"
              label="网络网址 (支持内网 IP 与端口)"
              rules={[{ required: true, message: '请输入网址' }]}
            >
              <Input placeholder="例如: https://github.com 或 192.168.1.100:8080" />
            </Form.Item>
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
      </div>
    </ConfigProvider>
  );
}
