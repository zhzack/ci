import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { PlusOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
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
  adminListTeams,
  adminCreateTeam,
  adminAddTeamMember,
  adminRemoveTeamMember,
  type AdminUser,
  type AuditEntry,
  type AdminTeam,
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

function TeamsTab(): React.JSX.Element {
  const { data: teams, isLoading: teamsLoading, error: teamsError, refetch: refetchTeams } = useApiQuery(
    ['admin', 'teams'],
    adminListTeams,
  );
  const { data: users } = useApiQuery(['admin', 'users'], adminListUsers);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm<{ name: string }>();
  const [creating, setCreating] = useState(false);

  const [addMemberModal, setAddMemberModal] = useState<{ team: AdminTeam } | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [addingMember, setAddingMember] = useState(false);

  const usersMap = useMemo(() => {
    const map = new Map<string, AdminUser>();
    for (const u of users ?? []) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const handleCreateTeam = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await adminCreateTeam(values.name.trim());
      antdMessage.success(`Team "${values.name}" created`);
      createForm.resetFields();
      setCreateModalOpen(false);
      void refetchTeams();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async () => {
    if (!addMemberModal || !selectedUserId) return;
    setAddingMember(true);
    try {
      await adminAddTeamMember(addMemberModal.team.id, selectedUserId);
      antdMessage.success('Member added to team');
      setAddMemberModal(null);
      setSelectedUserId(null);
      void refetchTeams();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (teamId: string, userId: string) => {
    try {
      await adminRemoveTeamMember(teamId, userId);
      antdMessage.success('Member removed');
      void refetchTeams();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const columns: TableColumnsType<AdminTeam> = [
    {
      title: 'Team Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space>
          <TeamOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>{name}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Team ID',
      dataIndex: 'id',
      key: 'id',
      render: (id: string) => (
        <Typography.Text code copyable={{ text: id }}>
          {id.slice(0, 8)}...
        </Typography.Text>
      ),
    },
    {
      title: 'Members',
      key: 'members',
      render: (_v, record) => {
        return (
          <Space wrap size={[4, 8]}>
            {record.member_ids.length === 0 ? (
              <Typography.Text type="secondary">No members</Typography.Text>
            ) : (
              record.member_ids.map((memberId) => {
                const user = usersMap.get(memberId);
                const label = user ? (user.display_name || user.username) : memberId.slice(0, 8);
                return (
                  <Tag
                    key={memberId}
                    closable
                    color="blue"
                    onClose={(e) => {
                      e.preventDefault();
                      void handleRemoveMember(record.id, memberId);
                    }}
                  >
                    {label}
                  </Tag>
                );
              })
            )}
          </Space>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_v, record) => {
        return (
          <Button
            size="small"
            icon={<UserAddOutlined />}
            onClick={() => {
              setSelectedUserId(null);
              setAddMemberModal({ team: record });
            }}
          >
            Add member
          </Button>
        );
      },
    },
  ];

  if (teamsLoading) return <Loading rows={5} />;
  if (teamsError) return <ErrorAlert error={teamsError} onRetry={() => refetchTeams()} />;

  const availableUsersForAdd = (users ?? []).filter(
    (u) => !addMemberModal?.team.member_ids.includes(u.id),
  );

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary">
          Teams allow grouping users and granting team-level access to pipelines and machines.
        </Typography.Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setCreateModalOpen(true)}
        >
          Create team
        </Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={teams ?? []} pagination={false} />

      <Modal
        title="Create Team"
        open={createModalOpen}
        onOk={() => void handleCreateTeam()}
        confirmLoading={creating}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="Team Name"
            rules={[
              { required: true, message: 'Please enter team name' },
              { min: 2, max: 64, message: 'Team name must be 2-64 characters' },
            ]}
          >
            <Input placeholder="e.g. Infrastructure, Backend, QA" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Add Member · ${addMemberModal?.team.name ?? ''}`}
        open={Boolean(addMemberModal)}
        onOk={() => void handleAddMember()}
        confirmLoading={addingMember}
        okButtonProps={{ disabled: !selectedUserId }}
        onCancel={() => {
          setAddMemberModal(null);
          setSelectedUserId(null);
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">
            Select a user to add to this team:
          </Typography.Text>
        </div>
        <Select
          showSearch
          placeholder="Search and select user"
          style={{ width: '100%' }}
          value={selectedUserId}
          onChange={setSelectedUserId}
          filterOption={(input, option) =>
            (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={availableUsersForAdd.map((u) => ({
            value: u.id,
            label: `${u.display_name || u.username} (${u.username})`,
          }))}
        />
      </Modal>
    </>
  );
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
      <PageHeader title="Admin console" description="Users, teams, roles, and the audit trail" />
      <div className="app-content-card">
        <Card>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'users', label: 'Users', children: <UsersTab /> },
              { key: 'teams', label: 'Teams', children: <TeamsTab /> },
              { key: 'audit', label: 'Audit log', children: <AuditTab /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export default AdminPage;

