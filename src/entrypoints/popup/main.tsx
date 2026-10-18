import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Badge,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Popconfirm,
  Radio,
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
  CloudDownloadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  RestOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { sendToBackground } from '@/lib/messaging';
import type {
  ArchiveInactiveTabsResponse,
  AutoGroupTabsResponse,
  CleanBookmarksResponse,
  DiscardTabsResponse,
  ExecuteCommandResponse,
  ExportBookmarksBackupResponse,
  GetCurrentWindowTabsResponse,
  GetTabHealthResponse,
  ScanBookmarksResponse,
  SearchItemsResponse,
  UngroupAllTabsResponse,
} from '@/lib/messaging';
import type { SearchItem, SearchItemKind } from '@/lib/search';
import {
  computeRecommendedDeletePlan,
  type BookmarkDuplicateGroup,
  type BookmarkScanReport,
} from '@/lib/bookmarks';
import { ESTIMATED_MB_PER_TAB, type TabHealthReport } from '@/lib/tab-health';
import { APP_VERSION } from '@/lib/version';
import { useThemeTokens } from '@/lib/theme-tokens';
import { useThemeMode, applyThemeToDocument } from '@/lib/theme-mode';
import { ThemeModeButton } from '@/components/ThemeToggle';
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

  // 让原生控件与页面底色跟随主题，避免首帧闪白
  useEffect(() => applyThemeToDocument(isDark, tk.canvas), [isDark, tk.canvas]);
  const [currentTabs, setCurrentTabs] = useState<TabSnapshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState('organize');

  // 阶段四：标签健康与闲置休眠状态
  const [tabHealth, setTabHealth] = useState<TabHealthReport | null>(null);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // 阶段四：书签健康与智能去重状态
  const [bookmarkReport, setBookmarkReport] = useState<BookmarkScanReport | null>(null);
  const [bookmarkScanning, setBookmarkScanning] = useState(false);
  const [bookmarkCleaning, setBookmarkCleaning] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  // 快照状态
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

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
        alert(res.message);
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

  // 刷新当前窗口标签、健康数据与快照
  const refreshCurrentWindow = async () => {
    setLoading(true);
    try {
      const [tabsRes, healthRes] = await Promise.all([
        sendToBackground<GetCurrentWindowTabsResponse>({ type: 'getCurrentWindowTabs' }),
        sendToBackground<GetTabHealthResponse>({ type: 'getTabHealth' }),
      ]);
      if (tabsRes.ok) {
        setCurrentTabs(tabsRes.tabs);
      }
      if (healthRes.ok) {
        setTabHealth(healthRes.health);
      }
      const snaps = await getSnapshots();
      setSnapshots(snaps);
    } catch (e) {
      console.warn('Failed to refresh tabs:', e);
    } finally {
      setLoading(false);
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
        alert(`已成功创建 ${res.createdGroupsCount} 个分组，归拢 ${res.groupedTabsCount} 个标签页！`);
      } else {
        alert('未找到需要聚合的同域名标签（同域名需 ≥ 2 个标签）');
      }
      refreshCurrentWindow();
    } catch {
      alert('自动归拢失败，请确认浏览器支持标签分组');
    }
  };

  // 解散当前分组
  const handleUngroupAll = async () => {
    try {
      const res = await sendToBackground<UngroupAllTabsResponse>({
        type: 'ungroupAllTabs',
      });
      if (res.ok) {
        alert(`已成功解散当前窗口的标签分组（共 ${res.ungroupedCount} 个标签）`);
      }
      refreshCurrentWindow();
    } catch {
      alert('解散分组失败');
    }
  };

  // 一键休眠当前窗口所有闲置标签（释放内存）
  const handleDiscardInactiveTabs = async () => {
    setDiscardLoading(true);
    try {
      const res = await sendToBackground<DiscardTabsResponse>({
        type: 'discardTabs',
      });
      if (res.ok && res.discardedCount > 0) {
        alert(`已成功休眠 ${res.discardedCount} 个闲置标签，估算释放约 ${res.freedMemoryMb}MB 内存！`);
      } else {
        alert('当前没有符合条件的闲置标签（播放中、固定或活动标签受保护）');
      }
      refreshCurrentWindow();
    } catch {
      alert('休眠标签操作失败');
    } finally {
      setDiscardLoading(false);
    }
  };

  // 一键沉淀归档并安全关闭闲置标签
  const handleArchiveInactiveTabs = async () => {
    setArchiveLoading(true);
    try {
      const res = await sendToBackground<ArchiveInactiveTabsResponse>({
        type: 'archiveInactiveTabs',
      });
      if (res.ok && res.archivedCount > 0) {
        alert(`已成功归档 ${res.archivedCount} 个闲置标签并关闭！快照已保存为：「${res.snapshotName}」`);
      } else {
        alert('当前没有需要沉淀归档的闲置标签');
      }
      refreshCurrentWindow();
    } catch {
      alert('沉淀归档操作失败');
    } finally {
      setArchiveLoading(false);
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
        alert(res.error);
      }
    } catch (e) {
      console.warn('Scan bookmarks failed:', e);
    } finally {
      setBookmarkScanning(false);
    }
  };

  // 按建议一键批量清理书签
  const handleCleanRecommendedBookmarks = async () => {
    if (!bookmarkReport || bookmarkReport.redundantCount === 0) return;
    const { deleteIds } = computeRecommendedDeletePlan(bookmarkReport.groups);
    if (!deleteIds.length) return;

    setBookmarkCleaning(true);
    try {
      const res = await sendToBackground<CleanBookmarksResponse>({
        type: 'cleanBookmarks',
        bookmarkIds: deleteIds,
      });
      if (res.ok) {
        alert(`已成功清理 ${res.removedCount} 个多余重复书签，已保留推荐项！`);
        await scanBookmarks();
      }
    } catch {
      alert('清理书签失败');
    } finally {
      setBookmarkCleaning(false);
    }
  };

  // 单独删除一个书签副本
  const handleDeleteSingleBookmark = async (id: string) => {
    try {
      const res = await sendToBackground<CleanBookmarksResponse>({
        type: 'cleanBookmarks',
        bookmarkIds: [id],
      });
      if (res.ok) {
        await scanBookmarks();
      }
    } catch {
      alert('删除书签失败');
    }
  };

  // 导出书签备份 (Netscape HTML / JSON)
  const handleBackupBookmarks = async (format: 'html' | 'json') => {
    try {
      const res = await sendToBackground<ExportBookmarksBackupResponse>({
        type: 'exportBookmarksBackup',
        format,
      });
      if (res.ok) {
        const blob = new Blob([res.content], { type: res.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      alert('导出书签备份失败');
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
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
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

        {/* Tabs */}
        <Tabs
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          size="small"
          items={[
            {
              key: 'organize',
              label: (
                <span>
                  <AppstoreOutlined />
                  标签治理
                </span>
              ),
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
                              <strong style={{ color: '#4f46e5' }}>({item.count})</strong>
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
                          background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                          border: 'none',
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

                  {/* 2. 闲置标签休眠与沉淀归档 (阶段四) */}
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      boxShadow: tk.shadowCard,
                      border: `1px solid ${tk.hairline}`,
                    }}
                  >
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text strong style={{ fontSize: 13, color: tk.ink }}>
                          闲置休眠与内存沉淀
                        </Text>
                        {tabHealth && (
                          <Tag color="cyan" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                            可释放 ~{tabHealth.estimatedMemorySavedMb} MB
                          </Tag>
                        )}
                      </div>
                      <Paragraph
                        type="secondary"
                        style={{ fontSize: 12, margin: '2px 0 0', lineHeight: 1.4 }}
                      >
                        非活动标签释放常驻内存（保留在标签栏）；或一键保存为快照后安全关闭。
                      </Paragraph>
                    </div>

                    <div
                      style={{
                        background: tk.canvas,
                        padding: '8px 10px',
                        borderRadius: 6,
                        marginBottom: 12,
                        fontSize: 11,
                        color: tk.ink3,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>已休眠: <strong style={{ color: tk.ink }}>{tabHealth?.discardedCount ?? 0}</strong></span>
                      <span>发声/保护: <strong style={{ color: tk.ink }}>{(tabHealth?.audibleCount ?? 0) + (tabHealth?.pinnedCount ?? 0)}</strong></span>
                      <span>可休眠: <strong style={{ color: '#4f46e5' }}>{tabHealth?.eligibleDiscardCount ?? 0}</strong></span>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Tooltip title="调用 Chrome 原生 discard 接口，释放内存，标签仍保留在标签栏">
                        <Button
                          block
                          icon={<RestOutlined />}
                          loading={discardLoading}
                          onClick={handleDiscardInactiveTabs}
                          style={{ height: 34, fontWeight: 500 }}
                        >
                          一键休眠闲置
                        </Button>
                      </Tooltip>
                      <Tooltip title="将闲置标签暂存为快照并安全关闭，彻底清理标签栏">
                        <Button
                          block
                          icon={<CameraOutlined />}
                          loading={archiveLoading}
                          onClick={handleArchiveInactiveTabs}
                          style={{ height: 34, fontWeight: 500 }}
                        >
                          沉淀归档并关闭
                        </Button>
                      </Tooltip>
                    </div>
                  </Card>
                </div>
              ),
            },
            {
              key: 'search',
              label: (
                <span>
                  <SearchOutlined />
                  快速检索
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Input
                    prefix={<SearchOutlined style={{ color: tk.ink3 }} />}
                    placeholder="搜索标签、书签或快捷指令 (Alt+K 随时唤出)"
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
                              e.currentTarget.style.borderColor = '#4f46e5';
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
                                <ThunderboltOutlined style={{ fontSize: 13, color: '#4f46e5' }} />
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
                                  color: item.active ? '#4f46e5' : '#1e293b',
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
              label: (
                <span>
                  <BookOutlined />
                  书签健康
                  {bookmarkReport && bookmarkReport.redundantCount > 0 && (
                    <Badge
                      count={bookmarkReport.redundantCount}
                      style={{
                        marginLeft: 4,
                        backgroundColor: '#ef4444',
                        boxShadow: 'none',
                      }}
                    />
                  )}
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* 顶部报告与操作卡片 */}
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      boxShadow: tk.shadowCard,
                      border: `1px solid ${tk.hairline}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div>
                        <Text strong style={{ fontSize: 13, color: tk.ink }}>
                          书签智能去重
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                          扫描收藏夹全树，按目录深度与标题质量推荐保留最佳书签
                        </Text>
                      </div>
                      <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={bookmarkScanning}
                        onClick={scanBookmarks}
                      >
                        重新扫描
                      </Button>
                    </div>

                    {bookmarkReport ? (
                      <div
                        style={{
                          background: tk.canvas,
                          padding: '8px 10px',
                          borderRadius: 6,
                          marginBottom: 10,
                          fontSize: 11,
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: tk.ink3,
                        }}
                      >
                        <span>总书签: <strong style={{ color: tk.ink }}>{bookmarkReport.totalBookmarks}</strong></span>
                        <span>文件夹: <strong style={{ color: tk.ink }}>{bookmarkReport.totalFolders}</strong></span>
                        <span>重复组: <strong style={{ color: '#4f46e5' }}>{bookmarkReport.duplicateGroupCount}</strong></span>
                        <span>可清理: <strong style={{ color: '#ef4444' }}>{bookmarkReport.redundantCount}</strong></span>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '16px 0' }}>
                        <Button
                          type="primary"
                          icon={<BookOutlined />}
                          loading={bookmarkScanning}
                          onClick={scanBookmarks}
                          style={{ background: '#4f46e5' }}
                        >
                          开始扫描书签树
                        </Button>
                      </div>
                    )}

                    {bookmarkReport && bookmarkReport.redundantCount > 0 && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Popconfirm
                          title="确认按建议一键清理？"
                          description={`将删除 ${bookmarkReport.redundantCount} 个冗余副本，保留分类最深、标题最完整的优质书签。`}
                          onConfirm={handleCleanRecommendedBookmarks}
                          okText="立即清理"
                          cancelText="取消"
                        >
                          <Button
                            type="primary"
                            danger
                            block
                            loading={bookmarkCleaning}
                            icon={<DeleteOutlined />}
                            style={{ fontWeight: 600, height: 32 }}
                          >
                            一键按建议清理 ({bookmarkReport.redundantCount} 项)
                          </Button>
                        </Popconfirm>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <Button
                        size="small"
                        block
                        icon={<CloudDownloadOutlined />}
                        onClick={() => handleBackupBookmarks('html')}
                      >
                        导出标准 HTML 备份
                      </Button>
                      <Button
                        size="small"
                        block
                        icon={<DownloadOutlined />}
                        onClick={() => handleBackupBookmarks('json')}
                      >
                        导出 JSON
                      </Button>
                    </div>
                  </Card>

                  {/* 重复书签列表 */}
                  {bookmarkReport && (
                    <div
                      style={{
                        maxHeight: 250,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {bookmarkReport.groups.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="非常棒！您的收藏夹很健康，未发现重复书签。"
                          style={{ margin: '30px 0' }}
                        />
                      ) : (
                        bookmarkReport.groups.map((group) => {
                          const isExpanded = expandedGroupKey === group.groupKey;
                          return (
                            <div
                              key={group.groupKey}
                              style={{
                                background: tk.surface,
                                border: `1px solid ${tk.hairline}`,
                                borderRadius: 8,
                                padding: '8px 10px',
                                boxShadow: tk.shadowCard,
                              }}
                            >
                              <div
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                onClick={() => setExpandedGroupKey(isExpanded ? null : group.groupKey)}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text strong ellipsis style={{ fontSize: 13, color: tk.ink, display: 'block' }}>
                                    {group.title}
                                  </Text>
                                  <Text type="secondary" ellipsis style={{ fontSize: 11, display: 'block' }}>
                                    {group.normalizedUrl}
                                  </Text>
                                </div>
                                <Tag color="volcano" style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>
                                  {group.items.length} 个副本
                                </Tag>
                              </div>

                              {isExpanded && (
                                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tk.hairline}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {group.items.map((it) => {
                                    const isKeep = it.id === group.recommendedKeepId;
                                    return (
                                      <div
                                        key={it.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          padding: '4px 6px',
                                          borderRadius: 4,
                                          background: isKeep ? tk.successSoft : tk.surface,
                                          border: isKeep ? `1px solid ${tk.successBorder}` : `1px solid ${tk.hairline}`,
                                        }}
                                      >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Tag
                                              color={isKeep ? 'green' : 'default'}
                                              style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}
                                            >
                                              {isKeep ? '推荐保留' : '待清理'}
                                            </Tag>
                                            <Text ellipsis style={{ fontSize: 12, color: tk.ink2 }}>
                                              {it.title}
                                            </Text>
                                          </div>
                                          <Text type="secondary" ellipsis style={{ fontSize: 10, display: 'block', marginTop: 2 }}>
                                            目录: {it.folderPath.join(' / ') || '书签栏根目录'}
                                          </Text>
                                        </div>

                                        {!isKeep && (
                                          <Popconfirm
                                            title="确认删除该重复书签？"
                                            onConfirm={() => handleDeleteSingleBookmark(it.id)}
                                            okText="删除"
                                            cancelText="取消"
                                          >
                                            <Button
                                              type="text"
                                              danger
                                              size="small"
                                              icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                            />
                                          </Popconfirm>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'snapshots',
              label: (
                <span>
                  <CameraOutlined />
                  会话快照
                  {snapshots.length > 0 && (
                    <Badge
                      count={snapshots.length}
                      style={{
                        marginLeft: 4,
                        backgroundColor: tk.accentSoft,
                        color: '#4f46e5',
                        boxShadow: 'none',
                      }}
                    />
                  )}
                </span>
              ),
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                    }}
                  >
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      已存快照（共 {snapshots.length} 份）
                    </Text>
                    <Button
                      size="small"
                      type="link"
                      icon={<PlusOutlined />}
                      onClick={handleSaveSnapshot}
                    >
                      新建快照
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
                                  <Text
                                    strong
                                    ellipsis
                                    style={{ fontSize: 13, color: tk.ink, maxWidth: 190 }}
                                  >
                                    {snap.name}
                                  </Text>
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
                                <Tooltip title="在新窗口全部恢复">
                                  <Button
                                    size="small"
                                    type="text"
                                    icon={<ExportOutlined style={{ color: '#4f46e5' }} />}
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
                                      style={{ fontSize: 11, color: '#4f46e5' }}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Text strong style={{ fontSize: 12, color: tk.ink2 }}>
                        多格式快速导出
                      </Text>
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
