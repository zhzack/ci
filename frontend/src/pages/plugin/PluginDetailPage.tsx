import React from "react";
import { useParams, Link } from 'react-router-dom';
import { Button, Card, Descriptions, Space, Tag, Typography, message as antdMessage } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { getPlugin } from '@/api/plugin';
import { requestPublish } from '@/api/store';
import { useAuthStore } from '@/store/auth';

export default function PluginDetailPage(): React.JSX.Element {
  const { name, version } = useParams<{ name: string; version: string }>();
  const identifier = `${name ?? ''}@${version ?? ''}`;
  const currentUser = useAuthStore((state) => state.user);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['plugin', name, version],
    () => getPlugin(name ?? '', version ?? ''),
    { enabled: Boolean(name && version) },
  );

  const publishMutation = useApiMutation<unknown, string>(
    { mutationFn: (pluginId: string) => requestPublish(pluginId) },
    [['plugin', name, version], ['plugins'], ['store']],
  );

  const isOwner =
    data?.plugin_id && currentUser && data.owner_id === currentUser.id;
  const canPublish =
    isOwner && data?.visibility === 'private' && data.review_status !== 'pending';

  const onPublish = async () => {
    if (!data?.plugin_id) return;
    try {
      await publishMutation.mutateAsync(data.plugin_id);
      antdMessage.success('Submitted for store review');
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  return (
    <>
      <PageHeader
        title={identifier}
        description="Plugin version details"
        extra={
          <Space>
            {canPublish ? (
              <Button type="primary" loading={publishMutation.isPending} onClick={onPublish}>
                Publish to store
              </Button>
            ) : null}
            {data?.review_status === 'pending' ? <Tag color="warning">review pending</Tag> : null}
            {data?.visibility === 'public' ? <Tag color="success">in store</Tag> : null}
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
            <Descriptions.Item label="Visibility">
              <Space size={4}>
                <Tag color={data.visibility === 'public' ? 'success' : 'default'}>
                  {data.visibility}
                </Tag>
                <Tag color={data.review_status === 'approved' ? 'success' : 'warning'}>
                  {data.review_status}
                </Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Owner">
              {data.owner_id ? data.owner_id.slice(0, 8) : <Tag color="blue">platform</Tag>}
            </Descriptions.Item>
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
