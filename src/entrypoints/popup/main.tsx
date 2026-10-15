import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  App,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  CameraOutlined,
  CheckOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { sendToBackground } from '@/lib/messaging';
import type {
  AutoGroupTabsResponse,
  GetCurrentWindowTabsResponse,
  UngroupAllTabsResponse,
} from '@/lib/messaging';
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
  const [currentTabs, setCurrentTabs] = useState<TabSnapshotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTabKey, setActiveTabKey] = useState('organize');

  // 快照状态
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);

  // 导出状态
  const [exportSource, setExportSource] = useState<'current' | string>('current');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown_list');
  const [copied, setCopied] = useState(false);

  // 刷新当前窗口标签与快照
  const refreshCurrentWindow = async () => {
    setLoading(true);
    try {
      const res = await sendToBackground<GetCurrentWindowTabsResponse>({
        type: 'getCurrentWindowTabs',
      });
      if (res.ok) {
        setCurrentTabs(res.tabs);
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

  // 下载文件
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
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
      <div style={{ padding: '14px 16px', background: '#f8fafc', minHeight: 520, boxSizing: 'border-box' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            paddingBottom: 10,
            borderBottom: '1px solid #e2e8f0',
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
                <Text strong style={{ fontSize: 15, color: '#0f172a' }}>
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
                  v0.4.0
                </Tag>
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                当前窗口: {currentTabs.length} 标签 · {uniqueDomainsCount} 域名
              </Text>
            </div>
          </div>
          <Space size={4}>
            <Tooltip title="刷新窗口标签">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined style={{ fontSize: 13, color: '#64748b' }} />}
                onClick={refreshCurrentWindow}
              />
            </Tooltip>
            <Tooltip title="设置中心">
              <Button
                type="text"
                size="small"
                icon={<SettingOutlined style={{ fontSize: 14, color: '#64748b' }} />}
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
                  标签归拢
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* 智能归拢卡片 */}
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ marginBottom: 10 }}>
                      <Text strong style={{ fontSize: 13, color: '#1e293b' }}>
                        域名智能聚合
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
                          background: '#f1f5f9',
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
                                border: '1px solid #cbd5e1',
                                background: '#fff',
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
                          background: '#f8fafc',
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

                  {/* 快捷暂存卡片 */}
                  <Card
                    size="small"
                    style={{
                      borderRadius: 10,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div style={{ marginBottom: 8 }}>
                      <Text strong style={{ fontSize: 13, color: '#1e293b' }}>
                        暂存当前会话
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                        立即快照暂存当前窗口全部 {currentTabs.length} 个标签页，稍后可随时恢复。
                      </Text>
                    </div>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder="快照名称 (留空按时间自动命名)"
                        value={newSnapshotName}
                        onChange={(e) => setNewSnapshotName(e.target.value)}
                        onPressEnter={handleSaveSnapshot}
                      />
                      <Button
                        type="primary"
                        icon={<CameraOutlined />}
                        loading={isSavingSnapshot}
                        onClick={handleSaveSnapshot}
                        style={{ background: '#4f46e5' }}
                      >
                        暂存
                      </Button>
                    </Space.Compact>
                  </Card>
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
                        backgroundColor: '#eef2ff',
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
                        maxHeight: 360,
                        overflowY: 'auto',
                      }}
                    >
                      {snapshots.map((snap) => {
                        const isExpanded = expandedSnapshotId === snap.id;
                        return (
                          <div
                            key={snap.id}
                            style={{
                              background: '#fff',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                              padding: '10px 12px',
                              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
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
                                    style={{ fontSize: 13, color: '#0f172a', maxWidth: 190 }}
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
                                  borderTop: '1px solid #f1f5f9',
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
                                      style={{ flex: 1, color: '#334155' }}
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
                </div>
              ),
            },
            {
              key: 'export',
              label: (
                <span>
                  <ExportOutlined />
                  多格式导出
                </span>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      选择导出格式 ({exportTargetTabs.length} 个标签)：
                    </Text>
                    <Radio.Group
                      size="small"
                      value={exportFormat}
                      onChange={(e) => setExportFormat(e.target.value)}
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="markdown_list">MD 列表</Radio.Button>
                      <Radio.Button value="markdown_table">MD 表格</Radio.Button>
                      <Radio.Button value="urls_only">纯网址</Radio.Button>
                      <Radio.Button value="json">JSON</Radio.Button>
                    </Radio.Group>
                  </div>

                  {/* 预览展示区域 */}
                  <div
                    style={{
                      background: '#0f172a',
                      color: '#f8fafc',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 11,
                      lineHeight: 1.45,
                      maxHeight: 260,
                      minHeight: 200,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {exportedText || '// 暂无标签可供导出'}
                  </div>

                  {/* 底部按钮栏 */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      type="primary"
                      block
                      icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                      onClick={handleCopy}
                      style={{
                        background: copied
                          ? '#10b981'
                          : 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                        border: 'none',
                        fontWeight: 600,
                        height: 34,
                      }}
                    >
                      {copied ? '已复制到剪贴板！' : '复制到剪贴板'}
                    </Button>
                    <Button
                      icon={<DownloadOutlined />}
                      onClick={handleDownload}
                      style={{ height: 34 }}
                    >
                      下载文件
                    </Button>
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
