import React from 'react';
import { useState } from 'react';
import { Button, Space, Table, Tag, Typography, message as antdMessage } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { StatusTag } from '@/components/StatusTag';
import type { StatusValue } from '@/types/common';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { listStorePlugins, reviewPlugin } from '@/api/store';
import type { PluginVersion } from '@/types/plugin';
import { useAuthStore } from '@/store/auth';

const PAGE_SIZE = 12;

export function StorePage(): React.JSX.Element {
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === 'admin';
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['store', { page }],
    () => listStorePlugins({ page, page_size: PAGE_SIZE }),
  );

  const review = async (pluginId: string, approve: boolean) => {
    try {
      await reviewPlugin(pluginId, approve);
      antdMessage.success(approve ? 'Approved' : 'Rejected');
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const columns: TableColumnsType<PluginVersion> = [
    {
      title: 'Plugin',
      dataIndex: 'name',
      render: (value: string, record) => (
        <Link to={`/plugin/${record.name}/${record.version}`}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            @{record.version}
          </Typography.Text>
        </Link>
      ),
    },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    {
      title: 'Runtime',
      dataIndex: 'runtime_type',
      render: (value: string) => <Tag color="geekblue">{value}</Tag>,
    },
    {
      title: 'Visibility',
      render: (_v, record) => (
        <Space size={4}>
          <Tag color={record.visibility === 'public' ? 'success' : 'default'}>
            {record.visibility}
          </Tag>
          {record.review_status !== 'approved' ? (
            <Tag color="warning">{record.review_status}</Tag>
          ) : null}
          {record.owner_id ? <Tag>personal</Tag> : <Tag color="blue">platform</Tag>}
        </Space>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: StatusValue) => <StatusTag status={value} />,
    },
  ];

  if (isAdmin) {
    columns.push({
      title: 'Review',
      key: 'review',
      render: (_v, record) =>
        record.review_status === 'pending' && record.plugin_id ? (
          <Space>
            <Button size="small" type="primary" onClick={() => void review(record.plugin_id as string, true)}>
              Approve
            </Button>
            <Button size="small" danger onClick={() => void review(record.plugin_id as string, false)}>
              Reject
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    });
  }

  const items = data?.items ?? [];
  const pendingCount = items.filter((i) => i.review_status === 'pending').length;

  return (
    <>
      <PageHeader
        title="Plugin store"
        description="Approved public plugins, plus your private catalog"
        extra={
          pendingCount > 0 && isAdmin ? (
            <Tag color="warning">{pendingCount} pending review</Tag>
          ) : null
        }
      />
      {isLoading ? (
        <Loading rows={5} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState description="Nothing in the store yet — register a plugin and publish it" />
      ) : (
        <div className="app-content-card">
          <Table
            rowKey="id"
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
        </div>
      )}
    </>
  );
}

export default StorePage;
