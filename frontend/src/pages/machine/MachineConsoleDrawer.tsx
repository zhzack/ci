import React, { useEffect, useMemo, useState } from 'react';
import {
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
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { MenuProps, TableColumnsType } from 'antd';
import {
  AppstoreOutlined,
  ArrowUpOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  LayoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  SortAscendingOutlined,
  SplitCellsOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  batchDeleteMachineFiles,
  getDownloadFilesUrl,
  getMachineNetwork,
  getMachineOverview,
  getMachineProcesses,
  listMachineDirectory,
  uploadMachineFile,
  type DirectoryEntry,
  type NetworkDiagnostics,
  type ProcessInfo,
  type SystemOverview,
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
  deserializeLayout,
  findTabGroupWithTab,
  getAllOpenTabIds,
  moveTab,
  selectTab,
  serializeLayout,
  splitTab,
} from '@/components/dock/dockEngine';

interface Props {
  open: boolean;
  machineId: string | null;
  machineName: string;
  connectionType: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 秒';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分`);
  if (parts.length === 0 || secs > 0) parts.push(`${secs}秒`);
  return parts.join(' ');
}

const ALL_CORE_TABS = ['files', 'terminal', 'processes', 'network', 'overview'];

// Default 4-Quadrant IDE Layout: 左上系统全景, 左下进程与网络, 右上在线终端, 右下远程文件
const DEFAULT_IDE_LAYOUT: LayoutNode = {
  id: 'root-split',
  type: 'split',
  direction: 'horizontal',
  sizes: [42, 58],
  children: [
    {
      id: 'left-split',
      type: 'split',
      direction: 'vertical',
      sizes: [45, 55],
      children: [
        {
          id: 'overview-group',
          type: 'tabGroup',
          tabs: ['overview'],
          activeTab: 'overview',
        },
        {
          id: 'proc-group',
          type: 'tabGroup',
          tabs: ['processes', 'network'],
          activeTab: 'processes',
        },
      ],
    },
    {
      id: 'right-split',
      type: 'split',
      direction: 'vertical',
      sizes: [52, 48],
      children: [
        {
          id: 'term-group',
          type: 'tabGroup',
          tabs: ['terminal'],
          activeTab: 'terminal',
        },
        {
          id: 'files-group',
          type: 'tabGroup',
          tabs: ['files'],
          activeTab: 'files',
        },
      ],
    },
  ],
};

export function MachineConsoleDrawer({
  open,
  machineId,
  machineName,
  connectionType,
  onClose,
}: Props): React.JSX.Element {
  const storageKey = machineId
    ? `mini_pipeline_dock_layout_${machineId}`
    : 'mini_pipeline_dock_layout_default';

  // Dynamically opened files in editor tabs
  const [openFiles, setOpenFiles] = useState<string[]>([]);

  // Load layout from localStorage or fallback
  const [layout, setLayout] = useState<LayoutNode>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return deserializeLayout(saved, ALL_CORE_TABS, DEFAULT_IDE_LAYOUT);
      }
    } catch {}
    return DEFAULT_IDE_LAYOUT;
  });

  const [autoRefresh, setAutoRefresh] = useState(true);

  // 1. Overview state
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // 2. Directory state
  const [currentPath, setCurrentPath] = useState('/');
  const [inputPath, setInputPath] = useState('/');
  const [files, setFiles] = useState<DirectoryEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [fileSortBy, setFileSortBy] = useState<string>('default');

  // 3. Process state
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [procLoading, setProcLoading] = useState(false);

  // 4. Network state
  const [network, setNetwork] = useState<NetworkDiagnostics | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);

  // Persist layout to localStorage
  const handleLayoutChange = (newLayout: LayoutNode) => {
    setLayout(newLayout);
    try {
      localStorage.setItem(storageKey, serializeLayout(newLayout));
    } catch {}
  };

  // Open file in Docking Editor Tab (in the same TabGroup as files by default)
  const handleOpenFileEditor = (filePath: string) => {
    const tabId = `file:${filePath}`;
    if (!openFiles.includes(filePath)) {
      setOpenFiles((prev) => [...prev, filePath]);
    }

    const allTabs = getAllOpenTabIds(layout);
    if (allTabs.includes(tabId)) {
      const targetGroup = findTabGroupWithTab(layout, tabId);
      if (targetGroup) {
        handleLayoutChange(selectTab(layout, targetGroup.id, tabId));
      }
    } else {
      // Find group containing 'files' and add the file tab to the same TabGroup as 'files'
      const filesGroup = findTabGroupWithTab(layout, 'files');
      if (filesGroup) {
        const updated = moveTab(layout, filesGroup.id, filesGroup.id, tabId);
        handleLayoutChange(updated);
      } else {
        const rootId = layout.id;
        const updated = splitTab(layout, rootId, rootId, tabId, 'center');
        handleLayoutChange(updated);
      }
      antdMessage.info(`已打开文件标签: ${filePath.split('/').pop()}`);
    }
  };

  // Fetch Overview
  const fetchOverview = async (silent = false) => {
    if (!machineId) return;
    if (!silent) setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await getMachineOverview(machineId);
      setOverview(data);
    } catch (err: any) {
      setOverviewError(err?.message || '获取机器监控信息失败');
    } finally {
      if (!silent) setOverviewLoading(false);
    }
  };

  // Fetch Directory
  const fetchDirectory = async (targetPath: string) => {
    if (!machineId) return;
    setFilesLoading(true);
    try {
      const data = await listMachineDirectory(machineId, targetPath);
      setFiles(data);
      setCurrentPath(targetPath);
      setInputPath(targetPath);
      setSelectedFilePaths([]);
    } catch (err: any) {
      antdMessage.error(`读取目录 "${targetPath}" 失败: ${err?.message || '未知错误'}`);
    } finally {
      setFilesLoading(false);
    }
  };

  // Fetch Processes
  const fetchProcesses = async (silent = false) => {
    if (!machineId) return;
    if (!silent) setProcLoading(true);
    try {
      const data = await getMachineProcesses(machineId);
      setProcesses(data);
    } catch (err: any) {
      if (!silent) antdMessage.error(`获取进程列表失败: ${err?.message || '未知错误'}`);
    } finally {
      if (!silent) setProcLoading(false);
    }
  };

  // Fetch Network
  const fetchNetwork = async (silent = false) => {
    if (!machineId) return;
    if (!silent) setNetworkLoading(true);
    try {
      const data = await getMachineNetwork(machineId);
      setNetwork(data);
    } catch (err: any) {
      if (!silent) antdMessage.error(`获取网络状态失败: ${err?.message || '未知错误'}`);
    } finally {
      if (!silent) setNetworkLoading(false);
    }
  };

  // Batch delete files
  const handleBatchDelete = async () => {
    if (!machineId || selectedFilePaths.length === 0) return;
    try {
      await batchDeleteMachineFiles(machineId, selectedFilePaths);
      antdMessage.success(`已删除 ${selectedFilePaths.length} 个文件/文件夹`);
      void fetchDirectory(currentPath);
    } catch (err: any) {
      antdMessage.error(`删除失败: ${err?.message || '未知错误'}`);
    }
  };

  // Upload file
  const handleUploadFile = async (file: File) => {
    if (!machineId) return false;
    try {
      await uploadMachineFile(machineId, currentPath, file);
      antdMessage.success(`文件 "${file.name}" 上传成功`);
      void fetchDirectory(currentPath);
    } catch (err: any) {
      antdMessage.error(`上传失败: ${err?.message || '未知错误'}`);
    }
    return false;
  };

  // On drawer open
  useEffect(() => {
    if (open && machineId) {
      void fetchOverview();
      void fetchDirectory(currentPath);
      void fetchProcesses();
      void fetchNetwork();
    }
  }, [open, machineId]);

  // Auto refresh polling
  useEffect(() => {
    if (!open || !machineId || !autoRefresh) return;
    const timer = setInterval(() => {
      void fetchOverview(true);
      void fetchProcesses(true);
      void fetchNetwork(true);
    }, 4000);
    return () => clearInterval(timer);
  }, [open, machineId, autoRefresh]);

  const handleParentNav = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    void fetchDirectory(parentPath);
  };

  // File sorting
  const sortedFiles = [...files].sort((a, b) => {
    if (fileSortBy === 'name_asc') return a.name.localeCompare(b.name);
    if (fileSortBy === 'name_desc') return b.name.localeCompare(a.name);
    if (fileSortBy === 'size_desc') return b.size_bytes - a.size_bytes;
    if (fileSortBy === 'size_asc') return a.size_bytes - b.size_bytes;
    if (fileSortBy === 'time_desc') return b.modified_at.localeCompare(a.modified_at);
    if (fileSortBy === 'time_asc') return a.modified_at.localeCompare(b.modified_at);
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Columns for Directory table
  const fileColumns: TableColumnsType<DirectoryEntry> = [
    {
      title: '名称',
      dataIndex: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <Space>
          {record.is_dir ? (
            <FolderOutlined style={{ color: '#faad14', fontSize: 16 }} />
          ) : (
            <FileTextOutlined style={{ color: '#1677ff', fontSize: 16 }} />
          )}
          {record.is_dir ? (
            <Typography.Link
              strong
              onClick={() => fetchDirectory(record.path)}
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
      ),
    },
    {
      title: '大小',
      dataIndex: 'size_bytes',
      width: 90,
      sorter: (a, b) => a.size_bytes - b.size_bytes,
      render: (bytes: number, record) =>
        record.is_dir ? <Typography.Text type="secondary">-</Typography.Text> : formatBytes(bytes),
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      width: 80,
      sorter: (a, b) => a.permissions.localeCompare(b.permissions),
      render: (p: string) => <Tag style={{ fontFamily: 'monospace' }}>{p}</Tag>,
    },
    {
      title: '修改时间',
      dataIndex: 'modified_at',
      width: 150,
      sorter: (a, b) => a.modified_at.localeCompare(b.modified_at),
      render: (time: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {time || '-'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_v, record) => (
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
        </Space>
      ),
    },
  ];

  const downloadSelectedUrl =
    machineId && selectedFilePaths.length > 0
      ? getDownloadFilesUrl(machineId, selectedFilePaths)
      : machineId && currentPath
      ? getDownloadFilesUrl(machineId, [currentPath])
      : '#';

  // Open tabs
  const openTabIds = getAllOpenTabIds(layout);

  // Quick action: Open closed tab
  const handleOpenTab = (tabId: string) => {
    if (!openTabIds.includes(tabId)) {
      const rootId = layout.id;
      const updated = splitTab(layout, rootId, rootId, tabId, 'right');
      handleLayoutChange(updated);
    }
  };

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
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, marginRight: 8 }}>
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={currentPath === '/' || currentPath === ''}
                  onClick={handleParentNav}
                >
                  上一级
                </Button>
                <Input
                  size="small"
                  value={inputPath}
                  onChange={(e) => setInputPath(e.target.value)}
                  onPressEnter={() => fetchDirectory(inputPath)}
                  placeholder="路径，例如 /var/log 或 C:\..."
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <Button size="small" type="primary" onClick={() => fetchDirectory(inputPath)}>
                  前往
                </Button>
              </div>

              <Space size={4}>
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

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <Table<DirectoryEntry>
                rowKey="path"
                columns={fileColumns}
                dataSource={sortedFiles}
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
            currentCwd={currentPath}
            currentFiles={files}
            onDirectoryChange={(newDir) => fetchDirectory(newDir)}
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
                <Row gutter={[10, 10]}>
                  <Col span={6}>
                    <Card size="small" style={{ borderRadius: 6, background: '#fafafa' }}>
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
                    <Card size="small" style={{ borderRadius: 6, background: '#fafafa' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        内存 (RAM)
                      </Typography.Text>
                      <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                        {overview.memory_percent}%
                      </div>
                      <Progress percent={overview.memory_percent} strokeColor="#52c41a" showInfo={false} />
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {Math.round(overview.memory_used_mb)}M / {Math.round(overview.memory_total_mb)}M
                      </Typography.Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card size="small" style={{ borderRadius: 6, background: '#fafafa' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        根目录磁盘
                      </Typography.Text>
                      <div style={{ fontSize: 18, fontWeight: 'bold', margin: '2px 0' }}>
                        {overview.disk_percent}%
                      </div>
                      <Progress percent={overview.disk_percent} strokeColor="#fa8c16" showInfo={false} />
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {overview.disk_used_gb}G / {overview.disk_total_gb}G
                      </Typography.Text>
                    </Card>
                  </Col>

                  <Col span={6}>
                    <Card size="small" style={{ borderRadius: 6, background: '#fafafa' }}>
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

                <Descriptions column={4} size="small">
                  <Descriptions.Item label="主机">{overview.hostname}</Descriptions.Item>
                  <Descriptions.Item label="系统">{overview.os_release}</Descriptions.Item>
                  <Descriptions.Item label="架构">{overview.arch}</Descriptions.Item>
                  <Descriptions.Item label="运行时长">
                    {formatUptime(overview.uptime_seconds)}
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
    files,
    processes,
    procLoading,
    network,
    networkLoading,
    overviewLoading,
    overviewError,
    overview,
    openFiles,
  ]);

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: 24 }}>
          <Space size={10}>
            <DesktopOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <div>
              <Typography.Text strong style={{ fontSize: 16 }}>
                {machineName} — 计算节点全功能 IDE 工作台
              </Typography.Text>
              <Tag color="cyan" style={{ marginLeft: 8 }}>
                {connectionType.toUpperCase()} 协议
              </Tag>
            </div>
          </Space>

          {/* Work Mode Switcher, Preset Layouts, Add Panels & Refresh */}
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
      }
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
      <DockLayout
        layout={layout}
        tabRegistry={tabRegistry}
        onChange={handleLayoutChange}
      />
    </Drawer>
  );
}
