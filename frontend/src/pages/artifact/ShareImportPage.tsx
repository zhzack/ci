import React, { useState } from 'react';

import { formatSize } from '@/utils/format';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Modal,
  Input,
  message,
  Empty,
  Tooltip,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  FolderOutlined,
  DownloadOutlined,
  ImportOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FileImageOutlined,
  CodeOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  getSharedContent,
  downloadSharedFileDirect,
  importFromShare,
  type StorageItem,
} from '@/api/packages';
import { useAuthStore } from '@/store/auth';


function getFileIcon(item: StorageItem) {
  if (item.is_dir) return <FolderOutlined style={{ color: '#faad14', fontSize: 18 }} />;
  const ext = item.extension.toLowerCase();
  if (['.zip', '.tar', '.gz', '.tgz'].includes(ext)) {
    return <FileZipOutlined style={{ color: '#13c2c2', fontSize: 18 }} />;
  }
  if (['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp'].includes(ext)) {
    return <FileImageOutlined style={{ color: '#eb2f96', fontSize: 18 }} />;
  }
  if (['.yaml', '.yml', '.json', '.py', '.sh', '.js', '.ts'].includes(ext)) {
    return <CodeOutlined style={{ color: '#1890ff', fontSize: 18 }} />;
  }
  return <FileTextOutlined style={{ color: '#8c8c8c', fontSize: 18 }} />;
}

export function ShareImportPage(): React.JSX.Element {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  const [currentPath, setCurrentPath] = useState('');
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [targetImportPath, setTargetImportPath] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-package', token, currentPath],
    queryFn: () => getSharedContent(token, currentPath),
    enabled: Boolean(token),
  });

  const importMutation = useMutation({
    mutationFn: (path: string) => importFromShare(token, path),
    onSuccess: (res) => {
      message.success(`成功导入到: ${res.path}`);
      setImportModalOpen(false);
    },
    onError: (err) => {
      message.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const handleDownload = async (record: StorageItem) => {
    setDownloadingPath(record.path);
    try {
      const filename = record.is_dir ? `${record.name || 'shared_folder'}.zip` : record.name;
      // Relative sub-path within the share
      const subPath = currentPath ? `${currentPath}/${record.name}` : record.name;
      await downloadSharedFileDirect(token, filename, subPath);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloadingPath(null);
    }
  };

  const pathSegments = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const breadcrumbItems = [
    {
      title: (
        <a onClick={() => setCurrentPath('')}>
          <FolderOutlined /> 分享根目录
        </a>
      ),
    },
    ...pathSegments.map((segment, index) => {
      const segPath = pathSegments.slice(0, index + 1).join('/');
      const isLast = index === pathSegments.length - 1;
      return {
        title: isLast ? (
          <Typography.Text strong>{segment}</Typography.Text>
        ) : (
          <a onClick={() => setCurrentPath(segPath)}>{segment}</a>
        ),
      };
    }),
  ];

  const columns: TableColumnsType<StorageItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record) => (
        <Space>
          {getFileIcon(record)}
          {record.is_dir ? (
            <a
              onClick={() =>
                setCurrentPath(currentPath ? `${currentPath}/${name}` : name)
              }
              style={{ fontWeight: 600 }}
            >
              {name}/
            </a>
          ) : (
            <span>{name}</span>
          )}
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number, record) => (record.is_dir ? '-' : formatSize(size)),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_val, record) => (
        <Space size="small">
          <Tooltip title={record.is_dir ? '打包下载为 ZIP' : '直接下载'}>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingPath === record.path}
              onClick={() => void handleDownload(record)}
            >
              下载
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>
      <Card
        title={
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate('/artifact')}
              size="small"
            >
              返回制品库
            </Button>
            <span>📦 共享制品包 (Shared Package)</span>
          </Space>
        }
        extra={
          user && (
            <Button
              type="primary"
              icon={<ImportOutlined />}
              onClick={() => {
                const defaultName = data?.current_path
                  ? data.current_path.split('/').pop()
                  : 'shared_item';
                setTargetImportPath(`personal/${user.username}/${defaultName}`);
                setImportModalOpen(true);
              }}
            >
              导入到我的空间
            </Button>
          )
        }
      >
        <div style={{ marginBottom: 16 }}>
          <Breadcrumb items={breadcrumbItems} />
        </div>

        {error ? (
          <Empty
            description="该分享链接不存在或已过期失效"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table
            rowKey="name"
            dataSource={data?.items || []}
            columns={columns}
            loading={isLoading}
            pagination={false}
            size="middle"
          />
        )}
      </Card>

      {/* Import Modal */}
      <Modal
        title="📥 导入共享包到个人或共享空间"
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        onOk={() => importMutation.mutate(targetImportPath)}
        confirmLoading={importMutation.isPending}
        okText="确认导入"
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            导入方式将由分享者设定自动处理：
            <br />
            • <b>Live Link（实时链接）</b>：在目标位置创建 <code>.link.json</code> 引用，随源更新；
            <br />
            • <b>Snapshot（快照副本）</b>：物理拷贝独立副本到您的目录下。
          </Typography.Paragraph>
        </div>
        <div>
          <Typography.Text strong>目标存储路径：</Typography.Text>
          <Input
            style={{ marginTop: 8 }}
            value={targetImportPath}
            onChange={(e) => setTargetImportPath(e.target.value)}
            placeholder={`personal/${user?.username || 'user'}/my_folder`}
          />
        </div>
      </Modal>
    </div>
  );
}
