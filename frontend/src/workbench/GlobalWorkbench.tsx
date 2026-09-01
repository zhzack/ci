import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
  message as antdMessage,
} from 'antd';
import type { InputRef, MenuProps } from 'antd';
import {
  AppstoreOutlined,
  BranchesOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownOutlined,
  EnterOutlined,
  LayoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  DockLayout,
  getAllOpenTabIds,
} from '@/components/dock';
import {
  useWorkbenchStore,
} from './workbenchStore';
import {
  WORKBENCH_CATALOG,
  buildWorkbenchTabRegistry,
} from './workbenchRegistry';

export function GlobalWorkbench(): React.JSX.Element {
  const { token } = antdTheme.useToken();
  const {
    layout,
    setLayout,
    resetLayout,
    openTab,
    dynamicTabs,
    savedLayouts,
    saveCurrentLayout,
    applySavedLayout,
    deleteSavedLayout,
    closeActiveTab,
    reopenLastClosedTab,
    nextTab,
    prevTab,
    switchToTabIndex,
  } = useWorkbenchStore();

  // Search / Quick Open modal state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<InputRef>(null);

  // Save layout modal state
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [layoutName, setLayoutName] = useState('');

  const openTabIds = useMemo(() => getAllOpenTabIds(layout), [layout]);
  const tabRegistry = useMemo(
    () => buildWorkbenchTabRegistry(openTabIds, dynamicTabs),
    [openTabIds, dynamicTabs]
  );

  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return WORKBENCH_CATALOG;
    const q = searchQuery.toLowerCase();
    return WORKBENCH_CATALOG.filter(
      (m) =>
        m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Global Browser-Aligned Tab & Workbench Shortcuts (Silent background execution)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const isAlt = e.altKey;
      const isShift = e.shiftKey;
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditable =
        targetTag === 'input' ||
        targetTag === 'textarea' ||
        (e.target as HTMLElement)?.isContentEditable;

      // 1. Quick Open / New Tab: Ctrl+T, Ctrl+K, Ctrl+P, Alt+T
      if (
        (isCtrlOrMeta && (e.key === 'k' || e.key === 'K' || e.key === 'p' || e.key === 'P' || e.key === 't' || e.key === 'T')) ||
        (isAlt && (e.key === 't' || e.key === 'T'))
      ) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      // 2. Reopen Last Closed Tab: Ctrl+Shift+T, Alt+Shift+T
      if (
        (isCtrlOrMeta && isShift && (e.key === 't' || e.key === 'T')) ||
        (isAlt && isShift && (e.key === 't' || e.key === 'T'))
      ) {
        e.preventDefault();
        const reopened = reopenLastClosedTab();
        if (reopened) {
          antdMessage.success('已重新打开最近关闭的标签页');
        }
        return;
      }

      // 3. Close Active Tab: Ctrl+W, Alt+W
      if (
        (isCtrlOrMeta && (e.key === 'w' || e.key === 'W')) ||
        (isAlt && (e.key === 'w' || e.key === 'W'))
      ) {
        e.preventDefault();
        const closedId = closeActiveTab();
        if (closedId) {
          const tabTitle =
            WORKBENCH_CATALOG.find((item) => item.id === closedId)?.title || closedId;
          antdMessage.info(`已关闭「${tabTitle}」`);
        }
        return;
      }

      // 4. Switch Next Tab: Ctrl+Tab, Ctrl+PageDown, Alt+RightArrow, Ctrl+Shift+]
      if (
        (isCtrlOrMeta && (e.key === 'Tab' && !isShift)) ||
        (isCtrlOrMeta && e.key === 'PageDown') ||
        (isAlt && (e.key === 'ArrowRight' || e.key === 'Right')) ||
        (isCtrlOrMeta && isShift && e.key === '}')
      ) {
        e.preventDefault();
        nextTab();
        return;
      }

      // 5. Switch Prev Tab: Ctrl+Shift+Tab, Ctrl+PageUp, Alt+LeftArrow, Ctrl+Shift+[
      if (
        (isCtrlOrMeta && e.key === 'Tab' && isShift) ||
        (isCtrlOrMeta && e.key === 'PageUp') ||
        (isAlt && (e.key === 'ArrowLeft' || e.key === 'Left')) ||
        (isCtrlOrMeta && isShift && e.key === '{')
      ) {
        e.preventDefault();
        prevTab();
        return;
      }

      // 6. Direct Switch by Number (Ctrl+1..9, Alt+1..9)
      if ((isAlt || (isCtrlOrMeta && !isShift && !isEditable)) && e.key >= '1' && e.key <= '9') {
        const num = parseInt(e.key, 10);
        e.preventDefault();
        if (num === 9) {
          switchToTabIndex(-1); // Last tab
        } else {
          switchToTabIndex(num - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeActiveTab, reopenLastClosedTab, nextTab, prevTab, switchToTabIndex]);

  // Reset selected index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Focus input on modal open
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [searchOpen]);

  const handleOpenItem = (tabId: string) => {
    openTab(tabId);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < filteredCatalog.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCatalog.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCatalog.length > 0) {
        const item = filteredCatalog[selectedIndex] || filteredCatalog[0];
        if (item) {
          handleOpenItem(item.id);
        }
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  };

  const handleConfirmSaveLayout = () => {
    if (!layoutName.trim()) {
      antdMessage.warning('请输入布局名称');
      return;
    }
    const entry = saveCurrentLayout(layoutName.trim());
    antdMessage.success(`工作台布局「${entry.name}」已保存`);
    setSaveModalOpen(false);
    setLayoutName('');
  };

  // Open Tab Dropdown Menu
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
            key: 'credential',
            label: '凭证与密钥中心 (Credentials Vault)',
            onClick: () => openTab('credential'),
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

  // Custom User Saved Layouts Menu
  const layoutManagementMenu: MenuProps = {
    items: [
      {
        key: 'action-save',
        icon: <SaveOutlined style={{ color: '#1677ff' }} />,
        label: (
          <span style={{ fontWeight: 600, color: '#1677ff' }}>
            保存当前分屏为新布局...
          </span>
        ),
        onClick: () => {
          setLayoutName(`分屏布局 (${openTabIds.length} 个标签)`);
          setSaveModalOpen(true);
        },
      },
      { type: 'divider' },
      {
        key: 'grp-saved',
        type: 'group',
        label: `📁 我的已保存布局 (${savedLayouts.length})`,
        children:
          savedLayouts.length === 0
            ? [
                {
                  key: 'empty-saved',
                  disabled: true,
                  label: (
                    <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                      暂无保存的布局
                    </span>
                  ),
                },
              ]
            : savedLayouts.map((item) => ({
                key: item.id,
                icon: <LayoutOutlined style={{ color: token.colorPrimary }} />,
                label: (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minWidth: 240,
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>{item.name}</span>
                      <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
                        {new Date(item.createdAt).toLocaleDateString()}{' '}
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <Space size={4} onClick={(e) => e.stopPropagation()}>
                      <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                        {item.tabCount} 个标签
                      </Tag>
                      <Tooltip title="删除该模板">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSavedLayout(item.id);
                            antdMessage.success(`已删除布局「${item.name}」`);
                          }}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                ),
                onClick: () => {
                  const ok = applySavedLayout(item.id);
                  if (ok) {
                    antdMessage.success(`已加载自定义布局: ${item.name}`);
                  }
                },
              })),
      },
      { type: 'divider' },
      {
        key: 'action-reset-default',
        icon: <ReloadOutlined />,
        label: '恢复默认主页',
        onClick: () => {
          resetLayout();
          antdMessage.success('工作台布局已重置');
        },
      },
    ],
  };

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
      {/* Clean IDE Workbench Control Bar */}
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
        <Space size={10}>
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

          <Dropdown menu={layoutManagementMenu} trigger={['click']}>
            <Button size="small" icon={<LayoutOutlined />}>
              工作台布局模式 ({savedLayouts.length}){' '}
              <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>

          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={() => setSearchOpen(true)}
          >
            快速打开...
          </Button>

          <Tag color="blue" style={{ margin: 0 }}>
            {openTabIds.length} 个活跃标签
          </Tag>
        </Space>

        <Space size={8}>
          <Tooltip title="关闭当前聚焦的标签页">
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={() => {
                const closedId = closeActiveTab();
                if (closedId) {
                  const tabTitle =
                    WORKBENCH_CATALOG.find((item) => item.id === closedId)?.title || closedId;
                  antdMessage.info(`已关闭「${tabTitle}」`);
                }
              }}
            >
              关闭标签
            </Button>
          </Tooltip>

          <Tooltip title="保存当前分屏与打开的标签页为自定义模板">
            <Button
              size="small"
              icon={<SaveOutlined />}
              onClick={() => {
                setLayoutName(`分屏布局 (${openTabIds.length} 个标签)`);
                setSaveModalOpen(true);
              }}
            >
              保存当前布局
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
              加载默认主页
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

      {/* Save Layout Modal */}
      <Modal
        title={
          <Space align="center">
            <SaveOutlined style={{ color: '#1677ff' }} />
            <span>保存当前工作台布局模板</span>
          </Space>
        }
        open={saveModalOpen}
        onOk={handleConfirmSaveLayout}
        onCancel={() => {
          setSaveModalOpen(false);
          setLayoutName('');
        }}
        okText="确认保存"
        cancelText="取消"
        width={480}
      >
        <div style={{ marginTop: 12 }}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
            为当前分屏布局命名。保存后，随时可以通过「工作台布局」下拉菜单一键切换与恢复。
          </Typography.Paragraph>

          <Input
            placeholder="例如: 日常开发多栏视图、监控与节点控制台..."
            value={layoutName}
            onChange={(e) => setLayoutName(e.target.value)}
            onPressEnter={handleConfirmSaveLayout}
            autoFocus
            style={{ marginTop: 8 }}
          />

          <div style={{ marginTop: 14 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              当前布局包含标签页 ({openTabIds.length})：
            </Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {openTabIds.map((id) => (
                <Tag key={id} style={{ margin: 0 }}>
                  {WORKBENCH_CATALOG.find((item) => item.id === id)?.title || id}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* Quick Search / Open Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 24 }}>
            <Space align="center">
              <SearchOutlined style={{ color: '#1677ff' }} />
              <span>快速打开工作台模块</span>
            </Space>
          </div>
        }
        open={searchOpen}
        footer={null}
        onCancel={() => {
          setSearchOpen(false);
          setSearchQuery('');
        }}
        width={580}
        destroyOnClose
      >
        <Input
          ref={searchInputRef}
          prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
          placeholder="输入模块名称或拼音快速过滤 (例如: 注册插件、流水线、控制台)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          autoFocus
          style={{ marginBottom: 14 }}
        />

        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          {filteredCatalog.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="未找到匹配的功能模块"
            />
          ) : (
            filteredCatalog.map((item, index) => {
              const isOpen = openTabIds.includes(item.id);
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpenItem(item.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: isSelected
                      ? token.colorFillSecondary
                      : token.colorFillQuaternary,
                    border: isSelected
                      ? `1px solid ${token.colorPrimary}`
                      : `1px solid transparent`,
                    transition: 'all 0.1s ease',
                  }}
                >
                  <Space size={10}>
                    <span style={{ fontSize: 16 }}>{item.icon}</span>
                    <Typography.Text strong>{item.title}</Typography.Text>
                  </Space>
                  <Space size={8}>
                    {isOpen ? (
                      <Tag color="green" icon={<CheckOutlined />}>
                        已在工作台
                      </Tag>
                    ) : (
                      <Tag>点击打开</Tag>
                    )}
                    {isSelected && (
                      <Tag
                        color="blue"
                        icon={<EnterOutlined />}
                        style={{ fontSize: 11, margin: 0 }}
                      >
                        Enter
                      </Tag>
                    )}
                  </Space>
                </div>
              );
            })
          )}
        </div>
      </Modal>
    </div>
  );
}

export default GlobalWorkbench;
