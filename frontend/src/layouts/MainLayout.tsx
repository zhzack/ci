import React from "react";
import { useMemo } from 'react';
import { Layout, Menu, Avatar, Dropdown, theme as antdTheme } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
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

const { Header, Sider, Content, Footer } = Layout;

export function MainLayout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useMenuStore((state) => state.collapsed);
  const toggle = useMenuStore((state) => state.toggle);
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const { token } = antdTheme.useToken();

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

  const displayName = user?.display_name || user?.username || 'Anonymous';

  return (
    <Layout style={{ minHeight: '100vh' }}>
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
          onClick={({ key }) => navigate(String(key))}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
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
            <span style={{ color: token.colorText }}>Mini Pipeline</span>
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'profile', disabled: true, label: `${displayName}${user?.role === 'admin' ? ' · admin' : ''}` },
                { type: 'divider' as const },
                { key: 'settings', label: <Link to="/setting">Settings</Link> },
                {
                  key: 'signout',
                  icon: <LogoutOutlined />,
                  label: 'Sign out',
                  onClick: () => {
                    void logout().catch(() => undefined);
                    clear();
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
        <Content className="app-content">
          <Outlet />
        </Content>
        <Footer className="app-footer">
          Mini Pipeline · v0.3.0
        </Footer>
      </Layout>
    </Layout>
  );
}
