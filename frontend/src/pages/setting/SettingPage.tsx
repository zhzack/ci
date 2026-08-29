import React from "react";
import { Alert, Card, Descriptions, Switch, Tag, Typography } from 'antd';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import { getReadiness, getVersion } from '@/api/health';
import { useThemeStore } from '@/store/theme';
import { useMenuStore } from '@/store/menu';
import { useUserStore } from '@/store/user';

export default function SettingPage(): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const collapsed = useMenuStore((state) => state.collapsed);
  const setCollapsed = useMenuStore((state) => state.setCollapsed);
  const user = useUserStore((state) => state.user);

  const versionQuery = useApiQuery(['health', 'version'], getVersion, {
    staleTime: 60_000,
  });
  const readinessQuery = useApiQuery(['health', 'ready'], getReadiness, {
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="UI preferences, account information, and platform status"
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
      <Card title="Platform status" style={{ marginBottom: 16 }}>
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="Version">
            {versionQuery.data ? (
              <Tag color="blue">v{versionQuery.data.version}</Tag>
            ) : (
              '—'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Readiness">
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
      <Card title="Account">
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="Name">{user.name}</Descriptions.Item>
          <Descriptions.Item label="Role">{user.role}</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
          The API now supports token authentication with admin/reader roles
          (config <code>auth.tokens</code>); UI login will build on it.
        </Typography.Paragraph>
      </Card>
    </>
  );
}
