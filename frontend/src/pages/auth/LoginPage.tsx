import React from 'react';
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

type FormValues = { username: string; password: string };

export function LoginPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [loading, setLoading] = React.useState(false);

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      const auth = await login(values.username, values.password);
      setAuth({ token: auth.token, user: auth.user });
      message.success(`Welcome back, ${auth.user.display_name || auth.user.username}`);
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
      <Card style={{ width: 400, boxShadow: '0 16px 48px rgba(0,0,0,0.35)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            Mini Pipeline
          </Typography.Title>
          <Typography.Text type="secondary">Sign in to your workspace</Typography.Text>
        </div>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Enter your username' }]}
          >
            <Input autoFocus placeholder="username" autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password placeholder="••••••••" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Sign in
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          No account yet? <Link to="/register">Register</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

export default LoginPage;
