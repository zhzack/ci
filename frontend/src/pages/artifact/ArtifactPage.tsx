import React, { useState } from 'react';
import { Button, Table, Tabs, Typography, Space, Popconfirm, App as AntApp } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, InboxOutlined, HistoryOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { useApiQuery } from '@/hooks/useApiQuery';
import { listArtifacts, publishArtifactToPackages } from '@/api/artifact';
import { downloadArtifactUrl } from '@/api/run';
import type { ArtifactListItem } from '@/types/artifact';
import { PackageHubTab } from './PackageHubTab';

const PAGE_SIZE = 10;

function RunArtifactsView(): React.JSX.Element {
  const { message } = AntApp.useApp();
  const [page, setPage] = useState(1);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['artifacts', { page }],
    () => listArtifacts({ page, page_size: PAGE_SIZE }),
  );
  const items = data?.items ?? [];

  const handlePublish = async (record: ArtifactListItem) => {
    setPublishingId(record.id);
    try {
      await publishArtifactToPackages(record.id, 'artifacts');
      message.success(`产物 ${record.name} 已成功保存到制品仓库 artifacts/ 目录！`);
    } catch {
      message.error('保存失败');
    } finally {
      setPublishingId(null);
    }
  };

  const columns: TableColumnsType<ArtifactListItem> = [
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Size',
      dataIndex: 'size',
      render: (value: number) => `${(value / 1024).toFixed(2)} KiB`,
    },
    {
      title: 'SHA256',
      dataIndex: 'sha256',
      render: (value: string) => <code style={{ fontSize: 12 }}>{value.slice(0, 12)}…</code>,
    },
    {
      title: 'Run',
      dataIndex: 'run_id',
      render: (value: string) => (
        <Typography.Link href={`/task/${value}`}>{value.slice(0, 8)}</Typography.Link>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_value, record) => (
        <Space size="small">
          <a
            href={downloadArtifactUrl(record.run_id, record.id)}
            target="_blank"
            rel="noreferrer"
          >
            <Button size="small" icon={<DownloadOutlined />}>
              Download
            </Button>
          </a>
          <Popconfirm
            title="保存到制品仓库？"
            description="将该产物归档到制品仓库 artifacts/ 目录供长期管理与共享"
            onConfirm={() => void handlePublish(record)}
          >
            <Button
              size="small"
              icon={<CloudUploadOutlined />}
              loading={publishingId === record.id}
            >
              保存到制品库
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (isLoading) return <Loading rows={6} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;
  if (items.length === 0) return <EmptyState description="No run artifacts collected yet" />;

  return (
    <Table
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={items}
      pagination={{
        current: page,
        pageSize: PAGE_SIZE,
        total: data?.total ?? 0,
        showSizeChanger: false,
        onChange: (next) => setPage(next),
      }}
    />
  );
}

export default function ArtifactPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState('packages');

  const tabItems = [
    {
      key: 'packages',
      label: (
        <span>
          <InboxOutlined /> 制品仓库 (Package Hub)
        </span>
      ),
      children: <PackageHubTab />,
    },
    {
      key: 'runs',
      label: (
        <span>
          <HistoryOutlined /> 运行产物 (Pipeline Runs)
        </span>
      ),
      children: <RunArtifactsView />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Artifacts & Packages"
        description="Manage shared packages, files, plugins, and pipeline run artifacts"
      />
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={tabItems}
        size="large"
      />
    </>
  );
}
