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
  adminCreateUser,
  adminResetPassword,
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
import { Checkbox } from 'antd';

function UsersTab(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(['admin', 'users'], adminListUsers);
  const me = useAuthStore((state) => state.user);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

  const [resetModalUser, setResetModalUser] = useState<AdminUser | null>(null);
  const [resetForm] = Form.useForm();
  const [resetting, setResetting] = useState(false);

  const apply = async (fn: () => Promise<void>) => {
    try {
      await fn();
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const handleCreateUser = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await adminCreateUser({
        username: values.username.trim(),
        password: values.password,
        display_name: values.display_name?.trim() || values.username.trim(),
        email: values.email?.trim() || undefined,
        role: values.role || 'user',
        must_change_password: values.must_change_password !== false,
      });
      antdMessage.success(`用户 "${values.username}" 创建成功`);
      createForm.resetFields();
      setCreateModalOpen(false);
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetModalUser) return;
    try {
      const values = await resetForm.validateFields();
      setResetting(true);
      await adminResetPassword(resetModalUser.id, {
        new_password: values.new_password,
        must_change_password: values.must_change_password !== false,
      });
      antdMessage.success(`用户 "${resetModalUser.username}" 密码重置成功`);
      resetForm.resetFields();
      setResetModalUser(null);
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setResetting(false);
    }
  };

  const columns: TableColumnsType<AdminUser> = [
    { title: '用户名', dataIndex: 'username' },
    { title: '显示名称', dataIndex: 'display_name' },
    {
      title: '邮箱',
      dataIndex: 'email',
      render: (email: string | null) => email || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (value: string) => (
        <Tag color={value === 'admin' ? 'geekblue' : 'default'}>{value}</Tag>
      ),
    },
    {
      title: '安全状态',
      key: 'security',
      render: (_v, record) =>
        record.must_change_password ? (
          <Tag color="warning">待首次改密</Tag>
        ) : (
          <Tag color="success">正常</Tag>
        ),
    },
    {
      title: '账号状态',
      dataIndex: 'status',
      render: (value: string) => <StatusTag status={value.toUpperCase()} />,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_v, record) => (
        <Space size="small">
          {record.username === me?.username ? (
            <Typography.Text type="secondary">当前登录账号</Typography.Text>
          ) : (
            <>
              {record.role === 'admin' ? (
                <Button size="small" onClick={() => void apply(() => adminSetRole(record.id, 'user'))}>
                  降为普通用户
                </Button>
              ) : (
                <Button size="small" type="link" onClick={() => void apply(() => adminSetRole(record.id, 'admin'))}>
                  设为管理员
                </Button>
              )}
              {record.status === 'active' ? (
                <Button size="small" danger onClick={() => void apply(() => adminSetStatus(record.id, 'disabled'))}>
                  禁用
                </Button>
              ) : (
                <Button size="small" onClick={() => void apply(() => adminSetStatus(record.id, 'active'))}>
                  启用
                </Button>
              )}
              <Button
                size="small"
                onClick={() => {
                  setResetModalUser(record);
                  resetForm.setFieldsValue({ must_change_password: true });
                }}
              >
                重置密码
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            createForm.setFieldsValue({ role: 'user', must_change_password: true });
            setCreateModalOpen(true);
          }}
        >
          新建用户
        </Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={data ?? []} pagination={false} />

      {/* 新建用户 Modal */}
      <Modal
        title="新建系统用户"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={handleCreateUser}
        confirmLoading={creating}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ role: 'user', must_change_password: true }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 3, max: 64, message: '长度在 3-64 个字符' },
            ]}
          >
            <Input placeholder="如：david" />
          </Form.Item>

          <Form.Item
            name="password"
            label="初始登录密码"
            rules={[
              { required: true, message: '请输入初始登录密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位密码" />
          </Form.Item>

          <Form.Item name="display_name" label="显示名称">
            <Input placeholder="如：大卫（选填）" />
          </Form.Item>

          <Form.Item
            name="email"
            label="电子邮箱"
            rules={[{ type: 'email', message: '请输入合法的邮箱格式' }]}
          >
            <Input placeholder="如：david@company.com（选填）" />
          </Form.Item>

          <Form.Item name="role" label="权限角色">
            <Select
              options={[
                { label: '普通用户 (user)', value: 'user' },
                { label: '系统管理员 (admin)', value: 'admin' },
              ]}
            />
          </Form.Item>

          <Form.Item name="must_change_password" valuePropName="checked">
            <Checkbox>首次登录强制修改密码</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 Modal */}
      <Modal
        title={`重置用户 "${resetModalUser?.username}" 密码`}
        open={Boolean(resetModalUser)}
        onCancel={() => setResetModalUser(null)}
        onOk={handleResetPassword}
        confirmLoading={resetting}
        destroyOnClose
      >
        <Form form={resetForm} layout="vertical" initialValues={{ must_change_password: true }}>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码（至少 8 位）" />
          </Form.Item>

          <Form.Item name="must_change_password" valuePropName="checked">
            <Checkbox>要求用户下次登录时修改密码</Checkbox>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
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

