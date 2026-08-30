import React from 'react';
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined, SafetyCertificateOutlined, IdcardOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { register, registerWithOtp, sendEmailCode } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

type FormValues = {
  username: string;
  displayName: string;
  email?: string;
  code?: string;
  password: string;
  confirm: string;
};

export function RegisterPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [loading, setLoading] = React.useState(false);
  const [form] = Form.useForm();

  // Email verification countdown
  const [emailValue, setEmailValue] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const [sendingCode, setSendingCode] = React.useState(false);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((prev) => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (!emailValue || !emailValue.includes('@')) {
      message.error('请输入有效的邮箱地址');
      return;
    }
    setSendingCode(true);
    try {
      await sendEmailCode(emailValue, 'register');
      message.success('注册验证码已发送至您的邮箱，请查收');
      setCountdown(60);
    } catch {
      // handled by axios interceptor
    } finally {
      setSendingCode(false);
    }
  };

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      let auth;
      if (values.email && values.code) {
        auth = await registerWithOtp({
          username: values.username,
          password: values.password,
          email: values.email,
          code: values.code,
          displayName: values.displayName,
        });
      } else {
        auth = await register(
          values.username,
          values.password,
          values.displayName,
          values.email
        );
      }
      setAuth({ token: auth.token, user: auth.user });
      message.success('账号创建成功，欢迎使用 Mini Pipeline！');
      navigate('/dashboard');
    } catch {
      // error already surfaced by the axios interceptor
    } finally {
      setLoading(false);
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
      <Card style={{ width: 440, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', borderRadius: 12 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            注册新账号
          </Typography.Title>
          <Typography.Text type="secondary">
            首个注册的用户将自动成为平台管理员
          </Typography.Text>
        </div>
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              {
                pattern: /^[A-Za-z][A-Za-z0-9_.-]{2,63}$/,
                message: '3-64位字符：字母开头，支持数字、点、下划线、中划线',
              },
            ]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#8c8c8c' }} />}
              autoFocus
              placeholder="3-64位用户名"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item name="displayName" label="用户昵称 / 显示名">
            <Input
              prefix={<IdcardOutlined style={{ color: '#8c8c8c' }} />}
              placeholder="例如：张三、Alice"
            />
          </Form.Item>

          <Form.Item
            name="email"
            label="电子邮箱"
            rules={[
              { required: true, message: '请输入电子邮箱' },
              { type: 'email', message: '邮箱格式不正确' },
            ]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#8c8c8c' }} />}
              placeholder="your_email@example.com"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
            />
          </Form.Item>

          <Form.Item
            name="code"
            label="邮箱验证码"
            rules={[
              { required: true, message: '请输入 6 位邮箱验证码' },
              { len: 6, message: '验证码为 6 位数字' },
            ]}
          >
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                prefix={<SafetyCertificateOutlined style={{ color: '#8c8c8c' }} />}
                placeholder="6 位数字验证码"
                maxLength={6}
                style={{ flex: 1 }}
              />
              <Button
                disabled={countdown > 0 || !emailValue}
                loading={sendingCode}
                onClick={handleSendCode}
              >
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Button>
            </div>
          </Form.Item>

          <Form.Item
            name="password"
            label="登录密码"
            rules={[
              { required: true, message: '请输入登录密码' },
              { min: 8, message: '密码至少 8 个字符' },
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#8c8c8c' }} />}
              placeholder="至少 8 个字符"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_rule, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#8c8c8c' }} />}
              placeholder="请再次确认密码"
              autoComplete="new-password"
            />
          </Form.Item>

          <Button type="primary" htmlType="submit" block size="large" loading={loading} style={{ marginTop: 8 }}>
            立即注册
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          已有账号？ <Link to="/login">直接登录</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

export default RegisterPage;
