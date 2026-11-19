import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Badge,
  Button,
  Card,
  ConfigProvider,
  Dropdown,
  Empty,
  Input,
  message,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tabs,
  Tag,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  CameraOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PushpinFilled,
  PushpinOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { sendToBackground } from '@/lib/messaging';
import type {
  AutoGroupTabsResponse,
  ExecuteCommandResponse,
  GetCurrentWindowTabsResponse,
  GetTabHealthResponse,
  ScanBookmarksResponse,
  SearchItemsResponse,
  UngroupAllTabsResponse,
} from '@/lib/messaging';
import type { SearchItem, SearchItemKind } from '@/lib/search';
import type { BookmarkScanReport } from '@/lib/bookmarks';
import type { TabHealthReport } from '@/lib/tab-health';
import { APP_VERSION } from '@/lib/version';
import { useThemeTokens } from '@/lib/theme-tokens';
import { useThemeMode, applyThemeToDocument } from '@/lib/theme-mode';
import { ThemeModeButton } from '@/components/ThemeToggle';
import { TabHealthPanel } from '@/components/TabHealthPanel';
import { BookmarkHealthPanel } from '@/components/BookmarkHealthPanel';
import {
  DEFAULTS,
  getDedupPausedUntil,
  getSettings,
  setDedupPausedUntil,
  setSettings,
  type Settings,
} from '@/lib/settings';
import { hostOf, inWhitelist, MODE_LABELS, resolveRule, stripWww } from '@/lib/match';
import {
  addPinnedItemIfAbsent,
  deletePinnedItem,
  findPinnedByUrl,
  getPinnedData,
} from '@/lib/pinned';
import type { PinnedData } from '@/lib/newtab-types';
import {
  analyzeTabsByDomain,
  deleteSnapshot,
  formatTabsExport,
  getDeterministicColor,
  getSnapshots,
  renameSnapshot,
  saveSnapshot,
  type DomainGroupAnalysis,
  type ExportFormat,
  type SessionSnapshot,
  type TabSnapshotItem,
} from '@/lib/snapshots';

const { Text, Paragraph } = Typography;

function PopupApp() {
  const { isDark, mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { tk } = useThemeTokens(isDark);
  const [messageApi, messageContextHolder] = message.useMessage();

  // 让原生控件与页面底色跟随主题，避免首帧闪白
  useEffect(() => applyThemeToDocument(isDark, tk.canvas), [isDark, tk.canvas]);
  const [currentTabs, setCurrentTabs] = useState<TabSnapshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState('organize');

  // 当前站点去重策略、固定状态与暂停状态
  const [activeTabUrl, setActiveTabUrl] = useState('');
  const [activeTabTitle, setActiveTabTitle] = useState('');
  const [pinnedData, setPinnedData] = useState<PinnedData>({ groups: [], items: [] });
  const [dedupSettings, setDedupSettings] = useState<Settings>(DEFAULTS);
  const [pausedUntil, setPausedUntil] = useState(0);

  // 阶段四：标签健康与闲置休眠状态
  const [tabHealth, setTabHealth] = useState<TabHealthReport | null>(null);

  // 阶段四：书签健康与智能去重状态
  const [bookmarkReport, setBookmarkReport] = useState<BookmarkScanReport | null>(null);
  const [bookmarkScanning, setBookmarkScanning] = useState(false);

  // 快照状态
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [editingSnapshotId, setEditingSnapshotId] = useState<string | null>(null);
  const [editingSnapshotName, setEditingSnapshotName] = useState('');

  // 导出状态
  const [exportSource, setExportSource] = useState<'current' | string>('current');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown_list');
  const [copied, setCopied] = useState(false);

  // 阶段三：搜索与快捷指令状态
  const [searchQuery, setSearchQuery] = useState('');
  const [searchKind, setSearchKind] = useState<'all' | SearchItemKind>('all');
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // 执行搜索
  const performSearch = async (q: string, kind: 'all' | SearchItemKind) => {
    setSearchLoading(true);
    try {
      const res = await sendToBackground<SearchItemsResponse>({
        type: 'searchItems',
        query: q,
        kindFilter: kind,
        limit: 35,
      });
      if (res && res.ok) {
        setSearchResults(res.items);
      }
    } catch (e) {
      console.warn('Search failed:', e);
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    if (activeTabKey === 'search') {
      performSearch(searchQuery, searchKind);
    } else if (activeTabKey === 'bookmarks' && !bookmarkReport && !bookmarkScanning) {
      scanBookmarks();
    }
  }, [activeTabKey, searchKind]);

  const handleSearchInputChange = (val: string) => {
    setSearchQuery(val);
    performSearch(val, searchKind);
  };

  const handleExecuteSearchItem = async (item: SearchItem) => {
    if (item.kind === 'tab' && item.tabId != null) {
      await sendToBackground({
        type: 'switchTab',
        tabId: item.tabId,
        windowId: item.windowId ?? 0,
        closeSelf: false,
      });
      window.close();
      return;
    }
    if (item.kind === 'command' && item.commandAction) {
      const res = await sendToBackground<ExecuteCommandResponse>({
        type: 'executeCommand',
        action: item.commandAction,
      });
      if (res?.copyText) {
        try {
          await navigator.clipboard.writeText(res.copyText);
        } catch (e) {
          console.warn('[YiTab] 写入剪贴板失败:', e);
        }
      }
      if (res?.message) {
        messageApi.success(res.message);
      }
      refreshCurrentWindow();
      performSearch(searchQuery, searchKind);
      return;
    }
    if (item.url) {
      chrome.tabs.create({ url: item.url });
      window.close();
    }
  };

  // 刷新当前窗口标签、健康数据、站点策略与快照
  const refreshCurrentWindow = async () => {
    setLoading(true);
    try {
      const [tabsRes, healthRes, settingsRes, pausedRes, pData, activeTabs] = await Promise.all([
        sendToBackground<GetCurrentWindowTabsResponse>({ type: 'getCurrentWindowTabs' }),
        sendToBackground<GetTabHealthResponse>({ type: 'getTabHealth' }),
        getSettings(),
        getDedupPausedUntil(),
        getPinnedData(),
        chrome.tabs?.query ? chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []) : Promise.resolve([]),
      ]);
      if (tabsRes.ok) {
        setCurrentTabs(tabsRes.tabs);
      }
      if (healthRes.ok) {
        setTabHealth(healthRes.health);
      }
      setDedupSettings(settingsRes);
      setPausedUntil(pausedRes);
      setPinnedData(pData);
      setActiveTabUrl(activeTabs[0]?.url || '');
      setActiveTabTitle(activeTabs[0]?.title || '');
      const snaps = await getSnapshots();
      setSnapshots(snaps);
    } catch (e) {
      console.warn('Failed to refresh tabs:', e);
    } finally {
      setLoading(false);
    }
  };

  const activeHost = useMemo(() => hostOf(activeTabUrl), [activeTabUrl]);
  const isCurrentWhitelisted = useMemo(
    () => Boolean(activeTabUrl && inWhitelist(activeTabUrl, dedupSettings.whitelist)),
    [activeTabUrl, dedupSettings.whitelist],
  );
  const currentRule = useMemo(
    () => (activeTabUrl ? resolveRule(activeTabUrl, dedupSettings) : null),
    [activeTabUrl, dedupSettings],
  );
  const isDedupPaused = pausedUntil > Date.now();
  const pausedRemainMin = isDedupPaused ? Math.max(1, Math.ceil((pausedUntil - Date.now()) / 60000)) : 0;
  const pinnedCurrentItem = useMemo(
    () => (activeTabUrl ? findPinnedByUrl(pinnedData, activeTabUrl) : undefined),
    [pinnedData, activeTabUrl],
  );

  const handlePinCurrentToGroup = async (groupId: string) => {
    if (!activeTabUrl || !/^https?:\/\//i.test(activeTabUrl)) return;
    const res = await addPinnedItemIfAbsent({
      title: activeTabTitle || activeHost || activeTabUrl,
      url: activeTabUrl,
      groupId,
    });
    setPinnedData(await getPinnedData());
    if (res.added) {
      messageApi.success(`已固定到工作台「${res.groupName}」`);
    } else {
      messageApi.info(`已在工作台「${res.groupName}」中`);
    }
  };

  const handleUnpinCurrent = async () => {
    if (!pinnedCurrentItem) return;
    await deletePinnedItem(pinnedCurrentItem.id);
    setPinnedData(await getPinnedData());
    messageApi.success('已从工作台取消固定');
  };

  const handleToggleCurrentWhitelist = async () => {
    if (!activeHost) return;
    if (isCurrentWhitelisted) {
      const nextList = dedupSettings.whitelist.filter((w) => stripWww(w) !== activeHost);
      const next = await setSettings({ whitelist: nextList });
      setDedupSettings(next);
      messageApi.success(`已将 ${activeHost} 移出白名单`);
    } else {
      const next = await setSettings({ whitelist: [...dedupSettings.whitelist, activeHost] });
      setDedupSettings(next);
      messageApi.success(`已放行 ${activeHost}（加入白名单）`);
    }
  };

  const handleTogglePauseDedup = async () => {
    if (isDedupPaused) {
      await setDedupPausedUntil(0);
      setPausedUntil(0);
      messageApi.success('已恢复标签去重拦截');
    } else {
      const until = Date.now() + 15 * 60 * 1000;
      await setDedupPausedUntil(until);
      setPausedUntil(until);
      messageApi.info('已暂停标签去重拦截 15 分钟');
    }
  };

  useEffect(() => {
    refreshCurrentWindow();
  }, []);

  // 域名聚集分析
  const domainAnalysis = useMemo(() => {
    return analyzeTabsByDomain(
      currentTabs.map((t, idx) => ({ id: idx + 1, url: t.url })),
      2,
    );
  }, [currentTabs]);

  // 全部域名去重列表
  const uniqueDomainsCount = useMemo(() => {
    const set = new Set<string>();
    for (const t of currentTabs) {
      try {
        const h = new URL(t.url).hostname.replace(/^www\./i, '');
        if (h) set.add(h);
      } catch {}
    }
    return set.size;
  }, [currentTabs]);

  // 一键按域名归拢
  const handleAutoGroup = async () => {
    try {
      const res = await sendToBackground<AutoGroupTabsResponse>({
        type: 'autoGroupTabs',
        minCount: 2,
      });
      if (res.ok && res.createdGroupsCount > 0) {
        messageApi.success(`已创建 ${res.createdGroupsCount} 个分组，归拢 ${res.groupedTabsCount} 个标签页`);
      } else {
        messageApi.info('未找到可聚合的同域名标签（单域名需 ≥ 2 个标签）');
      }
      refreshCurrentWindow();
    } catch {
      messageApi.error('自动归拢失败，请确认浏览器支持标签分组');
    }
  };

  // 解散当前分组
  const handleUngroupAll = async () => {
    try {
      const res = await sendToBackground<UngroupAllTabsResponse>({
        type: 'ungroupAllTabs',
      });
      if (res.ok) {
        messageApi.success(`已解散当前窗口的标签分组（共 ${res.ungroupedCount} 个标签）`);
      }
      refreshCurrentWindow();
    } catch {
      messageApi.error('解散分组失败');
    }
  };

  // 扫描书签树
  const scanBookmarks = async () => {
    setBookmarkScanning(true);
    try {
      const res = await sendToBackground<ScanBookmarksResponse>({
        type: 'scanBookmarks',
      });
      if (res.ok && res.report) {
        setBookmarkReport(res.report);
      } else if (res.error) {
        messageApi.error(res.error);
      }
    } catch (e) {
      console.warn('Scan bookmarks failed:', e);
    } finally {
      setBookmarkScanning(false);
    }
  };

  // 保存当前会话快照
  const handleSaveSnapshot = async () => {
    if (!currentTabs.length) return;
    setIsSavingSnapshot(true);
    try {
      await saveSnapshot(currentTabs, newSnapshotName);
      setNewSnapshotName('');
      const snaps = await getSnapshots();
      setSnapshots(snaps);
      setActiveTabKey('snapshots');
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  // 恢复快照
  const handleRestoreSnapshot = async (snapshot: SessionSnapshot, newWindow: boolean) => {
    const urls = snapshot.tabs.map((t) => t.url);
    if (!urls.length) return;
    await sendToBackground({
      type: 'restoreSnapshot',
      urls,
      newWindow,
    });
  };

  // 重命名快照
  const handleConfirmRenameSnapshot = async (id: string) => {
    const trimmed = editingSnapshotName.trim();
    if (!trimmed) {
      setEditingSnapshotId(null);
      return;
    }
    await renameSnapshot(id, trimmed);
    setSnapshots(await getSnapshots());
    setEditingSnapshotId(null);
    messageApi.success('快照已重命名');
  };

  // 删除快照
  const handleDeleteSnapshot = async (id: string) => {
    await deleteSnapshot(id);
    const snaps = await getSnapshots();
    setSnapshots(snaps);
    if (exportSource === id) {
      setExportSource('current');
    }
  };

  // 计算当前用于导出的标签数据
  const exportTargetTabs = useMemo(() => {
    if (exportSource === 'current') {
      return currentTabs;
    }
    const found = snapshots.find((s) => s.id === exportSource);
    return found ? found.tabs : currentTabs;
  }, [exportSource, currentTabs, snapshots]);

  // 格式化导出的内容
  const exportedText = useMemo(() => {
    return formatTabsExport(exportTargetTabs, exportFormat);
  }, [exportTargetTabs, exportFormat]);

  // 复制导出内容
  const handleCopy = () => {
    if (!exportedText) return;
    navigator.clipboard.writeText(exportedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // 下载导出文件
  const handleDownload = () => {
    if (!exportedText) return;
    const isJson = exportFormat === 'json';
    const blob = new Blob([exportedText], {
      type: isJson ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isJson ? `yitab-tabs-${Date.now()}.json` : `yitab-tabs-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: tk.accent,
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
        },
        components: {
          Tabs: {
            itemSelectedColor: tk.accentInk,
            inkBarColor: tk.accentInk,
          },
        },
      }}
    >
      {messageContextHolder}
      <div style={{ padding: '14px 16px', background: tk.canvas, minHeight: 520, boxSizing: 'border-box' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: `1px solid ${tk.hairline}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 800,
                fontSize: 14,
                boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
              }}
            >
              Yi
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text strong style={{ fontSize: 15, color: tk.ink }}>
                  YiTab 一签
                </Text>
                <Tag
                  color="indigo"
                  style={{
                    margin: 0,
                    fontSize: 10,
                    lineHeight: '16px',
                    padding: '0 5px',
                    borderRadius: 4,
                  }}
                >
                  {APP_VERSION}
                </Tag>
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                当前窗口: {currentTabs.length} 标签 · {uniqueDomainsCount} 域名
              </Text>
            </div>
          </div>
          <Space size={4}>
            <ThemeModeButton mode={themeMode} onChange={setThemeMode} ink3={tk.ink3} />
            <Tooltip title="刷新窗口与健康数据">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined style={{ fontSize: 13, color: tk.ink3 }} />}
                onClick={refreshCurrentWindow}
              />
            </Tooltip>
            <Tooltip title="设置中心">
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined style={{ fontSize: 14, color: tk.ink3 }} />}
                onClick={() => chrome.runtime.openOptionsPage()}
              />
            </Tooltip>
          </Space>
        </div>

        {/* 当前站点去重策略快捷条 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '7px 10px',
            marginBottom: 10,
            borderRadius: 8,
            background: isDedupPaused ? tk.dangerSoft : tk.surface,
            border: `1px solid ${isDedupPaused ? tk.dangerBorder : tk.hairline}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
            <SafetyCertificateOutlined
              style={{
                fontSize: 13,
                color: isDedupPaused
                  ? tk.dangerInk
                  : isCurrentWhitelisted
                    ? tk.successInk
                    : tk.accentInk,
                flexShrink: 0,
              }}
            />
            {isDedupPaused ? (
              <Text ellipsis style={{ fontSize: 12, color: tk.dangerInk, fontWeight: 500 }}>
                去重拦截已暂停（剩 {pausedRemainMin} 分钟）
              </Text>
            ) : activeHost ? (
              <>
                <Text ellipsis style={{ fontSize: 12, color: tk.ink, fontWeight: 500, maxWidth: 130 }} title={activeHost}>
                  {activeHost}
                </Text>
                <Tag
                  color={isCurrentWhitelisted ? 'green' : currentRule?.rule ? 'blue' : 'default'}
                  style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 5px', borderRadius: 4 }}
                >
                  {isCurrentWhitelisted
                    ? '白名单'
                    : currentRule?.rule
                      ? `规则·${MODE_LABELS[currentRule.mode]}`
                      : MODE_LABELS[dedupSettings.matchMode]}
                </Tag>
              </>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                去重拦截运行中 · {MODE_LABELS[dedupSettings.matchMode]}
              </Text>
            )}
          </div>

          <Space size={2} style={{ flexShrink: 0 }}>
            {activeHost && (
              pinnedCurrentItem ? (
                <Tooltip title="已固定到工作台（点击取消固定）">
                  <Button
                    size="small"
                    type="text"
                    icon={<PushpinFilled style={{ color: tk.accentInk, fontSize: 12 }} />}
                    onClick={() => void handleUnpinCurrent()}
                    style={{ height: 24, padding: '0 6px' }}
                  />
                </Tooltip>
              ) : (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: pinnedData.groups.map((g) => ({
                      key: g.id,
                      label: `固定到「${g.name}」`,
                      onClick: () => void handlePinCurrentToGroup(g.id),
                    })),
                  }}
                >
                  <Tooltip title="固定当前页到工作台">
                    <Button
                      size="small"
                      type="text"
                      icon={<PushpinOutlined style={{ color: tk.ink3, fontSize: 12 }} />}
                      style={{ height: 24, padding: '0 6px' }}
                    />
                  </Tooltip>
                </Dropdown>
              )
            )}
            {!isDedupPaused && activeHost && (
              <Button
                size="small"
                type={isCurrentWhitelisted ? 'default' : 'text'}
                onClick={handleToggleCurrentWhitelist}
                style={{ fontSize: 11, height: 24, padding: '0 7px' }}
              >
                {isCurrentWhitelisted ? '恢复拦截' : '放行此站'}
              </Button>
            )}
            <Tooltip title={isDedupPaused ? '立即恢复全局标签去重拦截' : '临时暂停全局去重拦截 15 分钟'}>
              <Button
                size="small"
                type={isDedupPaused ? 'primary' : 'text'}
                icon={isDedupPaused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                onClick={handleTogglePauseDedup}
                style={{ fontSize: 11, height: 24, padding: '0 7px' }}
              >
                {isDedupPaused ? '恢复' : '暂停15m'}
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* Tabs */}
        <Tabs
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          size="small"
          tabBarGutter={18}
          centered
          items={[
            {
              key: 'organize',
              icon: <AppstoreOutlined />,
              label: '治理',
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* 1. 域名智能归拢卡片 */}
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      boxShadow: tk.shadowCard,
                      border: `1px solid ${tk.hairline}`,
                    }}
                  >
                    <div style={{ marginBottom: 10 }}>
                      <Text strong style={{ fontSize: 13, color: tk.ink }}>
                        域名智能聚合与标签归拢
                      </Text>
                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 12, margin: '2px 0 0', lineHeight: 1.4 }}
                      >
                        将当前窗口相同域名的网页（≥2项）自动归集到对应 Chrome 原生彩色标签组中。
                      </Paragraph>
                    </div>

                    {domainAnalysis.length > 0 ? (
                      <div
                        style={{
                          background: tk.surfaceMuted,
                          padding: '8px 10px',
                          borderRadius: 6,
                          marginBottom: 12,
                        }}
                      >
                        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
                          检测到可聚合域名（共 {domainAnalysis.reduce((acc, d) => acc + d.count, 0)} 个标签）：
                        </Text>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {domainAnalysis.map((item) => (
                            <Tag
                              key={item.domain}
                              style={{
                                margin: 0,
                                fontSize: 11,
                                borderRadius: 4,
                                border: `1px solid ${tk.hairlineStrong}`,
                                background: tk.surface,
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: getDeterministicColor(item.domain),
                                  marginRight: 4,
                                }}
                              />
                              {item.domain}{' '}
                              <strong style={{ color: tk.accentInk }}>({item.count})</strong>
                            </Tag>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          background: tk.canvas,
                          padding: '8px 10px',
                          borderRadius: 6,
                          marginBottom: 12,
                          textAlign: 'center',
                        }}
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          暂无集中重复的域名标签（单域名 ≥ 2 个标签才会聚拢）
                        </Text>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        type="primary"
                        block
                        icon={<AppstoreOutlined />}
                        onClick={handleAutoGroup}
                        style={{
                          fontWeight: 600,
                          height: 34,
                        }}
                      >
                        一键按域名归拢
                      </Button>
                      <Button
                        block
                        icon={<UndoOutlined />}
                        onClick={handleUngroupAll}
                        style={{ height: 34 }}
                      >
                        解散分组
                      </Button>
                    </div>
                  </Card>

                  {/* 2. 闲置标签休眠与沉淀归档 (共享组件) */}
                  <TabHealthPanel
                    variant="compact"
                    tk={tk}
                    tabHealth={tabHealth}
                    onRefresh={refreshCurrentWindow}
                    messageApi={messageApi}
                  />
                </div>
              ),
            },
            {
              key: 'search',
              icon: <SearchOutlined />,
              label: '检索',
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Input
                    prefix={<SearchOutlined style={{ color: tk.ink3 }} />}
                    placeholder="搜索标签、书签或快捷指令"
                    allowClear
                    value={searchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    style={{ borderRadius: 8 }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Radio.Group
                      size="small"
                      value={searchKind}
                      onChange={(e) => setSearchKind(e.target.value)}
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="all">全部</Radio.Button>
                      <Radio.Button value="tab">标签</Radio.Button>
                      <Radio.Button value="command">指令</Radio.Button>
                      <Radio.Button value="bookmark">书签</Radio.Button>
                      <Radio.Button value="history">历史</Radio.Button>
                    </Radio.Group>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      共 {searchResults.length} 项
                    </Text>
                  </div>

                  <div
                    style={{
                      maxHeight: 330,
                      minHeight: 220,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      paddingRight: 2,
                    }}
                  >
                    {searchResults.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="未找到匹配项，可尝试搜索其他关键词"
                        style={{ margin: '40px 0' }}
                      />
                    ) : (
                      searchResults.map((item) => {
                        const kindTagColor =
                          item.kind === 'tab'
                            ? 'blue'
                            : item.kind === 'command'
                              ? 'purple'
                              : item.kind === 'bookmark'
                                ? 'green'
                                : 'orange';
                        const kindText =
                          item.kind === 'tab'
                            ? '标签'
                            : item.kind === 'command'
                              ? '指令'
                              : item.kind === 'bookmark'
                                ? '书签'
                                : '历史';

                        return (
                          <div
                            key={item.id}
                            onClick={() => handleExecuteSearchItem(item)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 10px',
                              borderRadius: 8,
                              background: tk.surface,
                              border: `1px solid ${tk.hairline}`,
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              boxShadow: tk.shadowCard,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = tk.accent;
                              e.currentTarget.style.background = tk.surfaceHover;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = tk.hairline;
                              e.currentTarget.style.background = tk.surface;
                            }}
                          >
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: tk.surfaceMuted,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                overflow: 'hidden',
                              }}
                            >
                              {item.favicon ? (
                                <img
                                  src={item.favicon}
                                  alt=""
                                  style={{ width: 14, height: 14 }}
                                  onError={(e) => (e.currentTarget.style.display = 'none')}
                                />
                              ) : item.kind === 'command' ? (
                                <ThunderboltOutlined style={{ fontSize: 13, color: tk.accentInk }} />
                              ) : (
                                <span style={{ fontSize: 12 }}>🌐</span>
                              )}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                strong
                                ellipsis
                                style={{
                                  fontSize: 13,
                                  color: item.active ? tk.accentInk : tk.ink,
                                  display: 'block',
                                }}
                              >
                                {item.title}
                              </Text>
                              <Text
                                type="secondary"
                                ellipsis
                                style={{ fontSize: 11, display: 'block' }}
                              >
                                {item.groupTitle && (
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      width: 5,
                                      height: 5,
                                      borderRadius: '50%',
                                      background: item.groupColor || '#4f46e5',
                                      marginRight: 4,
                                    }}
                                  />
                                )}
                                {item.groupTitle ? `${item.groupTitle} · ` : ''}
                                {item.domain || item.description || item.url}
                              </Text>
                            </div>

                            <Tag
                              color={kindTagColor}
                              style={{ margin: 0, fontSize: 10, borderRadius: 4 }}
                            >
                              {kindText}
                            </Tag>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: 'bookmarks',
              icon: <BookOutlined />,
              label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  书签
                  {bookmarkReport && bookmarkReport.redundantCount > 0 && (
                    <Badge
                      count={bookmarkReport.redundantCount}
                      style={{
                        backgroundColor: '#ef4444',
                        boxShadow: 'none',
                      }}
                    />
                  )}
                </span>
              ),
              children: (
                <BookmarkHealthPanel
                  variant="compact"
                  tk={tk}
                  report={bookmarkReport}
                  scanning={bookmarkScanning}
                  onScan={scanBookmarks}
                  messageApi={messageApi}
                />
              ),
            },
            {
              key: 'snapshots',
              icon: <CameraOutlined />,
              label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  快照
                  {snapshots.length > 0 && (
                    <Badge
                      count={snapshots.length}
                      style={{
                        backgroundColor: tk.accentSoft,
                        color: tk.accentInk,
                        boxShadow: 'none',
                      }}
                    />
                  )}
                </span>
              ),
              children: (
                <div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <Input
                      size="small"
                      placeholder="快照名称（可选，留空自动命名）"
                      value={newSnapshotName}
                      onChange={(e) => setNewSnapshotName(e.target.value)}
                      onPressEnter={() => void handleSaveSnapshot()}
                    />
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlusOutlined />}
                      loading={isSavingSnapshot}
                      onClick={() => void handleSaveSnapshot()}
                    >
                      保存快照
                    </Button>
                  </div>

                  {snapshots.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无保存的会话快照，可点击上方「新建快照」"
                      style={{ margin: '30px 0' }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        maxHeight: 280,
                        overflowY: 'auto',
                      }}
                    >
                      {snapshots.map((snap) => {
                        const isExpanded = expandedSnapshotId === snap.id;
                        return (
                          <div
                            key={snap.id}
                            style={{
                              background: tk.surface,
                              border: `1px solid ${tk.hairline}`,
                              borderRadius: 8,
                              padding: '10px 12px',
                              boxShadow: tk.shadowCard,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <div
                                style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                                onClick={() =>
                                  setExpandedSnapshotId(isExpanded ? null : snap.id)
                                }
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {editingSnapshotId === snap.id ? (
                                    <Input
                                      size="small"
                                      autoFocus
                                      value={editingSnapshotName}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => setEditingSnapshotName(e.target.value)}
                                      onPressEnter={() => void handleConfirmRenameSnapshot(snap.id)}
                                      onBlur={() => void handleConfirmRenameSnapshot(snap.id)}
                                      style={{ width: 170, fontSize: 12 }}
                                    />
                                  ) : (
                                    <Text
                                      strong
                                      ellipsis
                                      style={{ fontSize: 13, color: tk.ink, maxWidth: 180 }}
                                    >
                                      {snap.name}
                                    </Text>
                                  )}
                                  <Tag
                                    color="blue"
                                    style={{
                                      margin: 0,
                                      fontSize: 10,
                                      lineHeight: '16px',
                                      padding: '0 4px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    {snap.tabs.length} 项
                                  </Tag>
                                </div>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {new Date(snap.createdAt).toLocaleString()}
                                </Text>
                              </div>

                              <Space size={2}>
                                <Tooltip title="重命名快照">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<EditOutlined style={{ color: tk.ink3 }} />}
                                    onClick={() => {
                                      setEditingSnapshotId(snap.id);
                                      setEditingSnapshotName(snap.name);
                                    }}
                                  />
                                </Tooltip>
                                <Tooltip title="在新窗口全部恢复">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<ExportOutlined style={{ color: tk.accentInk }} />}
                                    onClick={() => handleRestoreSnapshot(snap, true)}
                                  />
                                </Tooltip>
                                <Tooltip title="在当前窗口恢复">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<FolderOpenOutlined style={{ color: '#0284c7' }} />}
                                    onClick={() => handleRestoreSnapshot(snap, false)}
                                  />
                                </Tooltip>
                                <Popconfirm
                                  title="确认删除该快照？"
                                  onConfirm={() => handleDeleteSnapshot(snap.id)}
                                  okText="删除"
                                  cancelText="取消"
                                >
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                  />
                                </Popconfirm>
                              </Space>
                            </div>

                            {/* 展开查看标签明细 */}
                            {isExpanded && (
                              <div
                                style={{
                                  marginTop: 8,
                                  paddingTop: 8,
                                  borderTop: `1px solid ${tk.hairline}`,
                                  maxHeight: 160,
                                  overflowY: 'auto',
                                }}
                              >
                                {snap.tabs.map((t, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontSize: 12,
                                      padding: '3px 0',
                                    }}
                                  >
                                    <Text
                                      type="secondary"
                                      style={{ width: 16, fontSize: 10, textAlign: 'center' }}
                                    >
                                      {idx + 1}
                                    </Text>
                                    <Text
                                      ellipsis
                                      style={{ flex: 1, color: tk.ink2 }}
                                      title={t.title || t.url}
                                    >
                                      {t.title || t.url}
                                    </Text>
                                    <a
                                      href={t.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      style={{ fontSize: 11, color: tk.accentInk }}
                                    >
                                      打开
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 导出工具集成 */}
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${tk.hairline}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Select
                        size="small"
                        value={exportSource}
                        onChange={setExportSource}
                        style={{ flex: 1, minWidth: 120 }}
                        options={[
                          { value: 'current', label: `当前窗口 (${currentTabs.length})` },
                          ...snapshots.map((s) => ({
                            value: s.id,
                            label: `${s.name} (${s.tabs.length})`,
                          })),
                        ]}
                      />
                      <Radio.Group
                        size="small"
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value)}
                        optionType="button"
                        buttonStyle="solid"
                      >
                        <Radio.Button value="markdown_list">MD</Radio.Button>
                        <Radio.Button value="markdown_table">表格</Radio.Button>
                        <Radio.Button value="urls_only">网址</Radio.Button>
                        <Radio.Button value="json">JSON</Radio.Button>
                      </Radio.Group>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        type="primary"
                        block
                        size="small"
                        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={handleCopy}
                        style={{
                          background: copied ? '#10b981' : '#4f46e5',
                          fontWeight: 500,
                        }}
                      >
                        {copied ? '已复制！' : '复制标签文本'}
                      </Button>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={handleDownload}
                      >
                        下载
                      </Button>
                    </div>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </ConfigProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<PopupApp />);
