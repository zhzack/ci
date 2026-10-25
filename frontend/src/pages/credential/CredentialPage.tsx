import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  App as AntApp,
  theme as antdTheme,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileProtectOutlined,
  GlobalOutlined,
  KeyOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  type CredentialItem,
  type CredentialScope,
  type CredentialType,
  type CreateCredentialRequest,
  type UpdateCredentialRequest,
  createCredential,
  deleteCredential,
  getCredentials,
  getRawCredential,
  updateCredential,
} from '@/api/credentials';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useAuthStore } from '@/store/auth';

export function CredentialPage(): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const { message } = AntApp.useApp();
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === 'admin';

  // Filters state
  const [searchText, setSearchText] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedScope, setSelectedScope] = useState<string>('all');

  // Modal states
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CredentialItem | null>(null);
  const [viewRawItem, setViewRawItem] = useState<{ name: string; type: string; data: Record<string, unknown> } | null>(null);
  const [rawLoadingId, setRawLoadingId] = useState<string | null>(null);

  const [form] = Form.useForm();
  const formType = (Form.useWatch('type', form) || 'username_password') as CredentialType;

  // Query credentials
  const { data: credentials = [], isLoading, refetch } = useApiQuery<CredentialItem[]>(
    ['credentials'],
    getCredentials
  );

  // Mutations
  const createMutation = useApiMutation<CredentialItem, CreateCredentialRequest>(
    {
      mutationFn: createCredential,
      onSuccess: () => {
        message.success('凭据创建成功并已加密安全保存');
        setCreateModalOpen(false);
        form.resetFields();
      },
    },
    [['credentials']]
  );

  const updateMutation = useApiMutation<CredentialItem, { id: string; req: UpdateCredentialRequest }>(
    {
      mutationFn: ({ id, req }) => updateCredential(id, req),
      onSuccess: () => {
        message.success('凭据更新成功');
        setEditingItem(null);
        form.resetFields();
      },
    },
    [['credentials']]
  );

  const deleteMutation = useApiMutation<void, string>(
    {
      mutationFn: deleteCredential,
      onSuccess: () => {
        message.success('凭据已安全删除');
      },
    },
    [['credentials']]
  );

  // Filtered list
  const safeList = useMemo(() => (Array.isArray(credentials) ? credentials : []), [credentials]);

  const filteredList = useMemo(() => {
    return safeList.filter((item) => {
      if (selectedType !== 'all' && item.type !== selectedType) return false;
      if (selectedScope !== 'all' && item.scope !== selectedScope) return false;
      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        const matchName = (item.name || '').toLowerCase().includes(q);
        const matchDesc = (item.description || '').toLowerCase().includes(q);
        const matchOwner = (item.owner_name || '').toLowerCase().includes(q);
        return matchName || matchDesc || matchOwner;
      }
      return true;
    });
  }, [safeList, selectedType, selectedScope, searchText]);

  // Statistics
  const stats = useMemo(() => {
    return {
      total: safeList.length,
      userPass: safeList.filter((c) => c.type === 'username_password').length,
      tokens: safeList.filter((c) => c.type === 'secret_text').length,
      sshKeys: safeList.filter((c) => c.type === 'ssh_key').length,
      files: safeList.filter((c) => c.type === 'secret_file').length,
    };
  }, [safeList]);

  const handleOpenCreate = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({
      type: 'username_password',
      scope: 'personal',
    });
    setCreateModalOpen(true);
  };

  const handleOpenEdit = (item: CredentialItem) => {
    setEditingItem(item);
    form.resetFields();
    form.setFieldsValue({
      name: item.name,
      type: item.type,
      scope: item.scope,
      description: item.description,
      team_id: item.team_id,
      domain_patterns: item.domain_patterns || [],
    });
    setCreateModalOpen(true);
  };

  const handleFormSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = {};

      if (values.type === 'username_password') {
        if (values.username) payload.username = values.username;
        if (values.password) payload.password = values.password;
      } else if (values.type === 'secret_text') {
        if (values.secret) payload.secret = values.secret;
      } else if (values.type === 'ssh_key') {
        if (values.ssh_username) payload.username = values.ssh_username;
        if (values.private_key) payload.private_key = values.private_key;
        if (values.passphrase) payload.passphrase = values.passphrase;
      } else if (values.type === 'secret_file') {
        if (values.filename) payload.filename = values.filename;
        if (values.file_content) payload.content_base64 = values.file_content;
      }

      if (editingItem) {
        await updateMutation.mutateAsync({
          id: editingItem.id,
          req: {
            name: values.name,
            description: values.description,
            scope: values.scope,
            team_id: values.team_id,
            domain_patterns: values.domain_patterns || [],
            payload: Object.keys(payload).length > 0 ? payload : undefined,
          },
        });
      } else {
        await createMutation.mutateAsync({
          name: values.name,
          type: values.type,
          scope: values.scope,
          description: values.description || '',
          team_id: values.team_id,
          domain_patterns: values.domain_patterns || [],
          payload,
        });
      }
    } catch {
      // Form validation error handled by Antd
    }
  };

  const handleViewRaw = async (item: CredentialItem) => {
    setRawLoadingId(item.id);
    try {
      const raw = await getRawCredential(item.id);
      setViewRawItem({
        name: raw.name,
        type: raw.type,
        data: raw.data,
      });
    } catch {
      message.error('无法解密查看此凭据明文');
    } finally {
      setRawLoadingId(null);
    }
  };

  const copyToClipboard = (text: string, tip = '已复制到剪贴板') => {
    navigator.clipboard.writeText(text);
    message.success(tip);
  };

  const renderTypeTag = (type: CredentialType) => {
    switch (type) {
      case 'username_password':
        return (
          <Tag color="blue" icon={<KeyOutlined />}>
            账号与密码
          </Tag>
        );
      case 'secret_text':
        return (
          <Tag color="purple" icon={<LockOutlined />}>
            访问令牌 / Token
          </Tag>
        );
      case 'ssh_key':
        return (
          <Tag color="orange" icon={<SafetyCertificateOutlined />}>
            SSH 部署私钥
          </Tag>
        );
      case 'secret_file':
        return (
          <Tag color="cyan" icon={<FileProtectOutlined />}>
            机密配置文件
          </Tag>
        );
      default:
        return <Tag>{type}</Tag>;
    }
  };

  const renderScopeTag = (scope: CredentialScope, teamName?: string | null) => {
    switch (scope) {
      case 'personal':
        return (
          <Tag color="default" icon={<UserOutlined />}>
            个人私有
          </Tag>
        );
      case 'team':
        return (
          <Tag color="geekblue" icon={<TeamOutlined />}>
            {teamName ? `团队 (${teamName})` : '团队共享'}
          </Tag>
        );
      case 'global':
        return (
          <Tag color="green" icon={<GlobalOutlined />}>
            全局系统
          </Tag>
        );
      default:
        return <Tag>{scope}</Tag>;
    }
  };

  const columns: TableColumnsType<CredentialItem> = [
    {
      title: '凭据名称与标识',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name: string, record: CredentialItem) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <KeyOutlined style={{ color: token.colorPrimary }} />
            <Typography.Text strong style={{ fontSize: 14 }}>
              {name}
            </Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
            ID: {record.id.slice(0, 13)}...
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '凭据类型',
      dataIndex: 'type',
      key: 'type',
      width: 170,
      render: (type: CredentialType) => renderTypeTag(type),
    },
    {
      title: '可见范围',
      dataIndex: 'scope',
      key: 'scope',
      width: 140,
      render: (scope: CredentialScope, record: CredentialItem) =>
        renderScopeTag(scope, record.team_name),
    },
    {
      title: '脱敏数据摘要',
      key: 'data',
      render: (_, record: CredentialItem) => {
        const d = record.data;
        if (record.type === 'username_password') {
          return (
            <Space size={6}>
              <Tag style={{ margin: 0 }}>用户: {d.username || '-'}</Tag>
              <Tag color="processing" style={{ margin: 0 }}>
                密码: {d.password || '••••••••'}
              </Tag>
            </Space>
          );
        }
        if (record.type === 'secret_text') {
          return (
            <Space size={6}>
              <Tag color="purple" style={{ margin: 0 }}>
                {d.preview || '••••••••'}
              </Tag>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                ({d.length || 0} 字符)
              </Typography.Text>
            </Space>
          );
        }
        if (record.type === 'ssh_key') {
          return (
            <Space size={6}>
              {d.username && <Tag style={{ margin: 0 }}>用户: {d.username}</Tag>}
              <Tag color="orange" style={{ margin: 0 }}>
                RSA/ED25519 私钥已加密
              </Tag>
              {d.has_passphrase && <Tag color="gold">含口令</Tag>}
            </Space>
          );
        }
        if (record.type === 'secret_file') {
          return (
            <Space size={6}>
              <Tag color="cyan" style={{ margin: 0 }}>
                {d.filename || 'secret.bin'}
              </Tag>
              <Tag color="green" style={{ margin: 0 }}>
                已加密存储
              </Tag>
            </Space>
          );
        }
        return <Tag>已加密保护</Tag>;
      },
    },
    {
      title: '适用网站与域名范围',
      dataIndex: 'domain_patterns',
      key: 'domain_patterns',
      width: 200,
      render: (patterns: string[]) => {
        if (!patterns || patterns.length === 0) {
          return <Typography.Text type="secondary" style={{ fontSize: 12 }}>全网通用</Typography.Text>;
        }
        return (
          <Space wrap size={4}>
            {patterns.map((p) => (
              <Tag key={p} color="cyan" style={{ fontSize: 11, margin: 0 }}>
                {p}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '描述与用途说明',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
      render: (desc: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {desc || '—'}
        </Typography.Text>
      ),
    },
    {
      title: '所有者',
      dataIndex: 'owner_name',
      key: 'owner_name',
      width: 120,
      render: (owner: string) => (
        <Space size={4}>
          <UserOutlined style={{ fontSize: 11, color: token.colorTextSecondary }} />
          <span style={{ fontSize: 12 }}>{owner || '系统'}</span>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_, record: CredentialItem) => {
        const isOwnerOrAdmin = isAdmin || record.owner_id === currentUser?.id;
        const yamlExpr = `\${{ secrets.${record.name} }}`;

        return (
          <Space size={6}>
            <Tooltip title={`复制流水线表达式: ${yamlExpr}`}>
              <Button
                type="text"
                size="small"
                icon={<CodeOutlined style={{ color: token.colorPrimary }} />}
                onClick={() => copyToClipboard(yamlExpr, `已复制表达式: ${yamlExpr}`)}
              />
            </Tooltip>

            {isOwnerOrAdmin && (
              <Tooltip title="解密并查看明文">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  loading={rawLoadingId === record.id}
                  onClick={() => handleViewRaw(record)}
                />
              </Tooltip>
            )}

            {isOwnerOrAdmin && (
              <Tooltip title="编辑凭据信息">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenEdit(record)}
                />
              </Tooltip>
            )}

            {isOwnerOrAdmin && (
              <Popconfirm
                title="确定删除此凭据？"
                description="删除后，引用此凭据的流水线在执行时将无法获取该密钥。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => deleteMutation.mutateAsync(record.id)}
              >
                <Tooltip title="删除凭据">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <Space align="center" size={10}>
            <div
              style={{
                background: token.colorPrimaryBg,
                color: token.colorPrimary,
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 20,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <KeyOutlined />
            </div>
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                凭证与密钥中心 (Credentials & Secret Vault)
              </Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                安全托管 Git Clone (HTTP/SSH)、私有镜像源、API Token、部署私钥及机密文件，支持在流水线中通过 <code>${'{' + '{ secrets.KEY }' + '}'}</code> 安全调用。
              </Typography.Text>
            </div>
          </Space>
        </div>

        <Space size={10}>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isLoading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
            新建安全凭据
          </Button>
        </Space>
      </div>

      {/* Statistics Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8} md={6} lg={4}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="全部凭据"
              value={stats.total}
              prefix={<KeyOutlined style={{ color: token.colorPrimary }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={5}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="Git / 账号密码"
              value={stats.userPass}
              prefix={<UserOutlined style={{ color: '#1890ff' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={5}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="API 令牌 / Token"
              value={stats.tokens}
              prefix={<LockOutlined style={{ color: '#722ed1' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={5}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="SSH 部署私钥"
              value={stats.sshKeys}
              prefix={<SafetyCertificateOutlined style={{ color: '#fa8c16' }} />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6} lg={5}>
          <Card size="small" style={{ borderRadius: 8 }}>
            <Statistic
              title="机密配置文件"
              value={stats.files}
              prefix={<FileProtectOutlined style={{ color: '#13c2c2' }} />}
            />
          </Card>
        </Col>
      </Row>

      {/* Filter and Search Bar */}
      <Card style={{ borderRadius: 8, marginBottom: 16 }} bodyStyle={{ padding: '14px 18px' }}>
        <Row gutter={[16, 12]} align="middle" justify="space-between">
          <Col xs={24} md={10} lg={8}>
            <Input
              prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
              placeholder="搜索凭据名称、描述或创建者..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
          </Col>

          <Col xs={24} md={14} lg={16}>
            <Space size={12} wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
              <Space size={6}>
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>类型:</span>
                <Select
                  value={selectedType}
                  onChange={setSelectedType}
                  style={{ width: 160 }}
                  options={[
                    { value: 'all', label: '全部类型' },
                    { value: 'username_password', label: '🔑 账号与密码' },
                    { value: 'secret_text', label: '🪙 访问令牌 / Token' },
                    { value: 'ssh_key', label: '🛡️ SSH 部署私钥' },
                    { value: 'secret_file', label: '📄 机密文件' },
                  ]}
                />
              </Space>

              <Space size={6}>
                <span style={{ fontSize: 13, color: token.colorTextSecondary }}>可见范围:</span>
                <Select
                  value={selectedScope}
                  onChange={setSelectedScope}
                  style={{ width: 140 }}
                  options={[
                    { value: 'all', label: '全部范围' },
                    { value: 'personal', label: '👤 个人私有' },
                    { value: 'team', label: '👥 团队共享' },
                    { value: 'global', label: '🌐 全局系统' },
                  ]}
                />
              </Space>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Main Table */}
      <Card style={{ borderRadius: 8 }} bodyStyle={{ padding: 0 }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredList}
          loading={isLoading}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 项凭据`,
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无匹配的安全凭据，点击上方按钮创建新凭据"
              />
            ),
          }}
        />
      </Card>

      {/* Create / Edit Credential Modal */}
      <Modal
        title={
          <Space align="center">
            <KeyOutlined style={{ color: token.colorPrimary }} />
            <span>{editingItem ? `编辑凭据: ${editingItem.name}` : '新建安全凭据 (New Credential)'}</span>
          </Space>
        }
        open={createModalOpen}
        onOk={handleFormSubmit}
        onCancel={() => {
          setCreateModalOpen(false);
          setEditingItem(null);
          form.resetFields();
        }}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={editingItem ? '保存更新' : '安全创建'}
        cancelText="取消"
        width={580}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="凭据标识名称"
            tooltip="在流水线中引用该凭据的变量名，只能包含英文字母、数字、短横线与下划线"
            rules={[
              { required: true, message: '请输入凭据标识名称' },
              {
                pattern: /^[a-zA-Z0-9_.-]{2,64}$/,
                message: '必须为 2-64 位字母、数字、短横线或下划线',
              },
            ]}
          >
            <Input placeholder="例如: gitee-clone-token, github-ci-token, deploy-ssh-key" />
          </Form.Item>

          <Form.Item
            name="type"
            label="凭据类型"
            rules={[{ required: true }]}
            initialValue="username_password"
          >
            <Radio.Group disabled={!!editingItem} buttonStyle="solid" style={{ width: '100%' }}>
              <Row gutter={[8, 8]}>
                <Col span={12}>
                  <Radio.Button value="username_password" style={{ width: '100%', textAlign: 'center' }}>
                    <KeyOutlined /> 账号与密码
                  </Radio.Button>
                </Col>
                <Col span={12}>
                  <Radio.Button value="secret_text" style={{ width: '100%', textAlign: 'center' }}>
                    <LockOutlined /> 访问令牌 / Token
                  </Radio.Button>
                </Col>
                <Col span={12}>
                  <Radio.Button value="ssh_key" style={{ width: '100%', textAlign: 'center' }}>
                    <SafetyCertificateOutlined /> SSH 部署私钥
                  </Radio.Button>
                </Col>
                <Col span={12}>
                  <Radio.Button value="secret_file" style={{ width: '100%', textAlign: 'center' }}>
                    <FileProtectOutlined /> 机密文件 / 配置
                  </Radio.Button>
                </Col>
              </Row>
            </Radio.Group>
          </Form.Item>

          {/* Dynamic Payload Form depending on Type */}
          {formType === 'username_password' && (
            <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
              <Form.Item
                name="username"
                label="账号 / 用户名"
                rules={[{ required: !editingItem, message: '请输入用户名' }]}
              >
                <Input placeholder="例如: git_bot 或 developer@example.com" />
              </Form.Item>
              <Form.Item
                name="password"
                label={editingItem ? '重置密码 / Token (留空则保持不变)' : '密码 / Personal Access Token'}
                rules={[{ required: !editingItem, message: '请输入密码或访问令牌' }]}
                style={{ marginBottom: 0 }}
              >
                <Input.Password placeholder="输入密码或 Personal Access Token" />
              </Form.Item>
            </Card>
          )}

          {formType === 'secret_text' && (
            <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
              <Form.Item
                name="secret"
                label={editingItem ? '重置令牌明文 (留空则保持不变)' : '机密令牌 / API Token 明文'}
                rules={[{ required: !editingItem, message: '请输入敏感令牌内容' }]}
                style={{ marginBottom: 0 }}
              >
                <Input.Password placeholder="例如: ghp_xxxxxxxxxxxxxxxxxxxx, Bearer xxxx" />
              </Form.Item>
            </Card>
          )}

          {formType === 'ssh_key' && (
            <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
              <Form.Item name="ssh_username" label="SSH 登录用户名 (可选)">
                <Input placeholder="例如: git 或 root" />
              </Form.Item>
              <Form.Item
                name="private_key"
                label={editingItem ? '重置 SSH 私钥内容 (留空则保持不变)' : 'SSH 私钥内容 (PEM/OpenSSH)'}
                rules={[{ required: !editingItem, message: '请输入 SSH 私钥' }]}
              >
                <Input.TextArea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
              <Form.Item name="passphrase" label="私钥口令 Passphrase (可选)" style={{ marginBottom: 0 }}>
                <Input.Password placeholder="若私钥无口令保护可留空" />
              </Form.Item>
            </Card>
          )}

          {formType === 'secret_file' && (
            <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
              <Form.Item
                name="filename"
                label="目标文件名"
                rules={[{ required: !editingItem, message: '请输入文件名' }]}
              >
                <Input placeholder="例如: kubeconfig, settings.xml, id_rsa" />
              </Form.Item>
              <Form.Item
                name="file_content"
                label={editingItem ? '替换文件内容 (留空则保持不变)' : '文件内容 (文本或 Base64)'}
                rules={[{ required: !editingItem, message: '请输入文件内容' }]}
                style={{ marginBottom: 0 }}
              >
                <Input.TextArea
                  rows={4}
                  placeholder="粘贴文件文本内容，系统将在落库前强加密保存..."
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
            </Card>
          )}

          <Form.Item
            name="scope"
            label="可见范围"
            initialValue="personal"
            rules={[{ required: true }]}
          >
            <Radio.Group>
              <Radio value="personal">👤 个人私有 (仅自己与管理员可用)</Radio>
              <Radio value="team">👥 团队共享 (团队成员可用)</Radio>
              <Radio value="global" disabled={!isAdmin}>
                🌐 全局系统 {!isAdmin && '(仅管理员可设置)'}
              </Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            name="domain_patterns"
            label="适用网站与域名规则 (可选，支持通配符)"
            tooltip="例如: *.github.com, gitee.com, nexus.corp.internal:8081, https://git.corp.com/*。在插件注册或远程下载输入对应网址时，系统将自动智能匹配并推荐此凭据"
          >
            <Select
              mode="tags"
              tokenSeparators={[',', ' ']}
              placeholder="输入域名通配符并按回车添加，如 *.gitee.com, nexus.internal:*"
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item name="description" label="用途描述 (可选)">
            <Input.TextArea rows={2} placeholder="记录此凭据的用途、绑定仓库或过期时间..." />
          </Form.Item>
        </Form>
      </Modal>

      {/* Raw Plaintext Display Modal */}
      <Modal
        title={
          <Space align="center">
            <LockOutlined style={{ color: '#52c41a' }} />
            <span>解密查看凭据明文: {viewRawItem?.name}</span>
          </Space>
        }
        open={!!viewRawItem}
        onCancel={() => setViewRawItem(null)}
        footer={
          <Button type="primary" onClick={() => setViewRawItem(null)}>
            关闭并隐匿
          </Button>
        }
        width={540}
      >
        {viewRawItem && (
          <div style={{ marginTop: 12 }}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
              ⚠️ 此操作已解密落库密文，请注意防范屏幕泄露。
            </Typography.Paragraph>

            <Card size="small" style={{ background: token.colorFillAlter }}>
              {Object.entries(viewRawItem.data).map(([key, val]) => (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <div style={{ flex: 1, marginRight: 12 }}>
                    <Typography.Text strong style={{ fontSize: 12, color: token.colorTextSecondary }}>
                      {key}:
                    </Typography.Text>
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 13,
                        wordBreak: 'break-all',
                        whiteSpace: 'pre-wrap',
                        marginTop: 4,
                        background: token.colorBgContainer,
                        padding: '4px 8px',
                        borderRadius: 4,
                        maxHeight: 180,
                        overflowY: 'auto',
                      }}
                    >
                      {String(val)}
                    </div>
                  </div>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(String(val), `已复制 ${key}`)}
                  >
                    复制
                  </Button>
                </div>
              ))}
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default CredentialPage;
