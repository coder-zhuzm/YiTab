import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
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
  Tag,
  theme,
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
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UploadOutlined,
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
  GetTabHealthResponse,
  ScanBookmarksResponse,
} from '../../lib/messaging';
import type { BookmarkScanReport } from '../../lib/bookmarks';
import type { TabHealthReport } from '../../lib/tab-health';
import {
  DEFAULT_NEWTAB_SETTINGS,
  type IconMode,
  type NewTabSettings,
  type ProfileMode,
} from '../../lib/newtab-types';
import { getNewTabSettings, saveNewTabSettings } from '../../lib/pinned';
import { SEARCH_ENGINES } from '../../lib/network-utils';
import { APP_VERSION } from '../../lib/version';
import { useThemeTokens } from '../../lib/theme-tokens';
import { useThemeMode, applyThemeToDocument } from '../../lib/theme-mode';
import { ThemeModeDropdown } from '../../components/ThemeToggle';
import { TabHealthPanel } from '../../components/TabHealthPanel';
import { BookmarkHealthPanel } from '../../components/BookmarkHealthPanel';
import '../../styles/precision-ui.css';
import {
  exportAllConfig,
  importAllConfig,
  parseConfigBackup,
} from '../../lib/config-backup';
import {
  formatShortcutParts,
  getDefaultPaletteShortcut,
  getPaletteShortcut,
  getShortcutPresets,
  isMacPlatform,
  parseKeyboardEventToShortcut,
  savePaletteShortcut,
  type PaletteShortcutConfig,
} from '../../lib/palette-shortcut';

const { Text, Paragraph, Title } = Typography;

const modes: MatchMode[] = ['smart', 'url', 'path', 'domain'];

const modeBadges: Record<MatchMode, { text: string; tone: 'accent' | 'neutral' | 'warn' | 'danger' }> = {
  smart: { text: '推荐 · 新安装默认', tone: 'accent' },
  url: { text: '严格完整匹配', tone: 'neutral' },
  path: { text: '宽泛 · 忽略参数', tone: 'warn' },
  domain: { text: '最宽泛 · 限制多开', tone: 'danger' },
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
  const { isDark, mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const { tk } = useThemeTokens(isDark);
  const [messageApi, messageContextHolder] = message.useMessage();

  // 让原生控件与页面底色跟随主题，避免首帧闪白
  useEffect(() => applyThemeToDocument(isDark, tk.canvas), [isDark, tk.canvas]);
  const [activeTabKey, setActiveTabKey] = useState('newtab');
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

  // 阶段四：标签内存与休眠治理
  const [tabHealth, setTabHealth] = useState<TabHealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // 阶段五：端侧 AI 智能引擎与资源管控
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiCapabilities, setAiCapabilities] = useState<AiCapabilities>({
    supported: false,
    modelReady: false,
    status: 'no',
  });
  const [aiCacheCount, setAiCacheCount] = useState(0);

  // 工作台（新标签页）偏好
  const [newTabSettings, setNewTabSettingsState] =
    useState<NewTabSettings>(DEFAULT_NEWTAB_SETTINGS);
  // 命令面板自定义快捷键
  const [paletteShortcut, setPaletteShortcutState] = useState<PaletteShortcutConfig>(() =>
    getDefaultPaletteShortcut(),
  );
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [chromeCommandShortcut, setChromeCommandShortcut] = useState<string>('');
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importModeRef = useRef<'merge' | 'overwrite'>('merge');

  const handleExportConfig = async () => {
    try {
      const payload = await exportAllConfig();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateTag = new Date().toISOString().slice(0, 10);
      a.download = `yitab-config-${dateTag}.json`;
      a.click();
      URL.revokeObjectURL(url);
      messageApi.success('配置备份已导出');
    } catch {
      messageApi.error('导出配置失败');
    }
  };

  const triggerImportConfig = (mode: 'merge' | 'overwrite') => {
    importModeRef.current = mode;
    if (importInputRef.current) {
      importInputRef.current.value = '';
      importInputRef.current.click();
    }
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseConfigBackup(text);
      if (!parsed.ok) {
        messageApi.error(parsed.error);
        return;
      }
      await importAllConfig(parsed.data, importModeRef.current);
      const [nextSettings, nextNewTab, nextAi] = await Promise.all([
        getSettings(),
        getNewTabSettings(),
        getAiSettings(),
      ]);
      update(nextSettings);
      setNewTabSettingsState(nextNewTab);
      setAiSettingsState(nextAi);
      messageApi.success(
        importModeRef.current === 'overwrite'
          ? '配置已覆盖导入并生效'
          : '配置已合并导入（保留原有规则与快捷方式）',
      );
    } catch {
      messageApi.error('读取或导入配置文件失败');
    }
  };

  useEffect(() => {
    getSettings()
      .then(update)
      .catch(() => setError('读取设置失败，请重新加载扩展。'))
      .finally(() => setLoading(false));

    fetchTabHealth();
    getAiSettings().then(setAiSettingsState);
    checkAiCapabilities().then(setAiCapabilities);
    getAiCacheStats().then((s) => setAiCacheCount(s.count));
    getNewTabSettings().then(setNewTabSettingsState);
    getPaletteShortcut().then(setPaletteShortcutState);
    if (typeof chrome !== 'undefined' && chrome.commands?.getAll) {
      chrome.commands
        .getAll()
        .then((cmds) => {
          const target = cmds.find((c) => c.name === 'toggle-palette');
          setChromeCommandShortcut(target?.shortcut || '');
        })
        .catch(() => {});
    }
  }, []);

  const handleSavePaletteShortcut = async (nextCfg: PaletteShortcutConfig, tip?: string) => {
    const savedCfg = await savePaletteShortcut(nextCfg);
    setPaletteShortcutState(savedCfg);
    if (tip) {
      messageApi.success(tip);
    }
  };

  useEffect(() => {
    if (!recordingShortcut) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingShortcut(false);
        return;
      }
      const parsed = parseKeyboardEventToShortcut(e);
      if (!parsed) {
        if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
          messageApi.warning('请至少搭配一个修饰键（⌘ / Ctrl / Alt）');
        }
        return;
      }
      setRecordingShortcut(false);
      const label = formatShortcutParts(parsed).join(' + ');
      void handleSavePaletteShortcut(
        { ...parsed, enabled: true },
        `已设置命令面板快捷键为 ${label}，所有网页立即生效`,
      );
    };
    const onBlur = () => setRecordingShortcut(false);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [recordingShortcut]);

  const handleOpenChromeShortcuts = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => {
        messageApi.info('请在地址栏打开 chrome://extensions/shortcuts 修改全局快捷键');
      });
    }
  };

  const handleSaveNewTabSettings = async (patch: Partial<NewTabSettings>) => {
    const next = await saveNewTabSettings(patch);
    setNewTabSettingsState(next);
    messageApi.success('工作台配置已保存');
  };

  const handleSaveAiSettings = async (patch: Partial<AiSettings>) => {
    const next = await saveAiSettings(patch);
    setAiSettingsState(next);
    messageApi.success('端侧 AI 配置已保存');
  };

  const handleClearAiCache = async () => {
    await clearAiCache();
    setAiCacheCount(0);
    messageApi.success('已清空本地端侧 AI 推理缓存');
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
        messageApi.error(res.error);
      }
    } catch (e) {
      console.warn('Scan bookmarks failed:', e);
    } finally {
      setBookmarkScanning(false);
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
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: tk.accent,
          borderRadius: 8,
          fontFamily: 'var(--font-sans)',
          colorBgContainer: tk.surface,
          colorBgElevated: tk.surface,
          colorBorderSecondary: tk.hairline,
        },
      }}
    >
      {messageContextHolder}
      <div style={{ minHeight: '100vh', background: tk.canvas, padding: '32px 24px 64px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {/* 页面主标题与状态条 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 22,
              paddingBottom: 16,
              borderBottom: `1px solid ${tk.hairline}`,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="yt-brand-pill">
                  <span className="yt-brand-dot" />
                  <span>YiTab 一签</span>
                </span>
                <Title level={3} style={{ margin: 0, fontSize: 19, color: tk.ink, letterSpacing: '-0.02em' }}>
                  控制中心
                </Title>
                <span className="yt-ver-pill">{APP_VERSION}</span>
              </div>
              <Text type="secondary" style={{ fontSize: 12.5, color: tk.ink3 }}>
                智能标签页治理、书签生态维护与资源优化套件
              </Text>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThemeModeDropdown mode={themeMode} onChange={setThemeMode} ink3={tk.ink3} />
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: saved ? tk.successSoft : saving ? tk.warnSoft : tk.surfaceMuted,
                  color: saved ? tk.successInk : saving ? tk.warnInk : tk.ink2,
                  border: `1px solid ${
                    saved ? tk.successBorder : saving ? tk.warnBorder : tk.hairline
                  }`,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: saved ? tk.successInk : saving ? tk.warnInk : tk.ink3,
                    display: 'inline-block',
                  }}
                />
                {loading ? '读取中…' : saving ? '保存中…' : saved ? '已保存' : '更改自动保存'}
              </span>
            </div>
          </div>

          {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20 }} />}

          {/* 左侧导航轨 + 右侧面板 */}
          <div className="yt-opt-layout">
            <nav aria-label="控制中心分类" className="yt-opt-sidebar" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTabKey === 'newtab'}
                className="yt-opt-nav-item"
                onClick={() => setActiveTabKey('newtab')}
              >
                <span className="yt-opt-nav-left">
                  <AppstoreOutlined style={{ fontSize: 14 }} />
                  <span>工作台</span>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTabKey === 'rules'}
                className="yt-opt-nav-item"
                onClick={() => setActiveTabKey('rules')}
              >
                <span className="yt-opt-nav-left">
                  <SettingOutlined style={{ fontSize: 14 }} />
                  <span>去重拦截策略</span>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTabKey === 'bookmarks'}
                className="yt-opt-nav-item"
                onClick={() => setActiveTabKey('bookmarks')}
              >
                <span className="yt-opt-nav-left">
                  <BookOutlined style={{ fontSize: 14 }} />
                  <span>书签健康与生态治理</span>
                </span>
                {bookmarkReport && bookmarkReport.redundantCount > 0 && (
                  <span className="yt-count-badge">{bookmarkReport.redundantCount}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTabKey === 'tabs'}
                className="yt-opt-nav-item"
                onClick={() => setActiveTabKey('tabs')}
              >
                <span className="yt-opt-nav-left">
                  <RestOutlined style={{ fontSize: 14 }} />
                  <span>闲置休眠与内存治理</span>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTabKey === 'ai'}
                className="yt-opt-nav-item"
                onClick={() => setActiveTabKey('ai')}
              >
                <span className="yt-opt-nav-left">
                  <ThunderboltOutlined style={{ fontSize: 14 }} />
                  <span>端侧智能与资源管控</span>
                </span>
              </button>
            </nav>

            <div style={{ minWidth: 0 }}>
              {activeTabKey === 'newtab' && (
                  <div>
                    {/* 图标来源 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15.5, fontWeight: 600, color: tk.ink }}>
                            快捷方式图标来源
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            决定工作台上每个快捷方式显示什么图标
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <Radio.Group
                        value={newTabSettings.iconMode}
                        onChange={(e) =>
                          void handleSaveNewTabSettings({ iconMode: e.target.value as IconMode })
                        }
                        style={{ width: '100%' }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                            gap: 12,
                          }}
                        >
                          {(
                            [
                              {
                                value: 'browser' as IconMode,
                                title: '浏览器图标（推荐）',
                                desc: '读取 Chrome 本地图标库，零网络请求。未访问过的站点会显示浏览器默认占位图。',
                              },
                              {
                                value: 'initials' as IconMode,
                                title: '首字母图标',
                                desc: '按名称本地生成渐变图标，任何站点都有稳定一致的观感。',
                              },
                            ] as const
                          ).map((opt) => {
                            const isChecked = newTabSettings.iconMode === opt.value;
                            return (
                              <div
                                key={opt.value}
                                className={isChecked ? 'yt-choice-tile is-selected' : 'yt-choice-tile'}
                                onClick={() => {
                                  if (!isChecked) {
                                    void handleSaveNewTabSettings({ iconMode: opt.value });
                                  }
                                }}
                              >
                                <Radio value={opt.value} style={{ fontWeight: 600 }}>
                                  {opt.title}
                                </Radio>
                                <div style={{ marginTop: 6, fontSize: 12, color: tk.ink3 }}>
                                  {opt.desc}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </Radio.Group>
                    </Card>

                    {/* 书签区与打开方式 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            书签区与打开方式
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                            打开工作台时展开书签
                          </div>
                          <div style={{ fontSize: 12, color: tk.ink3, marginTop: 4 }}>
                            关闭后默认收起，只保留标题与筛选框。工作台上的「收起 / 展开」按钮会同步改这里。
                          </div>
                        </div>
                        <Switch
                          checked={newTabSettings.bookmarksExpanded}
                          onChange={(checked) =>
                            void handleSaveNewTabSettings({ bookmarksExpanded: checked })
                          }
                        />
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          marginTop: 16,
                          paddingTop: 16,
                          borderTop: `1px solid ${tk.hairline}`,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                            点击快捷方式或书签时在新标签页打开
                          </div>
                          <div style={{ fontSize: 12, color: tk.ink3, marginTop: 4 }}>
                            开启后，点击工作台上的快捷方式、书签或执行搜索时默认在新标签页打开，保留工作台本身。
                          </div>
                        </div>
                        <Switch
                          checked={newTabSettings.openInNewTab}
                          onChange={(checked) =>
                            void handleSaveNewTabSettings({ openInNewTab: checked })
                          }
                        />
                      </div>
                    </Card>

                    {/* 默认模式与搜索引擎 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            默认模式与搜索引擎
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                          gap: 16,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                            默认模式
                          </div>
                          <Select
                            style={{ width: '100%' }}
                            value={newTabSettings.profile}
                            onChange={(v) =>
                              void handleSaveNewTabSettings({ profile: v as ProfileMode })
                            }
                            options={[
                              { value: 'work', label: '办公内网' },
                              { value: 'home', label: '个人模式' },
                            ]}
                          />
                          <div style={{ fontSize: 12, color: tk.ink3, marginTop: 6 }}>
                            个人模式会隐藏内网地址，并优先使用个人模式的搜索引擎。
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                            默认搜索引擎
                          </div>
                          <Select
                            style={{ width: '100%' }}
                            value={newTabSettings.defaultEngineId}
                            onChange={(v) => void handleSaveNewTabSettings({ defaultEngineId: v })}
                            options={SEARCH_ENGINES.map((e) => ({
                              value: e.id,
                              label: `${e.name}（前缀 ${e.prefix}）`,
                            }))}
                          />
                          <div style={{ fontSize: 12, color: tk.ink3, marginTop: 6 }}>
                            两种模式下未单独记忆时的兜底搜索引擎。
                          </div>
                        </div>
                      </div>
                    </Card>

                    {/* 命令面板快捷键设置 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            命令面板快捷键
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            自定义网页内一键呼出 YiTab 命令与标签搜索面板的组合键
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* 行 1：页内自定义快捷键开关 + 录制器 */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 500, color: tk.ink }}>
                              页内自定义快捷键
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3, marginTop: 2 }}>
                              开启后在任意网页中按下下方组合键即可呼出，修改后所有已开网页立即同步生效。
                            </div>
                          </div>
                          <Space size={10} align="center">
                            <button
                              type="button"
                              onClick={() => setRecordingShortcut((v) => !v)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                minWidth: 148,
                                height: 34,
                                padding: '0 12px',
                                borderRadius: 8,
                                border: `1.5px solid ${recordingShortcut ? tk.accent : tk.hairlineStrong}`,
                                background: recordingShortcut ? tk.accentSoft : tk.canvas,
                                color: recordingShortcut ? tk.accent : tk.ink,
                                cursor: 'pointer',
                                fontSize: 12.5,
                                fontWeight: 500,
                                justifyContent: 'center',
                                transition: 'border-color 140ms ease-out, background-color 140ms ease-out',
                              }}
                              title="点击后直接按下你想要的快捷键组合"
                            >
                              {recordingShortcut ? (
                                <span>请按下组合键… (Esc 取消)</span>
                              ) : (
                                <>
                                  {formatShortcutParts(paletteShortcut).map((part, idx) => (
                                    <kbd
                                      key={idx}
                                      className="yt-mono"
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        minWidth: 22,
                                        height: 22,
                                        padding: '0 6px',
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        borderRadius: 5,
                                        background: tk.surface,
                                        color: paletteShortcut.enabled ? tk.ink : tk.ink3,
                                        border: `1px solid ${tk.hairlineStrong}`,
                                        boxShadow: `0 1px 0 ${tk.hairlineStrong}`,
                                      }}
                                    >
                                      {part}
                                    </kbd>
                                  ))}
                                </>
                              )}
                            </button>
                            <Switch
                              checked={paletteShortcut.enabled}
                              onChange={(checked) =>
                                void handleSavePaletteShortcut(
                                  { ...paletteShortcut, enabled: checked },
                                  checked ? '已开启页内自定义快捷键' : '已关闭页内自定义快捷键',
                                )
                              }
                            />
                          </Space>
                        </div>

                        {/* 常用预设组合一键应用 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: tk.ink3 }}>常用预设：</span>
                          {getShortcutPresets().map((preset) => {
                            const parts = formatShortcutParts(preset);
                            const isCurrent =
                              paletteShortcut.enabled &&
                              paletteShortcut.code === preset.code &&
                              paletteShortcut.meta === preset.meta &&
                              paletteShortcut.ctrl === preset.ctrl &&
                              paletteShortcut.alt === preset.alt &&
                              paletteShortcut.shift === preset.shift;
                            return (
                              <Button
                                key={parts.join('-')}
                                size="small"
                                type={isCurrent ? 'primary' : 'default'}
                                ghost={isCurrent}
                                onClick={() => {
                                  setRecordingShortcut(false);
                                  void handleSavePaletteShortcut(
                                    { ...preset, enabled: true },
                                    `已切换为 ${parts.join(' + ')}`,
                                  );
                                }}
                              >
                                {parts.join(isMacPlatform() ? ' ' : ' + ')}
                              </Button>
                            );
                          })}
                        </div>

                        {/* 分割线 + Chrome 全局快捷键状态与直达入口 */}
                        <div
                          style={{
                            borderTop: `1px solid ${tk.hairline}`,
                            paddingTop: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 12,
                          }}
                        >
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 500, color: tk.ink }}>
                              Chrome 全局快捷键
                              <span
                                className="yt-mono"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  marginLeft: 8,
                                  padding: '1px 7px',
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  borderRadius: 5,
                                  background: tk.surfaceMuted,
                                  color: tk.ink,
                                  border: `1px solid ${tk.hairlineStrong}`,
                                }}
                              >
                                {chromeCommandShortcut || (isMacPlatform() ? '⌘⇧K' : 'Alt+Shift+K')}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3, marginTop: 2 }}>
                              由浏览器原生接管，在新标签页或 chrome:// 受限页也可触发（需在 Chrome 扩展快捷键页修改）。
                            </div>
                          </div>
                          <Button size="small" onClick={handleOpenChromeShortcuts}>
                            前往 Chrome 快捷键设置
                          </Button>
                        </div>
                      </div>
                    </Card>

                    {/* 配置备份与跨设备迁移 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            配置备份与跨设备迁移
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            一键导出或导入去重规则、白名单、工作台快捷方式与偏好设置
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <input
                        ref={importInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={(e) => void handleImportFileChange(e)}
                      />
                      <Space wrap size={10}>
                        <Button icon={<DownloadOutlined />} onClick={() => void handleExportConfig()}>
                          导出全部配置 (JSON)
                        </Button>
                        <Button
                          icon={<UploadOutlined />}
                          onClick={() => triggerImportConfig('merge')}
                        >
                          合并导入配置
                        </Button>
                        <Popconfirm
                          title="确认以导入文件覆盖当前配置？"
                          description="将替换现有的去重规则、白名单、快捷方式与主题偏好，建议先导出备份。"
                          onConfirm={() => triggerImportConfig('overwrite')}
                          okText="选择文件并覆盖"
                          cancelText="取消"
                        >
                          <Button danger>覆盖导入配置</Button>
                        </Popconfirm>
                      </Space>
                    </Card>
                  </div>
              )}

              {activeTabKey === 'rules' && (
                  <div>
                    {/* 1. 重复判定粒度（全局默认） */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15.5, fontWeight: 600, color: tk.ink }}>
                            重复判定粒度（全局默认）
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            决定打开新标签时以什么标准比对已有标签
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        boxShadow: tk.shadowCard,
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
                            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                            gap: 12,
                          }}
                        >
                          {modes.map((mode) => {
                            const isChecked = settings.matchMode === mode;
                            const badge = modeBadges[mode];
                            const badgeBg =
                              badge.tone === 'accent'
                                ? tk.accentSoft
                                : badge.tone === 'warn'
                                  ? tk.warnSoft
                                  : badge.tone === 'danger'
                                    ? tk.dangerSoft
                                    : tk.surfaceMuted;
                            const badgeFg =
                              badge.tone === 'accent'
                                ? tk.accentInk
                                : badge.tone === 'warn'
                                  ? tk.warnInk
                                  : badge.tone === 'danger'
                                    ? tk.dangerInk
                                    : tk.ink2;
                            const badgeBd =
                              badge.tone === 'accent'
                                ? tk.accentBorder
                                : badge.tone === 'warn'
                                  ? tk.warnBorder
                                  : badge.tone === 'danger'
                                    ? tk.dangerBorder
                                    : tk.hairlineStrong;
                            return (
                              <div
                                key={mode}
                                className={isChecked ? 'yt-choice-tile is-selected' : 'yt-choice-tile'}
                                onClick={() => {
                                  if (!disabled && settings.matchMode !== mode) {
                                    void save({ matchMode: mode });
                                  }
                                }}
                                style={{
                                  cursor: disabled ? 'not-allowed' : 'pointer',
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
                                        fontWeight: 500,
                                        color: badgeFg,
                                        background: badgeBg,
                                        padding: '2px 7px',
                                        borderRadius: 4,
                                        border: `1px solid ${badgeBd}`,
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
                                      color: isChecked ? tk.ink2 : tk.ink3,
                                    }}
                                  >
                                    {descriptions[mode]}
                                  </Paragraph>
                                </div>

                                <div
                                  style={{
                                    marginLeft: 24,
                                    padding: '6px 10px',
                                    background: isChecked ? tk.surface : tk.surfaceHover,
                                    borderRadius: 6,
                                    fontSize: 12,
                                    color: tk.ink2,
                                    fontFamily:
                                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                                    border: `1px solid ${tk.hairline}`,
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: tk.ink2 }}>示例：</span>
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
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            遇到匹配标签时的处理方式
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            发现相同网页后的交互行为
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
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
                            className={
                              settings.interceptMode === 'auto'
                                ? 'yt-choice-tile is-selected'
                                : 'yt-choice-tile'
                            }
                            onClick={() => {
                              if (!disabled && settings.interceptMode !== 'auto') {
                                void save({ interceptMode: 'auto' });
                              }
                            }}
                            style={{
                              padding: '16px',
                              cursor: disabled ? 'not-allowed' : 'pointer',
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
                                color: tk.ink3,
                                lineHeight: 1.5,
                              }}
                            >
                              极速流体验。新标签一闪即逝，视线自动聚焦到已打开的标签页，适合追求高效率的极简用户。
                            </div>
                          </div>

                          <div
                            className={
                              settings.interceptMode === 'ask'
                                ? 'yt-choice-tile is-selected'
                                : 'yt-choice-tile'
                            }
                            onClick={() => {
                              if (!disabled && settings.interceptMode !== 'ask') {
                                void save({ interceptMode: 'ask' });
                              }
                            }}
                            style={{
                              padding: '16px',
                              cursor: disabled ? 'not-allowed' : 'pointer',
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
                                color: tk.ink3,
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
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            拦截触发场景与刷新控制
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            决定在已有标签页刷新或重复加载时是否触发拦截
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div
                        style={{
                          padding: '16px',
                          borderRadius: 10,
                          border: `1px solid ${tk.hairline}`,
                          background: settings.ignoreReload !== false ? tk.surfaceHover : tk.surface,
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 16,
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, fontSize: 15, color: tk.ink }}>
                              刷新页面时忽略拦截（推荐 · 仅在新开时拦截）
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                padding: '1px 7px',
                                borderRadius: 4,
                                fontWeight: 500,
                                background: settings.ignoreReload !== false ? tk.successSoft : tk.surfaceMuted,
                                color: settings.ignoreReload !== false ? tk.successInk : tk.ink2,
                                border: `1px solid ${settings.ignoreReload !== false ? tk.successBorder : tk.hairline}`,
                              }}
                            >
                              {settings.ignoreReload !== false ? '默认开启' : '已关闭'}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: tk.ink3, lineHeight: 1.6 }}>
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
                          border: `1px solid ${tk.hairline}`,
                          background: tk.surface,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: tk.ink }}>
                            井号（Hash）路由是否参与判重
                          </span>
                          <span
                            style={{
                              fontSize: 11.5,
                              padding: '1px 7px',
                              borderRadius: 4,
                              fontWeight: 500,
                              background: settings.hashPolicy === 'ignore' ? tk.surfaceMuted : tk.successSoft,
                              color: settings.hashPolicy === 'ignore' ? tk.ink2 : tk.successInk,
                              border: `1px solid ${settings.hashPolicy === 'ignore' ? tk.hairline : tk.successBorder}`,
                            }}
                          >
                            {settings.hashPolicy === 'ignore' ? '忽略 Hash' : '默认保留'}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: tk.ink3, lineHeight: 1.6, marginBottom: 12 }}>
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
                          border: `1px solid ${tk.hairline}`,
                          background: tk.surface,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: tk.ink }}>
                            单页应用站内路由变化的处理方式
                          </span>
                          <span
                            style={{
                              fontSize: 11.5,
                              padding: '1px 7px',
                              borderRadius: 4,
                              fontWeight: 500,
                              background: settings.spaPolicy === 'auto' ? tk.warnSoft : tk.successSoft,
                              color: settings.spaPolicy === 'auto' ? tk.warnInk : tk.successInk,
                              border: `1px solid ${settings.spaPolicy === 'auto' ? tk.warnBorder : tk.successBorder}`,
                            }}
                          >
                            {settings.spaPolicy === 'auto' ? '静默切换' : settings.spaPolicy === 'off' ? '不处理' : '页内提示'}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: tk.ink3, lineHeight: 1.6, marginBottom: 12 }}>
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
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            网站例外规则
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            针对特定网站覆盖全局匹配模式
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          padding: '8px 12px',
                          background: tk.surfaceMuted,
                          borderRadius: 8,
                          fontSize: 12,
                          color: tk.ink2,
                          marginBottom: 16,
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>生效优先级：</span>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            background: tk.successSoft,
                            color: tk.successInk,
                            border: `1px solid ${tk.successBorder}`,
                          }}
                        >
                          1. 域名白名单（优先放行）
                        </span>
                        <span>→</span>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            background: tk.accentSoft,
                            color: tk.accentInk,
                            border: `1px solid ${tk.accentBorder}`,
                          }}
                        >
                          2. 最具体的网站规则
                        </span>
                        <span>→</span>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontSize: 11.5,
                            background: tk.surface,
                            color: tk.ink2,
                            border: `1px solid ${tk.hairlineStrong}`,
                          }}
                        >
                          3. 全局默认粒度
                        </span>
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
                                background: tk.surface,
                                borderRadius: 8,
                                border: `1px solid ${tk.hairline}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: 8,
                              }}
                            >
                              <div>
                                <Space wrap size={8}>
                                  <Text strong className="yt-mono" style={{ fontSize: 13.5 }}>
                                    {r.domain}
                                  </Text>
                                  <span
                                    style={{
                                      padding: '1px 7px',
                                      borderRadius: 4,
                                      fontSize: 11.5,
                                      fontWeight: 500,
                                      background: tk.accentSoft,
                                      color: tk.accentInk,
                                      border: `1px solid ${tk.accentBorder}`,
                                    }}
                                  >
                                    {MODE_LABELS[r.mode]}
                                  </span>
                                  <span
                                    style={{
                                      padding: '1px 7px',
                                      borderRadius: 4,
                                      fontSize: 11.5,
                                      background: tk.surfaceMuted,
                                      color: tk.ink2,
                                      border: `1px solid ${tk.hairlineStrong}`,
                                    }}
                                  >
                                    {r.includeSubdomains ? '含子域名' : '精确域名'}
                                  </span>
                                </Space>
                                {r.ignoredParams.length > 0 && (
                                  <div style={{ fontSize: 12, color: tk.ink3, marginTop: 4 }}>
                                    另忽略参数：
                                    <span style={{ fontFamily: 'monospace', color: tk.ink }}>
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
                          background: tk.canvas,
                          borderRadius: 10,
                          border: `1px dashed ${tk.hairlineStrong}`,
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
                          <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                            域名白名单（永不拦截）
                          </span>
                          <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                            适用于邮箱、协同文档、即时通讯等
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        borderColor: tk.hairline,
                        boxShadow: tk.shadowCard,
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
                            className="yt-mono"
                            onClose={(e) => {
                              e.preventDefault();
                              void save({ whitelist: settings.whitelist.filter((x) => x !== w) });
                            }}
                            style={{
                              padding: '4px 8px',
                              fontSize: 12.5,
                              borderRadius: 6,
                              background: tk.surfaceMuted,
                              border: `1px solid ${tk.hairlineStrong}`,
                            }}
                          >
                            {w}
                          </Tag>
                        ))}
                      </div>
                    </Card>

                    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
                      <Popconfirm
                        title="恢复去重默认设置？"
                        description="将清除所有自定义网站规则和白名单域名，恢复去重策略至初始状态。"
                        onConfirm={async () => {
                          if (await save(DEFAULTS)) clearEditor();
                        }}
                        okText="确认恢复"
                        cancelText="取消"
                      >
                        <Button danger disabled={disabled}>
                          恢复去重默认设置
                        </Button>
                      </Popconfirm>
                    </div>
                  </div>
              )}

              {activeTabKey === 'bookmarks' && (
                  <BookmarkHealthPanel
                    variant="full"
                    tk={tk}
                    report={bookmarkReport}
                    scanning={bookmarkScanning}
                    onScan={scanBookmarks}
                    messageApi={messageApi}
                  />
              )}

              {activeTabKey === 'tabs' && (
                  <TabHealthPanel
                    variant="full"
                    tk={tk}
                    tabHealth={tabHealth}
                    refreshLoading={healthLoading}
                    onRefresh={fetchTabHealth}
                    messageApi={messageApi}
                  />
              )}

              {activeTabKey === 'ai' && (
                  <div>
                    {/* 全局总开关与环境探测卡片 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <RobotOutlined style={{ color: tk.accentInk, fontSize: 16 }} />
                            <span style={{ fontSize: 15.5, fontWeight: 600, color: tk.ink }}>
                              Chrome Built-in AI 端侧模型引擎
                            </span>
                            {aiCapabilities.modelReady ? (
                              <span
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  padding: '1px 7px',
                                  borderRadius: 4,
                                  background: tk.successSoft,
                                  color: tk.successInk,
                                  border: `1px solid ${tk.successBorder}`,
                                }}
                              >
                                Gemini Nano 端侧模型就绪
                              </span>
                            ) : aiCapabilities.supported ? (
                              <span
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  padding: '1px 7px',
                                  borderRadius: 4,
                                  background: tk.warnSoft,
                                  color: tk.warnInk,
                                  border: `1px solid ${tk.warnBorder}`,
                                }}
                              >
                                端侧模型准备中 ({aiCapabilities.status})
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 500,
                                  padding: '1px 7px',
                                  borderRadius: 4,
                                  background: tk.surfaceMuted,
                                  color: tk.ink2,
                                  border: `1px solid ${tk.hairlineStrong}`,
                                }}
                              >
                                未检测到本地模型 (已优雅降级为启发式规则)
                              </span>
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
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <Paragraph style={{ color: tk.ink3, fontSize: 13, marginBottom: 16 }}>
                        基于谷歌 Gemini Nano 本地模型，数据 100% 留存在浏览器本地沙箱，绝不上云、绝不出网，保障内网与敏感工单的绝对隐私安全。
                        若硬件未开启端侧 AI 或处于省电状态，系统将自动平滑降级为确定性规则。
                      </Paragraph>

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 14,
                          padding: 16,
                          background: tk.canvas,
                          borderRadius: 8,
                          border: `1px solid ${tk.hairline}`,
                          opacity: aiSettings.enabled ? 1 : 0.6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              深层工单与文档胶囊智能浓缩 (Capsule Summarization)
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
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
                            <div style={{ fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              搜索框自然语言意图起跳 (Natural Language Jump)
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
                              支持输入“昨天看的权限修改PR”直接定位深层历史与书签。内置 400ms 输入防抖保护。
                            </div>
                          </div>
                          <Switch
                            disabled={!aiSettings.enabled}
                            checked={aiSettings.naturalLanguageJump}
                            onChange={(checked) => handleSaveAiSettings({ naturalLanguageJump: checked })}
                          />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              <span>跨域名任务语义聚类与智能命名 (Cross-Domain Auto-Grouping)</span>
                              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: tk.surfaceMuted, color: tk.ink2, border: `1px solid ${tk.hairline}` }}>规划中</span>
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
                              将跨站点的同一任务页面（Jira工单、GitLab代码、本地开发端口）自动归并为统一工作流标签组
                            </div>
                          </div>
                          <Switch disabled checked={false} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              <span>晨间工作现场智能简报 (Morning Standup Briefing)</span>
                              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: tk.surfaceMuted, color: tk.ink2, border: `1px solid ${tk.hairline}` }}>规划中</span>
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
                              每日早晨在新标签页生成一行未完任务与待审 PR 概览，支持一键断点续传
                            </div>
                          </div>
                          <Switch disabled checked={false} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65 }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              <span>书签空闲时智能语义打标 (Smart Bookmarks Tagging)</span>
                              <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, background: tk.surfaceMuted, color: tk.ink2, border: `1px solid ${tk.hairline}` }}>规划中</span>
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
                              在浏览器空闲时自动分析根目录书签并打标；涉及遍历扫描，默认保持关闭以节约算力
                            </div>
                          </div>
                          <Switch disabled checked={false} />
                        </div>
                      </div>
                    </Card>

                    {/* 资源管控与性能治理防线卡片 */}
                    <Card
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <SafetyCertificateOutlined style={{ color: tk.successInk }} />
                          <span style={{ fontSize: 15.5, fontWeight: 600, color: tk.ink }}>
                            端侧 AI 资源开销治理防线
                          </span>
                        </div>
                      }
                      style={{
                        marginBottom: 20,
                        borderRadius: 12,
                        boxShadow: tk.shadowCard,
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              电池供电与省电感知 (Battery & Power Mode Awareness)
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
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
                            borderTop: `1px solid ${tk.hairline}`,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: tk.ink }}>
                              本地持久化 LRU 结果缓存
                            </div>
                            <div style={{ fontSize: 12, color: tk.ink3 }}>
                              当前已缓存 <Text strong className="yt-tnum">{aiCacheCount}</Text> 条本地推理结果（二次访问享受 0 算力、0 显存占用、0 延迟直出）
                            </div>
                          </div>
                          <Button size="small" onClick={handleClearAiCache}>
                            清空 AI 缓存
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
              )}
            </div>
          </div>

          {/* 底部版本栏 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingTop: 14,
              marginTop: 20,
              borderTop: `1px solid ${tk.hairline}`,
            }}
          >
            <Text type="secondary" className="yt-tnum" style={{ fontSize: 12 }}>
              YiTab 一签 · {APP_VERSION}
            </Text>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsPage />);
