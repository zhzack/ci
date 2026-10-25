import React from 'react';
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
  theme as antdTheme,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ApiOutlined,
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  EditOutlined,
  KeyOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
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
  getMachineDeployKey,
  listGrants,
  createGrant,
  deleteGrant,
  listTeams,
  type Machine,
  type RegisterMachineRequest,
  type DeployKeyInfo,
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
  const { token: themeToken } = antdTheme.useToken();
  const serverUrl = window.location.origin;
  const winCmd = `powershell -c "irm '${serverUrl}/install.ps1?token=${token ?? ''}&server=${encodeURIComponent(serverUrl)}' | iex"`;
  const unixCmd = `curl -fsSL "${serverUrl}/install.sh?token=${token ?? ''}&server=${encodeURIComponent(serverUrl)}" | bash`;
  const universalCmd = `powershell -c "irm '${serverUrl}/install.ps1?token=${token ?? ''}&server=${encodeURIComponent(serverUrl)}' | iex"`;
  const manualCmd = `mini-pipeline-runner --server ${serverUrl} --token ${token ?? ''}`;

  const copyToClipboard = (text: string, title = '命令') => {
    void navigator.clipboard.writeText(text);
    antdMessage.success(`已成功复制 ${title} 到剪贴板`);
  };

  return (
    <Modal
      open={token !== null}
      title="机器注册成功 — 一键安装与启动 Runner Agent"
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="ok" type="primary" onClick={onClose}>
          我已部署 / 已妥善保存 Token
        </Button>,
      ]}
    >
      <Alert
        type="warning"
        showIcon
        message="Runner Token 仅在注册时展示一次"
        description="请妥善保管。点击下方对应操作系统的一键复制按钮，在目标机器终端粘贴运行即可自动完成环境准备、下载与启动！"
      />
      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <Typography.Text strong>Runner Token:</Typography.Text>
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => copyToClipboard(token ?? '', 'Runner Token')}
          >
            一键复制 Token
          </Button>
        </div>
        <Input.TextArea
          readOnly
          value={token ?? ''}
          autoSize
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            background: themeToken.colorFillTertiary,
          }}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Typography.Text strong>一键自动安装与部署命令 (推荐):</Typography.Text>
        <Tabs
          defaultActiveKey="windows"
          style={{ marginTop: 6 }}
          items={[
            {
              key: 'windows',
              label: '🪟 Windows (PowerShell)',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      在 Windows PowerShell 终端中执行（自动检测 Python、创建环境、下载并启动）:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(winCmd, 'Windows 部署命令')}
                    >
                      一键复制部署命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={winCmd}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'unix',
              label: '🐧 Linux / macOS',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      在 Linux / macOS 的 bash 或 zsh 终端中执行:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(unixCmd, 'Linux/macOS 部署命令')}
                    >
                      一键复制部署命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={unixCmd}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'universal',
              label: '🌐 通用自动识别',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      服务端自动根据终端 User-Agent 返回对应平台的安装脚本:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(universalCmd, '通用部署命令')}
                    >
                      一键复制部署命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    value={universalCmd}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'manual',
              label: '🛠️ 手动 CLI 启动',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      如果机器已安装 mini-pipeline CLI:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(manualCmd, 'CLI 启动命令')}
                    >
                      一键复制命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize
                    value={manualCmd}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
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
        message="管理员/特权任务执行提示"
        description="如果流水线步骤或插件需要 Administrator / root 权限，请在以管理员身份运行的终端中执行上述安装命令。Runner 及其所有派生的子构建任务将继承该权限运行。"
      />
    </Modal>
  );
}

function MachineDrawer({
  machine,
  onClose,
  onUpdated,
}: {
  machine: Machine | null;
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [grants, setGrants] = React.useState<Awaited<ReturnType<typeof listGrants>>>([]);
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [teams, setTeams] = React.useState<Team[]>([]);
  const [granteeType, setGranteeType] = React.useState<'user' | 'team'>('user');
  const [selectedGrantee, setSelectedGrantee] = React.useState<string | null>(null);
  const [grantPermission, setGrantPermission] = React.useState<'operator' | 'viewer'>('operator');
  const [credentials, setCredentials] = React.useState<Record<string, string> | null | undefined>(undefined);
  const [testingConn, setTestingConn] = React.useState(false);

  // Edit fields state
  const [editName, setEditName] = React.useState('');
  const [editConcurrency, setEditConcurrency] = React.useState(1);
  const [editNotes, setEditNotes] = React.useState('');
  const [savingConfig, setSavingConfig] = React.useState(false);

  const canManage = machine?.can_manage ?? false;

  React.useEffect(() => {
    if (!machine) return;
    setEditName(machine.name || '');
    setEditConcurrency(machine.max_concurrency || 1);
    setEditNotes(machine.notes || '');

    void listGrants('machine', machine.id).then(setGrants).catch(() => setGrants([]));
    if (canManage) {
      void adminListUsers().then(setUsers).catch(() => setUsers([]));
      void listTeams().then(setTeams).catch(() => setTeams([]));
    }
  }, [machine, canManage]);

  if (!machine) {
    return <Drawer open={false} onClose={onClose} />;
  }

  const saveMachineConfig = async () => {
    if (!editName.trim()) {
      antdMessage.warning('机器名称不能为空');
      return;
    }
    setSavingConfig(true);
    try {
      await updateMachine(machine.id, {
        name: editName.trim(),
        max_concurrency: editConcurrency,
        notes: editNotes,
      });
      antdMessage.success('机器配置与名称已成功保存');
      onUpdated?.();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setSavingConfig(false);
    }
  };

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
      onUpdated?.();
      onClose();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const isBuiltin = machine.labels?.builtin || machine.id === 'master-local' || machine.connection_type === 'builtin';

  return (
    <Drawer title={`节点详情 · ${machine.name}`} open onClose={onClose} width={520}>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Space wrap>
          {isBuiltin ? (
            <Tag color="gold" style={{ fontWeight: 500 }}>
              👑 Master 内置节点 (管理员专享)
            </Tag>
          ) : (
            <Tag color={machine.kind === 'admin' ? 'geekblue' : 'green'}>
              {machine.kind === 'admin' ? '管理员共享池' : '个人节点'}
            </Tag>
          )}
          <Tag color={machine.online ? 'success' : 'default'}>
            {machine.online ? '🟢 在线 (Online)' : '⚪ 离线 (Offline)'}
          </Tag>
          {machine.connection_type === 'ssh' ? (
            <Tag color="orange">🌐 SSH 远程主机</Tag>
          ) : isBuiltin ? (
            <Tag color="purple">👑 Built-in Server</Tag>
          ) : (
            <Tag color="cyan">🤖 Agent Runner</Tag>
          )}
          {machine.agent_version ? <Tag>v{machine.agent_version}</Tag> : null}
        </Space>

        {/* 1. Basic configuration and custom name */}
        <Card size="small" title="⚙️ 基础配置与自定义名称 (可修改)">
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                自定义显示名称 (Custom Name):
              </Typography.Text>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="例如: 前端构建机-01, 编译专用机"
                disabled={!canManage}
              />
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                最大并发任务数:
              </Typography.Text>
              <InputNumber
                min={1}
                max={64}
                value={editConcurrency}
                onChange={(v) => setEditConcurrency(v || 1)}
                style={{ width: '100%' }}
                disabled={!canManage}
              />
            </div>
            <div>
              <Typography.Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                备注信息 (Notes):
              </Typography.Text>
              <Input.TextArea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="填写节点用途、放置机房等..."
                disabled={!canManage}
              />
            </div>
            {canManage && (
              <Button
                type="primary"
                loading={savingConfig}
                onClick={saveMachineConfig}
                style={{ width: '100%' }}
              >
                保存基础信息修改
              </Button>
            )}
          </Space>
        </Card>

        {/* 2. Hardware and host telemetry */}
        <Card size="small" title="🖥️ 机器硬件与系统信息">
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="secondary">机器自身主机名 (Hostname):</Typography.Text>
              <Typography.Text strong code style={{ fontSize: 12 }}>
                {machine.hostname || machine.labels?.hostname || '尚未连接上报'}
              </Typography.Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">操作系统与架构:</Typography.Text>
              <Typography.Text>
                {machine.platform || machine.labels?.platform || '—'}{' '}
                {machine.arch || machine.labels?.arch ? `(${machine.arch || machine.labels?.arch})` : ''}
              </Typography.Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">系统发行版 / 内核:</Typography.Text>
              <Typography.Text>{machine.os_release || machine.labels?.os_release || '—'}</Typography.Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography.Text type="secondary">连接模式:</Typography.Text>
              <Typography.Text>
                {isBuiltin
                  ? '👑 Built-in Server (本地内置)'
                  : machine.connection_type === 'ssh'
                  ? '🌐 SSH (远程推送模式)'
                  : '🤖 Agent (长轮询 Pull 模式)'}
              </Typography.Text>
            </div>
            {machine.last_heartbeat && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography.Text type="secondary">最近心跳时间:</Typography.Text>
                <Typography.Text style={{ fontSize: 12 }}>
                  {new Date(machine.last_heartbeat).toLocaleString()}
                </Typography.Text>
              </div>
            )}
          </Space>
        </Card>

        {machine.has_credentials && machine.kind === 'admin' ? (
          <Alert
            type="info"
            showIcon
            message="机密信息受平台安全托管"
            description="被分配的用户可以安全调度运行任务，但无法查看原始密码/私钥。"
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
            查看凭证 (仅机主可见)
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
                  antdMessage.success(`SSH 连接成功 (${res.latency_ms ?? 0}ms)`);
                } else {
                  antdMessage.error(`SSH 连接失败: ${res.error || 'Host unreachable'}`);
                }
              } catch (err) {
                antdMessage.error(describeError(err));
              } finally {
                setTestingConn(false);
              }
            }}
          >
            测试 SSH 连通性
          </Button>
        ) : null}

        {canManage ? (
          <>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              共享与权限 (Shared with)
            </Typography.Title>
            {grants.length === 0 ? (
              <Typography.Text type="secondary">尚未共享给其他用户或团队。</Typography.Text>
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
                      取消共享
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
                  { value: 'user', label: '用户' },
                  { value: 'team', label: '团队' },
                ]}
              />
              <Select
                placeholder={granteeType === 'user' ? '选择用户' : '选择团队'}
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
                  { value: 'operator', label: '可调度' },
                  { value: 'viewer', label: '仅查看' },
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
                添加共享
              </Button>
            </Space.Compact>

            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              转移所有权 (Transfer ownership)
            </Typography.Title>
            <Select
              placeholder="选择转移接收人"
              style={{ width: '100%' }}
              value={null}
              onChange={(value: string) => {
                Modal.confirm({
                  title: '确认转移机器所有权？',
                  content: '转移后您将失去管理控制权，除非新机主重新向您共享。',
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
                    onUpdated?.();
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
  const { token: themeToken } = antdTheme.useToken();
  const { data, isLoading, error, refetch } = useApiQuery(['machines'], listMachines);
  const [drawer, setDrawer] = useState<Machine | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [deployKeyModalOpen, setDeployKeyModalOpen] = useState(false);
  const [deployKeyData, setDeployKeyData] = useState<DeployKeyInfo | null>(null);
  const [deployKeyLoading, setDeployKeyLoading] = useState(false);

  // Quick Rename Modal state
  const [renameTarget, setRenameTarget] = useState<Machine | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Uninstallation Modal state
  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [purgeEnvironments, setPurgeEnvironments] = useState(true);

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

  const handleViewDeployKey = async (machineId?: string) => {
    setDeployKeyLoading(true);
    setDeployKeyModalOpen(true);
    try {
      const res = await getMachineDeployKey(machineId);
      setDeployKeyData(res);
    } catch (err) {
      antdMessage.error('无法获取部署公钥: ' + describeError(err));
    } finally {
      setDeployKeyLoading(false);
    }
  };

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
      title: '机器名称 (自定义与主机名)',
      dataIndex: 'name',
      render: (value: string, record) => {
        const isBuiltin = record.labels?.builtin || record.id === 'master-local';
        const hostname = record.hostname || record.labels?.hostname;
        return (
          <Space direction="vertical" size={2}>
            <Space size={6} wrap>
              <ApiOutlined style={{ color: record.online ? '#52c41a' : undefined }} />
              <a onClick={() => setDrawer(record)} style={{ fontWeight: 600, fontSize: 14 }}>
                {value}
              </a>
              {record.can_manage && !isBuiltin && (
                <Tooltip title="修改机器自定义名称">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined style={{ color: themeToken.colorTextSecondary }} />}
                    onClick={() => {
                      setRenameTarget(record);
                      setRenameValue(record.name);
                    }}
                  />
                </Tooltip>
              )}
              {isBuiltin && (
                <Tag color="gold" style={{ marginLeft: 2, fontWeight: 500 }}>
                  👑 Master 内置节点 (管理员专享)
                </Tag>
              )}
            </Space>
            {hostname && (
              <Space size={4}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  真实主机:
                </Typography.Text>
                <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 11, margin: 0 }}>
                  💻 {hostname}
                </Tag>
              </Space>
            )}
          </Space>
        );
      },
    },
    {
      title: '机器类型与系统架构',
      key: 'machine_type',
      render: (_value, record) => {
        const isBuiltin =
          record.labels?.builtin ||
          record.id === 'master-local' ||
          (record.connection_type as string) === 'builtin';
        if (isBuiltin) {
          return <Tag color="purple">👑 Built-in Server</Tag>;
        }
        if (record.connection_type === 'ssh') {
          return <Tag color="orange">🌐 SSH 远程主机</Tag>;
        }
        const platform = (record.platform || record.labels?.platform || '').toLowerCase();
        const arch = record.arch || record.labels?.arch || 'x64';
        if (platform.includes('win')) {
          return <Tag color="blue">🪟 Windows ({arch})</Tag>;
        }
        if (platform.includes('linux')) {
          return <Tag color="green">🐧 Linux ({arch})</Tag>;
        }
        if (platform.includes('darwin') || platform.includes('mac')) {
          return <Tag color="magenta">🍎 macOS ({arch})</Tag>;
        }
        return <Tag color="cyan">🤖 Agent Runner</Tag>;
      },
    },
    {
      title: '归属类型',
      dataIndex: 'kind',
      render: (value: string) => (
        <Tag color={value === 'admin' ? 'geekblue' : 'green'}>
          {value === 'admin' ? '管理员共享池' : '个人节点'}
        </Tag>
      ),
    },
    {
      title: '运行状态',
      dataIndex: 'online',
      render: (value: boolean, record) =>
        record.connection_type === 'ssh' ? (
          <Tag color="blue">SSH 远端</Tag>
        ) : value ? (
          <Tag color="success">🟢 在线</Tag>
        ) : (
          <Tag>⚪ 离线</Tag>
        ),
    },
    {
      title: '并发上限',
      dataIndex: 'max_concurrency',
    },
    {
      title: 'Agent 版本',
      dataIndex: 'agent_version',
      render: (value: string | null, record) =>
        record.connection_type === 'ssh' ? 'SSH/SFTP' : value ? `v${value}` : '—',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value, record) => (
        <Space wrap size={6}>
          {record.can_manage && !record.labels?.builtin && record.id !== 'master-local' && (
            <Button
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setRenameTarget(record);
                setRenameValue(record.name);
              }}
            >
              重命名
            </Button>
          )}
          <Button
            size="small"
            icon={<SafetyCertificateOutlined style={{ color: themeToken.colorPrimary }} />}
            onClick={() => handleViewDeployKey(record.id)}
          >
            部署公钥
          </Button>
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
              测试连接
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
              重置 Token
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
                  machineId: record.id,
                  machineName: record.name,
                  connectionType: record.connection_type,
                  hostname: record.hostname || record.labels?.hostname,
                  platform: record.platform || record.labels?.platform,
                  osRelease: record.os_release || record.labels?.os_release,
                  arch: record.arch || record.labels?.arch,
                  online: record.online,
                  lastHeartbeat: record.last_heartbeat,
                },
              });
            }}
          >
            控制台与监控
          </Button>
          <Button size="small" onClick={() => setDrawer(record)}>
            管理 / 详情
          </Button>
          {record.can_manage && !record.labels?.builtin && record.id !== 'master-local' ? (
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
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={() => setUninstallModalOpen(true)}
            >
              🗑️ 一键卸载指令
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              onClick={() => handleViewDeployKey()}
            >
              🔑 部署公钥 (Deploy Key)
            </Button>
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
                <div
                  style={{
                    background: themeToken.colorFillTertiary,
                    border: `1px solid ${themeToken.colorBorderSecondary}`,
                    padding: 12,
                    borderRadius: 6,
                    marginBottom: 16,
                  }}
                >
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

      <Modal
        title={
          <Space align="center">
            <SafetyCertificateOutlined style={{ color: themeToken.colorPrimary }} />
            <span>
              {deployKeyData?.machine_name
                ? `机器部署公钥: ${deployKeyData.machine_name}`
                : '服务端主机部署公钥 (Master SSH Deploy Key)'}
            </span>
          </Space>
        }
        open={deployKeyModalOpen}
        onCancel={() => setDeployKeyModalOpen(false)}
        width={680}
        footer={[
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => {
              if (deployKeyData?.public_key) {
                navigator.clipboard.writeText(deployKeyData.public_key);
                antdMessage.success('已复制 SSH 部署公钥到剪贴板');
              }
            }}
          >
            一键复制公钥
          </Button>,
          <Button key="close" onClick={() => setDeployKeyModalOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          message="GitLab / GitHub 免密打通与部署指引"
          description="将下方生成的机器 SSH 部署公钥添加到 GitLab/GitHub 仓库设置（Settings -> Repository -> Deploy Keys）中，勾选 Write access 权限，即可实现执行任务或拉取代码时完全免输账号密码。"
          style={{ marginBottom: 16 }}
        />

        {deployKeyLoading ? (
          <Loading rows={3} />
        ) : (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Space size={12}>
                <Typography.Text strong>密钥类型:</Typography.Text>
                <Tag color="cyan">{deployKeyData?.key_type || 'ssh-ed25519'}</Tag>
                <Typography.Text strong>指纹 (Fingerprint):</Typography.Text>
                <Tag color="purple">{deployKeyData?.fingerprint || '—'}</Tag>
              </Space>
            </div>

            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>OpenSSH 部署公钥明文 (Public Key):</Typography.Text>
            </div>
            <Input.TextArea
              readOnly
              rows={4}
              value={deployKeyData?.public_key || ''}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                background: themeToken.colorFillAlter,
                cursor: 'pointer',
              }}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
        )}
      </Modal>

      {/* Quick Rename Machine Modal */}
      <Modal
        title="修改机器自定义名称"
        open={renameTarget !== null}
        onCancel={() => setRenameTarget(null)}
        confirmLoading={renaming}
        onOk={async () => {
          if (!renameTarget || !renameValue.trim()) {
            antdMessage.warning('请输入有效的机器名称');
            return;
          }
          setRenaming(true);
          try {
            await updateMachine(renameTarget.id, { name: renameValue.trim() });
            antdMessage.success(`机器已成功重命名为 “${renameValue.trim()}”`);
            setRenameTarget(null);
            void refetch();
          } catch (err) {
            antdMessage.error(describeError(err));
          } finally {
            setRenaming(false);
          }
        }}
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 12, padding: '8px 12px', background: themeToken.colorFillAlter, borderRadius: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>
              机器自身主机名 (Hostname):
            </Typography.Text>
            <Typography.Text strong code style={{ fontSize: 13 }}>
              {renameTarget?.hostname || renameTarget?.labels?.hostname || '尚未连接上报'}
            </Typography.Text>
          </div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            自定义显示名称 (Custom Name):
          </Typography.Text>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="例如: 前端构建机-01, 编译专用机"
            autoFocus
          />
        </div>
      </Modal>

      {/* One-click Uninstallation Modal */}
      <Modal
        title="🗑️ Mini Pipeline Runner 一键卸载与清理"
        open={uninstallModalOpen}
        onCancel={() => setUninstallModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setUninstallModalOpen(false)}>
            完成
          </Button>,
        ]}
        width={720}
      >
        <Alert
          type="info"
          showIcon
          message="一键注销与清理说明"
          description="在目标机器终端中执行下方指令，将自动终止 Runner 进程、注销系统开机自启服务/守护进程，并清除本地配置与 Token。"
          style={{ marginBottom: 16 }}
        />

        <div
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: themeToken.colorFillAlter,
            borderRadius: 6,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ maxWidth: '75%' }}>
            <Typography.Text strong style={{ display: 'block' }}>
              彻底清除已下载的运行环境与 Python 虚拟环境:
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {purgeEnvironments
                ? '已开启：将彻底删除 ~/.mini-pipeline-runner 目录（包含 Python venv、运行时包与缓存）'
                : '已关闭：将保留已下载的 Python 虚拟环境与依赖，仅注销 Token、删除启动脚本与配置'}
            </Typography.Text>
          </div>
          <Switch
            checked={purgeEnvironments}
            onChange={(checked) => setPurgeEnvironments(checked)}
            checkedChildren="彻底清除"
            unCheckedChildren="保留环境"
          />
        </div>

        <Tabs
          defaultActiveKey="windows"
          items={[
            {
              key: 'windows',
              label: '🪟 Windows (PowerShell)',
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      在 Windows 机器的 PowerShell 中执行:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        const cmd = `powershell -c "irm '${window.location.origin}/uninstall.ps1?purge=${purgeEnvironments}&server=${encodeURIComponent(window.location.origin)}' | iex"`;
                        void navigator.clipboard.writeText(cmd);
                        antdMessage.success('已复制 Windows 一键卸载命令到剪贴板');
                      }}
                    >
                      一键复制卸载命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 3 }}
                    value={`powershell -c "irm '${window.location.origin}/uninstall.ps1?purge=${purgeEnvironments}&server=${encodeURIComponent(window.location.origin)}' | iex"`}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'unix',
              label: '🐧 Linux / macOS',
              children: (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      在 Linux / macOS 机器的 bash/zsh 终端中执行:
                    </Typography.Text>
                    <Button
                      type="primary"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        const cmd = `curl -fsSL "${window.location.origin}/uninstall.sh?purge=${purgeEnvironments}&server=${encodeURIComponent(window.location.origin)}" | bash`;
                        void navigator.clipboard.writeText(cmd);
                        antdMessage.success('已复制 Linux/macOS 一键卸载命令到剪贴板');
                      }}
                    >
                      一键复制卸载命令
                    </Button>
                  </div>
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 2, maxRows: 3 }}
                    value={`curl -fsSL "${window.location.origin}/uninstall.sh?purge=${purgeEnvironments}&server=${encodeURIComponent(window.location.origin)}" | bash`}
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      background: themeToken.colorFillTertiary,
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <TokenOnceModal token={newToken} onClose={() => setNewToken(null)} />
      <MachineDrawer machine={drawer} onClose={() => setDrawer(null)} onUpdated={() => void refetch()} />
    </>
  );
}

export default MachinesPage;
