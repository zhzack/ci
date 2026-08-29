import React from "react";
import { useState } from 'react';
import { Button, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { useApiQuery } from '@/hooks/useApiQuery';
import { listArtifacts } from '@/api/artifact';
import { downloadArtifactUrl } from '@/api/run';
import type { ArtifactListItem } from '@/types/artifact';

const PAGE_SIZE = 10;

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
      <a
        href={downloadArtifactUrl(record.run_id, record.id)}
        target="_blank"
        rel="noreferrer"
      >
        <Button size="small" icon={<DownloadOutlined />}>
          Download
        </Button>
      </a>
    ),
  },
];

export default function ArtifactPage(): React.JSX.Element {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['artifacts', { page }],
    () => listArtifacts({ page, page_size: PAGE_SIZE }),
  );
  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Artifacts"
        description="Files produced by pipeline runs"
        extra={<Tag color="blue">Local managed storage</Tag>}
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState description="No artifacts collected yet" />
      ) : (
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
      )}
    </>
  );
}
