import React from "react";
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { StatusTag } from '@/components/StatusTag';
import type { StatusValue } from '@/types/common';
import { useApiQuery } from '@/hooks/useApiQuery';
import { listRuns } from '@/api/run';
import type { RunSummary } from '@/types/run';

export default function TaskRunningPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(
    ['runs', 'active'],
    () => listRuns({ status: 'RUNNING', page_size: 50 }),
    { refetchInterval: 2_000 },
  );

  const running = data?.items ?? [];

  const columns: ColumnsType<RunSummary> = [
    {
      title: 'Run',
      dataIndex: 'id',
      render: (value: string, record) => (
        <Typography.Link href={`/task/${record.id}`}>{value.slice(0, 8)}</Typography.Link>
      ),
    },
    { title: 'Pipeline', dataIndex: 'pipeline_name' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: StatusValue) => <StatusTag status={value} />,
    },
    { title: 'Started', dataIndex: 'started_at' },
  ];

  return (
    <>
      <PageHeader
        title="Running tasks"
        description="Currently active pipeline runs"
        extra={<Tag color="blue">Auto refresh 2s</Tag>}
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : running.length === 0 ? (
        <EmptyState description="No running pipelines" />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={running}
          pagination={false}
        />
      )}
    </>
  );
}
