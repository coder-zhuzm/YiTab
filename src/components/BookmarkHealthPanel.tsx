import { useState } from 'react';
import { Button, Card, Empty, Popconfirm, Space, Tag, Typography } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import {
  BookOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import {
  computeRecommendedDeletePlan,
  type BookmarkScanReport,
} from '@/lib/bookmarks';
import {
  sendToBackground,
  type CleanBookmarksResponse,
  type ExportBookmarksBackupResponse,
} from '@/lib/messaging';
import type { ThemeTokens } from '@/lib/theme-tokens';

const { Text, Paragraph } = Typography;

export interface BookmarkHealthPanelProps {
  variant: 'compact' | 'full';
  tk: ThemeTokens;
  report: BookmarkScanReport | null;
  scanning: boolean;
  onScan: () => void;
  messageApi: MessageInstance;
}

export function BookmarkHealthPanel({
  variant,
  tk,
  report,
  scanning,
  onScan,
  messageApi,
}: BookmarkHealthPanelProps) {
  const [cleaning, setCleaning] = useState(false);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  const handleCleanRecommended = async () => {
    if (!report || report.redundantCount === 0) return;
    const { deleteIds } = computeRecommendedDeletePlan(report.groups);
    if (!deleteIds.length) return;

    setCleaning(true);
    try {
      const res = await sendToBackground<CleanBookmarksResponse>({
        type: 'cleanBookmarks',
        bookmarkIds: deleteIds,
      });
      if (res.ok) {
        messageApi.success(`已清理 ${res.removedCount} 个多余重复书签，保留推荐项`);
        onScan();
      }
    } catch {
      messageApi.error('清理书签失败');
    } finally {
      setCleaning(false);
    }
  };

  const handleDeleteSingle = async (id: string) => {
    try {
      const res = await sendToBackground<CleanBookmarksResponse>({
        type: 'cleanBookmarks',
        bookmarkIds: [id],
      });
      if (res.ok) {
        onScan();
      }
    } catch {
      messageApi.error('删除书签失败');
    }
  };

  const handleBackup = async (format: 'html' | 'json') => {
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
      messageApi.error('导出书签备份失败');
    }
  };

  const isCompact = variant === 'compact';

  const renderGroupList = () => {
    if (!report) return null;
    if (report.groups.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="非常棒！您的收藏夹很健康，未发现重复书签。"
          style={{ margin: '30px 0' }}
        />
      );
    }

    return (
      <div
        style={{
          maxHeight: isCompact ? 250 : undefined,
          overflowY: isCompact ? 'auto' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: isCompact ? 8 : 10,
        }}
      >
        {report.groups.map((group) => {
          const isExpanded = expandedGroupKey === group.groupKey;
          return (
            <div
              key={group.groupKey}
              style={{
                background: tk.surface,
                border: `1px solid ${tk.hairline}`,
                borderRadius: 8,
                padding: isCompact ? '8px 10px' : '12px 14px',
                boxShadow: isCompact ? tk.shadowCard : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  gap: 8,
                }}
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
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: `1px solid ${tk.hairline}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
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
                          padding: isCompact ? '4px 6px' : '6px 10px',
                          borderRadius: 6,
                          background: isKeep ? tk.successSoft : tk.surface,
                          border: isKeep
                            ? `1px solid ${tk.successBorder}`
                            : `1px solid ${tk.hairline}`,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Tag
                              color={isKeep ? 'green' : 'default'}
                              style={{
                                margin: 0,
                                fontSize: 10,
                                lineHeight: '16px',
                                padding: '0 4px',
                              }}
                            >
                              {isKeep ? '推荐保留' : '待清理'}
                            </Tag>
                            <Text ellipsis style={{ fontSize: 12, color: tk.ink2 }}>
                              {it.title}
                            </Text>
                          </div>
                          <Text
                            type="secondary"
                            ellipsis
                            style={{ fontSize: 10, display: 'block', marginTop: 2 }}
                          >
                            目录: {it.folderPath.join(' / ') || '书签栏根目录'}
                          </Text>
                        </div>

                        {!isKeep && (
                          <Popconfirm
                            title="确认删除该重复书签？"
                            onConfirm={() => handleDeleteSingle(it.id)}
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
        })}
      </div>
    );
  };

  if (isCompact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card
          size="small"
          style={{
            borderRadius: 10,
            boxShadow: tk.shadowCard,
            border: `1px solid ${tk.hairline}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div>
              <Text strong style={{ fontSize: 13, color: tk.ink }}>
                书签智能去重
              </Text>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                扫描收藏夹全树，按目录深度与标题质量推荐保留最佳书签
              </Text>
            </div>
            {report && (
              <Button size="small" icon={<ReloadOutlined />} loading={scanning} onClick={onScan}>
                重新扫描
              </Button>
            )}
          </div>

          {report ? (
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
              <span>
                总书签: <strong style={{ color: tk.ink }}>{report.totalBookmarks}</strong>
              </span>
              <span>
                文件夹: <strong style={{ color: tk.ink }}>{report.totalFolders}</strong>
              </span>
              <span>
                重复组: <strong style={{ color: tk.accentInk }}>{report.duplicateGroupCount}</strong>
              </span>
              <span>
                可清理: <strong style={{ color: tk.dangerInk }}>{report.redundantCount}</strong>
              </span>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <Button type="primary" icon={<BookOutlined />} loading={scanning} onClick={onScan}>
                开始扫描书签树
              </Button>
            </div>
          )}

          {report && report.redundantCount > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Popconfirm
                title="确认按建议一键清理？"
                description={`将删除 ${report.redundantCount} 个冗余副本，保留分类最深、标题最完整的优质书签。`}
                onConfirm={handleCleanRecommended}
                okText="立即清理"
                cancelText="取消"
              >
                <Button
                  type="primary"
                  danger
                  block
                  loading={cleaning}
                  icon={<DeleteOutlined />}
                  style={{ fontWeight: 600, height: 32 }}
                >
                  一键按建议清理 ({report.redundantCount} 项)
                </Button>
              </Popconfirm>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Button
              size="small"
              block
              icon={<CloudDownloadOutlined />}
              onClick={() => handleBackup('html')}
            >
              导出标准 HTML 备份
            </Button>
            <Button
              size="small"
              block
              icon={<DownloadOutlined />}
              onClick={() => handleBackup('json')}
            >
              导出 JSON
            </Button>
          </div>
        </Card>

        {renderGroupList()}
      </div>
    );
  }

  return (
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
              <span style={{ fontSize: 16, fontWeight: 600, color: tk.ink }}>
                书签树深度扫描与智能去重
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: tk.ink3,
                  fontWeight: 'normal',
                  display: 'block',
                }}
              >
                递归扫描全部收藏夹，按路径深度、标题质量和历史添加时间智能推荐最佳保留项
              </span>
            </div>
            {report && (
              <Button icon={<ReloadOutlined />} loading={scanning} onClick={onScan}>
                重新扫描书签
              </Button>
            )}
          </div>
        }
        style={{
          marginBottom: 20,
          borderRadius: 12,
          borderColor: tk.hairline,
          boxShadow: tk.shadowCard,
        }}
      >
        {report ? (
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
                  background: tk.canvas,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: `1px solid ${tk.hairline}`,
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  总书签总数
                </Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: tk.ink, marginTop: 4 }}>
                  {report.totalBookmarks}
                </div>
              </div>
              <div
                style={{
                  background: tk.canvas,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: `1px solid ${tk.hairline}`,
                }}
              >
                <Text type="secondary" style={{ fontSize: 12 }}>
                  目录文件夹总数
                </Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: tk.ink, marginTop: 4 }}>
                  {report.totalFolders}
                </div>
              </div>
              <div
                style={{
                  background: tk.dangerSoft,
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: `1px solid ${tk.dangerBorder}`,
                }}
              >
                <Text type="secondary" style={{ fontSize: 12, color: tk.dangerInk }}>
                  重复书签组 / 冗余项
                </Text>
                <div style={{ fontSize: 22, fontWeight: 700, color: tk.dangerInk, marginTop: 4 }}>
                  {report.duplicateGroupCount} 组 · {report.redundantCount} 项
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
                borderTop: `1px solid ${tk.hairline}`,
              }}
            >
              <Space size={8}>
                {report.redundantCount > 0 && (
                  <Popconfirm
                    title="确认按建议一键清理？"
                    description={`将安全删除 ${report.redundantCount} 个冗余书签，保留归类最深、无营销参数的优质书签。建议清理前先导出备份。`}
                    onConfirm={handleCleanRecommended}
                    okText="立即清理"
                    cancelText="取消"
                  >
                    <Button
                      type="primary"
                      danger
                      loading={cleaning}
                      icon={<DeleteOutlined />}
                      style={{ fontWeight: 600 }}
                    >
                      一键按建议清理 ({report.redundantCount} 项)
                    </Button>
                  </Popconfirm>
                )}
              </Space>

              <Space size={8}>
                <Button icon={<CloudDownloadOutlined />} onClick={() => handleBackup('html')}>
                  导出标准 Netscape HTML 备份
                </Button>
                <Button icon={<DownloadOutlined />} onClick={() => handleBackup('json')}>
                  导出 JSON
                </Button>
              </Space>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <Paragraph type="secondary" style={{ fontSize: 14, marginBottom: 16 }}>
              尚未扫描书签树。点击下方按钮开始检测重复与异常书签。
            </Paragraph>
            <Button type="primary" icon={<BookOutlined />} loading={scanning} onClick={onScan}>
              开始全量书签检测
            </Button>
          </div>
        )}
      </Card>

      {report && report.groups.length > 0 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                重复书签清单（共 {report.groups.length} 组）
              </span>
              <span style={{ fontSize: 12, color: tk.ink3, fontWeight: 'normal' }}>
                每组已自动为您推荐保留最优项
              </span>
            </div>
          }
          style={{
            borderRadius: 12,
            borderColor: tk.hairline,
            boxShadow: tk.shadowCard,
          }}
        >
          {renderGroupList()}
        </Card>
      )}
    </div>
  );
}
