import React from 'react';
import { Button, Card, Form, Input, Typography, App as AntApp } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { register } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

type FormValues = {
  username: string;
  displayName: string;
  password: string;
  confirm: string;
};

export function RegisterPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [loading, setLoading] = React.useState(false);

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      const auth = await register(values.username, values.password, values.displayName);
      setAuth({ token: auth.token, user: auth.user });
      message.success('Account created');
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
      <Card style={{ width: 420, boxShadow: '0 16px 48px rgba(0,0,0,0.35)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            Create account
          </Typography.Title>
          <Typography.Text type="secondary">
            The very first account becomes the platform admin
          </Typography.Text>
        </div>
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: true, message: 'Choose a username' },
              {
                pattern: /^[A-Za-z][A-Za-z0-9_.-]{2,63}$/,
                message: '3-64 chars: letters, digits, dot, dash, underscore',
              },
            ]}
          >
            <Input autoFocus placeholder="username" autoComplete="username" />
          </Form.Item>
          <Form.Item name="displayName" label="Display name">
            <Input placeholder="How others will see you" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Choose a password' },
              { min: 8, message: 'At least 8 characters' },
            ]}
          >
            <Input.Password placeholder="At least 8 characters" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="Confirm password"
            dependencies={['password']}
            rules={[
              { required: true, message: 'Repeat the password' },
              ({ getFieldValue }) => ({
                validator(_rule, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            Register
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </Typography.Paragraph>
      </Card>
    </div>
  );
}

export default RegisterPage;
