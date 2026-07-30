import React from "react";
import { useParams, Link } from 'react-router-dom';
import { Button, Card, Descriptions, Space, Typography } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { useApiQuery } from '@/hooks/useApiQuery';
import { getPlugin } from '@/api/plugin';

export default function PluginDetailPage(): React.JSX.Element {
  const { name, version } = useParams<{ name: string; version: string }>();
  const identifier = `${name ?? ''}@${version ?? ''}`;
  const { data, isLoading, error, refetch } = useApiQuery(
    ['plugin', name, version],
    () => getPlugin(name ?? '', version ?? ''),
    { enabled: Boolean(name && version) },
  );

  return (
    <>
      <PageHeader
        title={identifier}
        description="Plugin version details"
        extra={
          <Space>
            <Link to="/plugin/list">
              <Button>Back to list</Button>
            </Link>
          </Space>
        }
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : data ? (
        <Card>
          <Descriptions bordered column={2} size="middle">
            <Descriptions.Item label="Name">{data.name}</Descriptions.Item>
            <Descriptions.Item label="Version">{data.version}</Descriptions.Item>
            <Descriptions.Item label="Source">{data.source_type}</Descriptions.Item>
            <Descriptions.Item label="Status">{data.status}</Descriptions.Item>
            <Descriptions.Item label="Runtime">{data.runtime_type}</Descriptions.Item>
            <Descriptions.Item label="Entry">{data.entry}</Descriptions.Item>
            <Descriptions.Item label="Source URL" span={2}>
              <Typography.Text copyable>{data.source_url ?? '—'}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Source revision" span={2}>
              {data.source_revision ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>
              {data.description || '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}
    </>
  );
}
