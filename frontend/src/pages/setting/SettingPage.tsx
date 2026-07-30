import React from "react";
import { Alert, Card, Descriptions, Switch, Typography } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { useThemeStore } from '@/store/theme';
import { useMenuStore } from '@/store/menu';
import { useUserStore } from '@/store/user';

export default function SettingPage(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const collapsed = useMenuStore((state) => state.collapsed);
  const setCollapsed = useMenuStore((state) => state.setCollapsed);
  const user = useUserStore((state) => state.user);

  return (
    <>
      <PageHeader
        title="Settings"
        description="UI preferences and account information"
      />
      <Alert
        type="info"
        showIcon
        message="Settings persist in localStorage and apply to this browser only."
        style={{ marginBottom: 16 }}
      />
      <Card title="Appearance" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="Dark mode">
            <Switch checked={mode === 'dark'} onChange={toggleTheme} />
          </Descriptions.Item>
          <Descriptions.Item label="Collapse sidebar">
            <Switch checked={collapsed} onChange={setCollapsed} />
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="Account">
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="Name">{user.name}</Descriptions.Item>
          <Descriptions.Item label="Role">{user.role}</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          Authentication and per-user roles will land in a future release.
        </Typography.Paragraph>
      </Card>
    </>
  );
}
