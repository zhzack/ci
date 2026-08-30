import React, { useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Switch,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import { LockOutlined, MailOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { getReadiness, getVersion } from '@/api/health';
import { updateProfile, changePassword, me, sendEmailCode, bindEmailWithOtp } from '@/api/auth';
import { useThemeStore } from '@/store/theme';
import { useMenuStore } from '@/store/menu';
import { useAuthStore } from '@/store/auth';

export default function SettingPage(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const collapsed = useMenuStore((state) => state.collapsed);
  const setCollapsed = useMenuStore((state) => state.setCollapsed);
  const authUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [profileForm] = Form.useForm();
  const [profileSaving, setProfileSaving] = useState(false);

  const [pwdForm] = Form.useForm();
  const [pwdSaving, setPwdSaving] = useState(false);

  // Bind/Change Email Modal
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [bindEmailForm] = Form.useForm();
  const [bindEmailValue, setBindEmailValue] = useState('');
  const [bindCountdown, setBindCountdown] = useState(0);
  const [bindSendingCode, setBindSendingCode] = useState(false);
  const [bindSubmitting, setBindSubmitting] = useState(false);

  React.useEffect(() => {
    if (bindCountdown <= 0) return;
    const timer = setTimeout(() => setBindCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [bindCountdown]);

  const versionQuery = useApiQuery(['health', 'version'], getVersion, {
    staleTime: 60_000,
  });
  const readinessQuery = useApiQuery(['health', 'ready'], getReadiness, {
    refetchInterval: 30_000,
  });

  const handleSendBindCode = async () => {
    if (!bindEmailValue || !bindEmailValue.includes('@')) {
      antdMessage.error('请输入有效的新邮箱地址');
      return;
    }
    setBindSendingCode(true);
    try {
      await sendEmailCode(bindEmailValue, 'bind_email');
      antdMessage.success('验证码已发送至新邮箱，请查收');
      setBindCountdown(60);
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setBindSendingCode(false);
    }
  };

  const handleBindEmailSubmit = async (values: { email: string; code: string }) => {
    setBindSubmitting(true);
    try {
      const updated = await bindEmailWithOtp({
        email: values.email,
        code: values.code,
      });
      setUser(updated);
      antdMessage.success('邮箱绑定成功！');
      setEmailModalOpen(false);
      bindEmailForm.resetFields();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setBindSubmitting(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      setProfileSaving(true);
      const updated = await updateProfile({
        display_name: values.display_name?.trim() || undefined,
        email: values.email?.trim() || undefined,
      });
      setUser(updated);
      antdMessage.success('个人资料已保存');
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      const values = await pwdForm.validateFields();
      setPwdSaving(true);
      await changePassword({
        old_password: values.old_password,
        new_password: values.new_password,
      });
      antdMessage.success('密码修改成功');
      pwdForm.resetFields();
      const updated = await me();
      setUser(updated);
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setPwdSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="系统设置 (Settings)"
        description="用户资料管理、界面偏好与平台运行状态"
      />

      <Card title="个人信息与安全" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="middle" style={{ marginBottom: 20 }}>
          <Descriptions.Item label="用户名">
            <Typography.Text strong>{authUser?.username || 'anonymous'}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            <Tag color={authUser?.role === 'admin' ? 'geekblue' : 'default'}>
              {authUser?.role || 'user'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="绑定邮箱">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {authUser?.email ? (
                <Tag color="cyan" icon={<MailOutlined />}>
                  {authUser.email}
                </Tag>
              ) : (
                <Typography.Text type="secondary">未绑定邮箱</Typography.Text>
              )}
              <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setEmailModalOpen(true)}>
                {authUser?.email ? '换绑邮箱' : '绑定邮箱'}
              </Button>
            </div>
          </Descriptions.Item>
        </Descriptions>

        <Divider style={{ margin: '16px 0' }} />

        <Typography.Title level={5} style={{ marginBottom: 12 }}>
          修改个人资料
        </Typography.Title>
        <Form
          form={profileForm}
          layout="vertical"
          initialValues={{
            display_name: authUser?.display_name || '',
            email: authUser?.email || '',
          }}
          style={{ maxWidth: 480 }}
          onFinish={handleSaveProfile}
        >
          <Form.Item name="display_name" label="显示名称">
            <Input prefix={<UserOutlined />} placeholder="请输入显示名称" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={profileSaving}>
              保存个人资料
            </Button>
          </Form.Item>
        </Form>

        <Divider style={{ margin: '24px 0 16px 0' }} />

        <Typography.Title level={5} style={{ marginBottom: 12 }}>
          修改登录密码
        </Typography.Title>
        <Form
          form={pwdForm}
          layout="vertical"
          style={{ maxWidth: 480 }}
          onFinish={handleChangePassword}
        >
          <Form.Item
            name="old_password"
            label="当前旧密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请输入当前旧密码" />
          </Form.Item>

          <Form.Item
            name="new_password"
            label="设置新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码长度至少为 8 位' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位新密码" />
          </Form.Item>

          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="请再次确认新密码" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={pwdSaving}>
              修改密码
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card title="外观与偏好" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="深色模式 (Dark mode)">
            <Switch checked={mode === 'dark'} onChange={toggleTheme} />
          </Descriptions.Item>
          <Descriptions.Item label="折叠侧边栏">
            <Switch checked={collapsed} onChange={setCollapsed} />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="平台运行状态 (Platform Status)" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="版本">
            {versionQuery.data ? (
              <Tag color="blue">v{versionQuery.data.version}</Tag>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="健康就绪度">
            {readinessQuery.data ? (
              <Tag color={readinessQuery.data.status === 'ready' ? 'success' : 'error'}>
                {readinessQuery.data.status}
              </Tag>
            ) : (
              <Tag>checking…</Tag>
            )}
          </Descriptions.Item>
          {readinessQuery.data
            ? Object.entries(readinessQuery.data.checks).map(([name, state]) => (
                <Descriptions.Item key={name} label={name}>
                  <Tag color={state === 'ok' ? 'success' : 'error'}>{state}</Tag>
                </Descriptions.Item>
              ))
            : null}
        </Descriptions>
      </Card>

      {/* Bind / Change Email Modal */}
      <Modal
        title={authUser?.email ? '更换绑定邮箱' : '绑定安全邮箱'}
        open={emailModalOpen}
        onCancel={() => {
          setEmailModalOpen(false);
          bindEmailForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
          请输入需要绑定的新邮箱，系统将发送 6 位数字验证码以核验该邮箱归属权。
        </Typography.Paragraph>
        <Form form={bindEmailForm} layout="vertical" onFinish={handleBindEmailSubmit} requiredMark={false}>
          <Form.Item
            name="email"
            label="新邮箱地址"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="new_email@example.com"
              value={bindEmailValue}
              onChange={(e) => setBindEmailValue(e.target.value)}
            />
          </Form.Item>
          <Form.Item
            name="code"
            label="邮箱验证码"
            rules={[
              { required: true, message: '请输入 6 位验证码' },
              { len: 6, message: '验证码为 6 位数字' },
            ]}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                prefix={<SafetyCertificateOutlined />}
                placeholder="6 位数字验证码"
                maxLength={6}
                style={{ flex: 1 }}
              />
              <Button
                disabled={bindCountdown > 0 || !bindEmailValue}
                loading={bindSendingCode}
                onClick={handleSendBindCode}
              >
                {bindCountdown > 0 ? `${bindCountdown}s` : '获取验证码'}
              </Button>
            </div>
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={bindSubmitting} style={{ marginTop: 8 }}>
            确认绑定
          </Button>
        </Form>
      </Modal>
    </>
  );
}
