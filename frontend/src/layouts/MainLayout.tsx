import React from "react";
import { useMemo } from 'react';
import { Layout, Menu, Avatar, Dropdown, theme as antdTheme } from 'antd';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { MENU_ITEMS, toAntdMenu } from '@/router/menuItems';
import { useMenuStore } from '@/store/menu';
import { useUserStore } from '@/store/user';

const { Header, Sider, Content, Footer } = Layout;

export function MainLayout(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useMenuStore((state) => state.collapsed);
  const toggle = useMenuStore((state) => state.toggle);
  const user = useUserStore((state) => state.user);
  const { token } = antdTheme.useToken();

  const items = useMemo(() => toAntdMenu(MENU_ITEMS), []);

  const selectedKey = useMemo(() => {
    const candidates = MENU_ITEMS.flatMap((item) =>
      item.children ? [item.path, ...item.children.map((child) => child.path)] : [item.path],
    );
    const sorted = [...candidates].sort((a, b) => b.length - a.length);
    return sorted.find((path) => location.pathname.startsWith(path)) ?? '/dashboard';
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="dark"
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={232}
      >
        <div
          style={{
            color: '#fff',
            textAlign: 'center',
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: 1,
            padding: '16px 0',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
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
            padding: '0 16px',
            background: token.colorBgContainer,
            borderBottom: '1px solid #f0f0f0',
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
                { key: 'docs', label: <Link to="/setting">Settings</Link> },
                { type: 'divider' as const },
                { key: 'signout', label: 'Sign out', disabled: true },
              ],
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user.name}</span>
            </span>
          </Dropdown>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        <Footer className="app-footer">
          Mini Pipeline · v0.1.0
        </Footer>
      </Layout>
    </Layout>
  );
}
