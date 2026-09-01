import React from "react";
import { useEffect, useMemo } from 'react';
import { Layout, Menu, Avatar, Dropdown, theme as antdTheme } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { MENU_ITEMS, toAntdMenu, visibleMenuItems } from '@/router/menuItems';
import { useMenuStore } from '@/store/menu';
import { useAuthStore } from '@/store/auth';
import { logout } from '@/api/auth';

import { ForcePasswordChangeModal } from '@/components/ForcePasswordChangeModal';
import { FloatingUploadManager } from '@/components/FloatingUploadManager';
import { GlobalWorkbench } from '@/workbench/GlobalWorkbench';
import { useWorkbenchStore } from '@/workbench/workbenchStore';
import { pathToTabId } from '@/workbench/workbenchUtils';

const { Header, Sider, Content } = Layout;

export function MainLayout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useMenuStore((state) => state.collapsed);
  const toggle = useMenuStore((state) => state.toggle);
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const openTab = useWorkbenchStore((state) => state.openTab);
  const switchUser = useWorkbenchStore((state) => state.switchUser);
  const { token } = antdTheme.useToken();

  useEffect(() => {
    switchUser(user?.id ?? null);
  }, [user?.id, switchUser]);

  const items = useMemo(
    () => toAntdMenu(visibleMenuItems(user?.role)),
    [user?.role],
  );

  const selectedKey = useMemo(() => {
    const candidates = MENU_ITEMS.flatMap((item) =>
      item.children ? [item.path, ...item.children.map((child) => child.path)] : [item.path],
    );
    const sorted = [...candidates].sort((a, b) => b.length - a.length);
    return sorted.find((path) => location.pathname.startsWith(path)) ?? '/dashboard';
  }, [location.pathname]);

  useEffect(() => {
    const tabId = pathToTabId(location.pathname);
    if (tabId) {
      openTab(tabId);
    }
  }, [location.pathname, openTab]);

  const displayName = user?.display_name || user?.username || 'Anonymous';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <ForcePasswordChangeModal />
      <FloatingUploadManager />
      <Sider
        theme="dark"
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={232}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div
          style={{
            color: '#fff',
            textAlign: 'center',
            fontWeight: 700,
            fontSize: 17,
            letterSpacing: 1,
            padding: '18px 0',
            background: 'linear-gradient(90deg, rgba(22,119,255,0.25), transparent)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {collapsed ? 'MP' : 'Mini Pipeline'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={items}
          selectedKeys={[selectedKey]}
          onClick={({ key }) => {
            const path = String(key);
            const tabId = pathToTabId(path);
            if (tabId) {
              openTab(tabId);
            }
            navigate(path);
          }}
        />
      </Sider>
      <Layout style={{ height: '100vh', overflow: 'hidden' }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
            zIndex: 10,
          }}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={toggle}
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 8 }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            <span style={{ color: token.colorText, fontWeight: 600 }}>Mini Pipeline IDE</span>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'profile', disabled: true, label: `${displayName}${user?.role === 'admin' ? ' · admin' : ''}` },
                { type: 'divider' as const },
                {
                  key: 'settings',
                  label: 'Settings',
                  onClick: () => {
                    openTab('settings');
                    navigate('/setting');
                  },
                },
                {
                  key: 'signout',
                  icon: <LogoutOutlined />,
                  label: 'Sign out',
                  onClick: () => {
                    void logout().catch(() => undefined);
                    clear();
                    switchUser(null);
                    navigate('/login');
                  },
                },
              ],
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" style={{ background: token.colorPrimary }} icon={<UserOutlined />} />
              <span>{displayName}</span>
            </span>
          </Dropdown>
        </Header>
        <Content style={{ height: 'calc(100vh - 64px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <GlobalWorkbench />
        </Content>
      </Layout>
    </Layout>
  );
}

