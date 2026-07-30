import React from "react";
import { Card, Col, Row, Statistic, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { StatusTag } from '@/components/StatusTag';
import { useApiQuery } from '@/hooks/useApiQuery';
import { dashboardSummary } from '@/api/dashboard';
import type { PipelineRun } from '@/types/run';

const columns: TableColumnsType<PipelineRun> = [
  {
    title: 'Run',
    dataIndex: 'id',
    render: (value: string, record) => (
      <a href={`/task/${record.id}`}>{value.slice(0, 8)}</a>
    ),
  },
  { title: 'Pipeline', dataIndex: 'pipeline_name' },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (value: string) => <StatusTag status={value} />,
  },
  { title: 'Created', dataIndex: 'created_at' },
];

export default function DashboardPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(
    ['dashboard', 'summary'],
    dashboardSummary,
    { refetchInterval: 5_000 },
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of plugins, pipelines, and recent runs"
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : data ? (
        <>
          <Row gutter={16}>
            <Col span={6}>
              <Card>
                <Statistic title="Plugins" value={data.counts.plugins} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="Pipelines" value={data.counts.pipelines} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Running tasks"
                  value={data.counts.running_tasks}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="Failed tasks"
                  value={data.counts.failed_tasks}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={16}>
              <Card title="Recent runs">
                {data.recent_runs.length === 0 ? (
                  <EmptyState description="No runs yet" />
                ) : (
                  <Table
                    rowKey="id"
                    size="middle"
                    columns={columns}
                    dataSource={data.recent_runs}
                    pagination={false}
                  />
                )}
              </Card>
            </Col>
            <Col span={8}>
              <Card title="System">
                <Typography.Paragraph>
                  Version: {data.system.version}
                </Typography.Paragraph>
                <Typography.Paragraph>
                  Environment: {data.system.environment}
                </Typography.Paragraph>
                <Typography.Paragraph copyable>
                  API: {data.system.api_url}
                </Typography.Paragraph>
              </Card>
            </Col>
          </Row>
        </>
      ) : null}
    </>
  );
}
