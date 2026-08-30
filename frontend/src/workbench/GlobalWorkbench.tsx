import React, { useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
  message as antdMessage,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BlockOutlined,
  BorderOutlined,
  BranchesOutlined,
  CheckOutlined,
  DesktopOutlined,
  DownOutlined,
  LayoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SplitCellsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  DockLayout,
  createDualHorizontalLayout,
  createDualVerticalLayout,
  createSingleGroupLayout,
  getAllOpenTabIds,
} from '@/components/dock';
import {
  DEFAULT_WORKBENCH_LAYOUT,
  useWorkbenchStore,
} from './workbenchStore';
import {
  WORKBENCH_CATALOG,
  buildWorkbenchTabRegistry,
} from './workbenchRegistry';

export function GlobalWorkbench(): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const { layout, setLayout, resetLayout, openTab, dynamicTabs } = useWorkbenchStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const openTabIds = useMemo(() => getAllOpenTabIds(layout), [layout]);
  const tabRegistry = useMemo(
    () => buildWorkbenchTabRegistry(openTabIds, dynamicTabs),
    [openTabIds, dynamicTabs]
  );

  // Quick Open Dropdown Menu
  const openMenu: MenuProps = {
    items: [
      {
        key: 'grp-plugins',
        type: 'group',
        label: '🧩 插件与市场 (Plugins)',
        children: [
          {
            key: 'plugin-register',
            label: '注册插件 (Register Plugin)',
            icon: <PlusOutlined style={{ color: '#13c2c2' }} />,
            onClick: () => openTab('plugin-register'),
          },
          {
            key: 'plugin-list',
            label: '插件列表 (Plugins List)',
            icon: <AppstoreOutlined style={{ color: '#1890ff' }} />,
            onClick: () => openTab('plugin-list'),
          },
          {
            key: 'plugin-store',
            label: '插件市场 (Plugin Store)',
            icon: <AppstoreOutlined style={{ color: '#722ed1' }} />,
            onClick: () => openTab('plugin-store'),
          },
        ],
      },
      {
        key: 'grp-pipelines',
        type: 'group',
        label: '🚀 流水线与可视化 (Pipelines)',
        children: [
          {
            key: 'pipeline-visual',
            label: '编写流水线 (Visual Pipeline Editor)',
            icon: <BranchesOutlined style={{ color: '#52c41a' }} />,
            onClick: () => openTab('pipeline-visual'),
          },
          {
            key: 'pipeline-list',
            label: '流水线列表 (Pipelines List)',
            icon: <BranchesOutlined style={{ color: '#fa8c16' }} />,
            onClick: () => openTab('pipeline-list'),
          },
          {
            key: 'pipeline-create',
            label: '新建流水线 (New Pipeline)',
            icon: <PlusOutlined style={{ color: '#eb2f96' }} />,
            onClick: () => openTab('pipeline-create'),
          },
          {
            key: 'pipeline-history',
            label: '流水线运行历史 (History)',
            icon: <BranchesOutlined style={{ color: '#faad14' }} />,
            onClick: () => openTab('pipeline-history'),
          },
        ],
      },
      {
        key: 'grp-machines',
        type: 'group',
        label: '🖥️ 计算节点与控制台 (Machines)',
        children: [
          {
            key: 'machines',
            label: '计算节点与多维控制台 (Machines & Terminal)',
            icon: <DesktopOutlined style={{ color: '#2f54eb' }} />,
            onClick: () => openTab('machines'),
          },
        ],
      },
      {
        key: 'grp-tasks',
        type: 'group',
        label: '⚡ 任务调度与监控 (Tasks)',
        children: [
          {
            key: 'task-running',
            label: '任务实时监控 (Task Monitor)',
            icon: <ThunderboltOutlined style={{ color: '#fa541c' }} />,
            onClick: () => openTab('task-running'),
          },
          {
            key: 'task-history',
            label: '任务历史 (Task History)',
            icon: <ThunderboltOutlined style={{ color: '#13c2c2' }} />,
            onClick: () => openTab('task-history'),
          },
        ],
      },
      {
        key: 'grp-system',
        type: 'group',
        label: '⚙️ 仪表盘与系统 (System)',
        children: [
          {
            key: 'dashboard',
            label: '仪表盘 (Dashboard)',
            onClick: () => openTab('dashboard'),
          },
          {
            key: 'artifacts',
            label: '产物管理 (Artifacts)',
            onClick: () => openTab('artifacts'),
          },
          {
            key: 'admin',
            label: '用户与团队 (Admin)',
            onClick: () => openTab('admin'),
          },
          {
            key: 'settings',
            label: '系统与偏好设置 (Settings)',
            onClick: () => openTab('settings'),
          },
        ],
      },
    ],
  };

  // Layout Presets Dropdown
  const presetMenu: MenuProps = {
    items: [
      {
        key: 'preset-quad',
        icon: <AppstoreOutlined />,
        label: '经典四分屏 (左上注册/右上编写/左下节点/右下监控)',
        onClick: () => {
          setLayout(DEFAULT_WORKBENCH_LAYOUT);
          antdMessage.success('已切换为经典四分屏 IDE 工作台布局');
        },
      },
      {
        key: 'preset-dual-h',
        icon: <SplitCellsOutlined />,
        label: '左右双分栏 (左侧配置与列表 / 右侧编写与监控)',
        onClick: () => {
          setLayout(
            createDualHorizontalLayout(
              ['plugin-register', 'plugin-list', 'machines'],
              ['pipeline-visual', 'task-running', 'dashboard'],
              [45, 55]
            )
          );
          antdMessage.success('已切换为左右双分栏布局');
        },
      },
      {
        key: 'preset-dual-v',
        icon: <BlockOutlined />,
        label: '上下双分栏 (上方设计编写 / 下方节点与日志)',
        onClick: () => {
          setLayout(
            createDualVerticalLayout(
              ['pipeline-visual', 'plugin-register'],
              ['task-running', 'machines', 'dashboard'],
              [55, 45]
            )
          );
          antdMessage.success('已切换为上下双分栏布局');
        },
      },
      {
        key: 'preset-single',
        icon: <BorderOutlined />,
        label: '单窗口聚合标签页 (Single Group)',
        onClick: () => {
          setLayout(
            createSingleGroupLayout([
              'pipeline-visual',
              'plugin-register',
              'machines',
              'task-running',
              'dashboard',
            ])
          );
          antdMessage.success('已切换为单窗口聚合标签页');
        },
      },
      { type: 'divider' },
      {
        key: 'reset',
        icon: <ReloadOutlined />,
        label: '恢复工作台默认布局',
        onClick: () => {
          resetLayout();
          antdMessage.success('工作台布局已重置为默认');
        },
      },
    ],
  };

  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return WORKBENCH_CATALOG;
    const q = searchQuery.toLowerCase();
    return WORKBENCH_CATALOG.filter(
      (m) =>
        m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: token.colorBgLayout,
      }}
    >
      {/* Top IDE Workbench Control Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        <Space size={12}>
          <Dropdown menu={openMenu} trigger={['click']}>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              style={{ fontWeight: 600 }}
            >
              打开功能标签页 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>

          <Dropdown menu={presetMenu} trigger={['click']}>
            <Button size="small" icon={<LayoutOutlined />}>
              工作台布局预设 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>

          <Tooltip title="快速查找并打开工作区标签页 (Ctrl+K)">
            <Button
              size="small"
              icon={<SearchOutlined />}
              onClick={() => setSearchOpen(true)}
            >
              快速打开...
            </Button>
          </Tooltip>

          <Tag color="blue" style={{ margin: 0 }}>
            {openTabIds.length} 个活跃标签
          </Tag>
        </Space>

        <Space size={8}>
          <Tooltip title="恢复工作台出厂默认布局">
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                resetLayout();
                antdMessage.success('工作台布局已重置');
              }}
            >
              重置布局
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* Main Multi-Split Docking Container */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {openTabIds.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 16,
              color: token.colorTextSecondary,
            }}
          >
            <LayoutOutlined style={{ fontSize: 48, opacity: 0.4 }} />
            <Typography.Text type="secondary">
              当前工作台无打开的标签页
            </Typography.Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => resetLayout()}
            >
              加载默认全功能工作台
            </Button>
          </div>
        ) : (
          <DockLayout
            layout={layout}
            tabRegistry={tabRegistry}
            onChange={setLayout}
          />
        )}
      </div>

      {/* Quick Search / Open Modal */}
      <Modal
        title="快速打开工作台模块"
        open={searchOpen}
        footer={null}
        onCancel={() => {
          setSearchOpen(false);
          setSearchQuery('');
        }}
        width={560}
      >
        <Input
          prefix={<SearchOutlined />}
          placeholder="输入模块名称或拼音快速过滤 (例如: 注册插件、流水线、控制台)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          autoFocus
          style={{ marginBottom: 16 }}
        />
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {filteredCatalog.map((item) => {
            const isOpen = openTabIds.includes(item.id);
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  openTab(item.id);
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: token.colorFillTertiary,
                }}
              >
                <Space>
                  {item.icon}
                  <Typography.Text strong>{item.title}</Typography.Text>
                </Space>
                {isOpen ? (
                  <Tag color="green" icon={<CheckOutlined />}>
                    已在工作台
                  </Tag>
                ) : (
                  <Tag>点击打开</Tag>
                )}
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
export default GlobalWorkbench;
