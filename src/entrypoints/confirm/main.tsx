import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Avatar, Button, Card, Space, Typography } from 'antd';
import { sendToBackground } from '@/lib/messaging';
import type { FindDuplicatesResponse } from '@/lib/messaging';
import type { TabInfo } from '@/lib/match';

const root = document.getElementById('root')!;
createRoot(root).render(<ConfirmPage />);

function ConfirmPage() {
  const [targetUrl] = useState(() => {
    const u = new URLSearchParams(location.search).get('u');
    return u ?? '';
  });
  const [dups, setDups] = useState<TabInfo[]>([]);

  useEffect(() => {
    if (!targetUrl) return;
    sendToBackground<FindDuplicatesResponse>({ type: 'findDuplicates', url: targetUrl }).then(
      (r) => setDups(r.tabs),
    );
  }, [targetUrl]);

  const openAnyway = () => {
    sendToBackground({ type: 'confirmOpen', url: targetUrl }).then(() => window.close());
  };

  return (
    <div style={{ maxWidth: 560, margin: '80px auto', padding: '0 16px' }}>
      <Typography.Title level={2}>这个页面已经打开过了</Typography.Title>
      <Typography.Paragraph type="secondary" copyable>
        {targetUrl}
      </Typography.Paragraph>

      {dups.map((t) => (
        <Card
          key={t.id}
          hoverable
          onClick={() => switchTo(t)}
          style={{ marginBottom: 12 }}
          styles={{ body: { display: 'flex', alignItems: 'center', gap: 12, padding: 16 } }}
        >
          {t.favicon ? (
            <Avatar shape="square" size={40} src={t.favicon} />
          ) : (
            <Avatar shape="square" size={40}>{t.title[0]}</Avatar>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <Typography.Text strong ellipsis style={{ maxWidth: '100%' }}>
              {t.title}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" ellipsis style={{ maxWidth: '100%' }}>
              {t.url}
            </Typography.Text>
          </div>
        </Card>
      ))}

      <Space style={{ marginTop: 24 }}>
        <Button
          type="primary"
          size="large"
          disabled={dups.length === 0}
          onClick={() => switchTo(dups[0])}
        >
          切换到已有标签（Enter）
        </Button>
        <Button size="large" onClick={openAnyway}>
          仍要新开（Esc）↗
        </Button>
      </Space>
    </div>
  );

  async function switchTo(tab: TabInfo) {
    if (!tab) return;
    await sendToBackground({
      type: 'switchTab',
      tabId: tab.id,
      windowId: tab.windowId,
      closeSelf: true,
    });
    window.close();
  }
}