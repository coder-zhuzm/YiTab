import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Empty,
  Input,
  message,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  CameraOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RestOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  DEFAULTS,
  getSettings,
  normalizeDomain,
  setSettings,
  type MatchMode,
  type Settings,
  type SiteRule,
  type SpaPolicy,
  type AiSettings,
  DEFAULT_AI_SETTINGS,
  getAiSettings,
  saveAiSettings,
} from '../../lib/settings';
import {
  checkAiCapabilities,
  getAiCacheStats,
  clearAiCache,
  type AiCapabilities,
} from '../../lib/ai-assistant';
import { MODE_LABELS } from '../../lib/match';
import { sendToBackground } from '../../lib/messaging';
import type {
  ArchiveInactiveTabsResponse,
  CleanBookmarksResponse,
  DiscardTabsResponse,
  ExportBookmarksBackupResponse,
  GetTabHealthResponse,
  ScanBookmarksResponse,
} from '../../lib/messaging';
import {
  computeRecommendedDeletePlan,
  type BookmarkDuplicateGroup,
  type BookmarkScanReport,
} from '../../lib/bookmarks';
import { ESTIMATED_MB_PER_TAB, type TabHealthReport } from '../../lib/tab-health';
import { APP_VERSION } from '../../lib/version';

const { Text, Paragraph, Title } = Typography;

const modes: MatchMode[] = ['smart', 'url', 'path', 'domain'];

const modeBadges: Record<MatchMode, { text: string; color: string }> = {
  smart: { text: '推荐 · 新安装默认', color: '#4f46e5' },
  url: { text: '严格完整匹配', color: '#0284c7' },
  path: { text: '宽泛 · 忽略参数', color: '#d97706' },
  domain: { text: '最宽泛 · 限制多开', color: '#dc2626' },
};

const descriptions: Record<MatchMode, string> = {
  smart:
    '保留路径和内容参数，忽略 utm_* 等追踪参数及普通锚点。参数按名称排序，同名多值保留顺序，Hash 路由保留。',
  url: '完整地址一致，包括参数顺序和锚点；不忽略任何参数。',
  path: '同协议、域名、端口和路径；忽略所有查询参数，Hash 路由保留。',
  domain: '同域名就匹配，不区分路径、参数和协议；兼容旧模式，www 与裸域名视为相同。',
};

const examples: Record<MatchMode, string> = {
  smart: '/article/1?utm_source=a 与 /article/1?utm_source=b 匹配；/watch?v=A 与 /watch?v=B 不匹配。',
  url: '/a?x=1 与 /a?x=2 不匹配；/a#intro 与 /a#comments 不匹配。',
  path: '/search?q=react 与 /search?q=vue 也会匹配，不适合全局用于搜索、视频等网站。',
  domain: '/article/1 与 /article/2 也会匹配，仅适合希望限制同网站多开的场景。',
};

function OptionsPage() {
  const [activeTabKey, setActiveTabKey] = useState('rules');
  const [settings, update] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [whiteInput, setWhiteInput] = useState('');
  const [domain, setDomain] = useState('');
  const [ruleMode, setRuleMode] = useState<MatchMode>('smart');
  const [subdomains, setSubdomains] = useState(false);
  const [params, setParams] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  // 阶段四：书签生态与健康治理
  const [bookmarkReport, setBookmarkReport] = useState<BookmarkScanReport | null>(null);
  const [bookmarkScanning, setBookmarkScanning] = useState(false);
  const [bookmarkCleaning, setBookmarkCleaning] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  // 阶段四：标签内存与休眠治理
  const [tabHealth, setTabHealth] = useState<TabHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // 阶段五：端侧 AI 智能引擎与资源管控
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiCapabilities, setAiCapabilities] = useState<AiCapabilities>({
    supported: false,
    modelReady: false,
    status: 'no',
  });
  const [aiCacheCount, setAiCacheCount] = useState(0);

  useEffect(() => {
    getSettings()
      .then(update)
      .catch(() => setError('读取设置失败，请重新加载扩展。'))
      .finally(() => setLoading(false));

    fetchTabHealth();
    getAiSettings().then(setAiSettingsState);
    checkAiCapabilities().then(setAiCapabilities);
    getAiCacheStats().then((s) => setAiCacheCount(s.count));
  }, []);

  const handleSaveAiSettings = async (patch: Partial<AiSettings>) => {
    const next = await saveAiSettings(patch);
    setAiSettingsState(next);
    message.success('端侧 AI 配置已保存');
  };

  const handleClearAiCache = async () => {
    await clearAiCache();
    setAiCacheCount(0);
    message.success('已成功清空本地端侧 AI 推理缓存');
  };

  const fetchTabHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await sendToBackground<GetTabHealthResponse>({ type: 'getTabHealth' });
      if (res && res.ok) {
        setTabHealth(res.health);
      }
    } catch (e) {
      console.warn('Failed to get tab health:', e);
    } finally {
      setHealthLoading(false);
    }
  };

  const scanBookmarks = async () => {
    setBookmarkScanning(true);
    try {
      const res = await sendToBackground<ScanBookmarksResponse>({ type: 'scanBookmarks' });
      if (res && res.ok && res.report) {
        setBookmarkReport(res.report);
      } else if (res?.error) {
        alert(res.error);
      }
    } catch (e) {
      console.warn('Scan bookmarks failed:', e);
    } finally {
      setBookmarkScanning(false);
    }
  };

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

  const handleDiscardTabs = async () => {
    setDiscardLoading(true);
    try {
      const res = await sendToBackground<DiscardTabsResponse>({ type: 'discardTabs' });
      if (res.ok && res.discardedCount > 0) {
        alert(`已成功休眠 ${res.discardedCount} 个闲置标签，估算释放约 ${res.freedMemoryMb}MB 内存！`);
      } else {
        alert('当前没有符合条件的闲置标签（播放中、固定或活动标签受保护）');
      }
      fetchTabHealth();
    } catch {
      alert('休眠标签操作失败');
    } finally {
      setDiscardLoading(false);
    }
  };

  const handleArchiveTabs = async () => {
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
      fetchTabHealth();
    } catch {
      alert('沉淀归档操作失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  async function save(patch: Partial<Settings>): Promise<boolean> {
    if (lock.current || loading) return false;
    lock.current = true;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      update(await setSettings(patch));
      setSaved(true);
      return true;
    } catch {
      setError('保存失败。请检查扩展状态或同步存储空间后重试。');
      return false;
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const disabled = loading || saving;

  function clearEditor() {
    setEditing(null);
    setDomain('');
    setRuleMode('smart');
    setSubdomains(false);
    setParams('');
  }

  async function saveRule() {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      setError('请输入有效域名或 HTTP(S) 地址，不支持通配符。');
      return;
    }
    const ignoredParams = [...new Set(params.split(/[,，\s]+/).filter(Boolean))];
    if (ignoredParams.some((p) => /[?&#=*]/.test(p))) {
      setError('忽略参数请填参数名，以逗号分隔，不支持通配符。');
      return;
    }
    const rule: SiteRule = {
      domain: normalized,
      mode: ruleMode,
      includeSubdomains: subdomains,
      ignoredParams: ruleMode === 'smart' ? ignoredParams : [],
    };
    if (
      settings.siteRules.some(
        (r, i) => i !== editing && r.domain === normalized && r.includeSubdomains === subdomains,
      )
    ) {
      setError('已有相同域名和子域覆盖范围的规则，请编辑原规则。');
      return;
    }
    const next = [...settings.siteRules];
    if (editing === null) next.push(rule);
    else next[editing] = rule;
    if (await save({ siteRules: next })) clearEditor();
  }

  async function addWhite() {
    const normalized = normalizeDomain(whiteInput);
    if (!normalized) {
      setError('白名单域名无效。');
      return;
    }
    if (await save({ whitelist: [...new Set([...settings.whitelist, normalized])] }))
      setWhiteInput('');
  }

  const broadAuto =
    settings.interceptMode === 'auto' &&
    [settings.matchMode, ...settings.siteRules.map((r) => r.mode)].some(
      (m) => m === 'path' || m === 'domain',
    );

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#4f46e5',
          borderRadius: 8,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", "Helvetica Neue", Arial, sans-serif',
          colorBgContainer: '#ffffff',
          colorBorderSecondary: '#e2e8f0',
        },
      }}
    >
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '36px 20px 64px' }}>
        <div style={{ maxWidth: 880, margin: '0 auto' }}>
          {/* 页面主标题与状态条 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  boxShadow: '0 4px 10px rgba(79, 70, 229, 0.25)',
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                Yi
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Title level={3} style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>
                    YiTab 一签 · 控制中心
                  </Title>
                  <Tag color="indigo" style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                    {APP_VERSION}
                  </Tag>
                </div>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  智能标签页治理、书签生态维护与资源优化套件
                </Text>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag
                color={saved ? 'green' : undefined}
                style={{
                  margin: 0,
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: saved ? '#16a34a' : saving ? '#d97706' : '#64748b',
                    display: 'inline-block',
                  }}
                />
                {loading ? '读取中…' : saving ? '保存中…' : saved ? '已保存' : '更改自动保存'}
              </Tag>
            </div>
          </div>

          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} />}

          {/* 导航标签页切换 */}
          <Tabs
            activeKey={activeTabKey}
            onChange={setActiveTabKey}
            type="card"
            style={{ marginBottom: 20 }}
            items={[
              {
                key: 'rules',
                label: (
                  <span>
                    <SettingOutlined />
                    去重拦截策略
                  </span>
                ),
                children: (
                  <div>
                    {/* 1. 重复判定粒度（全局默认） */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            重复判定粒度（全局默认）
                          </span>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                            决定打开新标签时以什么标准比对已有标签
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <Radio.Group
                        value={settings.matchMode}
                        disabled={disabled}
                        onChange={(e) => void save({ matchMode: e.target.value })}
                        style={{ width: '100%' }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
                            gap: 12,
                          }}
                        >
                          {modes.map((mode) => {
                            const isChecked = settings.matchMode === mode;
                            const badge = modeBadges[mode];
                            return (
                              <div
                                key={mode}
                                onClick={() => {
                                  if (!disabled && settings.matchMode !== mode) {
                                    void save({ matchMode: mode });
                                  }
                                }}
                                style={{
                                  padding: '14px 16px',
                                  borderRadius: 10,
                                  border: isChecked ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                                  background: isChecked ? '#f5f3ff' : '#ffffff',
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.15s ease',
                                  boxShadow: isChecked
                                    ? '0 2px 8px rgba(79, 70, 229, 0.12)'
                                    : '0 1px 2px rgba(0, 0, 0, 0.02)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <div>
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      marginBottom: 6,
                                    }}
                                  >
                                    <Radio value={mode} style={{ fontWeight: 600, fontSize: 15 }}>
                                      {MODE_LABELS[mode]}
                                      {mode === 'smart' ? '（新安装默认）' : ''}
                                    </Radio>
                                    <span
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: badge.color,
                                        background: '#ffffff',
                                        padding: '2px 8px',
                                        borderRadius: 4,
                                        border: `1px solid ${badge.color}33`,
                                      }}
                                    >
                                      {badge.text}
                                    </span>
                                  </div>
                                  <Paragraph
                                    type="secondary"
                                    style={{
                                      margin: '4px 0 8px 24px',
                                      fontSize: 13,
                                      lineHeight: 1.5,
                                      color: isChecked ? '#475569' : '#64748b',
                                    }}
                                  >
                                    {descriptions[mode]}
                                  </Paragraph>
                                </div>

                                <div
                                  style={{
                                    marginLeft: 24,
                                    padding: '6px 10px',
                                    background: isChecked ? 'rgba(255, 255, 255, 0.9)' : '#f8fafc',
                                    borderRadius: 6,
                                    fontSize: 12,
                                    color: '#475569',
                                    fontFamily:
                                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                    border: '1px solid rgba(0, 0, 0, 0.04)',
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: '#334155' }}>示例：</span>
                                  {examples[mode]}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Radio.Group>
                    </Card>

                    {/* 2. 遇到匹配标签时的处理方式 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            遇到匹配标签时的处理方式
                          </span>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                            发现相同网页后的交互行为
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <Radio.Group
                        value={settings.interceptMode}
                        disabled={disabled}
                        onChange={(e) => void save({ interceptMode: e.target.value })}
                        style={{ width: '100%' }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                            gap: 12,
                          }}
                        >
                          <div
                            onClick={() => {
                              if (!disabled && settings.interceptMode !== 'auto') {
                                void save({ interceptMode: 'auto' });
                              }
                            }}
                            style={{
                              padding: '16px',
                              borderRadius: 10,
                              border:
                                settings.interceptMode === 'auto'
                                  ? '2px solid #4f46e5'
                                  : '1px solid #e2e8f0',
                              background: settings.interceptMode === 'auto' ? '#f5f3ff' : '#ffffff',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Radio
                              value="auto"
                              style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}
                            >
                              静默切换：自动跳到已有标签，并关闭重复标签
                            </Radio>
                            <div
                              style={{
                                marginLeft: 24,
                                fontSize: 13,
                                color: '#64748b',
                                lineHeight: 1.5,
                              }}
                            >
                              极速流体验。新标签一闪即逝，视线自动聚焦到已打开的标签页，适合追求高效率的极简用户。
                            </div>
                          </div>

                          <div
                            onClick={() => {
                              if (!disabled && settings.interceptMode !== 'ask') {
                                void save({ interceptMode: 'ask' });
                              }
                            }}
                            style={{
                              padding: '16px',
                              borderRadius: 10,
                              border:
                                settings.interceptMode === 'ask'
                                  ? '2px solid #4f46e5'
                                  : '1px solid #e2e8f0',
                              background: settings.interceptMode === 'ask' ? '#f5f3ff' : '#ffffff',
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Radio
                              value="ask"
                              style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}
                            >
                              页内确认：选择「切换 / 仍要新开」
                            </Radio>
                            <div
                              style={{
                                marginLeft: 24,
                                fontSize: 13,
                                color: '#64748b',
                                lineHeight: 1.5,
                              }}
                            >
                              清晰透明。保留选择权，在全屏确认页直观对比地址、分组管理，支持键盘快捷键一键切换或放行。
                            </div>
                          </div>
                        </div>
                      </Radio.Group>

                      {broadAuto && (
                        <Alert
                          type="warning"
                          showIcon
                          style={{ marginTop: 16, borderRadius: 8 }}
                          message="全局或网站规则启用了宽泛匹配 + 静默切换，可能跳到不同内容。建议选择页内确认。"
                        />
                      )}
                    </Card>

                    {/* 3. 拦截触发场景与刷新控制 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            拦截触发场景与刷新控制
                          </span>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                            决定在已有标签页刷新或重复加载时是否触发拦截
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <div
                        style={{
                          padding: '16px',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                          background: settings.ignoreReload !== false ? '#f8fafc' : '#ffffff',
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                              刷新页面时忽略拦截（推荐 · 仅在新开时拦截）
                            </span>
                            <Tag color={settings.ignoreReload !== false ? 'green' : 'default'} style={{ margin: 0 }}>
                              {settings.ignoreReload !== false ? '默认开启' : '已关闭'}
                            </Tag>
                          </div>
                          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
                            开启后，当你在已有标签页按 F5、点击刷新按钮、执行重新加载或原地提交相同网页时，直接保留并刷新当前标签页，绝不触发拦截或误跳。仅在真正新开标签页、从地址栏输入新网页或点击新链接时，才进行去重检测。
                          </div>
                        </div>
                        <Switch
                          checked={settings.ignoreReload !== false}
                          disabled={disabled}
                          onChange={(checked) => void save({ ignoreReload: checked })}
                        />
                      </div>

                      {/* Hash 路由判定 */}
                      <div
                        style={{
                          marginTop: 12,
                          padding: '16px',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                          background: '#ffffff',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                            井号（Hash）路由是否参与判重
                          </span>
                          <Tag color={settings.hashPolicy === 'ignore' ? 'default' : 'green'} style={{ margin: 0 }}>
                            {settings.hashPolicy === 'ignore' ? '忽略 Hash' : '默认保留'}
                          </Tag>
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 12 }}>
                          大量单页应用用 <code>#inbox</code>、<code>#settings</code> 这类单段 Hash 表示不同页面。
                          保留 Hash 可避免把两个不同页面误判为重复。
                        </div>
                        {settings.hashPolicy === 'ignore' && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 12, borderRadius: 8 }}
                            message="当前是全局设置：所有网站的 Hash 都会被忽略"
                            description="这会同时影响其它单页应用。例如 #/inbox 与 #/sent 将被视为同一页面并被判为重复。如需按站点区分，请改用「网站例外规则」调整该站点的匹配粒度。"
                          />
                        )}
                        <Radio.Group
                          value={settings.hashPolicy === 'ignore' ? 'ignore' : 'keep'}
                          disabled={disabled}
                          onChange={(e) => void save({ hashPolicy: e.target.value })}
                        >
                          <Space direction="vertical" size={6}>
                            <Radio value="keep">
                              保留 Hash（推荐）— <code>#inbox</code> 与 <code>#sent</code> 视为不同页面
                            </Radio>
                            <Radio value="ignore">
                              忽略 Hash — <strong>全局</strong>生效，所有网站都按「Hash 不参与判重」处理
                            </Radio>
                          </Space>
                        </Radio.Group>
                      </div>

                      {/* SPA 站内路由处理策略 */}
                      <div
                        style={{
                          marginTop: 12,
                          padding: '16px',
                          borderRadius: 10,
                          border: '1px solid #e2e8f0',
                          background: '#ffffff',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: '#0f172a' }}>
                            单页应用站内路由变化的处理方式
                          </span>
                          <Tag color={settings.spaPolicy === 'auto' ? 'orange' : 'green'} style={{ margin: 0 }}>
                            {settings.spaPolicy === 'auto' ? '静默切换' : settings.spaPolicy === 'off' ? '不处理' : '页内提示'}
                          </Tag>
                        </div>
                        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 12 }}>
                          在单页应用内点击站内链接时（不产生整页加载），若别处已有相同路由的标签页，如何处理。
                          默认只在页内弹出轻提示，不会抢走你正在输入的页面。
                        </div>
                        <Select
                          style={{ width: '100%', maxWidth: 520 }}
                          value={settings.spaPolicy === 'auto' ? 'auto' : settings.spaPolicy === 'off' ? 'off' : 'toast'}
                          disabled={disabled}
                          onChange={(value: SpaPolicy) => void save({ spaPolicy: value })}
                          options={[
                            { value: 'toast', label: '页内轻提示（推荐）— 弹出浮窗询问，绝不抢焦点' },
                            { value: 'auto', label: '静默切换 — 直接跳转到已有标签页' },
                            { value: 'off', label: '不处理 — 完全忽略站内路由变化' },
                          ]}
                        />
                      </div>
                    </Card>

                    {/* 4. 网站例外规则 */}
                    <Card
                      title={
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            网站例外规则
                          </span>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                            针对特定网站覆盖全局匹配模式
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          padding: '8px 12px',
                          background: '#f1f5f9',
                          borderRadius: 8,
                          fontSize: 12,
                          color: '#475569',
                          marginBottom: 16,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>生效优先级：</span>
                        <Tag color="cyan" style={{ margin: 0 }}>
                          1. 域名白名单（优先放行）
                        </Tag>
                        <span>→</span>
                        <Tag color="blue" style={{ margin: 0 }}>
                          2. 最具体的网站规则
                        </Tag>
                        <span>→</span>
                        <Tag style={{ margin: 0 }}>3. 全局默认粒度</Tag>
                      </div>

                      {settings.siteRules.length > 0 && (
                        <div
                          style={{
                            marginBottom: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          {settings.siteRules.map((r, i) => (
                            <div
                              key={`${r.domain}-${r.includeSubdomains}`}
                              style={{
                                padding: '12px 16px',
                                background: '#ffffff',
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <Space wrap size={8}>
                                  <Text strong style={{ fontSize: 14 }}>
                                    {r.domain}
                                  </Text>
                                  <Tag color="blue">{MODE_LABELS[r.mode]}</Tag>
                                  <Tag color={r.includeSubdomains ? 'purple' : 'default'}>
                                    {r.includeSubdomains ? '含子域名' : '精确域名'}
                                  </Tag>
                                </Space>
                                {r.ignoredParams.length > 0 && (
                                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                                    另忽略参数：
                                    <span style={{ fontFamily: 'monospace', color: '#0f172a' }}>
                                      {r.ignoredParams.join('、')}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <Space size={8}>
                                <Button
                                  size="small"
                                  disabled={disabled}
                                  onClick={() => {
                                    setEditing(i);
                                    setDomain(r.domain);
                                    setRuleMode(r.mode);
                                    setSubdomains(r.includeSubdomains);
                                    setParams(r.ignoredParams.join(', '));
                                  }}
                                >
                                  编辑
                                </Button>
                                <Popconfirm
                                  title="删除此网站规则？"
                                  onConfirm={async () => {
                                    if (
                                      await save({
                                        siteRules: settings.siteRules.filter((_, n) => n !== i),
                                      })
                                    )
                                      clearEditor();
                                  }}
                                >
                                  <Button danger size="small" disabled={disabled}>
                                    删除
                                  </Button>
                                </Popconfirm>
                              </Space>
                            </div>
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          padding: '16px',
                          background: '#f8fafc',
                          borderRadius: 10,
                          border: '1px dashed #cbd5e1',
                        }}
                      >
                        <Title level={5} style={{ margin: '0 0 12px 0', fontSize: 14 }}>
                          {editing === null ? '添加网站规则' : '编辑网站规则'}
                        </Title>
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <Input
                            placeholder="域名，例如 example.com（也可直接粘贴网页网址）"
                            value={domain}
                            disabled={disabled}
                            onChange={(e) => setDomain(e.target.value)}
                            style={{ borderRadius: 6 }}
                          />
                          <Space wrap size={12}>
                            <Select
                              style={{ width: 180 }}
                              value={ruleMode}
                              disabled={disabled}
                              onChange={setRuleMode}
                              options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))}
                            />
                            <Checkbox
                              checked={subdomains}
                              disabled={disabled}
                              onChange={(e) => setSubdomains(e.target.checked)}
                            >
                              同时覆盖子域名
                            </Checkbox>
                          </Space>

                          {ruleMode === 'smart' && (
                            <Input
                              placeholder="额外忽略的参数名，例如 share, from（以逗号分隔，可留空）"
                              value={params}
                              disabled={disabled}
                              onChange={(e) => setParams(e.target.value)}
                              style={{ borderRadius: 6 }}
                            />
                          )}

                          <Space size={8} style={{ marginTop: 4 }}>
                            <Button
                              type="primary"
                              disabled={disabled}
                              onClick={() => void saveRule()}
                              style={{ fontWeight: 500 }}
                            >
                              {editing === null ? '添加规则' : '保存规则'}
                            </Button>
                            <Button disabled={disabled} onClick={clearEditor}>
                              清空 / 取消
                            </Button>
                          </Space>
                        </Space>
                      </div>
                    </Card>

                    {/* 5. 域名白名单 */}
                    <Card
                      title={
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            域名白名单（永不拦截）
                          </span>
                          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                            适用于邮箱、协同文档、即时通讯等
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
                        <Input
                          value={whiteInput}
                          disabled={disabled}
                          placeholder="输入域名，例如 mail.google.com"
                          onChange={(e) => setWhiteInput(e.target.value)}
                          onPressEnter={() => void addWhite()}
                        />
                        <Button type="primary" disabled={disabled} onClick={() => void addWhite()}>
                          添加
                        </Button>
                      </Space.Compact>

                      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {settings.whitelist.map((w) => (
                          <Tag
                            key={w}
                            closable={!disabled}
                            onClose={(e) => {
                              e.preventDefault();
                              void save({ whitelist: settings.whitelist.filter((x) => x !== w) });
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: 13,
                              borderRadius: 6,
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                            }}
                          >
                            {w}
                          </Tag>
                        ))}
                      </div>
                    </Card>
                  </div>
                ),
              },
              {
                key: 'bookmarks',
                label: (
                  <span>
                    <BookOutlined />
                    书签健康与生态治理
                    {bookmarkReport && bookmarkReport.redundantCount > 0 && (
                      <Badge
                        count={bookmarkReport.redundantCount}
                        style={{ marginLeft: 6, backgroundColor: '#ef4444' }}
                      />
                    )}
                  </span>
                ),
                children: (
                  <div>
                    {/* 书签概览卡片 */}
                    <Card
                      title={
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                              书签树深度扫描与智能去重
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: '#64748b',
                                fontWeight: 'normal',
                                display: 'block',
                              }}
                            >
                              递归扫描全部收藏夹，按路径深度、标题质量和历史添加时间智能推荐最佳保留项
                            </span>
                          </div>
                          <Button
                            type="primary"
                            icon={<ReloadOutlined />}
                            loading={bookmarkScanning}
                            onClick={scanBookmarks}
                            style={{ background: '#4f46e5' }}
                          >
                            {bookmarkReport ? '重新扫描书签' : '开始扫描书签'}
                          </Button>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      {bookmarkReport ? (
                        <div>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                              gap: 12,
                              marginBottom: 16,
                            }}
                          >
                            <div
                              style={{
                                background: '#f8fafc',
                                padding: '14px 16px',
                                borderRadius: 10,
                                border: '1px solid #e2e8f0',
                              }}
                            >
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                总书签总数
                              </Text>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#0f172a',
                                  marginTop: 4,
                                }}
                              >
                                {bookmarkReport.totalBookmarks}
                              </div>
                            </div>
                            <div
                              style={{
                                background: '#f8fafc',
                                padding: '14px 16px',
                                borderRadius: 10,
                                border: '1px solid #e2e8f0',
                              }}
                            >
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                目录文件夹总数
                              </Text>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#0f172a',
                                  marginTop: 4,
                                }}
                              >
                                {bookmarkReport.totalFolders}
                              </div>
                            </div>
                            <div
                              style={{
                                background: '#fef2f2',
                                padding: '14px 16px',
                                borderRadius: 10,
                                border: '1px solid #fecaca',
                              }}
                            >
                              <Text type="secondary" style={{ fontSize: 12, color: '#991b1b' }}>
                                重复书签组 / 冗余项
                              </Text>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#dc2626',
                                  marginTop: 4,
                                }}
                              >
                                {bookmarkReport.duplicateGroupCount} 组 ·{' '}
                                {bookmarkReport.redundantCount} 项
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              flexWrap: 'wrap',
                              gap: 10,
                              paddingTop: 12,
                              borderTop: '1px solid #e2e8f0',
                            }}
                          >
                            <Space size={8}>
                              {bookmarkReport.redundantCount > 0 && (
                                <Popconfirm
                                  title="确认按建议一键清理？"
                                  description={`将安全删除 ${bookmarkReport.redundantCount} 个冗余书签，保留归类最深、无营销参数的优质书签。建议清理前先导出备份。`}
                                  onConfirm={handleCleanRecommendedBookmarks}
                                  okText="立即清理"
                                  cancelText="取消"
                                >
                                  <Button
                                    type="primary"
                                    danger
                                    loading={bookmarkCleaning}
                                    icon={<DeleteOutlined />}
                                    style={{ fontWeight: 600 }}
                                  >
                                    一键按建议清理 ({bookmarkReport.redundantCount} 项)
                                  </Button>
                                </Popconfirm>
                              )}
                            </Space>

                            <Space size={8}>
                              <Button
                                icon={<CloudDownloadOutlined />}
                                onClick={() => handleBackupBookmarks('html')}
                              >
                                导出标准 Netscape HTML 备份
                              </Button>
                              <Button
                                icon={<DownloadOutlined />}
                                onClick={() => handleBackupBookmarks('json')}
                              >
                                导出 JSON
                              </Button>
                            </Space>
                          </div>
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', padding: '30px 0' }}>
                          <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 16 }}>
                            尚未扫描书签树。点击上方按钮开始检测重复与异常书签。
                          </Paragraph>
                          <Button
                            type="primary"
                            icon={<BookOutlined />}
                            loading={bookmarkScanning}
                            onClick={scanBookmarks}
                            style={{ background: '#4f46e5' }}
                          >
                            开始全量书签检测
                          </Button>
                        </div>
                      )}
                    </Card>

                    {/* 重复书签组明细列表 */}
                    {bookmarkReport && bookmarkReport.groups.length > 0 && (
                      <Card
                        title={
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span style={{ fontSize: 15, fontWeight: 600 }}>
                              重复书签清单（共 {bookmarkReport.groups.length} 组）
                            </span>
                            <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                              每组已自动为您推荐保留最优项
                            </span>
                          </div>
                        }
                        style={{
                          borderRadius: 12,
                          borderColor: '#e2e8f0',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {bookmarkReport.groups.map((group) => {
                            const isExpanded = expandedGroupKey === group.groupKey;
                            return (
                              <div
                                key={group.groupKey}
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: 8,
                                  padding: '12px 14px',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    cursor: 'pointer',
                                  }}
                                  onClick={() =>
                                    setExpandedGroupKey(isExpanded ? null : group.groupKey)
                                  }
                                >
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <Text strong style={{ fontSize: 14, color: '#0f172a' }}>
                                        {group.title}
                                      </Text>
                                      <Tag color="volcano" style={{ margin: 0, borderRadius: 4 }}>
                                        {group.items.length} 个副本
                                      </Tag>
                                      {group.isExactUrl ? (
                                        <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                                          完全同地址
                                        </Tag>
                                      ) : (
                                        <Tag color="cyan" style={{ margin: 0, fontSize: 11 }}>
                                          参数归一化匹配
                                        </Tag>
                                      )}
                                    </div>
                                    <Text
                                      type="secondary"
                                      ellipsis
                                      style={{
                                        fontSize: 12,
                                        display: 'block',
                                        marginTop: 2,
                                        fontFamily: 'monospace',
                                      }}
                                    >
                                      {group.normalizedUrl}
                                    </Text>
                                  </div>

                                  <Button size="small" type="link">
                                    {isExpanded ? '收起详情' : '展开对比'}
                                  </Button>
                                </div>

                                {isExpanded && (
                                  <div
                                    style={{
                                      marginTop: 12,
                                      paddingTop: 10,
                                      borderTop: '1px solid #f1f5f9',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 8,
                                    }}
                                  >
                                    {group.items.map((it) => {
                                      const isKeep = it.id === group.recommendedKeepId;
                                      return (
                                        <div
                                          key={it.id}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '8px 12px',
                                            borderRadius: 6,
                                            background: isKeep ? '#f0fdf4' : '#fafafa',
                                            border: isKeep
                                              ? '1px solid #86efac'
                                              : '1px solid #f1f5f9',
                                          }}
                                        >
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                              style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                              }}
                                            >
                                              <Tag
                                                color={isKeep ? 'green' : 'default'}
                                                style={{ margin: 0, fontWeight: 600 }}
                                              >
                                                {isKeep ? '★ 推荐保留' : '待清理冗余'}
                                              </Tag>
                                              <Text strong style={{ fontSize: 13 }}>
                                                {it.title}
                                              </Text>
                                            </div>
                                            <div
                                              style={{
                                                fontSize: 11,
                                                color: '#64748b',
                                                marginTop: 4,
                                              }}
                                            >
                                              📁 目录:{' '}
                                              <strong>
                                                {it.folderPath.join(' / ') || '书签栏根目录'}
                                              </strong>{' '}
                                              · 原始网址:{' '}
                                              <span style={{ fontFamily: 'monospace' }}>
                                                {it.url}
                                              </span>
                                            </div>
                                          </div>

                                          {!isKeep && (
                                            <Popconfirm
                                              title="确认删除该书签？"
                                              onConfirm={() => handleDeleteSingleBookmark(it.id)}
                                              okText="删除"
                                              cancelText="取消"
                                            >
                                              <Button
                                                type="text"
                                                danger
                                                size="small"
                                                icon={<DeleteOutlined />}
                                              >
                                                删除
                                              </Button>
                                            </Popconfirm>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </Card>
                    )}
                  </div>
                ),
              },
              {
                key: 'tabs',
                label: (
                  <span>
                    <RestOutlined />
                    闲置休眠与内存治理
                  </span>
                ),
                children: (
                  <div>
                    <Card
                      title={
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                              闲置标签智能休眠与内存释放
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: '#64748b',
                                fontWeight: 'normal',
                                display: 'block',
                              }}
                            >
                              使用 Chrome 原生 discard 接口冻结闲置标签以省内存；严格保护发声与固定标签
                            </span>
                          </div>
                          <Button
                            size="small"
                            icon={<ReloadOutlined />}
                            loading={healthLoading}
                            onClick={fetchTabHealth}
                          >
                            刷新监控
                          </Button>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                          gap: 12,
                          marginBottom: 16,
                        }}
                      >
                        <div
                          style={{
                            background: '#f8fafc',
                            padding: '14px 16px',
                            borderRadius: 10,
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            当前窗口总标签
                          </Text>
                          <div
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              color: '#0f172a',
                              marginTop: 4,
                            }}
                          >
                            {tabHealth?.totalCount ?? 0}
                          </div>
                        </div>

                        <div
                          style={{
                            background: '#eff6ff',
                            padding: '14px 16px',
                            borderRadius: 10,
                            border: '1px solid #bfdbfe',
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12, color: '#1e40af' }}>
                            已休眠标签
                          </Text>
                          <div
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              color: '#2563eb',
                              marginTop: 4,
                            }}
                          >
                            {tabHealth?.discardedCount ?? 0}
                          </div>
                        </div>

                        <div
                          style={{
                            background: '#ecfdf5',
                            padding: '14px 16px',
                            borderRadius: 10,
                            border: '1px solid #a7f3d0',
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12, color: '#065f46' }}>
                            受保护标签 (活动/发声/固定)
                          </Text>
                          <div
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              color: '#059669',
                              marginTop: 4,
                            }}
                          >
                            {(tabHealth?.audibleCount ?? 0) +
                              (tabHealth?.pinnedCount ?? 0) +
                              (tabHealth?.activeTabId ? 1 : 0)}
                          </div>
                        </div>

                        <div
                          style={{
                            background: '#f5f3ff',
                            padding: '14px 16px',
                            borderRadius: 10,
                            border: '1px solid #ddd6fe',
                          }}
                        >
                          <Text type="secondary" style={{ fontSize: 12, color: '#5b21b6' }}>
                            可释放内存估算
                          </Text>
                          <div
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              color: '#7c3aed',
                              marginTop: 4,
                            }}
                          >
                            ~{tabHealth?.estimatedMemorySavedMb ?? 0} MB
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          paddingTop: 12,
                          borderTop: '1px solid #e2e8f0',
                        }}
                      >
                        <Tooltip title="休眠闲置标签：标签标题仍保留在标签栏，但页面内存被释放，点击时重新载入">
                          <Button
                            type="primary"
                            icon={<RestOutlined />}
                            loading={discardLoading}
                            onClick={handleDiscardTabs}
                            style={{ background: '#4f46e5', fontWeight: 600 }}
                          >
                            一键休眠所有闲置标签
                          </Button>
                        </Tooltip>

                        <Tooltip title="将闲置标签暂存为一个新快照，并从标签栏中安全关闭，彻底还给您清爽的窗口">
                          <Button
                            icon={<CameraOutlined />}
                            loading={archiveLoading}
                            onClick={handleArchiveTabs}
                            style={{ fontWeight: 500 }}
                          >
                            一键沉淀归档并安全关闭闲置标签
                          </Button>
                        </Tooltip>
                      </div>
                    </Card>
                  </div>
                ),
              },
              {
                key: 'ai',
                label: (
                  <span>
                    <ThunderboltOutlined />
                    端侧智能与资源管控 (AI)
                  </span>
                ),
                children: (
                  <div>
                    {/* 全局总开关与环境探测卡片 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                              🤖 Chrome Built-in AI 端侧模型引擎
                            </span>
                            {aiCapabilities.modelReady ? (
                              <Tag color="success">Gemini Nano 端侧模型就绪</Tag>
                            ) : aiCapabilities.supported ? (
                              <Tag color="warning">端侧模型准备中 ({aiCapabilities.status})</Tag>
                            ) : (
                              <Tag color="default">未检测到本地模型 (已优雅降级为启发式规则)</Tag>
                            )}
                          </div>
                          <Switch
                            checked={aiSettings.enabled}
                            onChange={(checked) => handleSaveAiSettings({ enabled: checked })}
                          />
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <Paragraph style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                        基于谷歌 Gemini Nano 本地模型，数据 100% 留存在浏览器本地沙箱，绝不上云、绝不出网，保障内网与敏感工单的绝对隐私安全。
                        若硬件未开启端侧 AI 或处于省电状态，系统将自动平滑降级为确定性规则。
                      </Paragraph>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 14,
                          padding: 16,
                          background: '#f8fafc',
                          borderRadius: 8,
                          border: '1px solid #e2e8f0',
                          opacity: aiSettings.enabled ? 1 : 0.6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              深层工单与文档胶囊智能浓缩 (Capsule Summarization)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              自动将内网复杂网址与工单浓缩为 4~8 字精炼任务标签（如 [继续: PROJ-1024 结算重构] ↗）
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.capsuleSummarize}
                            onChange={(checked) => handleSaveAiSettings({ capsuleSummarize: checked })}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              搜索框自然语言意图起跳 (Natural Language Jump)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              支持输入“昨天看的权限修改PR”直接定位深层历史与书签。内置 400ms 输入防抖保护。
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.naturalLanguageJump}
                            onChange={(checked) => handleSaveAiSettings({ naturalLanguageJump: checked })}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              跨域名任务语义聚类与智能命名 (Cross-Domain Auto-Grouping)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              将跨站点的同一任务页面（Jira工单、GitLab代码、本地开发端口）自动归并为统一工作流标签组
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.taskAutoGrouping}
                            onChange={(checked) => handleSaveAiSettings({ taskAutoGrouping: checked })}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              晨间工作现场智能简报 (Morning Standup Briefing)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              每日早晨在新标签页生成一行未完任务与待审 PR 概览，支持一键断点续传
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.morningBriefing}
                            onChange={(checked) => handleSaveAiSettings({ morningBriefing: checked })}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              书签空闲时智能语义打标 (Smart Bookmarks Tagging)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              在浏览器空闲时自动分析根目录书签并打标；涉及遍历扫描，默认保持关闭以节约算力
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.bookmarkSmartTagging}
                            onChange={(checked) => handleSaveAiSettings({ bookmarkSmartTagging: checked })}
                          />
                        </div>
                      </div>
                    </Card>

                    {/* 资源管控与性能治理防线卡片 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <SafetyCertificateOutlined style={{ color: '#10b981' }} />
                          <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                            🛡️ 端侧 AI 资源开销治理防线
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: '#e2e8f0',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              电池供电与省电感知 (Battery & Power Mode Awareness)
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              当检测到设备处于未连接电源且电池电量低于 25% 或省电模式时，自动挂起非关键后台 AI 推理，守护笔记本续航
                            </div>
                          </div>
                          <Switch
                            checked={aiSettings.pauseOnBattery}
                            onChange={(checked) => handleSaveAiSettings({ pauseOnBattery: checked })}
                          />
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingTop: 12,
                            borderTop: '1px solid #e2e8f0',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                              本地持久化 LRU 结果缓存
                            </div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>
                              当前已缓存 <Text strong>{aiCacheCount}</Text> 条本地推理结果（二次访问享受 0 算力、0 显存占用、0 延迟直出）
                            </div>
                          </div>
                          <Button size="small" onClick={handleClearAiCache}>
                            清空 AI 缓存
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                ),
              },
            ]}
          />

          {/* 底部重置操作 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <Popconfirm
              title="恢复默认设置？"
              description="将清除所有自定义网站规则和白名单域名，恢复至初始状态。"
              onConfirm={async () => {
                if (await save(DEFAULTS)) clearEditor();
              }}
              okText="确认恢复"
              cancelText="取消"
            >
              <Button danger disabled={disabled}>
                恢复默认
              </Button>
            </Popconfirm>

            <Text type="secondary" style={{ fontSize: 12 }}>
              YiTab 一签 · {APP_VERSION}
            </Text>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsPage />);
