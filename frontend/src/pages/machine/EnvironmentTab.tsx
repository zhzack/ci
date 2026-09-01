import React, { useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  updateEnvironment,
  type CreateRuntimeEnvironmentPayload,
  type RuntimeEnvironment,
} from '@/api/environment';
import { EnvironmentDeployModal, type MachineOption } from './EnvironmentDeployModal';

interface Props {
  machines: MachineOption[];
}

export function EnvironmentTab({ machines }: Props): React.JSX.Element {
  const { data: envs, isLoading, error, refetch } = useApiQuery(
    ['environments'],
    listEnvironments
  );

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm] = Form.useForm<CreateRuntimeEnvironmentPayload>();
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<RuntimeEnvironment | null>(null);
  const [editForm] = Form.useForm();
  const [editing, setEditing] = useState(false);

  const [deployTarget, setDeployTarget] = useState<RuntimeEnvironment | null>(null);

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await createEnvironment({
        name: values.name.trim(),
        env_type: values.env_type || 'python',
        version: values.version.trim(),
        os_arch: values.os_arch || 'linux-x86_64',
        package_path: values.package_path?.trim() || undefined,
        download_url: values.download_url?.trim() || undefined,
        description: values.description?.trim() || '',
        is_default: values.is_default || false,
      });
      antdMessage.success(`环境 "${values.name}" 注册成功`);
      createForm.resetFields();
      setCreateModalOpen(false);
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    try {
      const values = await editForm.validateFields();
      setEditing(true);
      await updateEnvironment(editTarget.id, {
        name: values.name.trim(),
        env_type: values.env_type,
        version: values.version.trim(),
        os_arch: values.os_arch,
        package_path: values.package_path?.trim() || undefined,
        download_url: values.download_url?.trim() || undefined,
        description: values.description?.trim() || '',
        is_default: values.is_default,
      });
      antdMessage.success(`环境 "${values.name}" 已更新`);
      setEditTarget(null);
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setEditing(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteEnvironment(id);
      antdMessage.success('环境已删除');
      void refetch();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  const columns: TableColumnsType<RuntimeEnvironment> = [
    {
      title: '环境名称 / 标识',
      dataIndex: 'name',
      render: (name: string, record) => (
        <Space direction="vertical" size={2}>
          <Space>
            <Typography.Text strong>{name}</Typography.Text>
            {record.is_default && <Tag color="gold">默认环境</Tag>}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.description || '无详细描述'}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'env_type',
      render: (type: string) => (
        <Tag color={type === 'python' ? 'blue' : type === 'node' ? 'green' : 'default'}>
          {type.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      render: (version: string) => <Tag color="cyan">v{version}</Tag>,
    },
    {
      title: '目标系统架构',
      dataIndex: 'os_arch',
      render: (arch: string) => <Tag>{arch}</Tag>,
    },
    {
      title: '制品仓存储路径 / 来源',
      dataIndex: 'package_path',
      render: (path: string | null, record) => {
        const source = path || record.download_url || '内置预置源';
        return (
          <Typography.Text code style={{ fontSize: 12 }}>
            {source}
          </Typography.Text>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_v, record) => (
        <Space size={8}>
          <Button
            type="primary"
            size="small"
            icon={<RocketOutlined />}
            onClick={() => setDeployTarget(record)}
          >
            一键部署到机器
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditTarget(record);
              editForm.setFieldsValue(record);
            }}
          />
          <Popconfirm
            title="确定删除此环境配置？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const [uninstallModalOpen, setUninstallModalOpen] = useState(false);
  const serverUrl = window.location.origin.replace(':5173', ':8000');
  const unixUninstallCmd = `curl -fsSL "${serverUrl}/uninstall.sh" | bash`;
  const winUninstallCmd = `powershell -c "irm ${serverUrl}/uninstall.ps1 | iex"`;

  if (isLoading) return <Loading rows={5} />;
  if (error) return <ErrorAlert error={error} onRetry={() => refetch()} />;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            运行时环境包管理 (Runtime Packages)
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13, margin: 0 }}>
            管理托管在制品仓库中的 Python、Node 等环境分发包，并支持一键向多台机器批量下发装配。
          </Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<DeleteOutlined />} onClick={() => setUninstallModalOpen(true)}>
            一键卸载/清理命令
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
            注册新环境包
          </Button>
        </Space>
      </div>

      {/* Uninstall Modal */}
      <Modal
        title="一键卸载与环境清理命令"
        open={uninstallModalOpen}
        onCancel={() => setUninstallModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setUninstallModalOpen(false)}>
            我知道了
          </Button>,
        ]}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
          在需要清理环境的目标机器终端中粘贴并运行以下单行命令，将自动停止 Runner 守护进程并彻底删除所有已安装的 Python/Node 运行时与工作区缓存目录：
        </Typography.Paragraph>

        <div style={{ marginBottom: 12 }}>
          <Typography.Text strong>Linux / macOS 卸载命令：</Typography.Text>
          <Input.TextArea
            readOnly
            value={unixUninstallCmd}
            autoSize
            style={{
              marginTop: 4,
              fontFamily: 'JetBrains Mono, monospace',
              background: 'var(--mp-bg-subtle, #f5f5f5)',
              color: 'var(--mp-text-color, inherit)',
            }}
          />
        </div>

        <div>
          <Typography.Text strong>Windows PowerShell 卸载命令：</Typography.Text>
          <Input.TextArea
            readOnly
            value={winUninstallCmd}
            autoSize
            style={{
              marginTop: 4,
              fontFamily: 'JetBrains Mono, monospace',
              background: 'var(--mp-bg-subtle, #f5f5f5)',
              color: 'var(--mp-text-color, inherit)',
            }}
          />
        </div>
      </Modal>

      <Table<RuntimeEnvironment>
        rowKey="id"
        columns={columns}
        dataSource={envs ?? []}
        size="middle"
        pagination={false}
      />

      {/* Deploy to Machines Modal */}
      <EnvironmentDeployModal
        open={Boolean(deployTarget)}
        environment={deployTarget}
        machines={machines}
        onClose={() => setDeployTarget(null)}
      />

      {/* Create Environment Modal */}
      <Modal
        title="注册新运行时环境包"
        open={createModalOpen}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ env_type: 'python', os_arch: 'linux-x86_64', is_default: false }}
          onFinish={handleCreate}
        >
          <Form.Item
            name="name"
            label="环境标识 / 名称"
            rules={[{ required: true, message: '请输入环境名称' }]}
          >
            <Input placeholder="例如: python-3.11-custom" />
          </Form.Item>

          <Space style={{ display: 'flex' }} size={16}>
            <Form.Item name="env_type" label="环境类型" style={{ flex: 1 }}>
              <Select
                options={[
                  { label: 'Python', value: 'python' },
                  { label: 'Node.js', value: 'node' },
                  { label: 'Generic / Other', value: 'generic' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="version"
              label="版本号"
              rules={[{ required: true, message: '请输入版本号' }]}
              style={{ flex: 1 }}
            >
              <Input placeholder="例如: 3.11.9" />
            </Form.Item>
          </Space>

          <Form.Item name="os_arch" label="目标系统架构">
            <Select
              options={[
                { label: 'Linux x86_64 (amd64)', value: 'linux-x86_64' },
                { label: 'Linux aarch64 (arm64)', value: 'linux-aarch64' },
                { label: 'Windows x64', value: 'windows-x64' },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="package_path"
            label="制品仓存储相对路径 (Package Hub Path)"
            extra="如 environments/python-3.11.9-linux-x86_64.tar.gz"
          >
            <Input placeholder="environments/..." />
          </Form.Item>

          <Form.Item name="description" label="描述信息">
            <Input.TextArea rows={2} placeholder="关于该运行时的特性、内置包或用途说明" />
          </Form.Item>

          <Form.Item name="is_default" label="设为该类型默认环境" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={creating} style={{ marginTop: 8 }}>
            确认注册
          </Button>
        </Form>
      </Modal>

      {/* Edit Environment Modal */}
      <Modal
        title="编辑运行时环境"
        open={Boolean(editTarget)}
        onCancel={() => setEditTarget(null)}
        footer={null}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item
            name="name"
            label="环境标识 / 名称"
            rules={[{ required: true, message: '请输入环境名称' }]}
          >
            <Input />
          </Form.Item>

          <Space style={{ display: 'flex' }} size={16}>
            <Form.Item name="env_type" label="环境类型" style={{ flex: 1 }}>
              <Select
                options={[
                  { label: 'Python', value: 'python' },
                  { label: 'Node.js', value: 'node' },
                  { label: 'Generic / Other', value: 'generic' },
                ]}
              />
            </Form.Item>

            <Form.Item name="version" label="版本号" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>

          <Form.Item name="os_arch" label="目标系统架构">
            <Select
              options={[
                { label: 'Linux x86_64 (amd64)', value: 'linux-x86_64' },
                { label: 'Linux aarch64 (arm64)', value: 'linux-aarch64' },
                { label: 'Windows x64', value: 'windows-x64' },
              ]}
            />
          </Form.Item>

          <Form.Item name="package_path" label="制品仓存储相对路径">
            <Input />
          </Form.Item>

          <Form.Item name="description" label="描述信息">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Form.Item name="is_default" label="设为默认环境" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Button type="primary" htmlType="submit" block loading={editing} style={{ marginTop: 8 }}>
            保存修改
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
