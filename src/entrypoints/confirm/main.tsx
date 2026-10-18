import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  theme,
  Typography,
} from 'antd';
import { sendToBackground } from '@/lib/messaging';
import type {
  FindDuplicatesResponse,
  GetTabGroupsResponse,
  TabGroupInfo,
  TabGroupColor,
} from '@/lib/messaging';
import { MODE_LABELS, type TabInfo } from '@/lib/match';
import { useThemeTokens, type ThemeTokens } from '@/lib/theme-tokens';
import { useThemeMode, applyThemeToDocument } from '@/lib/theme-mode';
import { ThemeModeButton } from '@/components/ThemeToggle';

const GROUP_COLORS: { label: string; value: TabGroupColor; hex: string }[] = [
  { label: '灰色', value: 'grey', hex: '#64748b' },
  { label: '蓝色', value: 'blue', hex: '#3b82f6' },
  { label: '红色', value: 'red', hex: '#ef4444' },
  { label: '黄色', value: 'yellow', hex: '#f59e0b' },
  { label: '绿色', value: 'green', hex: '#10b981' },
  { label: '粉色', value: 'pink', hex: '#ec4899' },
  { label: '紫色', value: 'purple', hex: '#8b5cf6' },
  { label: '青色', value: 'cyan', hex: '#06b6d4' },
  { label: '橙色', value: 'orange', hex: '#f97316' },
];

function Kbd({ children, tk }: { children: React.ReactNode; tk: ThemeTokens }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        padding: '0 5px',
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontWeight: 600,
        color: tk.ink2,
        background: tk.surfaceMuted,
        border: `1px solid ${tk.hairlineStrong}`,
        borderBottom: `2px solid ${tk.hairlineStrong}`,
        borderRadius: 4,
        marginLeft: 6,
        lineHeight: 1,
      }}
    >
      {children}
    </kbd>
  );
}

createRoot(document.getElementById('root')!).render(<ConfirmPage />);

function ConfirmPage() {
  const { isDark, mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { tk } = useThemeTokens(isDark);

  // 让原生控件与页面底色跟随主题，避免首帧闪白
  useEffect(() => applyThemeToDocument(isDark, tk.canvas), [isDark, tk.canvas]);
  const [targetUrl] = useState(() => new URLSearchParams(location.search).get('u') ?? '');
  const [dups, setDups] = useState<TabInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // 展开与详情状态
  const [showTargetDetails, setShowTargetDetails] = useState(false);
  const [expandedTabIds, setExpandedTabIds] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  // 批量管理状态
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<number>>(new Set());

  // 分组弹窗状态
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupColor, setGroupColor] = useState<TabGroupColor>('blue');
  const [existingGroups, setExistingGroups] = useState<TabGroupInfo[]>([]);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [selectedJoinGroupId, setSelectedJoinGroupId] = useState<number | null>(null);

  const valid = useMemo(() => {
    try {
      return /^https?:$/.test(new URL(targetUrl).protocol);
    } catch {
      return false;
    }
  }, [targetUrl]);

  // 刷新已有匹配标签列表
  const refresh = useCallback(() => {
    if (!valid) {
      setLoading(false);
      setError('目标地址无效');
      return;
    }
    sendToBackground<FindDuplicatesResponse>({ type: 'findDuplicates', url: targetUrl })
      .then((r) => {
        setDups(r.tabs);
        setError('');
        setSelectedId((prev) => {
          if (prev != null && r.tabs.some((t) => t.id === prev)) return prev;
          return r.tabs[0]?.id ?? null;
        });
      })
      .catch(() => {
        setError('查询匹配标签失败，请重试或重新加载扩展。');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [targetUrl, valid]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);

    // 监听外部标签关闭事件，及时移除对应项
    const onTabRemoved = (closedTabId: number) => {
      setDups((prev) => prev.filter((t) => t.id !== closedTabId));
      setBatchSelectedIds((prev) => {
        if (!prev.has(closedTabId)) return prev;
        const next = new Set(prev);
        next.delete(closedTabId);
        return next;
      });
    };
    chrome.tabs?.onRemoved?.addListener(onTabRemoved);

    return () => {
      window.removeEventListener('focus', refresh);
      chrome.tabs?.onRemoved?.removeListener(onTabRemoved);
    };
  }, [refresh]);

  // 维护当前有效选中项
  useEffect(() => {
    if (selectedId == null || !dups.some((t) => t.id === selectedId)) {
      setSelectedId(dups[0]?.id ?? null);
    }
  }, [dups, selectedId]);

  const selectedTab = useMemo(() => dups.find((t) => t.id === selectedId), [dups, selectedId]);

  // 「仍要打开」放行并原地导航
  const openAnyway = useCallback(async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await sendToBackground({ type: 'confirmOpen', url: targetUrl });
      window.location.href = targetUrl;
    } catch {
      setError('放行失败，请重新加载扩展后重试。');
      setBusy(false);
    }
  }, [targetUrl, valid, busy]);

  // 切换到目标标签
  const switchTo = useCallback(
    async (tab?: TabInfo) => {
      if (!tab || busy) return;
      setBusy(true);
      try {
        await sendToBackground({
          type: 'switchTab',
          tabId: tab.id,
          windowId: tab.windowId,
          closeSelf: true,
        });
      } catch {
        setError('切换失败，目标标签可能已在外部关闭。');
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  // 关闭单个标签
  const closeSingleTab = useCallback(async (tabId: number) => {
    setBusy(true);
    try {
      await sendToBackground({ type: 'closeTabs', tabIds: [tabId] });
      setDups((prev) => prev.filter((t) => t.id !== tabId));
    } catch {
      setError('关闭标签失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  // 批量关闭所选标签
  const closeBatchTabs = useCallback(async () => {
    const ids = Array.from(batchSelectedIds);
    if (!ids.length) return;
    setBusy(true);
    try {
      await sendToBackground({ type: 'closeTabs', tabIds: ids });
      setDups((prev) => prev.filter((t) => !batchSelectedIds.has(t.id)));
      setBatchSelectedIds(new Set());
    } catch {
      setError('批量关闭标签失败。');
    } finally {
      setBusy(false);
    }
  }, [batchSelectedIds]);

  // 保留所选一个，关闭其他匹配标签
  const keepOneCloseOthers = useCallback(
    async (keepId: number) => {
      const idsToClose = dups.filter((t) => t.id !== keepId).map((t) => t.id);
      if (!idsToClose.length) return;
      setBusy(true);
      try {
        await sendToBackground({ type: 'closeTabs', tabIds: idsToClose });
        setDups((prev) => prev.filter((t) => t.id === keepId));
        setSelectedId(keepId);
        setBatchSelectedIds(new Set());
      } catch {
        setError('操作失败。');
      } finally {
        setBusy(false);
      }
    },
    [dups],
  );

  // 移出分组
  const ungroupTabs = useCallback(
    async (tabIds: number[]) => {
      setBusy(true);
      try {
        await sendToBackground({ type: 'ungroupTabs', tabIds });
        refresh();
      } catch {
        setError('移出分组失败。');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  // 打开新建分组弹窗
  const openNewGroupModal = useCallback(() => {
    const targets = batchMode ? Array.from(batchSelectedIds) : selectedId ? [selectedId] : [];
    if (!targets.length) {
      setError('请先选择要分组的标签。');
      return;
    }
    // 检查是否跨窗口
    const targetTabs = dups.filter((t) => targets.includes(t.id));
    const windowIds = new Set(targetTabs.map((t) => t.windowId));
    if (windowIds.size > 1) {
      setError('浏览器限制：不同窗口的标签无法合并至同一分组，请选择同一窗口的标签。');
      return;
    }
    setGroupTitle('');
    setGroupColor('blue');
    setGroupModalOpen(true);
  }, [batchMode, batchSelectedIds, selectedId, dups]);

  // 确认新建分组
  const submitNewGroup = useCallback(async () => {
    const targets = batchMode ? Array.from(batchSelectedIds) : selectedId ? [selectedId] : [];
    if (!targets.length) return;
    setBusy(true);
    try {
      await sendToBackground({
        type: 'groupTabs',
        tabIds: targets,
        title: groupTitle.trim() || undefined,
        color: groupColor,
      });
      setGroupModalOpen(false);
      refresh();
    } catch {
      setError('新建分组失败。');
    } finally {
      setBusy(false);
    }
  }, [batchMode, batchSelectedIds, selectedId, groupTitle, groupColor, refresh]);

  // 打开加入已有分组弹窗
  const openJoinGroupModal = useCallback(async () => {
    const targets = batchMode ? Array.from(batchSelectedIds) : selectedId ? [selectedId] : [];
    if (!targets.length) {
      setError('请先选择要加入分组的标签。');
      return;
    }
    const targetTabs = dups.filter((t) => targets.includes(t.id));
    const winId = targetTabs[0]?.windowId;
    if (targetTabs.some((t) => t.windowId !== winId)) {
      setError('不同窗口的标签无法加入同一分组，请选择同一窗口的标签。');
      return;
    }
    try {
      const res = await sendToBackground<GetTabGroupsResponse>({
        type: 'getTabGroups',
        windowId: winId,
      });
      if (!res.groups.length) {
        setError('该窗口当前暂无已存在的分组，请使用「新建分组」。');
        return;
      }
      setExistingGroups(res.groups);
      setSelectedJoinGroupId(res.groups[0]?.id ?? null);
      setJoinModalOpen(true);
    } catch {
      setError('获取窗口分组失败。');
    }
  }, [batchMode, batchSelectedIds, selectedId, dups]);

  // 确认加入已有分组
  const submitJoinGroup = useCallback(async () => {
    if (selectedJoinGroupId == null) return;
    const targets = batchMode ? Array.from(batchSelectedIds) : selectedId ? [selectedId] : [];
    if (!targets.length) return;
    setBusy(true);
    try {
      await sendToBackground({
        type: 'groupTabs',
        tabIds: targets,
        groupId: selectedJoinGroupId,
      });
      setJoinModalOpen(false);
      refresh();
    } catch {
      setError('加入已有分组失败。');
    } finally {
      setBusy(false);
    }
  }, [selectedJoinGroupId, batchMode, batchSelectedIds, selectedId, refresh]);

  // 复制完整地址
  const copyTargetUrl = useCallback(() => {
    if (!targetUrl) return;
    navigator.clipboard.writeText(targetUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [targetUrl]);

  // 键盘快捷键监听
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        groupModalOpen ||
        joinModalOpen ||
        (e.target instanceof HTMLElement &&
          e.target.closest('button, a, input, textarea, .ant-popconfirm, .ant-modal'))
      ) {
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (dups.length && selectedTab) {
          void switchTo(selectedTab);
        } else if (!dups.length) {
          void openAnyway();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        void openAnyway();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!dups.length) return;
        const curIdx = dups.findIndex((t) => t.id === selectedId);
        const nextIdx = curIdx < 0 || curIdx >= dups.length - 1 ? 0 : curIdx + 1;
        setSelectedId(dups[nextIdx].id);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!dups.length) return;
        const curIdx = dups.findIndex((t) => t.id === selectedId);
        const nextIdx = curIdx <= 0 ? dups.length - 1 : curIdx - 1;
        setSelectedId(dups[nextIdx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dups, selectedId, selectedTab, openAnyway, switchTo, groupModalOpen, joinModalOpen]);

  // 摘要解析
  const targetSummary = useMemo(() => parseUrlSummary(targetUrl), [targetUrl]);
  const primaryMode = dups[0]?.match?.mode;

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
          colorBgContainer: tk.surface,
          colorBorderSecondary: tk.hairline,
        },
      }}
    >
      <div style={{ minHeight: '100vh', background: tk.canvas, color: tk.ink }}>
        {/* 顶部主操作区：Sticky 吸顶，列表滚动时始终可见 */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            background: tk.stickyBg,
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            borderBottom: `1px solid ${tk.stickyBorder}`,
            boxShadow: tk.shadowSticky,
            padding: '12px 24px',
          }}
        >
          <div
            style={{
              maxWidth: 880,
              margin: '0 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                  letterSpacing: 0.3,
                  boxShadow: '0 2px 5px rgba(79, 70, 229, 0.25)',
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
                YiTab
              </div>
              <Typography.Text strong style={{ fontSize: 16, color: tk.ink }}>
                {loading
                  ? '正在检查匹配标签…'
                  : dups.length
                  ? `找到 ${dups.length} 个匹配标签`
                  : '当前无匹配已有标签'}
              </Typography.Text>
            </div>

            <Space wrap size={10}>
              {dups.length > 0 ? (
                <Button
                  type="primary"
                  size="large"
                  disabled={loading || busy || !selectedTab}
                  onClick={() => void switchTo(selectedTab)}
                  style={{
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                    boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
                  }}
                >
                  <span>切换到所选标签</span>
                  <Kbd tk={tk}>↵ Enter</Kbd>
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  disabled={!valid || busy}
                  onClick={() => void openAnyway()}
                  style={{
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                  }}
                >
                  <span>继续打开目标页面</span>
                  <Kbd tk={tk}>↵ Enter</Kbd>
                </Button>
              )}

              <Button
                size="large"
                disabled={!valid || busy}
                onClick={() => void openAnyway()}
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                <span>仍要打开</span>
                <Kbd tk={tk}>Esc</Kbd>
              </Button>

              <Button onClick={() => void chrome.runtime.openOptionsPage()}>网站规则</Button>
              <ThemeModeButton mode={themeMode} onChange={setThemeMode} ink3={tk.ink3} size="middle" />
            </Space>
          </div>
        </header>

        {/* 主体内容 */}
        <main style={{ maxWidth: 880, margin: '24px auto', padding: '0 20px 48px' }}>
          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

          {primaryMode === 'domain' && (
            <Alert
              type="warning"
              showIcon
              message="这是同域名匹配，已有标签可能是该网站的其他页面。请对比地址后选择。"
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}
          {primaryMode === 'path' && (
            <Alert
              type="warning"
              showIcon
              message="这是同路径匹配，已忽略所有查询参数。页面内容可能不同，请核实后选择。"
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}

          {/* 准备打开区块：高质感 Inspector 卡片 */}
          <Card
            size="small"
            style={{
              marginBottom: 20,
              borderRadius: 12,
              borderColor: tk.hairline,
              background: tk.surface,
              boxShadow: tk.shadowCard,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
                marginBottom: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={tk.ink3}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                </svg>
                <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>
                  准备打开的目标页面
                </Typography.Text>
              </div>

              <Space size={10}>
                <Button
                  type="link"
                  size="small"
                  onClick={copyTargetUrl}
                  style={{
                    padding: 0,
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {copied ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      已复制完整地址
                    </>
                  ) : (
                    '复制完整地址'
                  )}
                </Button>
                <span style={{ color: tk.hairlineStrong }}>|</span>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setShowTargetDetails((v) => !v)}
                  style={{ padding: 0, fontSize: 12 }}
                >
                  {showTargetDetails ? '收起详情' : '查看详情'}
                </Button>
              </Space>
            </div>

            {/* 默认紧凑摘要：优雅 Monospace 语法高亮 */}
            <div
              style={{
                fontSize: 13,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                padding: '8px 12px',
                background: tk.canvas,
                borderRadius: 8,
                border: `1px solid ${tk.hairline}`,
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <span style={{ fontWeight: 700, color: tk.ink }}>{targetSummary.host}</span>
              <span style={{ color: tk.ink2 }}>{targetSummary.path}</span>
              {targetSummary.queryCount > 0 && (
                <Tag
                  color="purple"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    fontFamily: 'sans-serif',
                    borderRadius: 4,
                  }}
                >
                  +{targetSummary.queryCount} 参数
                </Tag>
              )}
              {targetSummary.hash && (
                <Tag
                  color="cyan"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    fontFamily: 'sans-serif',
                    borderRadius: 4,
                  }}
                >
                  Hash: {targetSummary.hash}
                </Tag>
              )}
            </div>

            {/* 展开完整详情 */}
            {showTargetDetails && (
              <div
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: `1px dashed ${tk.hairline}`,
                  fontSize: 13,
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    完整地址：
                  </Typography.Text>
                  <Typography.Paragraph
                    copyable
                    style={{
                      overflowWrap: 'anywhere',
                      marginTop: 4,
                      marginBottom: 0,
                      background: tk.surfaceMuted,
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: 'ui-monospace, monospace',
                      color: tk.ink,
                    }}
                  >
                    {targetUrl}
                  </Typography.Paragraph>
                </div>
              </div>
            )}
          </Card>

          {/* 已有标签列表头部与批量管理栏 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Title level={5} style={{ margin: 0, fontSize: 16, color: tk.ink }}>
                已有标签（{dups.length}）
              </Typography.Title>
              {dups.length > 0 && (
                <span style={{ fontSize: 12, color: tk.ink3 }}>
                  ↑ ↓ 键快速选择 · Enter 键直接跳转
                </span>
              )}
            </div>

            <Space wrap size={8}>
              {!batchMode ? (
                dups.length > 1 && (
                  <Button size="small" onClick={() => setBatchMode(true)}>
                    批量管理
                  </Button>
                )
              ) : (
                <>
                  <Tag color="blue" style={{ margin: 0 }}>
                    已选 {batchSelectedIds.size} 项
                  </Tag>
                  <Button
                    size="small"
                    onClick={() => {
                      if (batchSelectedIds.size === dups.length) {
                        setBatchSelectedIds(new Set());
                      } else {
                        setBatchSelectedIds(new Set(dups.map((t) => t.id)));
                      }
                    }}
                  >
                    {batchSelectedIds.size === dups.length ? '取消全选' : '全选'}
                  </Button>
                  <Popconfirm
                    title={`确认关闭选中的 ${batchSelectedIds.size} 个标签？`}
                    description="注意：标签关闭后未保存的表单数据可能丢失。"
                    onConfirm={closeBatchTabs}
                    disabled={!batchSelectedIds.size || busy}
                  >
                    <Button danger size="small" disabled={!batchSelectedIds.size || busy}>
                      关闭所选 ({batchSelectedIds.size})
                    </Button>
                  </Popconfirm>
                  <Button
                    size="small"
                    disabled={!batchSelectedIds.size || busy}
                    onClick={openNewGroupModal}
                  >
                    新建分组
                  </Button>
                  <Button
                    size="small"
                    disabled={!batchSelectedIds.size || busy}
                    onClick={openJoinGroupModal}
                  >
                    加入已有分组
                  </Button>
                  <Button
                    size="small"
                    disabled={!batchSelectedIds.size || busy}
                    onClick={() => ungroupTabs(Array.from(batchSelectedIds))}
                  >
                    移出分组
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      setBatchMode(false);
                      setBatchSelectedIds(new Set());
                    }}
                  >
                    退出批量
                  </Button>
                </>
              )}
            </Space>
          </div>

          {/* 标签卡片列表 */}
          {dups.map((t) => {
            const isSelected = t.id === selectedId;
            const isBatchChecked = batchSelectedIds.has(t.id);
            const tSummary = parseUrlSummary(t.url);
            const isExpanded = expandedTabIds.has(t.id);

            return (
              <Card
                key={t.id}
                onClick={() => {
                  if (batchMode) {
                    setBatchSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    });
                  } else {
                    setSelectedId(t.id);
                  }
                }}
                style={{
                  marginBottom: 12,
                  borderRadius: 12,
                  cursor: 'pointer',
                  borderColor: isSelected && !batchMode ? '#4f46e5' : tk.hairline,
                  boxShadow:
                    isSelected && !batchMode
                      ? '0 0 0 2px rgba(79, 70, 229, 0.2), 0 4px 14px rgba(79, 70, 229, 0.08)'
                      : '0 1px 3px rgba(0, 0, 0, 0.03)',
                  transition: 'all 0.16s cubic-bezier(0.16, 1, 0.3, 1)',
                  background: tk.surface,
                }}
                styles={{ body: { padding: '14px 18px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  {/* 模式勾选或单选指示 */}
                  <div style={{ paddingTop: 3 }} onClick={(e) => e.stopPropagation()}>
                    {batchMode ? (
                      <Checkbox
                        checked={isBatchChecked}
                        onChange={(e) => {
                          setBatchSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.id);
                            else next.delete(t.id);
                            return next;
                          });
                        }}
                      />
                    ) : (
                      <Radio
                        checked={isSelected}
                        onChange={() => setSelectedId(t.id)}
                        aria-label="选择此标签"
                      />
                    )}
                  </div>

                  {/* Favicon 优雅包装 */}
                  <div
                    style={{
                      width: 38,
                      height: 38,
                      flexShrink: 0,
                      borderRadius: 9,
                      background: tk.canvas,
                      border: `1px solid ${tk.hairline}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      marginTop: 1,
                    }}
                  >
                    <Avatar
                      shape="square"
                      size={24}
                      src={t.favicon || undefined}
                      style={{ background: 'transparent', color: tk.ink3, fontWeight: 600 }}
                    >
                      {t.title ? t.title[0] : 'T'}
                    </Avatar>
                  </div>

                  {/* 核心信息 */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <Typography.Text
                        strong
                        style={{
                          fontSize: 15,
                          color: tk.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: 1.4,
                        }}
                        title={t.title}
                      >
                        {t.title || t.url}
                      </Typography.Text>
                    </div>

                    {/* 路径摘要 */}
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        color: tk.ink3,
                        marginBottom: 6,
                        display: 'flex',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: tk.ink2 }}>{tSummary.host}</span>
                      <span>{tSummary.path}</span>
                      {tSummary.queryCount > 0 && (
                        <Tag
                          style={{
                            margin: 0,
                            fontSize: 11,
                            fontFamily: 'sans-serif',
                            borderRadius: 4,
                          }}
                        >
                          +{tSummary.queryCount} 参数
                        </Tag>
                      )}
                    </div>

                    {/* 标签元信息：模式、规则、窗口、分组 */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}
                    >
                      {t.match && (
                        <Tag
                          color="blue"
                          style={{
                            margin: 0,
                            fontWeight: 500,
                            borderRadius: 4,
                          }}
                        >
                          {MODE_LABELS[t.match.mode]}
                        </Tag>
                      )}
                      {t.match?.ruleDomain && (
                        <Tag style={{ margin: 0, borderRadius: 4 }}>
                          网站规则：{t.match.ruleDomain}
                        </Tag>
                      )}
                      {t.groupTitle && (
                        <Tag
                          color={t.groupColor ?? 'default'}
                          style={{ margin: 0, borderRadius: 4 }}
                        >
                          分组: {t.groupTitle}
                        </Tag>
                      )}
                      <Tag
                        style={{
                          margin: 0,
                          background: tk.surfaceMuted,
                          color: tk.ink3,
                          borderRadius: 4,
                        }}
                      >
                        窗口 {t.windowId}
                      </Tag>
                      <span style={{ fontSize: 12, color: tk.ink3 }}>{t.match?.reason}</span>
                    </div>

                    {/* 展开的完整地址与详情 */}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: `1px dashed ${tk.hairline}`,
                          fontSize: 12,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Typography.Text type="secondary">完整地址：</Typography.Text>
                        <Typography.Paragraph
                          copyable
                          style={{
                            overflowWrap: 'anywhere',
                            marginTop: 4,
                            marginBottom: 4,
                            background: tk.canvas,
                            padding: '6px 10px',
                            borderRadius: 6,
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 12,
                          }}
                        >
                          {t.url}
                        </Typography.Paragraph>
                      </div>
                    )}
                  </div>

                  {/* 单卡片操作区 */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      flexShrink: 0,
                      alignItems: 'flex-end',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type={isSelected ? 'primary' : 'default'}
                      size="small"
                      disabled={busy}
                      onClick={() => void switchTo(t)}
                      style={{
                        fontWeight: 500,
                        background: isSelected ? '#4f46e5' : undefined,
                        borderColor: isSelected ? '#4f46e5' : undefined,
                      }}
                    >
                      切换
                    </Button>

                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, fontSize: 12 }}
                      onClick={() => {
                        setExpandedTabIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else next.add(t.id);
                          return next;
                        });
                      }}
                    >
                      {isExpanded ? '收起详情' : '查看详情'}
                    </Button>

                    <Popconfirm
                      title="确定关闭此标签页？"
                      description="若有未提交的表单内容可能丢失。"
                      onConfirm={() => void closeSingleTab(t.id)}
                      okText="关闭"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        type="text"
                        danger
                        size="small"
                        style={{ fontSize: 12, padding: '0 4px' }}
                      >
                        关闭
                      </Button>
                    </Popconfirm>

                    {dups.length > 1 && (
                      <Popconfirm
                        title="保留此标签并关闭其他匹配标签？"
                        description={`将关闭其余 ${dups.length - 1} 个匹配标签。`}
                        onConfirm={() => void keepOneCloseOthers(t.id)}
                        okText="确认关闭其他"
                        cancelText="取消"
                      >
                        <Button
                          type="text"
                          size="small"
                          style={{ fontSize: 11, padding: '0 4px', color: tk.ink3 }}
                        >
                          仅留此项
                        </Button>
                      </Popconfirm>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {/* 全部关闭时的提示 */}
          {!loading && dups.length === 0 && !error && (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                background: tk.surface,
                borderRadius: 12,
                border: `1px solid ${tk.hairline}`,
                boxShadow: tk.shadowCard,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: tk.surfaceMuted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  color: tk.ink3,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              <Typography.Title level={4} style={{ color: tk.ink, marginBottom: 8, fontSize: 18 }}>
                没有匹配的已有标签
              </Typography.Title>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 20, fontSize: 14 }}>
                原标签已被关闭，或当前规则未命中。您可以直接继续打开目标页面。
              </Typography.Paragraph>
              <Button
                type="primary"
                size="large"
                disabled={!valid || busy}
                onClick={() => void openAnyway()}
                style={{
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                }}
              >
                继续打开目标页面（Enter）
              </Button>
            </div>
          )}
        </main>

        {/* 新建分组 Modal */}
        <Modal
          title="新建标签分组"
          open={groupModalOpen}
          onOk={submitNewGroup}
          onCancel={() => setGroupModalOpen(false)}
          okText="确认创建"
          cancelText="取消"
          confirmLoading={busy}
        >
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong>分组名称：</Typography.Text>
              <Input
                placeholder="例如：开发、参考资料（可留空）"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                style={{ marginTop: 6, borderRadius: 6 }}
                maxLength={30}
              />
            </div>
            <div>
              <Typography.Text strong>选择颜色：</Typography.Text>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {GROUP_COLORS.map((c) => {
                  const isSelected = groupColor === c.value;
                  return (
                    <div
                      key={c.value}
                      onClick={() => setGroupColor(c.value)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #4f46e5' : `1px solid ${tk.hairline}`,
                        background: isSelected ? tk.accentSoft : tk.surface,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: c.hex,
                          display: 'inline-block',
                          boxShadow: isSelected ? `0 0 0 2px ${tk.surface}, 0 0 0 4px ${c.hex}` : undefined,
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: isSelected ? 600 : 400 }}>
                        {c.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>

        {/* 加入已有分组 Modal */}
        <Modal
          title="加入窗口已有分组"
          open={joinModalOpen}
          onOk={submitJoinGroup}
          onCancel={() => setJoinModalOpen(false)}
          okText="确认加入"
          cancelText="取消"
          confirmLoading={busy}
        >
          <div style={{ marginTop: 16 }}>
            <Typography.Paragraph type="secondary">
              选择当前窗口中已存在的标签组：
            </Typography.Paragraph>
            <Select
              style={{ width: '100%' }}
              value={selectedJoinGroupId}
              onChange={(val) => setSelectedJoinGroupId(val)}
              options={existingGroups.map((g) => ({
                value: g.id,
                label: `${g.title || '未命名分组'} (${g.color || '无颜色'})`,
              }))}
            />
          </div>
        </Modal>
      </div>
    </ConfigProvider>
  );
}

function parseUrlSummary(urlString: string): {
  host: string;
  path: string;
  queryCount: number;
  hash?: string;
} {
  try {
    const u = new URL(urlString);
    const host = u.host;
    let path = u.pathname;
    if (path.length > 40) {
      path = path.slice(0, 18) + '…' + path.slice(-14);
    }
    const queryCount = [...u.searchParams.keys()].length;
    const hash = u.hash ? (u.hash.length > 20 ? u.hash.slice(0, 15) + '…' : u.hash) : undefined;
    return { host, path, queryCount, hash };
  } catch {
    return { host: urlString, path: '', queryCount: 0 };
  }
}
