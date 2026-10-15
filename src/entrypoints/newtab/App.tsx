import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  CheckCircleFilled,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SwapOutlined,
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
import { filterAndRankItems, type SearchItem } from '@/lib/search';

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
      const [pData, nSettings] = await Promise.all([
        getPinnedData(),
        getNewTabSettings(),
      ]);
      setPinnedData(pData);
      setSettings(nSettings);

      const matchedEngine =
        SEARCH_ENGINES.find((e) => e.id === nSettings.defaultEngineId) ||
        SEARCH_ENGINES[0];
      setActiveEngine(matchedEngine);

      // 查询已开标签
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
                  searchInput && (
                    <Button
                      type="primary"
                      size="small"
                      icon={<SearchOutlined />}
                      onClick={handleSearchSubmit}
                    >
                      {parsedSearch.isAddress ? '直达' : '搜索'}
                    </Button>
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
