import React, { useState } from 'react';
import { Modal, Form, Input, Button, message, Typography, Space, Alert } from 'antd';
import { LockOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { changePassword, me } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

const { Title, Text } = Typography;

export function ForcePasswordChangeModal(): React.JSX.Element | null {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const visible = Boolean(user && user.must_change_password);

  if (!visible) return null;

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await changePassword({ new_password: values.newPassword });
      message.success('密码修改成功，欢迎使用 Mini Pipeline！');
      const updatedUser = await me();
      setUser(updatedUser);
      form.resetFields();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const errorResponse = err as { response?: { data?: { detail?: string } } };
        message.error(errorResponse.response?.data?.detail || '修改密码失败，请重试');
      } else if (err instanceof Error) {
        message.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={visible}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={460}
      centered
    >
      <div style={{ padding: '8px 4px' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <SafetyCertificateOutlined style={{ fontSize: 44, color: '#1677ff', marginBottom: 12 }} />
            <Title level={4} style={{ margin: 0 }}>
              首次登录安全提醒
            </Title>
            <Text type="secondary" style={{ fontSize: 13, marginTop: 4, display: 'block' }}>
              为了您的账号安全，首次登录必须先修改初始密码。
            </Text>
          </div>

          <Alert
            message="密码要求"
            description="密码长度至少为 8 位，建议包含大小写字母、数字或特殊字符。"
            type="info"
            showIcon
          />

          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item
              name="newPassword"
              label="设置新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '密码长度至少为 8 个字符' },
              ]}
              hasFeedback
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
                placeholder="请输入新密码（至少 8 位）"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              label="确认新密码"
              dependencies={['newPassword']}
              hasFeedback
              rules={[
                { required: true, message: '请再次确认新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('newPassword') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
                placeholder="请再次输入新密码"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                确认并修改密码
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </div>
    </Modal>
  );
}
