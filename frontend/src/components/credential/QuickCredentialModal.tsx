import React, { useEffect } from 'react';
import {
  Card,
  Col,
  Form,
  Input,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  App as AntApp,
  theme as antdTheme,
} from 'antd';
import {
  FileProtectOutlined,
  KeyOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import {
  type CredentialItem,
  type CredentialType,
  createCredential,
} from '@/api/credentials';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useAuthStore } from '@/store/auth';

export interface QuickCredentialModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (item: CredentialItem) => void;
  initialType?: CredentialType;
  suggestedUrl?: string;
  allowedTypes?: CredentialType[];
}

export function QuickCredentialModal({
  open,
  onClose,
  onCreated,
  initialType = 'username_password',
  suggestedUrl,
  allowedTypes,
}: QuickCredentialModalProps): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const { message } = AntApp.useApp();
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = currentUser?.role === 'admin';
  const [form] = Form.useForm();
  const formType = (Form.useWatch('type', form) || initialType) as CredentialType;

  const createMutation = useApiMutation<CredentialItem, Parameters<typeof createCredential>[0]>(
    {
      mutationFn: createCredential,
      onSuccess: (data) => {
        message.success(`已成功创建凭据 “${data.name}”`);
        onCreated(data);
        onClose();
      },
    },
    [['credentials']]
  );

  useEffect(() => {
    if (open) {
      form.resetFields();
      let defaultDomains: string[] = [];
      if (suggestedUrl) {
        try {
          if (suggestedUrl.includes('@') && suggestedUrl.includes(':')) {
            // SSH URL: git@github.com:org/repo.git
            const hostPart = suggestedUrl.split('@')[1]?.split(':')[0];
            if (hostPart) defaultDomains = [`*.${hostPart}`, hostPart];
          } else {
            const parsed = new URL(suggestedUrl);
            const host = parsed.hostname;
            defaultDomains = [`*.${host}`, host];
          }
        } catch {
          // Ignore invalid URL
        }
      }

      form.setFieldsValue({
        type: initialType,
        scope: 'personal',
        domain_patterns: defaultDomains,
      });
    }
  }, [open, suggestedUrl, initialType, form]);

  const handleSubmit = async () => {
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

      await createMutation.mutateAsync({
        name: values.name,
        type: values.type,
        scope: values.scope,
        description: values.description || '',
        team_id: values.team_id,
        domain_patterns: values.domain_patterns || [],
        payload,
      });
    } catch {
      // Handled by Form
    }
  };

  const isTypeAllowed = (t: CredentialType) => {
    if (!allowedTypes || allowedTypes.length === 0) return true;
    return allowedTypes.includes(t);
  };

  return (
    <Modal
      title={
        <Space align="center">
          <KeyOutlined style={{ color: token.colorPrimary }} />
          <span>快速新建安全凭据 (Quick Create Credential)</span>
        </Space>
      }
      open={open}
      onOk={handleSubmit}
      onCancel={onClose}
      confirmLoading={createMutation.isPending}
      okText="立即创建并选中"
      cancelText="取消"
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="凭据标识名称"
          rules={[
            { required: true, message: '请输入凭据标识名称' },
            {
              pattern: /^[a-zA-Z0-9_.-]{2,64}$/,
              message: '必须为 2-64 位字母、数字、短横线或下划线',
            },
          ]}
        >
          <Input placeholder="例如: gitee-clone-token, gitlab-ci-token, deploy-ssh-key" />
        </Form.Item>

        <Form.Item name="type" label="凭据类型" rules={[{ required: true }]}>
          <Radio.Group buttonStyle="solid" style={{ width: '100%' }}>
            <Row gutter={[8, 8]}>
              {isTypeAllowed('username_password') && (
                <Col span={12}>
                  <Radio.Button value="username_password" style={{ width: '100%', textAlign: 'center' }}>
                    <KeyOutlined /> 账号与密码
                  </Radio.Button>
                </Col>
              )}
              {isTypeAllowed('secret_text') && (
                <Col span={12}>
                  <Radio.Button value="secret_text" style={{ width: '100%', textAlign: 'center' }}>
                    <LockOutlined /> 访问令牌 / Token
                  </Radio.Button>
                </Col>
              )}
              {isTypeAllowed('ssh_key') && (
                <Col span={12}>
                  <Radio.Button value="ssh_key" style={{ width: '100%', textAlign: 'center' }}>
                    <SafetyCertificateOutlined /> SSH 部署私钥
                  </Radio.Button>
                </Col>
              )}
              {isTypeAllowed('secret_file') && (
                <Col span={12}>
                  <Radio.Button value="secret_file" style={{ width: '100%', textAlign: 'center' }}>
                    <FileProtectOutlined /> 机密文件
                  </Radio.Button>
                </Col>
              )}
            </Row>
          </Radio.Group>
        </Form.Item>

        {formType === 'username_password' && (
          <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
            <Form.Item
              name="username"
              label="账号 / 用户名"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input placeholder="例如: git_bot 或 developer@example.com" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码 / Personal Access Token"
              rules={[{ required: true, message: '请输入密码或访问令牌' }]}
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
              label="机密令牌 / API Token 明文"
              rules={[{ required: true, message: '请输入敏感令牌内容' }]}
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
              label="SSH 私钥内容 (PEM/OpenSSH)"
              rules={[{ required: true, message: '请输入 SSH 私钥' }]}
            >
              <Input.TextArea
                rows={4}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          </Card>
        )}

        {formType === 'secret_file' && (
          <Card size="small" style={{ background: token.colorFillAlter, marginBottom: 16 }}>
            <Form.Item
              name="filename"
              label="目标文件名"
              rules={[{ required: true, message: '请输入文件名' }]}
            >
              <Input placeholder="例如: kubeconfig, settings.xml" />
            </Form.Item>
            <Form.Item
              name="file_content"
              label="文件内容 (文本或 Base64)"
              rules={[{ required: true, message: '请输入文件内容' }]}
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
          name="domain_patterns"
          label="适用网站与域名规则 (支持通配符)"
          tooltip="例如: *.github.com, gitee.com, nexus.corp.internal:8081。输入后按回车添加"
        >
          <Select
            mode="tags"
            tokenSeparators={[',', ' ']}
            placeholder="输入域名通配符并按回车添加，如 *.gitee.com, nexus.internal:*"
            style={{ width: '100%' }}
          />
        </Form.Item>

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

        <Form.Item name="description" label="用途描述 (可选)">
          <Input.TextArea rows={2} placeholder="记录此凭据的用途、绑定仓库或过期时间..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}
