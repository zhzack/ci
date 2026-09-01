import React, { useEffect, useMemo } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Divider,
  Dropdown,
  Layout,
  Menu,
  Space,
  Tag,
  Tooltip,
  theme as antdTheme,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  SettingOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { MENU_ITEMS, toAntdMenu, visibleMenuItems } from '@/router/menuItems';
import { useMenuStore } from '@/store/menu';
import { useThemeStore } from '@/store/theme';
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
  const mode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const openTab = useWorkbenchStore((state) => state.openTab);
  const switchUser = useWorkbenchStore((state) => state.switchUser);
  const { token } = antdTheme.useToken();

  const isDark = mode === 'dark';

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

  // Global Ctrl+B shortcut to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  const displayName = user?.display_name || user?.username || 'Anonymous';
  const roleName = user?.role === 'admin' ? '系统管理员' : '开发成员';

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <ForcePasswordChangeModal />
      <FloatingUploadManager />

      {/* Modern Adaptive Sider */}
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={230}
        collapsedWidth={64}
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          zIndex: 100,
          transition: 'all 0.2s cubic-bezier(0.2, 0, 0, 1)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Brand / Logo Header */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              openTab('dashboard');
              navigate('/dashboard');
            }}
            style={{
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '0' : '0 16px',
              gap: 10,
              cursor: 'pointer',
              userSelect: 'none',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              flexShrink: 0,
              transition: 'background 0.2s',
            }}
            title="点击返回工作台总览"
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: 16,
                boxShadow: '0 2px 10px rgba(22, 119, 255, 0.35)',
                flexShrink: 0,
              }}
            >
              <ThunderboltFilled />
            </div>

            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, overflow: 'hidden' }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    color: token.colorText,
                    letterSpacing: 0.3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Mini Pipeline
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: token.colorTextSecondary,
                    whiteSpace: 'nowrap',
                  }}
                >
                  自动化流水线平台
                </span>
              </div>
            )}
          </div>

          {/* Navigation Menu List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            <Menu
              mode="inline"
              items={items}
              selectedKeys={[selectedKey]}
              style={{
                borderRight: 0,
                background: 'transparent',
                fontSize: 13,
              }}
              onClick={({ key }) => {
                const path = String(key);
                const tabId = pathToTabId(path);
                if (tabId) {
                  openTab(tabId);
                }
                navigate(path);
              }}
            />
          </div>

          {/* Sider Dedicated Collapse/Expand Footer Bar */}
          <div
            role="button"
            tabIndex={0}
            onClick={toggle}
            style={{
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'space-between',
              padding: collapsed ? '0' : '0 16px',
              borderTop: `1px solid ${token.colorBorderSecondary}`,
              cursor: 'pointer',
              color: token.colorTextSecondary,
              transition: 'all 0.2s',
              userSelect: 'none',
              background: token.colorFillQuaternary,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = token.colorPrimary;
              e.currentTarget.style.background = token.colorFillTertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = token.colorTextSecondary;
              e.currentTarget.style.background = token.colorFillQuaternary;
            }}
          >
            {collapsed ? (
              <Tooltip title="展开侧边栏" placement="right">
                <MenuUnfoldOutlined style={{ fontSize: 16 }} />
              </Tooltip>
            ) : (
              <>
                <span style={{ fontSize: 12, fontWeight: 500 }}>收起侧边栏</span>
                <MenuFoldOutlined style={{ fontSize: 14 }} />
              </>
            )}
          </div>
        </div>
      </Sider>

      {/* Main Right Area */}
      <Layout style={{ height: '100vh', overflow: 'hidden', background: token.colorBgLayout }}>
        {/* Top Header */}
        <Header
          style={{
            height: 54,
            lineHeight: '54px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
            zIndex: 90,
          }}
        >
          {/* Header Left: Collapse Trigger & Workbench Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tooltip title={collapsed ? '展开侧边栏 (Ctrl+B)' : '收起侧边栏 (Ctrl+B)'}>
              <Button
                type="text"
                shape="circle"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={toggle}
                style={{
                  fontSize: 15,
                  color: token.colorTextSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            </Tooltip>

            <Divider type="vertical" style={{ margin: '0 4px', height: 16 }} />

            <Space size={8} align="center">
              <span style={{ color: token.colorText, fontWeight: 600, fontSize: 13 }}>
                多任务流水线 IDE 工作台
              </span>
              <Tag
                color={isDark ? 'purple' : 'blue'}
                style={{
                  fontSize: 11,
                  borderRadius: 10,
                  padding: '0 8px',
                  margin: 0,
                  border: 0,
                }}
              >
                v2.0 Pro
              </Tag>
            </Space>
          </div>

          {/* Header Right: Dark Mode Toggle & Account Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Dark Mode Switch Button */}
            <Tooltip title={isDark ? '切换至明亮浅色模式 (Light Mode)' : '切换至暗黑深色模式 (Dark Mode)'}>
              <Button
                type="text"
                shape="circle"
                icon={
                  isDark ? (
                    <SunOutlined style={{ color: '#faad14', fontSize: 16 }} />
                  ) : (
                    <MoonOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                  )
                }
                onClick={toggleTheme}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: token.colorFillQuaternary,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  width: 32,
                  height: 32,
                }}
              />
            </Tooltip>

            <Divider type="vertical" style={{ margin: '0 2px', height: 16 }} />

            {/* User Profile Dropdown */}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'profile',
                    disabled: true,
                    label: (
                      <div style={{ padding: '4px 0' }}>
                        <div style={{ fontWeight: 600, color: token.colorText }}>{displayName}</div>
                        <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                          {user?.email || '未绑定邮箱'} · {roleName}
                        </div>
                      </div>
                    ),
                  },
                  { type: 'divider' as const },
                  {
                    key: 'settings',
                    icon: <SettingOutlined />,
                    label: '个人偏好与设置',
                    onClick: () => {
                      openTab('settings');
                      navigate('/setting');
                    },
                  },
                  {
                    key: 'signout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    danger: true,
                    onClick: () => {
                      void logout().catch(() => undefined);
                      clear();
                      switchUser(null);
                      navigate('/login');
                    },
                  },
                ],
              }}
              placement="bottomRight"
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: 6,
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = token.colorFillTertiary)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Badge dot status="success" offset={[-2, 22]}>
                  <Avatar
                    size={28}
                    style={{
                      background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                      color: '#ffffff',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                    icon={!displayName ? <UserOutlined /> : undefined}
                  >
                    {displayName ? displayName.slice(0, 1).toUpperCase() : 'U'}
                  </Avatar>
                </Badge>
                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                    {displayName}
                  </span>
                  <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
                    {user?.role === 'admin' ? '管理员' : '成员'}
                  </span>
                </div>
              </div>
            </Dropdown>
          </div>
        </Header>

        {/* Multi-Tab IDE Content Body */}
        <Content
          style={{
            height: 'calc(100vh - 54px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <GlobalWorkbench />
        </Content>
      </Layout>
    </Layout>
  );
}


