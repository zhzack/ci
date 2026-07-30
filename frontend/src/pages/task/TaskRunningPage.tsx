import React from "react";
import { Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { StatusTag } from '@/components/StatusTag';
import { useApiQuery } from '@/hooks/useApiQuery';
import { dashboardSummary } from '@/api/dashboard';
import type { PipelineRun } from '@/types/run';

const ACTIVE = new Set(['PENDING', 'READY', 'RUNNING']);

export default function TaskRunningPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(
    ['running-tasks'],
    dashboardSummary,
    { refetchInterval: 2_000 },
  );

  const running = (data?.recent_runs ?? []).filter((run) => ACTIVE.has(run.status));

  const columns: ColumnsType<PipelineRun> = [
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
      render: (value: string) => <StatusTag status={value} />,
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
