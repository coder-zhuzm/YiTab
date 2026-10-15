import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Card,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { getSettings, setSettings, DEFAULTS } from '../../lib/settings';
import type { Settings } from '../../lib/settings';

function OptionsPage() {
  const [form] = Form.useForm<Settings>();
  const [whitelist, setWhitelist] = useState<string[]>(DEFAULTS.whitelist);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      form.setFieldsValue(s);
      setWhitelist(s.whitelist);
    });
  }, [form]);

  const save = async (patch: Partial<Settings>) => {
    const s = await setSettings(patch);
    setWhitelist(s.whitelist);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: '0 16px' }}>
      <Typography.Title level={3}>YiTab 一签 · 设置</Typography.Title>

      <Card title="重复判定粒度" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="matchMode" style={{ marginBottom: 0 }}>
            <Radio.Group
              onChange={(e) => save({ matchMode: e.target.value })}
              options={[
                { value: 'url', label: '完整 URL 一致才算重复（默认，更精确）' },
                { value: 'domain', label: '同域名即算重复（更激进，防堆标签）' },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card title="遇到重复标签时的处理方式" style={{ marginBottom: 16 }}>
        <Form form={form} layout="vertical">
          <Form.Item name="interceptMode" style={{ marginBottom: 0 }}>
            <Radio.Group
              onChange={(e) => save({ interceptMode: e.target.value })}
              options={[
                { value: 'auto', label: '静默切换：自动跳到已有标签，新开的关闭（默认）' },
                { value: 'ask', label: '页内确认：大按钮确认「切换 / 仍要新开」' },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>

      <Card
        title="域名白名单"
        extra={saved ? <Tag color="green">已保存</Tag> : null}
        style={{ marginBottom: 16 }}
      >
        <Typography.Paragraph type="secondary">
          白名单里的域名不做去重检测，例如 mail.google.com
        </Typography.Paragraph>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            id="yitab-whitelist-input"
            placeholder="输入域名，回车添加"
            onPressEnter={(e) => {
              const input = e.currentTarget;
              const v = input.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
              if (v && !whitelist.includes(v)) save({ whitelist: [...whitelist, v] });
              input.value = '';
            }}
          />
        </Space.Compact>
        <div style={{ marginTop: 12 }}>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={whitelist}
            open={false}
            suffixIcon={null}
            placeholder="暂无白名单域名"
            onChange={(vals) => save({ whitelist: vals })}
            options={whitelist.map((w) => ({ value: w, label: w }))}
          />
        </div>
      </Card>

      <Space>
        <Button id="yitab-reset" onClick={() => save(DEFAULTS)}>
          恢复默认
        </Button>
      </Space>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<OptionsPage />);