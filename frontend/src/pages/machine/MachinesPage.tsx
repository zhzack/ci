import React from 'react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  DesktopOutlined,
  KeyOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import {
  listMachines,
  registerMachine,
  revokeMachine,
  rotateMachineToken,
  updateMachine,
  readCredentials,
  testMachineConnection,
  listGrants,
  createGrant,
  deleteGrant,
  listTeams,
  type Machine,
  type RegisterMachineRequest,
  type Team,
} from '@/api/machine';
import { adminListUsers, type AdminUser } from '@/api/admin';
import { EnvironmentTab } from './EnvironmentTab';
import { useWorkbenchStore } from '@/workbench/workbenchStore';

type RegisterFormValues = {
  name: string;
  max_concurrency: number;
  notes: string;
  connection_type: 'agent' | 'ssh';
  host?: string;
  port?: number;
  username?: string;
  auth_type?: 'password' | 'private_key';
  password?: string;
  private_key?: string;
};

function TokenOnceModal({ token, onClose }: { token: string | null; onClose: () => void }) {
  const serverUrl = window.location.origin.replace(':5173', ':8000');
  const winCmd = `powershell -c "irm ${serverUrl}/install.ps1?token=${token ?? ''} | iex"`;
  const unixCmd = `curl -fsSL "${serverUrl}/install.sh?token=${token ?? ''}" | bash`;
  const universalCmd = `powershell -c "irm ${serverUrl}/install?token=${token ?? ''} | iex"`;
  const manualCmd = `mini-pipeline-runner --server ${serverUrl} --token ${token ?? ''}`;

  return (
    <Modal
      open={token !== null}
      title="Machine registered — one-line runner installation"
      onCancel={onClose}
      width={700}
      footer={[
        <Button key="ok" type="primary" onClick={onClose}>
          I have deployed / saved the token
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        message="This runner token is shown only once"
        description="Store it safely. Copy the one-liner command below to auto-install and start the runner in one step!"
      />
      <div style={{ marginTop: 14 }}>
        <Typography.Text strong>Runner Token:</Typography.Text>
        <Input.TextArea
          readOnly
          value={token ?? ''}
          autoSize
          style={{ marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Typography.Text strong>One-line Quick Deploy &amp; Start:</Typography.Text>
        <Tabs
          defaultActiveKey="windows"
          style={{ marginTop: 6 }}
          items={[
            {
              key: 'windows',
              label: 'Windows (PowerShell)',
              children: (
                <div>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 6 }}>
                    Run in PowerShell (auto-detects Python, prepares venv, installs &amp; starts runner):
                  </Typography.Paragraph>
                  <Input.TextArea
                    readOnly
                    autoSize
                    value={winCmd}
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fafafa' }}
                  />
                </div>
              ),
            },
            {
              key: 'unix',
              label: 'Linux / macOS',
              children: (
                <div>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 6 }}>
                    Run in bash / zsh terminal:
                  </Typography.Paragraph>
                  <Input.TextArea
                    readOnly
                    autoSize
                    value={unixCmd}
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fafafa' }}
                  />
                </div>
              ),
            },
            {
              key: 'universal',
              label: 'Universal Auto-Detect',
              children: (
                <div>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 6 }}>
                    Platform auto-detects Windows/Linux/macOS via User-Agent:
                  </Typography.Paragraph>
                  <Input.TextArea
                    readOnly
                    autoSize
                    value={universalCmd}
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fafafa' }}
                  />
                </div>
              ),
            },
            {
              key: 'manual',
              label: 'Manual CLI',
              children: (
                <div>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 6 }}>
                    If mini-pipeline package is already installed:
                  </Typography.Paragraph>
                  <Input.TextArea
                    readOnly
                    autoSize
                    value={manualCmd}
                    style={{ fontFamily: 'JetBrains Mono, monospace', background: '#fafafa' }}
                  />
                </div>
              ),
            },
          ]}
        />
      </div>

      <Alert
        style={{ marginTop: 14 }}
        type="info"
        showIcon
        message="Privileged / Administrator Task Execution"
        description="If your pipeline tasks or plugin scripts require Administrator or root privileges, run the installation command above in an elevated terminal ('Run as Administrator' on Windows, or sudo on Linux/macOS). The runner and all its child tasks will run with those privileges."
      />
    </Modal>
  );
}

function MachineDrawer({
  machine,
  onClose,
}: {
  machine: Machine | null;
  onClose: () => void;
}) {
  const [grants, setGrants] = React.useState<Awaited<ReturnType<typeof listGrants>>>([]);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [granteeType, setGranteeType] = React.useState<'user' | 'team'>('user');
  const [selectedGrantee, setSelectedGrantee] = React.useState<string | null>(null);
  const [grantPermission, setGrantPermission] = React.useState<'operator' | 'viewer'>('operator');
  const [credentials, setCredentials] = React.useState<Record<string, string> | null | undefined>(undefined);
  const [testingConn, setTestingConn] = React.useState(false);

  const canManage = machine?.can_manage ?? false;

  React.useEffect(() => {
    if (!machine) return;
    void listGrants('machine', machine.id).then(setGrants).catch(() => setGrants([]));
    if (canManage) {
      void adminListUsers().then(setUsers).catch(() => setUsers([]));
      void listTeams().then(setTeams).catch(() => setTeams([]));
    }
  }, [machine, canManage]);

  if (!machine) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const share = async (type: 'user' | 'team', id: string, perm: 'operator' | 'viewer') => {
    try {
      await createGrant({
        resource_type: 'machine',
        resource_id: machine.id,
        grantee_type: type,
        grantee_id: id,
        permission: perm,
      });
      antdMessage.success(`Machine shared with ${type}`);
      setSelectedGrantee(null);
      void listGrants('machine', machine.id).then(setGrants);
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const revokeShare = async (grantId: string) => {
    await deleteGrant(grantId);
    void listGrants('machine', machine.id).then(setGrants);
  };

  const transfer = async (userId: string) => {
    try {
      await updateMachine(machine.id, { transfer_to_user_id: userId });
      antdMessage.success('Ownership transferred');
      onClose();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  return (
    <Drawer title={`Machine · ${machine.name}`} open onClose={onClose} width={480}>
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Space wrap>
          <Tag color={machine.kind === 'admin' ? 'geekblue' : 'green'}>
            {machine.kind === 'admin' ? 'admin pool' : 'personal'}
          </Tag>
          <Tag color={machine.online ? 'success' : 'default'}>
            {machine.online ? 'online' : 'offline'}
          </Tag>
          {machine.agent_version ? <Tag>v{machine.agent_version}</Tag> : null}
          {Object.entries(machine.labels).map(([k, v]) => (
            <Tag key={k} color="blue">
              {k}: {v}
            </Tag>
          ))}
        </Space>

        {machine.has_credentials && machine.kind === 'admin' ? (
          <Alert
            type="info"
            showIcon
            message="Credentials are held by the platform"
            description="Assigned users can run tasks but never see the stored credentials."
          />
        ) : null}
        {machine.has_credentials && machine.kind === 'personal' ? (
          <Button
            icon={<KeyOutlined />}
            onClick={async () => {
              if (credentials === undefined) {
                try {
                  setCredentials(await readCredentials(machine.id));
                } catch (err) {
                  antdMessage.error(describeError(err));
                  return;
                }
              }
              antdMessage.info(JSON.stringify(credentials ?? {}));
            }}
          >
            View credentials (owner only)
          </Button>
        ) : null}
        {machine.connection_type === 'ssh' ? (
          <Button
            icon={<LinkOutlined />}
            loading={testingConn}
            onClick={async () => {
              setTestingConn(true);
              try {
                const res = await testMachineConnection(machine.id);
                if (res.ok) {
                  antdMessage.success(`SSH connection OK (${res.latency_ms ?? 0}ms)`);
                } else {
                  antdMessage.error(`SSH connection failed: ${res.error || 'Host unreachable'}`);
                }
              } catch (err) {
                antdMessage.error(describeError(err));
              } finally {
                setTestingConn(false);
              }
            }}
          >
            Test SSH connection
          </Button>
        ) : null}

        {canManage ? (
          <>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              Shared with
            </Typography.Title>
            {grants.length === 0 ? (
              <Typography.Text type="secondary">Not shared yet.</Typography.Text>
            ) : (
              grants.map((grant) => {
                const isTeam = grant.grantee_type === 'team';
                const displayName = isTeam
                  ? teams.find((t) => t.id === grant.grantee_id)?.name ?? grant.grantee_id
                  : users.find((u) => u.id === grant.grantee_id)?.username ?? grant.grantee_id;
                return (
                  <Space key={grant.id}>
                    <Tag color="purple">{grant.permission}</Tag>
                    <Tag color={isTeam ? 'cyan' : 'geekblue'}>{grant.grantee_type}</Tag>
                    <Typography.Text>{displayName}</Typography.Text>
                    <Button type="link" size="small" onClick={() => void revokeShare(grant.id)}>
                      Remove
                    </Button>
                  </Space>
                );
              })
            )}
            <Space.Compact style={{ width: '100%' }}>
              <Select
                value={granteeType}
                onChange={(v) => {
                  setGranteeType(v);
                  setSelectedGrantee(null);
                }}
                style={{ width: 100 }}
                options={[
                  { value: 'user', label: 'User' },
                  { value: 'team', label: 'Team' },
                ]}
              />
              <Select
                placeholder={granteeType === 'user' ? 'Select user' : 'Select team'}
                style={{ flex: 1 }}
                value={selectedGrantee}
                onChange={setSelectedGrantee}
                showSearch
                filterOption={(input, opt) =>
                  (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={
                  granteeType === 'user'
                    ? users
                        .filter(
                          (u) =>
                            u.id !== machine.owner_id &&
                            !grants.some((g) => g.grantee_type === 'user' && g.grantee_id === u.id),
                        )
                        .map((u) => ({
                          value: u.id,
                          label: `${u.username}${u.display_name ? ` (${u.display_name})` : ''}`,
                        }))
                    : teams
                        .filter(
                          (t) =>
                            !grants.some((g) => g.grantee_type === 'team' && g.grantee_id === t.id),
                        )
                        .map((t) => ({ value: t.id, label: t.name }))
                }
              />
              <Select
                value={grantPermission}
                onChange={setGrantPermission}
                style={{ width: 105 }}
                options={[
                  { value: 'operator', label: 'Operator' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
              />
              <Button
                type="primary"
                disabled={!selectedGrantee}
                onClick={() => {
                  if (selectedGrantee) {
                    void share(granteeType, selectedGrantee, grantPermission);
                  }
                }}
              >
                Share
              </Button>
            </Space.Compact>

            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              Transfer ownership
            </Typography.Title>
            <Select
              placeholder="Transfer to user"
              style={{ width: '100%' }}
              value={null}
              onChange={(value: string) => {
                Modal.confirm({
                  title: 'Transfer this machine?',
                  content: 'You will lose management control unless re-shared.',
                  onOk: () => void transfer(value),
                });
              }}
              options={users
                .filter((u) => u.id !== machine.owner_id)
                .map((u) => ({ value: u.id, label: u.username }))}
            />

            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => {
                Modal.confirm({
                  title: `确认删除机器节点 “${machine.name}”？`,
                  content:
                    '删除后该节点将从页面列表中移除，并注销其运行权限。数据库将保留历史标记以供既往流水线索引，新发起的流水线无法再使用该节点。',
                  okText: '确认删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async () => {
                    await revokeMachine(machine.id);
                    antdMessage.success('机器节点已成功删除');
                    onClose();
                  },
                });
              }}
            >
              删除该机器节点
            </Button>
          </>
        ) : null}
      </Space>
    </Drawer>
  );
}

export function MachinesPage(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useApiQuery(['machines'], listMachines);
  const [drawer, setDrawer] = useState<Machine | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [form] = Form.useForm<RegisterFormValues>();
  const registerMutation = useApiMutation<
    { machine: Machine; token: string },
    RegisterMachineRequest
  >(
    {
      mutationFn: async (values) => await registerMachine(values),
    },
    [['machines']],
  );

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      const payload: RegisterMachineRequest = {
        name: values.name,
        max_concurrency: values.max_concurrency,
        notes: values.notes,
        connection_type: values.connection_type || 'agent',
        ...(values.connection_type === 'ssh'
          ? {
              connection: {
                host: values.host || '',
                port: values.port ? Number(values.port) : 22,
                username: values.username || '',
                ...(values.auth_type === 'private_key'
                  ? { private_key: values.private_key }
                  : { password: values.password }),
              },
            }
          : {}),
      };
      const res = await registerMutation.mutateAsync(payload);
      setRegisterOpen(false);
      form.resetFields();
      if (res.token) {
        setNewToken(res.token);
      } else {
        antdMessage.success('SSH machine registered successfully');
      }
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const columns: TableColumnsType<Machine> = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (value: string, record) => (
        <Space>
          <ApiOutlined style={{ color: record.online ? '#52c41a' : undefined }} />
          <a onClick={() => setDrawer(record)}>{value}</a>
        </Space>
      ),
    },
    {
      title: 'Mode',
      dataIndex: 'connection_type',
      render: (value: string) =>
        value === 'ssh' ? <Tag color="orange">SSH</Tag> : <Tag color="cyan">Agent</Tag>,
    },
    {
      title: 'Kind',
      dataIndex: 'kind',
      render: (value: string) => (
        <Tag color={value === 'admin' ? 'geekblue' : 'green'}>
          {value === 'admin' ? 'admin pool' : 'personal'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'online',
      render: (value: boolean, record) =>
        record.connection_type === 'ssh' ? (
          <Tag color="blue">SSH Host</Tag>
        ) : value ? (
          <Tag color="success">online</Tag>
        ) : (
          <Tag>offline</Tag>
        ),
    },
    {
      title: 'Concurrency',
      dataIndex: 'max_concurrency',
    },
    {
      title: 'Runner',
      dataIndex: 'agent_version',
      render: (value: string | null, record) =>
        record.connection_type === 'ssh' ? 'SSH/SFTP' : value ? `v${value}` : '—',
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_value, record) => (
        <Space>
          {record.connection_type === 'ssh' ? (
            <Button
              size="small"
              icon={<LinkOutlined />}
              onClick={async () => {
                antdMessage.loading({
                  content: 'Testing SSH connection...',
                  key: `test-${record.id}`,
                });
                try {
                  const res = await testMachineConnection(record.id);
                  if (res.ok) {
                    antdMessage.success({
                      content: `Connected successfully (${res.latency_ms ?? 0}ms)`,
                      key: `test-${record.id}`,
                    });
                  } else {
                    antdMessage.error({
                      content: `Connection failed: ${res.error ?? 'Unreachable'}`,
                      key: `test-${record.id}`,
                    });
                  }
                } catch (err) {
                  antdMessage.error({
                    content: describeError(err),
                    key: `test-${record.id}`,
                  });
                }
              }}
            >
              Test
            </Button>
          ) : record.can_manage ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={async () => {
                const { token } = await rotateMachineToken(record.id);
                setNewToken(token);
                void refetch();
              }}
            >
              New token
            </Button>
          ) : null}
          <Button
            type="primary"
            ghost
            size="small"
            icon={<DesktopOutlined />}
            onClick={() => {
              const tabId = `machine-console:${record.id}`;
              openTab(tabId, {
                id: tabId,
                type: 'machine-console',
                title: `控制台: ${record.name}`,
                props: {
                  machineName: record.name,
                  connectionType: record.connection_type,
                },
              });
            }}
          >
            控制台与监控
          </Button>
          <Button size="small" onClick={() => setDrawer(record)}>
            管理
          </Button>
          {record.can_manage ? (
            <Popconfirm
              title={`确认删除机器 “${record.name}”？`}
              description="删除后节点将从页面移除，数据库保留历史标记供流水线历史索引。"
              okText="删除"
              okType="danger"
              cancelText="取消"
              onConfirm={async () => {
                try {
                  await revokeMachine(record.id);
                  antdMessage.success('机器节点已成功删除');
                  void refetch();
                } catch (err) {
                  antdMessage.error(describeError(err));
                }
              }}
            >
              <Button danger size="small" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  const { openTab } = useWorkbenchStore();
  const [activeTab, setActiveTab] = useState<'machines' | 'environments'>('machines');

  return (
    <>
      <PageHeader
        title="计算节点与运行环境 (Machines & Environments)"
        description="管理分布式 Runner 节点、SSH 远端主机，以及多机一键下发装配 Python/Node 运行环境"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              刷新
            </Button>
            {activeTab === 'machines' && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  form.resetFields();
                  setRegisterOpen(true);
                }}
              >
                注册新机器节点
              </Button>
            )}
          </Space>
        }
      />
      <div className="app-content-card">
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'machines' | 'environments')}
          items={[
            {
              key: 'machines',
              label: '机器节点列表',
              children: isLoading ? (
                <Loading rows={5} />
              ) : error ? (
                <ErrorAlert error={error} onRetry={() => refetch()} />
              ) : (data?.length ?? 0) === 0 ? (
                <EmptyState description="暂无计算机器，请点击右上角注册 Runner 或 SSH 主机" />
              ) : (
                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={data ?? []}
                  pagination={false}
                />
              ),
            },
            {
              key: 'environments',
              label: '运行时环境管理与批量下发',
              children: <EnvironmentTab machines={data ?? []} />,
            },
          ]}
        />
      </div>

      <Modal
        title="Register a Machine"
        open={registerOpen}
        onCancel={() => setRegisterOpen(false)}
        footer={null}
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={onSubmit}
          initialValues={{
            connection_type: 'agent',
            max_concurrency: 2,
            port: 22,
            auth_type: 'password',
          }}
        >
          <Form.Item name="connection_type" label="Connection Mode">
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="agent">Agent (Runner pulls, one-line install)</Radio.Button>
              <Radio.Button value="ssh">SSH (Server pushes via SSH/SFTP)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="name" label="Machine name" rules={[{ required: true, message: 'Machine name is required' }]}>
            <Input placeholder="my-laptop or prod-runner-01" />
          </Form.Item>

          <Form.Item name="max_concurrency" label="Max concurrent tasks">
            <InputNumber min={1} max={64} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, curr) => prev.connection_type !== curr.connection_type}
          >
            {({ getFieldValue }) =>
              getFieldValue('connection_type') === 'ssh' ? (
                <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, marginBottom: 16 }}>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                    SSH Connection Details:
                  </Typography.Text>
                  <Space style={{ width: '100%', display: 'flex' }}>
                    <Form.Item
                      name="host"
                      label="Host / IP"
                      rules={[{ required: true, message: 'Host is required' }]}
                      style={{ flex: 3 }}
                    >
                      <Input placeholder="192.168.1.100 or server.domain" />
                    </Form.Item>
                    <Form.Item name="port" label="Port" style={{ flex: 1 }}>
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Space>
                  <Form.Item
                    name="username"
                    label="SSH Username"
                    rules={[{ required: true, message: 'SSH username is required' }]}
                  >
                    <Input placeholder="ubuntu / root / runner" />
                  </Form.Item>
                  <Form.Item name="auth_type" label="Authentication Method">
                    <Radio.Group>
                      <Radio value="password">Password</Radio>
                      <Radio value="private_key">Private Key</Radio>
                    </Radio.Group>
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, curr) => prev.auth_type !== curr.auth_type}
                  >
                    {({ getFieldValue: getAuthField }) =>
                      getAuthField('auth_type') === 'private_key' ? (
                        <Form.Item
                          name="private_key"
                          label="Private Key (PEM format)"
                          rules={[{ required: true, message: 'Private key is required' }]}
                        >
                          <Input.TextArea
                            rows={4}
                            placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                            style={{ fontFamily: 'monospace' }}
                          />
                        </Form.Item>
                      ) : (
                        <Form.Item
                          name="password"
                          label="SSH Password"
                          rules={[{ required: true, message: 'Password is required' }]}
                        >
                          <Input.Password placeholder="SSH account password" />
                        </Form.Item>
                      )
                    }
                  </Form.Item>
                </div>
              ) : null
            }
          </Form.Item>

          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Where is this machine, who owns the hardware…" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={registerMutation.isPending}>
            Register Machine
          </Button>
        </Form>
      </Modal>

      <TokenOnceModal token={newToken} onClose={() => setNewToken(null)} />
      <MachineDrawer machine={drawer} onClose={() => setDrawer(null)} />
    </>
  );
}

export default MachinesPage;
