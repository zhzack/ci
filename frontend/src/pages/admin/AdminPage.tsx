import React from 'react';
import { useState } from 'react';
import {
  Button,
  Card,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { StatusTag } from '@/components/StatusTag';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import {
  adminListUsers,
  adminSetRole,
  adminSetStatus,
  adminAudit,
  type AdminUser,
  type AuditEntry,
} from '@/api/admin';
import { useAuthStore } from '@/store/auth';

function UsersTab(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(['admin', 'users'], adminListUsers);
  const me = useAuthStore((state) => state.user);

  const apply = async (fn: () => Promise<void>) => {
    try {
      await fn();
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const columns: TableColumnsType<AdminUser> = [
    { title: 'Username', dataIndex: 'username' },
    { title: 'Display name', dataIndex: 'display_name' },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (value: string) => (
        <Tag color={value === 'admin' ? 'geekblue' : 'default'}>{value}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => <StatusTag status={value.toUpperCase()} />,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_v, record) => (
        <Typography.Text>
          {record.username === me?.username ? (
            <Typography.Text type="secondary">that&apos;s you</Typography.Text>
          ) : (
            <>
              {record.role === 'admin' ? (
                <Button size="small" onClick={() => void apply(() => adminSetRole(record.id, 'user'))}>
                  Demote
                </Button>
              ) : (
                <Button size="small" type="link" onClick={() => void apply(() => adminSetRole(record.id, 'admin'))}>
                  Make admin
                </Button>
              )}
              {record.status === 'active' ? (
                <Button size="small" danger onClick={() => void apply(() => adminSetStatus(record.id, 'disabled'))}>
                  Disable
                </Button>
              ) : (
                <Button size="small" onClick={() => void apply(() => adminSetStatus(record.id, 'active'))}>
                  Enable
                </Button>
              )}
            </>
          )}
        </Typography.Text>
      ),
    },
  ];

  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;
  return <Table rowKey="id" columns={columns} dataSource={data ?? []} pagination={false} />;
}

function AuditTab(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(['admin', 'audit'], () => adminAudit(150));
  const columns: TableColumnsType<AuditEntry> = [
    { title: 'Time', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString() },
    { title: 'Action', dataIndex: 'action', render: (v: string) => <Tag color="processing">{v}</Tag> },
    { title: 'Resource', dataIndex: 'resource_type', render: (_v, r) => r.resource_type ? `${r.resource_type}:${(r.resource_id ?? '').slice(0, 8)}` : '—' },
    { title: 'User', dataIndex: 'user_id', render: (v: string | null) => (v ? v.slice(0, 8) : 'anonymous') },
    { title: 'Request', dataIndex: 'request_id' },
  ];
  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;
  return <Table rowKey="id" columns={columns} dataSource={data ?? []} size="small" />;
}

export function AdminPage(): React.JSX.Element {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="Admin console" description="Users, roles, and the audit trail" />
      <div className="app-content-card">
        <Card>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'users', label: 'Users', children: <UsersTab /> },
              { key: 'audit', label: 'Audit log', children: <AuditTab /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export default AdminPage;
