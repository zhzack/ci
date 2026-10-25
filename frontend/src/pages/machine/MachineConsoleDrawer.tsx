import React, { useEffect, useMemo, useState } from 'react';

import { formatBytes } from '@/utils/format';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Input,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Tree,
  Typography,
  Upload,
  theme as antdTheme,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  AppstoreOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  HddOutlined,
  InboxOutlined,
  LayoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SplitCellsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  getDownloadFilesUrl,
  type DirectoryEntry,
} from '@/api/diagnostics';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { FileEditorPane } from './FileEditorPane';
import { InteractiveTerminal } from './InteractiveTerminal';
import { ProcessManagerPane } from './ProcessManagerPane';
import { NetworkDiagnosticsPane } from './NetworkDiagnosticsPane';
import { DockLayout } from '@/components/dock/DockLayout';
import type { LayoutNode, TabItemConfig } from '@/components/dock/types';
import {
  getAllOpenTabIds,
} from '@/components/dock/dockEngine';
import {
  ALL_CORE_TABS,
  DEFAULT_IDE_LAYOUT,
  formatUptime,
  getPathAncestors,
  normalizePath,
} from './machineConsoleUtils';
import { useConsoleDockLayout } from './useConsoleDockLayout';
import { useMachineTelemetry } from './useMachineTelemetry';
import { useRemoteFiles } from './useRemoteFiles';
import { ConsoleFileModals } from './ConsoleFileModals';

export interface MachineConsoleProps {
  machineId: string | null;
  machineName: string;
  connectionType: string;
  hostname?: string;
  platform?: string;
  osRelease?: string;
  arch?: string;
  online?: boolean;
  lastHeartbeat?: string;
}

interface Props extends MachineConsoleProps {
  open: boolean;
  onClose: () => void;
  /** When true, renders inline (for workbench tab); when false renders as a Drawer */
  tabMode?: boolean;
}

/** Thin wrapper for workbench tab usage — renders the console inline, no Drawer. */
export function MachineConsoleTab({
  machineId,
  machineName,
  connectionType,
  hostname,
  platform,
  osRelease,
  arch,
  online,
  lastHeartbeat,
}: MachineConsoleProps): React.JSX.Element {
  return (
    <MachineConsoleDrawer
      open={true}
      tabMode={true}
      machineId={machineId}
      machineName={machineName}
      connectionType={connectionType}
      hostname={hostname}
      platform={platform}
      osRelease={osRelease}
      arch={arch}
      online={online}
      lastHeartbeat={lastHeartbeat}
      onClose={() => undefined}
    />
  );
}

export function MachineConsoleDrawer({
  open,
  machineId,
  machineName,
  connectionType,
  hostname,
  platform,
  osRelease,
  arch,
  online,
  lastHeartbeat,
  onClose,
  tabMode = false,
}: Props): React.JSX.Element {
  const {
    openFiles,
    layout,
    handleLayoutChange,
    handleOpenTab,
    handleOpenFileEditor,
  } = useConsoleDockLayout(machineId);
  const {
    overview,
    overviewLoading,
    overviewError,
    fetchOverview,
    processes,
    procLoading,
    fetchProcesses,
    network,
    networkLoading,
    fetchNetwork,
  } = useMachineTelemetry(machineId);

  const { token } = antdTheme.useToken();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const {
    currentPath,
    inputPath,
    isEditingPath,
    files,
    filesLoading,
    selectedFilePaths,
    fileSortBy,
    drives,
    treeData,
    expandedKeys,
    treeSearch,
    fileFilter,
    createModalVisible,
    createModalType,
    newItemName,
    createLoading,
    renameModalVisible,
    targetRenamePath,
    newRenameName,
    renameLoading,
    chmodModalVisible,
    targetChmodPath,
    newChmodMode,
    chmodLoading,
    isDraggingOver,
    pendingTerminalCmd,
    setInputPath,
    setIsEditingPath,
    setSelectedFilePaths,
    setExpandedKeys,
    setFileSortBy,
    setTreeSearch,
    setFileFilter,
    setCreateModalVisible,
    setCreateModalType,
    setNewItemName,
    setRenameModalVisible,
    setNewRenameName,
    setChmodModalVisible,
    setNewChmodMode,
    setIsDraggingOver,
    setPendingTerminalCmd,
    fetchDirectory,
    fetchDrives,
    onLoadTreeData,
    onSelectTree,
    filteredTreeData,
    sortedFiles,
    filteredSortedFiles,
    handleBatchDelete,
    handleUploadFile,
    handleCreateSubmit,
    handleRenameSubmit,
    handleChmodSubmit,
    handleDropUpload,
    handleRefreshCurrentDir,
    handleParentNav,
    getTreeContextMenu,
    getContextMenu,
  } = useRemoteFiles({ machineId, platform, overview, handleOpenTab, handleOpenFileEditor });

  // Fetch Directory with caching & complete tree synchronization
  // On drawer open
  useEffect(() => {
    if (open && machineId) {
      void fetchDrives();
      void fetchOverview();
      void fetchProcesses();
      void fetchNetwork();
    }
  }, [open, machineId, fetchDrives, fetchOverview, fetchProcesses, fetchNetwork]);

  // Auto refresh polling
  useEffect(() => {
    if (!open || !machineId || !autoRefresh) return;
    const timer = setInterval(() => {
      void fetchOverview(true);
      void fetchProcesses(true);
      void fetchNetwork(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [open, machineId, autoRefresh, fetchOverview, fetchProcesses, fetchNetwork]);

  // Columns for Directory table
  const fileColumns: TableColumnsType<DirectoryEntry> = useMemo(
    () => [
      {
        title: '名称',
        dataIndex: 'name',
        sorter: (a: DirectoryEntry, b: DirectoryEntry) => a.name.localeCompare(b.name),
        render: (name: string, record: DirectoryEntry) => (
          <Dropdown menu={{ items: getContextMenu(record) }} trigger={['contextMenu']}>
            <Space style={{ width: '100%', cursor: 'pointer' }}>
              {record.is_dir ? (
                <FolderOutlined style={{ color: '#faad14', fontSize: 16 }} />
              ) : (
                <FileTextOutlined style={{ color: '#1677ff', fontSize: 16 }} />
              )}
              {record.is_dir ? (
                <Typography.Link
                  strong
                  onClick={() => void fetchDirectory(record.path)}
                  style={{ cursor: 'pointer' }}
                >
                  {name}
                </Typography.Link>
              ) : (
                <Typography.Link strong onClick={() => handleOpenFileEditor(record.path)}>
                  {name}
                </Typography.Link>
              )}
            </Space>
          </Dropdown>
        ),
      },
      {
        title: '大小',
        dataIndex: 'size_bytes',
        width: 90,
        sorter: (a: DirectoryEntry, b: DirectoryEntry) => a.size_bytes - b.size_bytes,
        render: (bytes: number, record: DirectoryEntry) =>
          record.is_dir ? <Typography.Text type="secondary">-</Typography.Text> : formatBytes(bytes),
      },
      {
        title: '权限',
        dataIndex: 'permissions',
        width: 80,
        sorter: (a: DirectoryEntry, b: DirectoryEntry) => a.permissions.localeCompare(b.permissions),
        render: (p: string) => <Tag style={{ fontFamily: 'monospace' }}>{p}</Tag>,
      },
      {
        title: '修改时间',
        dataIndex: 'modified_at',
        width: 150,
        sorter: (a: DirectoryEntry, b: DirectoryEntry) => a.modified_at.localeCompare(b.modified_at),
        render: (time: string) => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {time || '-'}
          </Typography.Text>
        ),
      },
      {
        title: '操作',
        key: 'actions',
        width: 110,
        render: (_v: unknown, record: DirectoryEntry) => (
          <Space size={2}>
            {!record.is_dir && (
              <Tooltip title="在标签页中打开编辑">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenFileEditor(record.path)}
                />
              </Tooltip>
            )}
            <Tooltip title="下载">
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                href={machineId ? getDownloadFilesUrl(machineId, [record.path]) : '#'}
                target="_blank"
              />
            </Tooltip>
            <Dropdown menu={{ items: getContextMenu(record) }} trigger={['click']}>
              <Button type="text" size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          </Space>
        ),
      },
    ],
    [fetchDirectory, handleOpenFileEditor, machineId, getContextMenu],
  );

  const downloadSelectedUrl =
    machineId && selectedFilePaths.length > 0
      ? getDownloadFilesUrl(machineId, selectedFilePaths)
      : machineId && currentPath
      ? getDownloadFilesUrl(machineId, [currentPath])
      : '#';

  type PresetKey = 'ide' | 'file-mode' | 'monitor-mode' | 'peer-tabs' | 'grid';

  // Preset Layout Modes
  const LAYOUT_PRESETS: Record<PresetKey, { label: string; layout: LayoutNode }> = {
    ide: {
      label: '经典四象限 IDE',
      layout: DEFAULT_IDE_LAYOUT,
    },
    'file-mode': {
      label: '文件开发模式',
      layout: {
        id: 'split-file-mode',
        type: 'split',
        direction: 'horizontal',
        sizes: [45, 55],
        children: [
          { id: 'g-file', type: 'tabGroup', tabs: ['files'], activeTab: 'files' },
          { id: 'g-term', type: 'tabGroup', tabs: ['terminal', 'overview'], activeTab: 'terminal' },
        ],
      },
    },
    'monitor-mode': {
      label: '运维全景监控模式',
      layout: {
        id: 'split-monitor-mode',
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { id: 'g-proc', type: 'tabGroup', tabs: ['processes', 'network'], activeTab: 'processes' },
          { id: 'g-term', type: 'tabGroup', tabs: ['overview', 'terminal'], activeTab: 'overview' },
        ],
      },
    },
    'peer-tabs': {
      label: '同级全标签页',
      layout: {
        id: 'single-group-peer',
        type: 'tabGroup',
        tabs: ['files', 'processes', 'network', 'terminal', 'overview'],
        activeTab: 'files',
      },
    },
    grid: {
      label: '四宫格布局',
      layout: {
        id: 'split-grid',
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          {
            id: 'split-left',
            type: 'split',
            direction: 'vertical',
            sizes: [50, 50],
            children: [
              { id: 'g-overview', type: 'tabGroup', tabs: ['overview'], activeTab: 'overview' },
              { id: 'g-proc', type: 'tabGroup', tabs: ['processes'], activeTab: 'processes' },
            ],
          },
          {
            id: 'split-right',
            type: 'split',
            direction: 'vertical',
            sizes: [50, 50],
            children: [
              { id: 'g-term', type: 'tabGroup', tabs: ['terminal'], activeTab: 'terminal' },
              { id: 'g-files', type: 'tabGroup', tabs: ['files', 'network'], activeTab: 'files' },
            ],
          },
        ],
      },
    },
  };

  // Preset Layout Selector Menu
  const presetMenuItems: MenuProps['items'] = [
    {
      key: 'ide',
      label: '经典四象限 IDE (全景/进程/终端/文件)',
      icon: <SplitCellsOutlined />,
      onClick: () => handleLayoutChange(LAYOUT_PRESETS.ide.layout),
    },
    {
      key: 'file-mode',
      label: '文件开发模式 (左侧文件管理 / 右侧在线终端)',
      icon: <FolderOpenOutlined />,
      onClick: () => handleLayoutChange(LAYOUT_PRESETS['file-mode'].layout),
    },
    {
      key: 'monitor-mode',
      label: '运维监控模式 (左侧进程与网络 / 右侧全景与终端)',
      icon: <FundProjectionScreenOutlined />,
      onClick: () => handleLayoutChange(LAYOUT_PRESETS['monitor-mode'].layout),
    },
    {
      key: 'peer-tabs',
      label: '同级全标签页 (文件/进程/网络/终端/全景在同一级 Tab)',
      icon: <AppstoreOutlined />,
      onClick: () => handleLayoutChange(LAYOUT_PRESETS['peer-tabs'].layout),
    },
    {
      key: 'grid',
      label: '四宫格布局 (全功能 2x2 网格)',
      onClick: () => handleLayoutChange(LAYOUT_PRESETS.grid.layout),
    },
  ];

  // Dynamic Tab Registry (Core panels + dynamically opened file editors)
  const tabRegistry: Record<string, TabItemConfig> = useMemo(() => {
    const registry: Record<string, TabItemConfig> = {
      files: {
        id: 'files',
        title: '远程文件',
        icon: <FolderOpenOutlined style={{ color: '#faad14' }} />,
        content: (
          <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
            {/* Left: Directory Tree Sidebar */}
            <div
              style={{
                width: 240,
                minWidth: 180,
                maxWidth: 320,
                borderRight: '1px solid rgba(140, 140, 140, 0.18)',
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(0, 0, 0, 0.015)',
                padding: '8px 8px',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 4px 6px 4px',
                  borderBottom: '1px solid rgba(140, 140, 140, 0.12)',
                  marginBottom: 8,
                }}
              >
                <Space size={6}>
                  <FolderOpenOutlined style={{ color: '#faad14', fontSize: 14 }} />
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    目录结构
                  </Typography.Text>
                </Space>
                <Tooltip title="刷新磁盘与目录树">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void fetchDrives()}
                  />
                </Tooltip>
              </div>

              <Input
                size="small"
                placeholder="筛选目录树..."
                value={treeSearch}
                onChange={(e) => setTreeSearch(e.target.value)}
                allowClear
                style={{ marginBottom: 8, fontSize: 12 }}
              />

              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {treeData.length > 0 ? (
                  <Tree
                    showIcon
                    blockNode
                    treeData={filteredTreeData}
                    loadData={onLoadTreeData}
                    selectedKeys={[normalizePath(currentPath)]}
                    expandedKeys={expandedKeys}
                    onExpand={(keys) => setExpandedKeys(keys)}
                    onSelect={onSelectTree}
                    titleRender={(node) => (
                      <Dropdown
                        menu={{ items: getTreeContextMenu(node) }}
                        trigger={['contextMenu']}
                      >
                        <span style={{ userSelect: 'none' }}>
                          {node.title as React.ReactNode}
                        </span>
                      </Dropdown>
                    )}
                  />
                ) : (
                  <div
                    style={{
                      padding: '24px 8px',
                      textAlign: 'center',
                      color: '#999',
                      fontSize: 12,
                    }}
                  >
                    暂无目录数据
                  </div>
                )}
              </div>
            </div>

            {/* Right: File Explorer Table & Actions */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                padding: '8px 12px',
                minWidth: 0,
              }}
            >
              {/* WinSCP Style: Drive Switcher Pills */}
              {drives.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    marginBottom: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography.Text type="secondary" style={{ fontSize: 11, marginRight: 2 }}>
                    <HddOutlined /> 磁盘:
                  </Typography.Text>
                  {drives.map((d) => {
                    const isActive = normalizePath(currentPath)
                      .toLowerCase()
                      .startsWith(d.mount_point.toLowerCase().slice(0, 2));
                    return (
                      <Tag
                        key={d.mount_point}
                        color={isActive ? 'blue' : 'default'}
                        style={{
                          cursor: 'pointer',
                          padding: '1px 8px',
                          fontSize: 12,
                          borderRadius: 10,
                          border: isActive ? '1px solid #1677ff' : undefined,
                        }}
                        onClick={() => void fetchDirectory(d.mount_point)}
                      >
                        <span style={{ fontWeight: isActive ? 600 : 400 }}>{d.device_id}</span>
                        {d.total_gb > 0 && (
                          <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 4 }}>
                            ({d.free_gb}G 可用)
                          </span>
                        )}
                      </Tag>
                    );
                  })}
                </div>
              )}

              {/* Navigation & Action Toolbar */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <Button
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={
                      currentPath === '/' ||
                      currentPath === '' ||
                      currentPath === 'C:/' ||
                      currentPath === 'D:/' ||
                      currentPath === 'G:/' ||
                      currentPath === 'F:/' ||
                      currentPath === 'H:/'
                    }
                    onClick={handleParentNav}
                    title="返回上一级目录"
                  />
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    onClick={() => void fetchDirectory(currentPath, true)}
                    title="刷新当前目录 (F5)"
                  />

                  {/* Interactive Breadcrumbs / Editable Path Toggle */}
                  {isEditingPath ? (
                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                      <Input
                        size="small"
                        value={inputPath}
                        onChange={(e) => setInputPath(e.target.value)}
                        onPressEnter={() => {
                          setIsEditingPath(false);
                          void fetchDirectory(inputPath);
                        }}
                        placeholder="路径，例如 /var/log 或 C:\..."
                        style={{ flex: 1, fontFamily: 'monospace' }}
                      />
                      <Button
                        size="small"
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={() => {
                          setIsEditingPath(false);
                          void fetchDirectory(inputPath);
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        background: 'rgba(0, 0, 0, 0.03)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        overflowX: 'auto',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Breadcrumb
                        items={getPathAncestors(currentPath).map((p, idx, arr) => {
                          const isLast = idx === arr.length - 1;
                          const name = idx === 0 ? p : p.split('/').pop() || p;
                          return {
                            title: (
                              <span
                                style={{
                                  cursor: 'pointer',
                                  fontWeight: isLast ? 600 : 400,
                                  color: isLast ? '#1677ff' : undefined,
                                }}
                                onClick={() => void fetchDirectory(p)}
                              >
                                {name}
                              </span>
                            ),
                          };
                        })}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined style={{ fontSize: 11, opacity: 0.6 }} />}
                        onClick={() => setIsEditingPath(true)}
                        style={{ marginLeft: 6 }}
                        title="编辑路径"
                      />
                    </div>
                  )}
                </div>

                <Space size={4} wrap>
                  <Input
                    size="small"
                    placeholder="过滤当前目录..."
                    prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
                    value={fileFilter}
                    onChange={(e) => setFileFilter(e.target.value)}
                    allowClear
                    style={{ width: 130 }}
                  />
                  <Select
                    size="small"
                    value={fileSortBy}
                    onChange={setFileSortBy}
                    style={{ width: 110 }}
                    suffixIcon={<SortAscendingOutlined />}
                    options={[
                      { label: '默认排序', value: 'default' },
                      { label: '名称 A-Z', value: 'name_asc' },
                      { label: '名称 Z-A', value: 'name_desc' },
                      { label: '大小 大到小', value: 'size_desc' },
                      { label: '大小 由小到大', value: 'size_asc' },
                      { label: '修改时间 最新', value: 'time_desc' },
                      { label: '修改时间 最旧', value: 'time_asc' },
                    ]}
                  />
                  <Tooltip title="新建文件">
                    <Button
                      size="small"
                      icon={<FileAddOutlined />}
                      onClick={() => {
                        setCreateModalType('file');
                        setNewItemName('');
                        setCreateModalVisible(true);
                      }}
                    >
                      新建文件
                    </Button>
                  </Tooltip>
                  <Tooltip title="新建文件夹">
                    <Button
                      size="small"
                      icon={<FolderAddOutlined />}
                      onClick={() => {
                        setCreateModalType('dir');
                        setNewItemName('');
                        setCreateModalVisible(true);
                      }}
                    >
                      新建文件夹
                    </Button>
                  </Tooltip>
                  <Upload beforeUpload={handleUploadFile} showUploadList={false} multiple>
                    <Button size="small" icon={<UploadOutlined />}>
                      上传
                    </Button>
                  </Upload>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    href={downloadSelectedUrl}
                    target="_blank"
                  >
                    {selectedFilePaths.length > 0 ? `下载(${selectedFilePaths.length})` : '打包下载'}
                  </Button>
                  <Tooltip title="刷新当前目录">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={handleRefreshCurrentDir}
                    />
                  </Tooltip>
                  {selectedFilePaths.length > 0 && (
                    <Popconfirm
                      title={`确定删除选中的 ${selectedFilePaths.length} 个文件？`}
                      onConfirm={handleBatchDelete}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button size="small" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              </div>

              {/* Drag and Drop Zone Container */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  position: 'relative',
                  border: isDraggingOver ? '2px dashed #1677ff' : 'none',
                  background: isDraggingOver ? 'rgba(22, 119, 255, 0.05)' : undefined,
                  transition: 'all 0.2s ease',
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                }}
                onDrop={handleDropUpload}
              >
                {isDraggingOver && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.85)',
                      zIndex: 10,
                      pointerEvents: 'none',
                    }}
                  >
                    <Space direction="vertical" align="center">
                      <InboxOutlined style={{ fontSize: 40, color: '#1677ff' }} />
                      <Typography.Text strong style={{ fontSize: 16, color: '#1677ff' }}>
                        释放鼠标将文件直接上传至当前目录
                      </Typography.Text>
                    </Space>
                  </div>
                )}
                <Table<DirectoryEntry>
                  rowKey="path"
                  columns={fileColumns}
                  dataSource={filteredSortedFiles}
                  loading={filesLoading}
                  size="small"
                  pagination={false}
                  rowSelection={{
                    selectedRowKeys: selectedFilePaths,
                    onChange: (keys) => setSelectedFilePaths(keys as string[]),
                  }}
                />
              </div>
            </div>
          </div>
        ),
      },
      terminal: {
        id: 'terminal',
        title: '原生控制台',
        icon: <DesktopOutlined style={{ color: '#52c41a' }} />,
        content: (
          <InteractiveTerminal
            machineId={machineId}
            machineName={machineName}
            connectionType={connectionType}
            hostname={overview?.hostname || hostname}
            platform={overview?.platform || platform}
            currentCwd={currentPath}
            currentFiles={files}
            onDirectoryChange={(newDir) => fetchDirectory(newDir)}
            pendingCommand={pendingTerminalCmd}
            onClearPendingCommand={() => setPendingTerminalCmd(null)}
          />
        ),
      },
      processes: {
        id: 'processes',
        title: '进程监控',
        icon: <FundProjectionScreenOutlined style={{ color: '#722ed1' }} />,
        content: (
          <ProcessManagerPane
            processes={processes}
            loading={procLoading}
            onRefresh={() => fetchProcesses()}
          />
        ),
      },
      network: {
        id: 'network',
        title: '网络状态监控',
        icon: <GlobalOutlined style={{ color: '#13c2c2' }} />,
        content: (
          <NetworkDiagnosticsPane
            data={network}
            loading={networkLoading}
            onRefresh={() => fetchNetwork()}
          />
        ),
      },
      overview: {
        id: 'overview',
        title: '系统全景',
        icon: <DashboardOutlined style={{ color: '#1677ff' }} />,
        content: (
          <div style={{ padding: '12px 16px', overflowY: 'auto', height: '100%' }}>
            {overviewLoading ? (
              <Loading rows={3} />
            ) : overviewError ? (
              <ErrorAlert error={new Error(overviewError)} onRetry={() => fetchOverview()} />
            ) : overview ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {/* 1. 目标计算节点身份与连接状态指示卡片 */}
                <Card
                  size="small"
                  style={{
                    borderRadius: 6,
                    background: token.colorFillAlter,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                >
                  <Descriptions
                    size="small"
                    column={{ xxl: 4, xl: 4, lg: 2, md: 2, sm: 1, xs: 1 }}
                  >
                    <Descriptions.Item label="当前机器自定义名称">
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {machineName}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="真实主机名 (Hostname)">
                      <Tag color="geekblue" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        💻 {overview.hostname || hostname || '待连接上报'}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="系统类型与架构">
                      <Tag
                        color={
                          (overview.platform || platform || '').toLowerCase().includes('win')
                            ? 'blue'
                            : (overview.platform || platform || '').toLowerCase().includes('linux')
                            ? 'green'
                            : (overview.platform || platform || '').toLowerCase().includes('mac')
                            ? 'magenta'
                            : 'default'
                        }
                      >
                        {(overview.platform || platform || '').toLowerCase().includes('win')
                          ? '🪟 Windows'
                          : (overview.platform || platform || '').toLowerCase().includes('linux')
                          ? '🐧 Linux'
                          : (overview.platform || platform || '').toLowerCase().includes('mac')
                          ? '🍎 macOS'
                          : '💻 Host'}{' '}
                        ({overview.arch || arch || 'x64'})
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="连接模式与状态">
                      <Space size={4}>
                        <Tag
                          color={
                            machineId === 'master-local' || connectionType === 'builtin'
                              ? 'purple'
                              : connectionType === 'ssh'
                              ? 'orange'
                              : 'cyan'
                          }
                        >
                          {machineId === 'master-local' || connectionType === 'builtin'
                            ? '👑 Master 内置'
                            : connectionType === 'ssh'
                            ? '🌐 SSH 远端'
                            : '🤖 Agent Runner'}
                        </Tag>
                        <Tag
                          color={
                            overview?.online ?? (online || overview.uptime_seconds > 0)
                              ? 'success'
                              : 'default'
                          }
                        >
                          {overview?.online ?? (online || overview.uptime_seconds > 0)
                            ? '🟢 实时在线'
                            : '⚪ 离线 / 等待心跳'}
                        </Tag>
                      </Space>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>

                {!(overview?.online ?? (online || overview.uptime_seconds > 0)) &&
                  machineId !== 'master-local' &&
                  connectionType !== 'builtin' && (
                    <Alert
                      type="warning"
                      showIcon
                      message={`节点 [${machineName}] 当前处于离线/等待通信状态`}
                      description="该节点尚未向平台建立实时心跳通信。请确认目标机器已执行一键部署脚本且后台守护进程正常运行。上线后系统全景将自动更新该机器的实时 CPU、内存与磁盘数据。"
                    />
                  )}

                <Row gutter={[10, 10]}>
                  <Col span={6}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 6,
                        background: token.colorFillQuaternary,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        CPU ({overview.cpu_count} 核心)
                      </Typography.Text>
                      <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                        {overview.cpu_percent}%
                      </div>
                      <Progress
                        percent={overview.cpu_percent}
                        status={overview.cpu_percent > 80 ? 'exception' : 'active'}
                        strokeColor="#1677ff"
                        showInfo={false}
                      />
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 6,
                        background: token.colorFillQuaternary,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        内存 (RAM)
                      </Typography.Text>
                      <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                        {overview.memory_percent}%
                      </div>
                      <Progress
                        percent={overview.memory_percent}
                        strokeColor="#52c41a"
                        showInfo={false}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {Math.round(overview.memory_used_mb)}M /{' '}
                        {Math.round(overview.memory_total_mb)}M
                      </Typography.Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 6,
                        background: token.colorFillQuaternary,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        根目录磁盘
                      </Typography.Text>
                      <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                        {overview.disk_percent}%
                      </div>
                      <Progress
                        percent={overview.disk_percent}
                        strokeColor="#fa8c16"
                        showInfo={false}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {overview.disk_used_gb}G / {overview.disk_total_gb}G
                      </Typography.Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card
                      size="small"
                      style={{
                        borderRadius: 6,
                        background: token.colorFillQuaternary,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        网络实时流量
                      </Typography.Text>
                      <div style={{ fontSize: 13, fontWeight: 'bold', margin: '4px 0' }}>
                        <span style={{ color: '#52c41a' }}>↓ {overview.network_recv_mb}M</span> /{' '}
                        <span style={{ color: '#1677ff' }}>↑ {overview.network_sent_mb}M</span>
                      </div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        实时流量监控
                      </Typography.Text>
                    </Card>
                  </Col>
                </Row>

                {/* FinalShell Style: Multi-Disk Partitions Breakdown */}
                {drives.length > 0 && (
                  <Card
                    size="small"
                    title={
                      <Space size={6}>
                        <HddOutlined style={{ color: '#1677ff' }} />
                        <Typography.Text strong style={{ fontSize: 13 }}>
                          物理存储与分区状态 ({drives.length} 个盘符/挂载点)
                        </Typography.Text>
                      </Space>
                    }
                    style={{
                      borderRadius: 6,
                      background: token.colorFillQuaternary,
                      border: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <Row gutter={[12, 12]}>
                      {drives.map((d) => (
                        <Col
                          span={drives.length === 1 ? 24 : drives.length === 2 ? 12 : 6}
                          key={d.mount_point}
                        >
                          <div
                            style={{
                              padding: '8px 10px',
                              background: token.colorBgContainer,
                              borderRadius: 6,
                              border: `1px solid ${token.colorBorderSecondary}`,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginBottom: 2,
                              }}
                            >
                              <Typography.Text strong style={{ fontSize: 12 }}>
                                💽 {d.device_id} ({d.volume_name || d.mount_point})
                              </Typography.Text>
                              <Tag
                                color={
                                  d.percent > 85
                                    ? 'error'
                                    : d.percent > 70
                                    ? 'warning'
                                    : 'success'
                                }
                                style={{ margin: 0, fontSize: 11 }}
                              >
                                {d.percent}%
                              </Tag>
                            </div>
                            <Progress
                              percent={d.percent}
                              size="small"
                              status={d.percent > 85 ? 'exception' : 'normal'}
                              strokeColor={
                                d.percent > 85
                                  ? '#ff4d4f'
                                  : d.percent > 70
                                  ? '#faad14'
                                  : '#1677ff'
                              }
                              showInfo={false}
                            />
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                marginTop: 2,
                                fontSize: 11,
                                color: token.colorTextSecondary,
                              }}
                            >
                              <span>已用: {d.used_gb} GB</span>
                              <span>总量: {d.total_gb} GB</span>
                            </div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                )}

                <Descriptions
                  column={{ xxl: 5, xl: 5, lg: 3, md: 2, sm: 1, xs: 1 }}
                  size="small"
                >
                  <Descriptions.Item label="主机">{overview.hostname || hostname || '—'}</Descriptions.Item>
                  <Descriptions.Item label="系统">{overview.os_release || osRelease || '—'}</Descriptions.Item>
                  <Descriptions.Item label="架构">{overview.arch || arch || '—'}</Descriptions.Item>
                  <Descriptions.Item label="运行时长">
                    {formatUptime(overview.uptime_seconds)}
                  </Descriptions.Item>
                  <Descriptions.Item label="最近心跳">
                    {lastHeartbeat ? new Date(lastHeartbeat).toLocaleString() : '—'}
                  </Descriptions.Item>
                </Descriptions>
              </Space>
            ) : null}
          </div>
        ),
      },
    };

    // Dynamically register file editors for openFiles
    for (const filePath of openFiles) {
      const tabId = `file:${filePath}`;
      const fileName = filePath.split('/').pop() || filePath;
      registry[tabId] = {
        id: tabId,
        title: fileName,
        icon: <FileTextOutlined style={{ color: '#1677ff' }} />,
        closable: true,
        content: (
          <FileEditorPane
            machineId={machineId || ''}
            filePath={filePath}
            onSaved={() => fetchDirectory(currentPath)}
          />
        ),
      };
    }

    return registry;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPath,
    inputPath,
    fileSortBy,
    sortedFiles,
    filesLoading,
    selectedFilePaths,
    downloadSelectedUrl,
    machineId,
    machineName,
    connectionType,
    hostname,
    platform,
    arch,
    online,
    files,
    processes,
    procLoading,
    network,
    networkLoading,
    overviewLoading,
    overviewError,
    overview,
    openFiles,
    token,
    fetchOverview,
    fetchProcesses,
    fetchNetwork,
    fetchDirectory,
    fileColumns,
    handleBatchDelete,
    handleParentNav,
    handleUploadFile,
  ]);

  const effectiveHostname = overview?.hostname || hostname || '待心跳上报';
  const effectivePlatform = (overview?.platform || platform || '').toLowerCase();
  const effectiveArch = overview?.arch || arch || 'x64';
  const isWindows =
    effectivePlatform.includes('win') || (overview?.os_release || '').toLowerCase().includes('win');
  const isLinux =
    effectivePlatform.includes('linux') ||
    (overview?.os_release || '').toLowerCase().includes('linux');
  const isMac =
    effectivePlatform.includes('darwin') ||
    effectivePlatform.includes('mac') ||
    (overview?.os_release || '').toLowerCase().includes('mac');
  const isBuiltin = machineId === 'master-local' || connectionType === 'builtin';
  const isSSH = connectionType === 'ssh';
  const isOnline = online ?? (overview ? overview.uptime_seconds > 0 : false);
  const openTabIds = getAllOpenTabIds(layout);

  const toolbar = (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
      }}
    >
      <Space size={10} wrap>
        <DesktopOutlined style={{ fontSize: 18, color: '#1677ff' }} />
        <div>
          <Space size={6} wrap>
            <Typography.Text strong style={{ fontSize: tabMode ? 14 : 16 }}>
              {machineName}
            </Typography.Text>
            <Tag color="geekblue" style={{ fontFamily: 'monospace', fontSize: 11, margin: 0 }}>
              💻 {effectiveHostname}
            </Tag>
            <Tag
              color={
                isBuiltin
                  ? 'purple'
                  : isSSH
                  ? 'orange'
                  : isWindows
                  ? 'blue'
                  : isLinux
                  ? 'green'
                  : isMac
                  ? 'magenta'
                  : 'cyan'
              }
              style={{ margin: 0 }}
            >
              {isBuiltin
                ? '👑 Built-in Server'
                : isSSH
                ? '🌐 SSH'
                : isWindows
                ? `🪟 Windows (${effectiveArch})`
                : isLinux
                ? `🐧 Linux (${effectiveArch})`
                : `🤖 Agent (${connectionType})`}
            </Tag>
            <Tag color={isOnline ? 'success' : 'default'} style={{ margin: 0 }}>
              {isOnline ? '🟢 在线' : '⚪ 离线'}
            </Tag>
          </Space>
        </div>
      </Space>

      <Space size={12}>
        <Segmented
          size="small"
          options={[
            { label: '📁 文件模式', value: 'file-mode' },
            { label: '📊 监控模式', value: 'monitor-mode' },
            { label: '📑 同级全标签', value: 'peer-tabs' },
            { label: '🎛️ 经典 IDE', value: 'ide' },
          ]}
          onChange={(val) => {
            const p = LAYOUT_PRESETS[val as PresetKey];
            if (p) handleLayoutChange(p.layout);
          }}
        />

        <Dropdown menu={{ items: presetMenuItems }} placement="bottomRight">
          <Button size="small" icon={<LayoutOutlined />}>
            更多预设
          </Button>
        </Dropdown>

        <Dropdown
          menu={{
            items: ALL_CORE_TABS.map((tabId) => ({
              key: tabId,
              label: `打开 ${tabRegistry[tabId]?.title}`,
              icon: tabRegistry[tabId]?.icon,
              disabled: openTabIds.includes(tabId),
              onClick: () => handleOpenTab(tabId),
            })),
          }}
          placement="bottomRight"
        >
          <Button size="small" icon={<PlusOutlined />}>
            打开面板
          </Button>
        </Dropdown>

        <Divider type="vertical" />

        <Space size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            实时轮询
          </Typography.Text>
          <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh} />
        </Space>

        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            void fetchOverview();
            void fetchDirectory(currentPath);
            void fetchProcesses();
            void fetchNetwork();
          }}
        >
          全部刷新
        </Button>
      </Space>
    </div>
  );

  const modals = (
    <ConsoleFileModals
        createModalVisible={ createModalVisible }
        createModalType={ createModalType }
        createLoading={ createLoading }
        handleCreateSubmit={ handleCreateSubmit }
        setCreateModalVisible={ setCreateModalVisible }
        setNewItemName={ setNewItemName }
        currentPath={ currentPath }
        newItemName={ newItemName }
        renameModalVisible={ renameModalVisible }
        renameLoading={ renameLoading }
        handleRenameSubmit={ handleRenameSubmit }
        setRenameModalVisible={ setRenameModalVisible }
        targetRenamePath={ targetRenamePath }
        newRenameName={ newRenameName }
        setNewRenameName={ setNewRenameName }
        chmodModalVisible={ chmodModalVisible }
        chmodLoading={ chmodLoading }
        handleChmodSubmit={ handleChmodSubmit }
        setChmodModalVisible={ setChmodModalVisible }
        targetChmodPath={ targetChmodPath }
        newChmodMode={ newChmodMode }
        setNewChmodMode={ setNewChmodMode }
    />
  );

  if (tabMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
          {toolbar}
        </div>
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <DockLayout layout={layout} tabRegistry={tabRegistry} onChange={handleLayoutChange} />
        </div>
        {modals}
      </div>
    );
  }

  return (
    <Drawer
      title={<div style={{ paddingRight: 24 }}>{toolbar}</div>}
      open={open}
      onClose={onClose}
      width="96vw"
      bodyStyle={{
        padding: 8,
        height: 'calc(100vh - 55px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
      destroyOnClose
    >
      <DockLayout layout={layout} tabRegistry={tabRegistry} onChange={handleLayoutChange} />
      {modals}
    </Drawer>
  );
}
