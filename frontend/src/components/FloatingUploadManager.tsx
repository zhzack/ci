import React, { useEffect } from 'react';
import {
  Button,
  Card,
  List,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  FileOutlined,
  LoadingOutlined,
  MinusOutlined,
  StopOutlined,
  UpOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useUploadStore } from '@/store/upload';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function FloatingUploadManager(): React.JSX.Element | null {
  const { token } = antdTheme.useToken();
  const {
    tasks,
    isOpen,
    isMinimized,
    setMinimized,
    setOpen,
    cancelTask,
    cancelAll,
    clearCompleted,
  } = useUploadStore();

  // Prevent accidental page reload/closure when uploads are running
  useEffect(() => {
    const isUploading = tasks.some(
      (t) => t.status === 'uploading' || t.status === 'pending',
    );
    if (!isUploading) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '当前有文件正在上传中，刷新或离开页面将中断上传，确认离开吗？';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [tasks]);

  if (!isOpen || tasks.length === 0) {
    return null;
  }

  const totalCount = tasks.length;
  const successCount = tasks.filter((t) => t.status === 'success').length;
  const errorCount = tasks.filter((t) => t.status === 'error').length;
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
  const uploadingCount = tasks.filter((t) => t.status === 'uploading').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const isDone = uploadingCount === 0 && pendingCount === 0;

  // Real-time byte-level overall progress
  const totalBytes = tasks.reduce((sum, t) => sum + (t.size || 0), 0);
  const uploadedBytes = tasks.reduce((sum, t) => {
    if (t.status === 'success') return sum + t.size;
    if (t.status === 'uploading') return sum + (t.loadedBytes || 0);
    return sum;
  }, 0);

  const overallPercent =
    totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

  // Render Minimized Pill
  if (isMinimized) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1050,
          background: token.colorBgElevated,
          borderRadius: 24,
          padding: '8px 16px',
          boxShadow: '0 6px 20px rgba(0, 0, 0, 0.25)',
          border: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onClick={() => setMinimized(false)}
      >
        <Space align="center" size="small">
          {isDone ? (
            <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} />
          ) : (
            <LoadingOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          )}
          <Typography.Text strong style={{ fontSize: 13 }}>
            {isDone
              ? `上传完成 (${successCount}/${totalCount})`
              : `后台上传中 (${successCount}/${totalCount}) · ${overallPercent}%`}
          </Typography.Text>
        </Space>

        <Space size={4} onClick={(e) => e.stopPropagation()}>
          {!isDone && (
            <Tooltip title="取消全部上传">
              <Button
                type="text"
                size="small"
                danger
                icon={<StopOutlined style={{ fontSize: 12 }} />}
                onClick={cancelAll}
              />
            </Tooltip>
          )}
          <Tooltip title="展开查看详情">
            <Button
              type="text"
              size="small"
              icon={<UpOutlined style={{ fontSize: 12 }} />}
              onClick={() => setMinimized(false)}
            />
          </Tooltip>
          <Tooltip title="关闭">
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined style={{ fontSize: 12 }} />}
              onClick={() => setOpen(false)}
            />
          </Tooltip>
        </Space>
      </div>
    );
  }

  // Render Expanded Floating Card
  return (
    <Card
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 480,
        zIndex: 1050,
        boxShadow: '0 10px 32px rgba(0, 0, 0, 0.28)',
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgElevated,
      }}
      bodyStyle={{ padding: '12px 16px' }}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space align="center">
            {isDone ? (
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
            ) : (
              <UploadOutlined style={{ color: '#1677ff', fontSize: 16 }} />
            )}
            <Typography.Text strong>
              {isDone
                ? `上传完成 (${successCount}/${totalCount})`
                : `正在上传 (${successCount + 1}/${totalCount})`}
            </Typography.Text>
          </Space>

          <Space size={4}>
            {!isDone && (
              <Button
                size="small"
                danger
                onClick={cancelAll}
                style={{ fontSize: 12, padding: '0 6px' }}
              >
                取消全部
              </Button>
            )}
            {isDone && (
              <Button size="small" type="link" onClick={clearCompleted} style={{ padding: '0 4px' }}>
                清空列表
              </Button>
            )}
            <Tooltip title="收起放入后台 (不挡住页面)">
              <Button
                type="text"
                size="small"
                icon={<MinusOutlined style={{ fontSize: 12 }} />}
                onClick={() => setMinimized(true)}
              />
            </Tooltip>
            <Tooltip title="关闭">
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined style={{ fontSize: 12 }} />}
                onClick={() => setOpen(false)}
              />
            </Tooltip>
          </Space>
        </div>
      }
    >
      {/* Overall Progress & Summary */}
      <div style={{ marginBottom: 14 }}>
        <Progress
          percent={overallPercent}
          status={errorCount > 0 && isDone ? 'exception' : isDone ? 'success' : 'active'}
          strokeColor={isDone ? '#52c41a' : '#1677ff'}
          size="small"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已完成 {successCount} / 共 {totalCount} 个文件
            {cancelledCount > 0 && (
              <span style={{ color: '#8c8c8c', marginLeft: 6 }}>({cancelledCount} 个取消)</span>
            )}
            {errorCount > 0 && (
              <span style={{ color: '#cf1322', marginLeft: 6 }}>({errorCount} 个失败)</span>
            )}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatSize(uploadedBytes)} / {formatSize(totalBytes)} ({overallPercent}%)
          </Typography.Text>
        </div>
      </div>

      {/* Task List with Individual Progress */}
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        <List
          size="small"
          dataSource={tasks}
          renderItem={(item) => {
            const itemLoaded =
              item.status === 'success'
                ? item.size
                : item.status === 'cancelled'
                ? 0
                : item.loadedBytes || 0;

            return (
              <List.Item
                key={item.id}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #f0f0f0',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                }}
              >
                {/* File Info Top Line */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                    <FileOutlined style={{ color: '#8c8c8c', flexShrink: 0 }} />
                    <div style={{ overflow: 'hidden' }}>
                      <Typography.Text
                        ellipsis
                        style={{
                          fontSize: 13,
                          display: 'block',
                          maxWidth: 260,
                        }}
                        title={item.relativePath || item.name}
                      >
                        {item.relativePath || item.name}
                      </Typography.Text>
                    </div>
                  </div>

                  {/* Status & Cancel Action */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {item.status === 'uploading' && (
                      <Space size={4}>
                        <LoadingOutlined style={{ color: '#1677ff' }} />
                        <Typography.Text style={{ color: '#1677ff', fontSize: 12 }}>
                          {item.progress}%
                        </Typography.Text>
                        <Tooltip title="取消此文件上传">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<CloseCircleOutlined style={{ fontSize: 13 }} />}
                            onClick={() => cancelTask(item.id)}
                          />
                        </Tooltip>
                      </Space>
                    )}
                    {item.status === 'pending' && (
                      <Space size={4}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          等待中
                        </Typography.Text>
                        <Tooltip title="取消排队">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<CloseCircleOutlined style={{ fontSize: 13 }} />}
                            onClick={() => cancelTask(item.id)}
                          />
                        </Tooltip>
                      </Space>
                    )}
                    {item.status === 'cancelled' && <Tag>已取消</Tag>}
                    {item.status === 'success' && <Tag color="success">完成</Tag>}
                    {item.status === 'error' && (
                      <Tooltip title={item.errorMsg || '上传失败'}>
                        <Tag color="error" icon={<WarningOutlined />}>
                          失败
                        </Tag>
                      </Tooltip>
                    )}
                  </div>
                </div>

                {/* Individual File Progress Bar & Byte Count */}
                {(item.status === 'uploading' || item.status === 'pending') && (
                  <div style={{ marginTop: 2 }}>
                    <Progress
                      percent={item.progress}
                      size="small"
                      showInfo={false}
                      strokeColor="#1677ff"
                    />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 2,
                        fontSize: 11,
                      }}
                    >
                      <Typography.Text type="secondary">
                        {formatSize(itemLoaded)} / {formatSize(item.size)}
                      </Typography.Text>
                      <Typography.Text type="secondary">{item.progress}%</Typography.Text>
                    </div>
                  </div>
                )}
              </List.Item>
            );
          }}
        />
      </div>
    </Card>
  );
}
