import React from "react";
import { useState } from 'react';
import { Button, Space, Table, Tag, message as antdMessage } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { SearchBar } from '@/components/SearchBar';
import { TableToolbar } from '@/components/TableToolbar';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { confirmDanger } from '@/components/Confirm';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useDebounce } from '@/hooks/useDebounce';
import { deletePlugin, listPlugins } from '@/api/plugin';
import type { PluginVersion } from '@/types/plugin';

const PAGE_SIZE = 10;

export default function PluginListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(keyword, 300);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['plugins', { page, search: debounced }],
    () => listPlugins({ page, page_size: PAGE_SIZE, search: debounced || undefined }),
  );

  const deleteMutation = useApiMutation<unknown, { name: string; version: string }>(
    {
      mutationFn: ({ name, version }) => deletePlugin(name, version),
    },
    [['plugins']],
  );

  const columns: TableColumnsType<PluginVersion> = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Version', dataIndex: 'version' },
    {
      title: 'Source',
      dataIndex: 'source_type',
      render: (value: string) => <Tag color="geekblue">{value}</Tag>,
    },
    { title: 'Status', dataIndex: 'status' },
    {
      title: 'Actions',
      key: 'actions',
      render: (_value, record) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/plugin/${record.name}/${record.version}`)}
          >
            View
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            loading={deleteMutation.isPending}
            onClick={async () => {
              const ok = await confirmDanger({
                title: 'Delete plugin',
                content: `Remove ${record.name}@${record.version}? This cannot be undone.`,
              });
              if (!ok) {
                return;
              }
              try {
                await deleteMutation.mutateAsync({ name: record.name, version: record.version });
                antdMessage.success(`Deleted ${record.name}@${record.version}`);
                void refetch();
              } catch (err) {
                console.error(describeError(err));
              }
            }}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Plugins"
        description="Manage installed plugin versions"
        extra={
          <Space>
            <Link to="/plugin/register">
              <Button type="primary">Register plugin</Button>
            </Link>
          </Space>
        }
      />
      <div className="app-content-card">
        <TableToolbar
          left={
            <SearchBar
              value={keyword}
              onChange={(value) => {
                setKeyword(value);
                setPage(1);
              }}
              placeholder="Search by name"
            />
          }
          right={
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              Refresh
            </Button>
          }
        />
        {isLoading ? (
          <Loading rows={6} />
        ) : error ? (
          <ErrorAlert error={error} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState description="No plugins registered yet" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: data?.total ?? 0,
              showSizeChanger: false,
              showTotal: (total) => `${total} plugin version(s)`,
              onChange: (next) => setPage(next),
            }}
          />
        )}
      </div>
    </>
  );
}
