import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  DEFAULTS,
  getSettings,
  normalizeDomain,
  setSettings,
  type MatchMode,
  type Settings,
  type SiteRule,
} from '../../lib/settings';
import { MODE_LABELS } from '../../lib/match';

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

  useEffect(() => {
    getSettings()
      .then(update)
      .catch(() => setError('读取设置失败，请重新加载扩展。'))
      .finally(() => setLoading(false));
  }, []);

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
        <div style={{ maxWidth: 840, margin: '0 auto' }}>
          {/* 页面主标题与状态条 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 24,
              paddingBottom: 16,
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  boxShadow: '0 4px 10px rgba(79, 70, 229, 0.25)',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </div>
              <div>
                <Typography.Title level={3} style={{ margin: 0, fontSize: 20, color: '#0f172a' }}>
                  YiTab 一签 · 设置
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  智能标签页去重拦截与快捷调度配置
                </Typography.Text>
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
                        <Typography.Paragraph
                          type="secondary"
                          style={{
                            margin: '4px 0 8px 24px',
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: isChecked ? '#475569' : '#64748b',
                          }}
                        >
                          {descriptions[mode]}
                        </Typography.Paragraph>
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

            <div
              style={{
                marginTop: 16,
                padding: '10px 14px',
                background: '#f8fafc',
                borderRadius: 8,
                fontSize: 12,
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              升级保留旧的匹配与处理方式，不会自动切换你的设置。不同路径默认视为不同页面，不自动猜测内容身份。
            </div>
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
                {/* 选项 1: 静默切换 */}
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
                      settings.interceptMode === 'auto' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                    background: settings.interceptMode === 'auto' ? '#f5f3ff' : '#ffffff',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Radio value="auto" style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
                    静默切换：自动跳到已有标签，并关闭重复标签
                  </Radio>
                  <div style={{ marginLeft: 24, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
                    极速流体验。新标签一闪即逝，视线自动聚焦到已打开的标签页，适合追求高效率的极简用户。
                  </div>
                </div>

                {/* 选项 2: 页内确认 */}
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
                      settings.interceptMode === 'ask' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                    background: settings.interceptMode === 'ask' ? '#f5f3ff' : '#ffffff',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Radio value="ask" style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>
                    页内确认：选择「切换 / 仍要新开」
                  </Radio>
                  <div style={{ marginLeft: 24, fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>
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

          {/* 3. 网站例外规则 */}
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>网站例外规则</span>
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
            {/* 规则优先级阶梯指引 */}
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
              <span style={{ color: '#64748b', marginLeft: 4 }}>
                （精确域名规则优先于子域覆盖规则）
              </span>
            </div>

            {/* 已有规则列表 */}
            {settings.siteRules.length > 0 && (
              <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                        <Typography.Text strong style={{ fontSize: 14 }}>
                          {r.domain}
                        </Typography.Text>
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
                            await save({ siteRules: settings.siteRules.filter((_, n) => n !== i) })
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

            {/* 规则编辑 / 新增区块 */}
            <div
              style={{
                padding: '16px',
                background: '#f8fafc',
                borderRadius: 10,
                border: '1px dashed #cbd5e1',
              }}
            >
              <Typography.Title level={5} style={{ margin: '0 0 12px 0', fontSize: 14 }}>
                {editing === null ? '添加网站规则' : '编辑网站规则'}
              </Typography.Title>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Input
                  aria-label="规则域名"
                  placeholder="域名，例如 example.com（也可直接粘贴网页网址）"
                  value={domain}
                  disabled={disabled}
                  onChange={(e) => setDomain(e.target.value)}
                  style={{ borderRadius: 6 }}
                />
                <Space wrap size={12}>
                  <Select
                    aria-label="网站匹配模式"
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

                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {descriptions[ruleMode]}
                </Typography.Text>

                {ruleMode === 'smart' && (
                  <>
                    <Input
                      aria-label="忽略参数"
                      placeholder="额外忽略的参数名，例如 share, from（以逗号分隔，可留空）"
                      value={params}
                      disabled={disabled}
                      onChange={(e) => setParams(e.target.value)}
                      style={{ borderRadius: 6 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      仅智能模式生效。按参数名精确区分大小写；请勿忽略 id、v、q 等内容标识参数。
                    </Typography.Text>
                  </>
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

          {/* 4. 域名白名单（不检测） */}
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>
                  域名白名单（不检测）
                </span>
                <span style={{ fontSize: 12, color: '#64748b', fontWeight: 'normal' }}>
                  白名单内的网站永不拦截
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
            <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
              适用于邮箱、协同文档、即时通讯等需要多开窗口的站点。精确域名匹配，www 与裸域名等价。
            </Typography.Paragraph>

            <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
              <Input
                aria-label="白名单域名"
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  {w}
                </Tag>
              ))}
              {settings.whitelist.length === 0 && (
                <span style={{ fontSize: 13, color: '#94a3b8' }}>暂无白名单域名</span>
              )}
            </div>
          </Card>

          {/* 底部重置操作 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
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

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              YiTab 一签 · v0.3.0
            </Typography.Text>
          </div>
        </div>
      </div>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsPage />);
