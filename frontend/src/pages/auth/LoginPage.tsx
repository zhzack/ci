import React from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Tabs,
  Typography,
  App as AntApp,
} from 'antd';
import { MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { login, loginWithOtp, sendEmailCode, resetPasswordWithOtp } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [activeTab, setActiveTab] = React.useState<'password' | 'otp'>('password');
  const [loading, setLoading] = React.useState(false);

  // OTP Login Countdown
  const [otpEmail, setOtpEmail] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const [sendingCode, setSendingCode] = React.useState(false);

  // Forgot Password Modal
  const [forgotModalVisible, setForgotModalVisible] = React.useState(false);
  const [forgotEmail, setForgotEmail] = React.useState('');
  const [forgotCountdown, setForgotCountdown] = React.useState(0);
  const [forgotSendingCode, setForgotSendingCode] = React.useState(false);
  const [forgotLoading, setForgotLoading] = React.useState(false);
  const [forgotForm] = Form.useForm();

  // Countdown timer effect
  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  React.useEffect(() => {
    if (forgotCountdown <= 0) return;
    const timer = setTimeout(() => setForgotCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [forgotCountdown]);

  // Handle Send Code for Login
  const handleSendLoginCode = async () => {
    if (!otpEmail || !otpEmail.includes('@')) {
      message.error('请输入有效的邮箱地址');
      return;
    }
    setSendingCode(true);
    try {
      await sendEmailCode(otpEmail, 'login');
      message.success('登录验证码已发送，请查收邮箱');
      setCountdown(60);
    } catch {
      // handled by axios interceptor
    } finally {
      setSendingCode(false);
    }
  };

  // Handle Send Code for Forgot Password
  const handleSendForgotCode = async () => {
    if (!forgotEmail || !forgotEmail.includes('@')) {
      message.error('请输入注册时绑定的邮箱地址');
      return;
    }
    setForgotSendingCode(true);
    try {
      await sendEmailCode(forgotEmail, 'reset_password');
      message.success('重置验证码已发送，请查收邮箱');
      setForgotCountdown(60);
    } catch {
      // handled by axios interceptor
    } finally {
      setForgotSendingCode(false);
    }
  };

  // Password Login
  const onPasswordFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const auth = await login(values.username, values.password);
      setAuth({ token: auth.token, user: auth.user });
      message.success(`欢迎回来，${auth.user.display_name || auth.user.username}`);
      navigate('/dashboard');
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  // OTP Login
  const onOtpFinish = async (values: { email: string; code: string }) => {
    setLoading(true);
    try {
      const auth = await loginWithOtp(values.email, values.code);
      setAuth({ token: auth.token, user: auth.user });
      message.success(`欢迎回来，${auth.user.display_name || auth.user.username}`);
      navigate('/dashboard');
    } catch {
      // handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Submit
  const onForgotFinish = async (values: { email: string; code: string; new_password: string }) => {
    setForgotLoading(true);
    try {
      await resetPasswordWithOtp({
        email: values.email,
        code: values.code,
        new_password: values.new_password,
      });
      message.success('密码重置成功！请使用新密码登录');
      setForgotModalVisible(false);
      forgotForm.resetFields();
    } catch {
      // handled by interceptor
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #111a3a 0%, #1c2f6e 55%, #2a4bb8 100%)',
        padding: 24,
      }}
    >
      <Card style={{ width: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', borderRadius: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            ⚡ Mini Pipeline
          </Typography.Title>
          <Typography.Text type="secondary">轻量高效的现代 CI/CD 自动化系统</Typography.Text>
        </div>

        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'password' | 'otp')}
          centered
          items={[
            { key: 'password', label: '账号密码登录' },
            { key: 'otp', label: '邮箱免密登录' },
          ]}
        />

        {activeTab === 'password' ? (
          <Form layout="vertical" onFinish={onPasswordFinish} requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item
              name="username"
              rules={[{ required: true, message: '请输入用户名' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#8c8c8c' }} />}
                autoFocus
                placeholder="用户名"
                autoComplete="username"
                size="large"
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#8c8c8c' }} />}
                placeholder="密码"
                autoComplete="current-password"
                size="large"
              />
            </Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <Button
                type="link"
                style={{ padding: 0, fontSize: 13 }}
                onClick={() => setForgotModalVisible(true)}
              >
                忘记密码？
              </Button>
            </div>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              立即登录
            </Button>
          </Form>
        ) : (
          <Form layout="vertical" onFinish={onOtpFinish} requiredMark={false} style={{ marginTop: 12 }}>
            <Form.Item
              name="email"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '邮箱格式不正确' },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ color: '#8c8c8c' }} />}
                placeholder="注册邮箱地址"
                autoComplete="email"
                size="large"
                value={otpEmail}
                onChange={(e) => setOtpEmail(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              name="code"
              rules={[
                { required: true, message: '请输入 6 位验证码' },
                { len: 6, message: '验证码为 6 位数字' },
              ]}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  prefix={<SafetyCertificateOutlined style={{ color: '#8c8c8c' }} />}
                  placeholder="6 位数字验证码"
                  maxLength={6}
                  size="large"
                  style={{ flex: 1 }}
                />
                <Button
                  size="large"
                  disabled={countdown > 0 || !otpEmail}
                  loading={sendingCode}
                  onClick={handleSendLoginCode}
                >
                  {countdown > 0 ? `${countdown}s 后重新获取` : '获取验证码'}
                </Button>
              </div>
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ marginTop: 16 }}>
              验证并登录
            </Button>
          </Form>
        )}

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Typography.Text type="secondary">
            还没有账号？ <Link to="/register">立即注册</Link>
          </Typography.Text>
        </div>
      </Card>

      {/* Forgot Password Modal */}
      <Modal
        title="找回 / 重置密码"
        open={forgotModalVisible}
        onCancel={() => {
          setForgotModalVisible(false);
          forgotForm.resetFields();
        }}
        footer={null}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
          请输入您绑定的注册邮箱，系统将向该邮箱发送重置密码的 6 位数字验证码。
        </Typography.Paragraph>
        <Form form={forgotForm} layout="vertical" onFinish={onForgotFinish} requiredMark={false}>
          <Form.Item
            name="email"
            label="注册邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="user@example.com"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
            />
          </Form.Item>
          <Form.Item
            name="code"
            label="邮箱验证码"
            rules={[
              { required: true, message: '请输入验证码' },
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
                disabled={forgotCountdown > 0 || !forgotEmail}
                loading={forgotSendingCode}
                onClick={handleSendForgotCode}
              >
                {forgotCountdown > 0 ? `${forgotCountdown}s` : '获取验证码'}
              </Button>
            </div>
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '密码至少 8 个字符' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位新密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={forgotLoading} style={{ marginTop: 8 }}>
            确认重置密码
          </Button>
        </Form>
      </Modal>
    </div>
  );
}

export default LoginPage;
