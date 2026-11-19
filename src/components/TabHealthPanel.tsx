import { useState } from 'react';
import { Button, Card, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import { CameraOutlined, ReloadOutlined, RestOutlined } from '@ant-design/icons';
import {
  sendToBackground,
  type ArchiveInactiveTabsResponse,
  type DiscardTabsResponse,
} from '@/lib/messaging';
import type { TabHealthReport } from '@/lib/tab-health';
import type { ThemeTokens } from '@/lib/theme-tokens';

const { Text, Paragraph } = Typography;

export interface TabHealthPanelProps {
  variant: 'compact' | 'full';
  tk: ThemeTokens;
  tabHealth: TabHealthReport | null;
  refreshLoading?: boolean;
  onRefresh: () => void;
  messageApi: MessageInstance;
}

export function TabHealthPanel({
  variant,
  tk,
  tabHealth,
  refreshLoading = false,
  onRefresh,
  messageApi,
}: TabHealthPanelProps) {
  const [discardLoading, setDiscardLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const handleDiscard = async () => {
    setDiscardLoading(true);
    try {
      const res = await sendToBackground<DiscardTabsResponse>({ type: 'discardTabs' });
      if (res.ok && res.discardedCount > 0) {
        messageApi.success(
          `已休眠 ${res.discardedCount} 个闲置标签，估算释放约 ${res.freedMemoryMb}MB 内存`,
        );
      } else {
        messageApi.info('当前没有符合条件的闲置标签（播放中、固定或活动标签受保护）');
      }
      onRefresh();
    } catch {
      messageApi.error('休眠标签操作失败');
    } finally {
      setDiscardLoading(false);
    }
  };

  const handleArchive = async () => {
    setArchiveLoading(true);
    try {
      const res = await sendToBackground<ArchiveInactiveTabsResponse>({
        type: 'archiveInactiveTabs',
      });
      if (res.ok && res.archivedCount > 0) {
        messageApi.success(
          `已归档 ${res.archivedCount} 个闲置标签并关闭，快照：「${res.snapshotName}」`,
        );
      } else {
        messageApi.info('当前没有需要沉淀归档的闲置标签');
      }
      onRefresh();
    } catch {
      messageApi.error('沉淀归档操作失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  const eligibleCount = tabHealth?.eligibleDiscardCount ?? 0;

  if (variant === 'compact') {
    return (
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
          <span>
            已休眠: <strong style={{ color: tk.ink }}>{tabHealth?.discardedCount ?? 0}</strong>
          </span>
          <span>
            发声/保护:{' '}
            <strong style={{ color: tk.ink }}>
              {(tabHealth?.audibleCount ?? 0) + (tabHealth?.pinnedCount ?? 0)}
            </strong>
          </span>
          <span>
            可休眠: <strong style={{ color: tk.accentInk }}>{eligibleCount}</strong>
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip title="调用 Chrome 原生 discard 接口，释放内存，标签仍保留在标签栏">
            <Button
              block
              icon={<RestOutlined />}
              loading={discardLoading}
              onClick={handleDiscard}
              style={{ height: 34, fontWeight: 500 }}
            >
              一键休眠闲置
            </Button>
          </Tooltip>
          <Popconfirm
            title="确认沉淀归档并关闭闲置标签？"
            description={`将保存快照后关闭当前窗口的 ${eligibleCount} 个闲置标签（播放中、固定和活动标签受保护）。`}
            onConfirm={handleArchive}
            okText="归档并关闭"
            cancelText="取消"
            disabled={!eligibleCount}
          >
            <Tooltip title="将闲置标签暂存为快照并安全关闭，彻底清理标签栏">
              <Button
                block
                icon={<CameraOutlined />}
                loading={archiveLoading}
                style={{ height: 34, fontWeight: 500 }}
              >
                沉淀归档并关闭
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      </Card>
    );
  }

  return (
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
            <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
              闲置标签智能休眠与内存释放
            </span>
            <span
              style={{
                fontSize: 12,
                color: tk.ink3,
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
            loading={refreshLoading}
            onClick={onRefresh}
          >
            刷新监控
          </Button>
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            background: tk.canvas,
            padding: '14px 16px',
            borderRadius: 10,
            border: `1px solid ${tk.hairline}`,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前窗口总标签
          </Text>
          <div style={{ fontSize: 22, fontWeight: 700, color: tk.ink, marginTop: 4 }}>
            {tabHealth?.totalCount ?? 0}
          </div>
        </div>

        <div
          style={{
            background: tk.infoSoft,
            padding: '14px 16px',
            borderRadius: 10,
            border: `1px solid ${tk.infoBorder}`,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, color: tk.infoInk }}>
            已休眠标签
          </Text>
          <div style={{ fontSize: 22, fontWeight: 700, color: tk.infoInk, marginTop: 4 }}>
            {tabHealth?.discardedCount ?? 0}
          </div>
        </div>

        <div
          style={{
            background: tk.successSoft,
            padding: '14px 16px',
            borderRadius: 10,
            border: `1px solid ${tk.successBorder}`,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, color: tk.successInk }}>
            受保护标签 (活动/发声/固定)
          </Text>
          <div style={{ fontSize: 22, fontWeight: 700, color: tk.successInk, marginTop: 4 }}>
            {(tabHealth?.audibleCount ?? 0) +
              (tabHealth?.pinnedCount ?? 0) +
              (tabHealth?.activeTabId ? 1 : 0)}
          </div>
        </div>

        <div
          style={{
            background: tk.accentSoft,
            padding: '14px 16px',
            borderRadius: 10,
            border: `1px solid ${tk.accentBorder}`,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12, color: tk.accentInk }}>
            可释放内存估算
          </Text>
          <div style={{ fontSize: 22, fontWeight: 700, color: tk.accentInk, marginTop: 4 }}>
            ~{tabHealth?.estimatedMemorySavedMb ?? 0} MB
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          paddingTop: 12,
          borderTop: `1px solid ${tk.hairline}`,
        }}
      >
        <Tooltip title="休眠闲置标签：标签标题仍保留在标签栏，但页面内存被释放，点击时重新载入">
          <Button
            type="primary"
            icon={<RestOutlined />}
            loading={discardLoading}
            onClick={handleDiscard}
            style={{ fontWeight: 600 }}
          >
            一键休眠所有闲置标签
          </Button>
        </Tooltip>

        <Popconfirm
          title="确认沉淀归档并关闭闲置标签？"
          description={`将先保存快照，再安全关闭当前窗口的 ${eligibleCount} 个闲置标签（播放中、固定和活动标签受保护）。`}
          onConfirm={handleArchive}
          okText="归档并关闭"
          cancelText="取消"
          disabled={!eligibleCount}
        >
          <Tooltip title="将闲置标签暂存为一个新快照，并从标签栏中安全关闭，彻底还给您清爽的窗口">
            <Button icon={<CameraOutlined />} loading={archiveLoading} style={{ fontWeight: 500 }}>
              一键沉淀归档并安全关闭闲置标签
            </Button>
          </Tooltip>
        </Popconfirm>
      </div>
    </Card>
  );
}
