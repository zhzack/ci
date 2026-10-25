import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { MailOutlined, PlusOutlined, SendOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
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
  adminGetEmailConfig,
  adminUpdateEmailConfig,
  adminSendTestEmail,
  type AdminUser,
  type AuditEntry,
  type AdminTeam,
} from '@/api/admin';
import { useAuthStore } from '@/store/auth';

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
      render: (value: 'active' | 'disabled') =>
        value === 'active' ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag color="default">停用</Tag>
        ),
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

function EmailConfigTab(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(['admin', 'email-config'], adminGetEmailConfig);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);

  React.useEffect(() => {
    if (data) {
      form.setFieldsValue({
        enabled: data.enabled,
        host: data.host,
        port: data.port,
        username: data.username,
        sender_email: data.sender_email,
        sender_name: data.sender_name,
        use_ssl: data.use_ssl,
        use_tls: data.use_tls,
      });
    }
  }, [data, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const res = await adminUpdateEmailConfig({
        enabled: values.enabled,
        host: values.host.trim(),
        port: values.port,
        username: values.username.trim(),
        password: values.password ? values.password.trim() : undefined,
        sender_email: values.sender_email.trim(),
        sender_name: values.sender_name.trim(),
        use_ssl: values.use_ssl ?? true,
        use_tls: values.use_tls ?? false,
      });
      antdMessage.success(res.message || 'SMTP 配置已保存并生效');
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      antdMessage.error('请输入有效的测试接收邮箱');
      return;
    }
    setTesting(true);
    try {
      const res = await adminSendTestEmail(testEmail);
      antdMessage.success(res.message || `测试邮件已成功发送至 ${testEmail}`);
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setTesting(false);
    }
  };

  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        配置系统发信服务（SMTP）。启用后，系统将能够发送邮箱验证码、重置密码邮件与流水线运行结果通知。
      </Typography.Paragraph>

      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item name="enabled" label="启用邮件发信服务" valuePropName="checked">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Space direction="horizontal" style={{ width: '100%' }} size={16}>
          <Form.Item
            name="host"
            label="SMTP 服务器地址 (Host)"
            rules={[{ required: true, message: '请输入 SMTP 服务器地址' }]}
            style={{ flex: 2 }}
          >
            <Input placeholder="smtp.qq.com" />
          </Form.Item>

          <Form.Item
            name="port"
            label="SMTP 端口 (Port)"
            rules={[{ required: true, message: '请输入端口' }]}
            style={{ flex: 1 }}
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="465" />
          </Form.Item>
        </Space>

        <Form.Item
          name="username"
          label="发信账号 (Username)"
          rules={[{ required: true, message: '请输入发信邮箱或账号' }]}
        >
          <Input prefix={<MailOutlined />} placeholder="your_account@qq.com" />
        </Form.Item>

        <Form.Item
          name="password"
          label="授权码 / 密码 (Password)"
          extra={data?.has_password ? '✅ 服务器已保存授权码。留空表示保持当前授权码不变。' : '请输入邮箱开启 SMTP 获得的专用授权码'}
        >
          <Input.Password placeholder="•••••••• (留空保持现有配置)" />
        </Form.Item>

        <Space direction="horizontal" style={{ width: '100%' }} size={16}>
          <Form.Item
            name="sender_email"
            label="发件人邮箱 (Sender Email)"
            rules={[{ required: true, message: '请输入发件人邮箱' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="your_account@qq.com" />
          </Form.Item>

          <Form.Item
            name="sender_name"
            label="发件人显示名 (Sender Name)"
            rules={[{ required: true, message: '请输入发件人名称' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="Mini Pipeline CI/CD" />
          </Form.Item>
        </Space>

        <Space direction="horizontal" size={24} style={{ marginBottom: 20 }}>
          <Form.Item name="use_ssl" label="启用 SSL 加密 (465端口推荐)" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
          <Form.Item name="use_tls" label="启用 STARTTLS (587端口推荐)" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Space>

        <Form.Item style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>
            保存发信配置
          </Button>
        </Form.Item>
      </Form>

      <Divider style={{ margin: '32px 0 24px 0' }} />

      <Typography.Title level={5}>发送测试邮件</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        输入目标收件邮箱，发送一封测试邮件以验证 SMTP 服务器连通性与账号密码的有效性。
      </Typography.Paragraph>

      <div style={{ display: 'flex', gap: 12, maxWidth: 480 }}>
        <Input
          prefix={<MailOutlined />}
          placeholder="接收测试邮件的目标邮箱"
          value={testEmail}
          onChange={(e) => setTestEmail(e.target.value)}
        />
        <Button
          icon={<SendOutlined />}
          type="default"
          loading={testing}
          onClick={handleSendTest}
        >
          发送测试邮件
        </Button>
      </div>
    </div>
  );
}

export function AdminPage(): React.JSX.Element {
  const [tab, setTab] = useState('users');
  return (
    <>
      <PageHeader title="平台管理员控制台" description="用户管理、团队分组、操作审计日志与 SMTP 邮件服务配置" />
      <div className="app-content-card">
        <Card>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              { key: 'users', label: '用户管理', children: <UsersTab /> },
              { key: 'teams', label: '团队与分组', children: <TeamsTab /> },
              { key: 'email', label: '邮件服务 (SMTP)', children: <EmailConfigTab /> },
              { key: 'audit', label: '审计日志', children: <AuditTab /> },
            ]}
          />
        </Card>
      </div>
    </>
  );
}

export default AdminPage;

