import React, { useState, useRef, useEffect } from 'react';
import {
  Breadcrumb,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  App as AntApp,
  theme as antdTheme,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  FolderOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  UploadOutlined,
  DownloadOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
  FileTextOutlined,
  InboxOutlined,
  SaveOutlined,
  ShareAltOutlined,
  CopyOutlined,
  UserOutlined,
  TeamOutlined,
  AppstoreOutlined,
  BuildOutlined,
  CompassOutlined,
  CheckOutlined,
  SafetyCertificateOutlined,
  PieChartOutlined,
  BarChartOutlined,
  RightOutlined,
  DownOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listPackageItems,
  createDirectory,
  downloadPackageFileDirect,
  deletePackageItem,
  publishPackageAsPlugin,
  extractPackageArchive,
  copyPackageItem,
  type StorageItem,
  type PackageGrant,
} from '@/api/packages';
import { matchCredentials } from '@/api/credentials';
import { CredentialSelect } from '@/components/credential/CredentialSelect';
import { useAuthStore } from '@/store/auth';
import { useUploadStore } from '@/store/upload';
import { formatSize } from '@/utils/format';
import { scanDataTransfer } from '@/utils/fileDrop';
import { getFileIcon } from '@/components/fileIcon';
import { usePackageActions } from './usePackageActions';
import { usePackageShare } from './usePackageShare';
import { usePackageAdminPanels } from './usePackageAdminPanels';

export function PackageHubTab(): React.JSX.Element {
  const { message } = AntApp.useApp();

  const {
    shareModalOpen,
    setShareModalOpen,
    shareTargetItem,
    shareType,
    setShareType,
    shareExpiresHours,
    setShareExpiresHours,
    shareDesc,
    setShareDesc,
    generatedShareUrl,
    mySharesDrawerOpen,
    setMySharesDrawerOpen,
    myShares,
    refetchShares,
    createShareMutation,
    deleteShareMutation,
    handleOpenShare,
  } = usePackageShare({ message });
  const { token } = antdTheme.useToken();
  const queryClient = useQueryClient();

  const user = useAuthStore((state) => state.user);
  const addUploadFiles = useUploadStore((state) => state.addFiles);
  const uploadSuccessTick = useUploadStore((state) => state.successTick);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const myPersonalZone = user ? `personal/${user.username || user.display_name}` : 'shared';
  const [currentPath, setCurrentPath] = useState(myPersonalZone);

  const {
    isImportRemoteModalOpen,
    setIsImportRemoteModalOpen,
    importRemoteUrl,
    setImportRemoteUrl,
    importRemoteFilename,
    setImportRemoteFilename,
    importRemoteCredentialId,
    setImportRemoteCredentialId,
    importRemoteMutation,
    statsDrawerOpen,
    setStatsDrawerOpen,
    statsScope,
    setStatsScope,
    storageStats,
    statsLoading,
    refetchStats,
    grantModalOpen,
    setGrantModalOpen,
    grantTargetPath,
    setGrantTargetPath,
    granteeType,
    setGranteeType,
    granteeId,
    setGranteeId,
    grantPermission,
    setGrantPermission,
    grants,
    grantsLoading,
    allUsers,
    allTeams,
    createGrantMutation,
    revokeGrantMutation,
  } = usePackageAdminPanels({ currentPath, message });
  const [searchFilter, setSearchFilter] = useState('');

  // Modals & Drawers
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isMkdirModalOpen, setIsMkdirModalOpen] = useState(false);
  const [newDirName, setNewDirName] = useState('');

  // Drag and Drop state
  const [isDraggingOverTable, setIsDraggingOverTable] = useState(false);
  const [dragTargetFolderPath, setDragTargetFolderPath] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

  // Upload completions arrive from the shared background queue; refresh
  // the directory listing whenever any task lands.
  useEffect(() => {
    if (uploadSuccessTick > 0) {
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
    }
  }, [uploadSuccessTick, queryClient]);

  const handleDropFiles = async (dataTransfer: DataTransfer, targetDir: string) => {
    try {
      const files = await scanDataTransfer(dataTransfer);
      if (files.length > 0) {
        addUploadFiles(files, targetDir);
        message.success(
          `已将 ${files.length} 个文件推入上传队列 -> 目标: ${targetDir || '根目录'}`,
        );
      }
    } catch (err) {
      message.error(`解析拖拽文件失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addUploadFiles(Array.from(files), currentPath);
      message.info(`已加入上传队列 (${files.length} 个文件)，可在右下角查看进度`);
      e.target.value = '';
    }
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      addUploadFiles(Array.from(files), currentPath);
      message.info(`已加入文件夹上传队列 (${files.length} 个文件)，可在右下角查看进度`);
      e.target.value = '';
    }
  };

  // Copy / Import Modal state
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState('');
  const [copySourcePath, setCopySourcePath] = useState('');

  // Downloading loading tracking
  // Batch operations state
  // Mouse swipe/drag-to-select tracking
  // Queries
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['packages', currentPath],
    queryFn: () => listPackageItems(currentPath),
  });
  const {
    previewDrawerOpen,
    previewLoading,
    currentPreview,
    isEditing,
    editBuffer,
    saveLoading,
    downloadingPath,
    selectedRowKeys,
    selectedRows,
    batchCopyModalOpen,
    batchCopyTargetDir,
    batchActionLoading,
    isMouseSelecting,
    setPreviewDrawerOpen,
    setIsEditing,
    setEditBuffer,
    setSelectedRowKeys,
    setSelectedRows,
    setBatchCopyModalOpen,
    setBatchCopyTargetDir,
    filteredItems,
    breadcrumbItems,
    handleNavigate,
    handleDownload,
    handleOpenPreview,
    handleSaveText,
    handleBatchDownload,
    handleBatchDelete,
    handleBatchCopy,
    toggleRowSelection,
    handleRowMouseDown,
    handleRowMouseEnter,
  } = usePackageActions({ data, currentPath, setCurrentPath, searchFilter, message });

  // Mutations
  const mkdirMutation = useMutation({
    mutationFn: (name: string) => createDirectory(currentPath, name),
    onSuccess: () => {
      message.success('目录创建成功');
      setIsMkdirModalOpen(false);
      setNewDirName('');
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ path, recursive }: { path: string; recursive?: boolean }) =>
      deletePackageItem(path, recursive),
    onSuccess: () => {
      message.success('删除成功');
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    },
    onError: (err) => {
      message.error(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const publishMutation = useMutation({
    mutationFn: (path: string) => publishPackageAsPlugin(path),
    onSuccess: () => {
      message.success('成功发布为插件！');
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
    },
  });

  const extractMutation = useMutation({
    mutationFn: (path: string) => extractPackageArchive(path),
    onSuccess: () => {
      message.success('解压完成');
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    },
  });

  const copyMutation = useMutation({
    mutationFn: ({ src, dst }: { src: string; dst: string }) => copyPackageItem(src, dst),
    onSuccess: () => {
      message.success('复制/导入成功');
      setCopyModalOpen(false);
      setCopyTarget('');
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    },
    onError: (err) => {
      message.error(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const columns: TableColumnsType<StorageItem> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (_value, record) => (
        <Space>
          {getFileIcon(record)}
          {record.is_dir ? (
            <a
              onClick={(e) => {
                e.stopPropagation();
                handleNavigate(record.path);
              }}
              style={{ fontWeight: 600, color: '#1677ff' }}
            >
              {record.name}/
            </a>
          ) : (
            <span
              onClick={(e) => {
                e.stopPropagation();
                void handleOpenPreview(record);
              }}
              style={{ cursor: 'pointer' }}
            >
              {record.name}
            </span>
          )}
          {record.name.endsWith('.link.json') && (
            <Tag color="green" icon={<ShareAltOutlined />}>
              Live 引用
            </Tag>
          )}
          {record.is_plugin_candidate && (
            <Tag color="purple" icon={<ThunderboltOutlined />}>
              插件候选
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (value: number, record) =>
        record.is_dir ? (
          <Tooltip title="点击进入文件夹">
            <Tag
              color="orange"
              bordered={false}
              style={{ cursor: 'pointer' }}
              onClick={() => handleNavigate(record.path)}
            >
              {formatSize(value)}
            </Tag>
          </Tooltip>
        ) : (
          formatSize(value)
        ),
    },
    {
      title: '修改时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (value?: string) => (value ? new Date(value).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_value, record) => (
        <Space size="small" wrap>
          <Tooltip title={record.is_dir ? '打包下载为 ZIP' : '直接下载'}>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={downloadingPath === record.path}
              onClick={() => void handleDownload(record)}
            />
          </Tooltip>

          {record.is_dir && (
            <Tooltip title="目录权限分配 (ACL 授权)">
              <Button
                size="small"
                icon={<SafetyCertificateOutlined style={{ color: '#1677ff' }} />}
                onClick={() => {
                  setGrantTargetPath(record.path);
                  setGrantModalOpen(true);
                }}
              />
            </Tooltip>
          )}

          <Tooltip title="分享给他人 (Live 链接 / 快照副本)">
            <Button
              size="small"
              icon={<ShareAltOutlined style={{ color: '#52c41a' }} />}
              onClick={() => handleOpenShare(record)}
            />
          </Tooltip>

          <Tooltip title="复制 / 导入到…">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                setCopySourcePath(record.path);
                setCopyTarget(record.path);
                setCopyModalOpen(true);
              }}
            />
          </Tooltip>

          {!record.is_dir && (
            <Tooltip title="预览内容">
              <Button
                size="small"
                icon={<EyeOutlined />}
                onClick={() => void handleOpenPreview(record)}
              />
            </Tooltip>
          )}

          {record.is_editable && (
            <Tooltip title="在线编辑">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  void handleOpenPreview(record).then(() => setIsEditing(true));
                }}
              />
            </Tooltip>
          )}

          {record.is_plugin_candidate && (
            <Tooltip title="快速发布为流水线插件">
              <Button
                size="small"
                type="dashed"
                icon={<ThunderboltOutlined style={{ color: '#722ed1' }} />}
                loading={publishMutation.isPending}
                onClick={() => publishMutation.mutate(record.path)}
              >
                插件
              </Button>
            </Tooltip>
          )}

          {['.zip', '.tar', '.gz', '.tgz'].includes(record.extension.toLowerCase()) && (
            <Popconfirm
              title="解压归档包？"
              description="将在当前目录解压所有内容并保持子目录结构"
              onConfirm={() => extractMutation.mutate(record.path)}
            >
              <Tooltip title="解压归档包">
                <Button
                  size="small"
                  icon={<FolderOpenOutlined style={{ color: '#13c2c2' }} />}
                  loading={extractMutation.isPending}
                />
              </Tooltip>
            </Popconfirm>
          )}

          <Popconfirm
            title={record.is_dir ? '确认删除该文件夹及所有内容？' : '确认删除该文件？'}
            onConfirm={() =>
              deleteMutation.mutate({ path: record.path, recursive: record.is_dir })
            }
            okText="删除"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Hidden File/Folder Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is standard for folder picking
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderInputChange}
      />

      {/* Zone Switcher Header */}
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Space wrap>
            <Button
              type={currentPath.startsWith('personal') ? 'primary' : 'default'}
              icon={<UserOutlined />}
              onClick={() => setCurrentPath(myPersonalZone)}
            >
              个人私有空间 (personal/{user?.username || user?.display_name})
            </Button>
            <Button
              type={currentPath.startsWith('shared') ? 'primary' : 'default'}
              icon={<TeamOutlined />}
              onClick={() => setCurrentPath('shared')}
            >
              团队公共空间 (shared)
            </Button>
            <Button
              type={currentPath.startsWith('artifacts') ? 'primary' : 'default'}
              icon={<BuildOutlined />}
              onClick={() => setCurrentPath('artifacts')}
            >
              流水线产物沉淀 (artifacts)
            </Button>
            <Button
              type={currentPath.startsWith('plugins') ? 'primary' : 'default'}
              icon={<AppstoreOutlined />}
              onClick={() => setCurrentPath('plugins')}
            >
              插件暂存候选 (plugins)
            </Button>
            {user?.role === 'admin' && (
              <Button
                type={currentPath === '' ? 'primary' : 'default'}
                icon={<CompassOutlined />}
                onClick={() => setCurrentPath('')}
              >
                全景根目录 (Admin)
              </Button>
            )}
          </Space>

          <Space>
            <Button
              icon={<PieChartOutlined style={{ color: '#1677ff' }} />}
              onClick={() => {
                setStatsScope(currentPath);
                setStatsDrawerOpen(true);
              }}
            >
              存储空间分析
            </Button>
            <Button
              icon={<ShareAltOutlined />}
              onClick={() => {
                void refetchShares();
                setMySharesDrawerOpen(true);
              }}
            >
              我的分享管理 ({myShares.length})
            </Button>
          </Space>
        </div>
      </Card>

      {/* Directory & Actions Card */}
      <Card style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Space align="center" size="middle">
            <Breadcrumb items={breadcrumbItems} />
            <Tag color="blue">{data?.driver ? `Driver: ${data.driver}` : 'Local Store'}</Tag>
          </Space>

          <Space wrap>
            <Input.Search
              placeholder="搜索当前目录…"
              allowClear
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ width: 180 }}
            />
            <Button
              icon={<FolderAddOutlined />}
              onClick={() => {
                setNewDirName('');
                setIsMkdirModalOpen(true);
              }}
            >
              新建文件夹
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'upload-files',
                    icon: <FileTextOutlined style={{ color: '#1677ff' }} />,
                    label: '上传文件 (支持多选)',
                    onClick: () => fileInputRef.current?.click(),
                  },
                  {
                    key: 'upload-folder',
                    icon: <FolderOpenOutlined style={{ color: '#faad14' }} />,
                    label: '上传文件夹 (保持子目录树)',
                    onClick: () => folderInputRef.current?.click(),
                  },
                  {
                    type: 'divider',
                  },
                  {
                    key: 'upload-drag',
                    icon: <InboxOutlined style={{ color: '#52c41a' }} />,
                    label: '拖拽上传区域…',
                    onClick: () => setIsUploadModalOpen(true),
                  },
                  {
                    type: 'divider',
                  },
                  {
                    key: 'import-remote',
                    icon: <LinkOutlined style={{ color: '#722ed1' }} />,
                    label: '🔗 远程 HTTP URL 导入 (带凭证认证)',
                    onClick: () => {
                      setImportRemoteUrl('');
                      setImportRemoteFilename('');
                      setImportRemoteCredentialId(undefined);
                      setIsImportRemoteModalOpen(true);
                    },
                  },
                ],
              }}
            >
              <Button type="primary" icon={<UploadOutlined />}>
                上传 <DownOutlined style={{ fontSize: 11 }} />
              </Button>
            </Dropdown>
            <Button icon={<ReloadOutlined />} onClick={() => void refetch()} />
          </Space>
        </div>
      </Card>

      {/* Main Table with Direct File/Folder Drag & Drop */}
      <Card
        style={{
          border: isDraggingOverTable ? '2px dashed #1677ff' : undefined,
          backgroundColor: isDraggingOverTable ? 'rgba(22, 119, 255, 0.02)' : undefined,
          transition: 'all 0.2s',
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounterRef.current++;
          if (e.dataTransfer.types.includes('Files')) {
            setIsDraggingOverTable(true);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounterRef.current--;
          if (dragCounterRef.current <= 0) {
            setIsDraggingOverTable(false);
            setDragTargetFolderPath(null);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounterRef.current = 0;
          setIsDraggingOverTable(false);
          setDragTargetFolderPath(null);
          void handleDropFiles(e.dataTransfer, currentPath);
        }}
      >
        {isDraggingOverTable && (
          <div
            style={{
              padding: '14px 20px',
              background: 'rgba(22, 119, 255, 0.08)',
              border: '2px dashed #1677ff',
              borderRadius: 8,
              marginBottom: 16,
              textAlign: 'center',
              pointerEvents: 'none',
            }}
          >
            <Space direction="vertical" size={2}>
              <Typography.Text strong style={{ fontSize: 15, color: '#1677ff' }}>
                <InboxOutlined style={{ fontSize: 20, marginRight: 8 }} />
                {dragTargetFolderPath
                  ? `松开鼠标直接上传至子文件夹: ${dragTargetFolderPath}`
                  : `松开鼠标直接上传到当前目录: ${currentPath || '全景根目录'}`}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                支持从本地 Windows 资源管理器直接拖拽单个文件、多个文件或整个完整文件夹（保留嵌套子目录）
              </Typography.Text>
            </Space>
          </div>
        )}

        {/* Active Batch Operations Toolbar */}
        {selectedRowKeys.length > 0 && (
          <div
            style={{
              padding: '10px 16px',
              background: token.colorInfoBg,
              border: `1px solid ${token.colorInfoBorder}`,
              borderRadius: 6,
              marginBottom: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <Space size="middle" wrap>
              <Typography.Text strong style={{ color: '#1677ff' }}>
                已勾选 {selectedRowKeys.length} 个项目
              </Typography.Text>
              <Button
                size="small"
                type="primary"
                icon={<DownloadOutlined />}
                loading={batchActionLoading}
                onClick={handleBatchDownload}
              >
                批量打包下载 ZIP
              </Button>
              <Button
                size="small"
                icon={<CopyOutlined />}
                loading={batchActionLoading}
                onClick={() => {
                  setBatchCopyTargetDir(currentPath);
                  setBatchCopyModalOpen(true);
                }}
              >
                批量复制 / 移动
              </Button>
              <Popconfirm
                title={`确认批量删除选中的 ${selectedRowKeys.length} 个项目？`}
                description="删除后无法恢复，选中的文件夹其所有子内容也将被递归删除"
                onConfirm={handleBatchDelete}
                okText="删除"
                okButtonProps={{ danger: true, loading: batchActionLoading }}
              >
                <Button size="small" danger icon={<DeleteOutlined />}>
                  批量删除
                </Button>
              </Popconfirm>
            </Space>

            <Button
              size="small"
              type="link"
              onClick={() => {
                setSelectedRowKeys([]);
                setSelectedRows([]);
              }}
            >
              取消勾选
            </Button>
          </div>
        )}

        <Table
          rowKey="path"
          rowSelection={{
            selectedRowKeys,
            onChange: (keys, rows) => {
              setSelectedRowKeys(keys);
              setSelectedRows(rows);
            },
          }}
          columns={columns}
          dataSource={filteredItems}
          loading={isLoading}
          pagination={{ pageSize: 15 }}
          locale={{
            emptyText: (
              <Empty description="当前目录下暂无文件（可直接拖拽本地文件或文件夹到此处上传）" />
            ),
          }}
          onRow={(record, index) => {
            const rowIndex = index ?? 0;
            const isSelected = selectedRowKeys.includes(record.path);

            return {
              onClick: (e) => toggleRowSelection(record, rowIndex, e),
              onMouseDown: (e) => handleRowMouseDown(record, rowIndex, e),
              onMouseEnter: () => handleRowMouseEnter(record, rowIndex),
              onDragEnter: (e) => {
                if (!record.is_dir) return;
                e.preventDefault();
                e.stopPropagation();
                setDragTargetFolderPath(record.path);
              },
              onDragOver: (e) => {
                if (!record.is_dir) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                setDragTargetFolderPath(record.path);
              },
              onDragLeave: (e) => {
                if (!record.is_dir) return;
                e.preventDefault();
                e.stopPropagation();
              },
              onDrop: (e) => {
                if (!record.is_dir) return;
                e.preventDefault();
                e.stopPropagation();
                dragCounterRef.current = 0;
                setIsDraggingOverTable(false);
                setDragTargetFolderPath(null);
                void handleDropFiles(e.dataTransfer, record.path);
              },
              style: {
                cursor: 'pointer',
                userSelect: isMouseSelecting ? 'none' : 'auto',
                backgroundColor:
                  dragTargetFolderPath === record.path
                    ? '#e6f4ff'
                    : isSelected
                    ? 'rgba(22, 119, 255, 0.08)'
                    : undefined,
                outline: dragTargetFolderPath === record.path ? '2px dashed #1677ff' : undefined,
                transition: 'background-color 0.15s ease',
              },
            };
          }}
        />
      </Card>

      {/* Batch Copy Modal */}
      <Modal
        title={`📋 批量复制 / 移动选中的 ${selectedRows.length} 个项目`}
        open={batchCopyModalOpen}
        onCancel={() => setBatchCopyModalOpen(false)}
        onOk={handleBatchCopy}
        confirmLoading={batchActionLoading}
        okText="开始复制"
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">已选文件与文件夹列表：</Typography.Text>
          <div
            style={{
              maxHeight: 140,
              overflowY: 'auto',
              background: token.colorFillQuaternary,
              padding: '8px 12px',
              borderRadius: 6,
              border: `1px solid ${token.colorBorderSecondary}`,
              marginTop: 6,
            }}
          >
            {selectedRows.map((r) => (
              <div key={r.path} style={{ fontSize: 13, padding: '3px 0' }}>
                <Space>
                  {getFileIcon(r)}
                  <Typography.Text strong>{r.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    ({r.path})
                  </Typography.Text>
                </Space>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Typography.Text type="secondary">目标存储目录：</Typography.Text>
          <Input
            style={{ marginTop: 6 }}
            value={batchCopyTargetDir}
            onChange={(e) => setBatchCopyTargetDir(e.target.value)}
            placeholder="例如 shared/ 或 personal/bob/tools"
          />
        </div>
      </Modal>

      {/* Share Modal */}
      <Modal
        title={
          <Space>
            <ShareAltOutlined style={{ color: '#52c41a' }} />
            <span>创建制品分享链接</span>
          </Space>
        }
        open={shareModalOpen}
        onCancel={() => setShareModalOpen(false)}
        footer={
          generatedShareUrl ? (
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => setShareModalOpen(false)}
            >
              完成
            </Button>
          ) : (
            <Space>
              <Button onClick={() => setShareModalOpen(false)}>取消</Button>
              <Button
                type="primary"
                loading={createShareMutation.isPending}
                onClick={() => {
                  if (!shareTargetItem) return;
                  createShareMutation.mutate({
                    source_path: shareTargetItem.path,
                    share_type: shareType,
                    description: shareDesc,
                    expires_in_hours: shareExpiresHours,
                  });
                }}
              >
                生成分享链接
              </Button>
            </Space>
          )
        }
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">分享资源：</Typography.Text>
          <Typography.Text strong code style={{ display: 'block', marginTop: 4 }}>
            {shareTargetItem?.path}
          </Typography.Text>
        </div>

        {!generatedShareUrl ? (
          <>
            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong>分享类型：</Typography.Text>
              <Radio.Group
                value={shareType}
                onChange={(e) => setShareType(e.target.value)}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}
              >
                <Radio value="live">
                  <b>⚡ 实时跟随链接 (Live Link)</b>
                  <div style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 24 }}>
                    接收者始终读取您的最新修改；导入时创建 Live 引用指针，随您的源文件更新而更新。
                  </div>
                </Radio>
                <Radio value="snapshot">
                  <b>📸 快照独立副本 (Snapshot Copy)</b>
                  <div style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 24 }}>
                    接收者导入时复制为独立物理文件，归属人移交给接收者，后续双方修改互不影响。
                  </div>
                </Radio>
              </Radio.Group>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong>有效期：</Typography.Text>
              <Select
                value={shareExpiresHours}
                onChange={(val) => setShareExpiresHours(val)}
                style={{ width: '100%', marginTop: 8 }}
                options={[
                  { label: '永久有效', value: undefined },
                  { label: '24 小时', value: 24 },
                  { label: '7 天', value: 168 },
                  { label: '30 天', value: 720 },
                ]}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <Typography.Text strong>描述说明（可选）：</Typography.Text>
              <Input.TextArea
                rows={2}
                value={shareDesc}
                onChange={(e) => setShareDesc(e.target.value)}
                placeholder="例如：产研模型权重 v1.0，用于预发联调"
                style={{ marginTop: 8 }}
              />
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="success" strong>
              ✅ 分享链接创建成功！
            </Typography.Text>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <Input value={generatedShareUrl} readOnly />
              <Button
                icon={<CopyOutlined />}
                onClick={() => {
                  void navigator.clipboard.writeText(generatedShareUrl);
                  message.success('已复制到剪贴板');
                }}
              >
                复制
              </Button>
            </div>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
              他人访问该链接即可在线浏览、直接下载或一键导入到他们自己的个人空间。
            </Typography.Paragraph>
          </div>
        )}
      </Modal>

      {/* My Shares Drawer */}
      <Drawer
        title="🔗 我的分享链接管理"
        open={mySharesDrawerOpen}
        onClose={() => setMySharesDrawerOpen(false)}
        width={600}
      >
        <Table
          rowKey="token"
          dataSource={myShares}
          pagination={false}
          columns={[
            {
              title: '分享资源',
              dataIndex: 'source_path',
              key: 'source_path',
              render: (text, record) => (
                <div>
                  <Typography.Text strong>{text}</Typography.Text>
                  <div>
                    <Tag color={record.share_type === 'live' ? 'green' : 'blue'}>
                      {record.share_type === 'live' ? 'Live 实时' : 'Snapshot 快照'}
                    </Tag>
                    {record.description && (
                      <span style={{ color: '#8c8c8c', fontSize: 12 }}>
                        {record.description}
                      </span>
                    )}
                  </div>
                </div>
              ),
            },
            {
              title: '过期时间',
              dataIndex: 'expires_at',
              key: 'expires_at',
              width: 140,
              render: (val?: string) => (val ? new Date(val).toLocaleDateString() : '永久有效'),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_v, record) => (
                <Space size="small">
                  <Tooltip title="复制分享链接">
                    <Button
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={() => {
                        const url = `${window.location.origin}/share/${record.token}`;
                        void navigator.clipboard.writeText(url);
                        message.success('分享链接已复制');
                      }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="确定撤销此分享链接？"
                    onConfirm={() => deleteShareMutation.mutate(record.token)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: <Empty description="暂无创建的分享链接" /> }}
        />
      </Drawer>

      {/* Copy / Import Modal */}
      <Modal
        title="📋 复制 / 导入文件或文件夹"
        open={copyModalOpen}
        onCancel={() => setCopyModalOpen(false)}
        onOk={() => copyMutation.mutate({ src: copySourcePath, dst: copyTarget })}
        confirmLoading={copyMutation.isPending}
        okText="复制"
      >
        <div style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">源路径：</Typography.Text>
          <Typography.Text code style={{ display: 'block', marginTop: 4 }}>
            {copySourcePath}
          </Typography.Text>
        </div>
        <div>
          <Typography.Text type="secondary">目标存储路径：</Typography.Text>
          <Input
            style={{ marginTop: 4 }}
            value={copyTarget}
            onChange={(e) => setCopyTarget(e.target.value)}
            placeholder="例如 personal/bob/my_copy 或 shared/tools/"
          />
        </div>
      </Modal>

      {/* Mkdir Modal */}
      <Modal
        title="新建文件夹"
        open={isMkdirModalOpen}
        onCancel={() => setIsMkdirModalOpen(false)}
        onOk={() => mkdirMutation.mutate(newDirName)}
        confirmLoading={mkdirMutation.isPending}
        okText="创建"
      >
        <Input
          placeholder="请输入文件夹名称"
          value={newDirName}
          onChange={(e) => setNewDirName(e.target.value)}
          onPressEnter={() => mkdirMutation.mutate(newDirName)}
        />
      </Modal>

      {/* Upload Drop Area Modal */}
      <Modal
        title={`拖拽上传到: ${currentPath || '全景根目录'}`}
        open={isUploadModalOpen}
        onCancel={() => setIsUploadModalOpen(false)}
        footer={null}
      >
        <Upload.Dragger
          multiple
          directory
          showUploadList={false}
          beforeUpload={(_file, fileList) => {
            addUploadFiles(fileList, currentPath);
            setIsUploadModalOpen(false);
            message.info(`已加入后台上传队列 (${fileList.length} 个文件)，可在右下角查看详情`);
            return false;
          }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          </p>
          <p className="ant-upload-text">点击或拖拽文件 / 整个文件夹到此处上传</p>
          <p className="ant-upload-hint">
            自动转入右下角后台上传窗口，不挡住页面，可自由切换浏览
          </p>
        </Upload.Dragger>
      </Modal>

      {/* Preview / Edit Drawer */}
      <Drawer
        title={
          <Space>
            <span>{currentPreview?.name}</span>
            {currentPreview?.is_editable && !isEditing && (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => setIsEditing(true)}
              >
                编辑
              </Button>
            )}
            {isEditing && (
              <Button
                size="small"
                type="primary"
                icon={<SaveOutlined />}
                loading={saveLoading}
                onClick={() => void handleSaveText()}
              >
                保存
              </Button>
            )}
          </Space>
        }
        open={previewDrawerOpen}
        onClose={() => setPreviewDrawerOpen(false)}
        width={720}
      >
        {previewLoading ? (
          <div>加载预览中…</div>
        ) : (
          <div>
            {currentPreview?.is_text ? (
              isEditing ? (
                <Input.TextArea
                  rows={25}
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 13 }}
                />
              ) : (
                <pre
                  style={{
                    backgroundColor: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: 16,
                    borderRadius: 6,
                    maxHeight: '75vh',
                    overflow: 'auto',
                    fontFamily: 'Consolas, Monaco, monospace',
                    fontSize: 13,
                  }}
                >
                  {currentPreview.content}
                </pre>
              )
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_DEFAULT}
                description="二进制文件暂不支持在线直接文本预览"
              >
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() => {
                    if (currentPreview) {
                      void downloadPackageFileDirect(
                        currentPreview.path,
                        currentPreview.name,
                      );
                    }
                  }}
                >
                  下载到本地查看
                </Button>
              </Empty>
            )}
          </div>
        )}
      </Drawer>

      {/* Directory ACL Grants Modal */}
      <Modal
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#1677ff' }} />
            <span>目录访问控制与权限分配 (ACL)</span>
          </Space>
        }
        open={grantModalOpen}
        onCancel={() => setGrantModalOpen(false)}
        footer={null}
        width={680}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary">当前配置目录：</Typography.Text>
          <Typography.Text strong code style={{ marginLeft: 8 }}>
            {grantTargetPath}
          </Typography.Text>
        </div>

        {/* Add Grant Section */}
        <Card size="small" title="新增授权主体" style={{ marginBottom: 16 }}>
          <Space wrap size="middle" align="center" style={{ width: '100%' }}>
            <Radio.Group
              value={granteeType}
              onChange={(e) => {
                setGranteeType(e.target.value);
                setGranteeId('');
              }}
            >
              <Radio.Button value="user">
                <UserOutlined /> 用户
              </Radio.Button>
              <Radio.Button value="team">
                <TeamOutlined /> 团队
              </Radio.Button>
            </Radio.Group>

            <Select
              showSearch
              placeholder={granteeType === 'user' ? '选择被授权用户…' : '选择被授权团队…'}
              value={granteeId || undefined}
              onChange={(val) => setGranteeId(val)}
              style={{ width: 220 }}
              options={
                granteeType === 'user'
                  ? allUsers.map((u) => ({
                      label: `${u.display_name || u.username} (${u.username})`,
                      value: u.id,
                    }))
                  : allTeams.map((t) => ({
                      label: `${t.name} (团队)`,
                      value: t.id,
                    }))
              }
            />

            <Select
              value={grantPermission}
              onChange={(val) => setGrantPermission(val)}
              style={{ width: 130 }}
              options={[
                { label: '只读浏览 (viewer)', value: 'viewer' },
                { label: '读写操作 (operator)', value: 'operator' },
              ]}
            />

            <Button
              type="primary"
              disabled={!granteeId}
              loading={createGrantMutation.isPending}
              onClick={() => createGrantMutation.mutate()}
            >
              授予权限
            </Button>
          </Space>
        </Card>

        {/* Existing Grants List */}
        <Typography.Title level={5} style={{ fontSize: 14, marginBottom: 8 }}>
          已生效的权限列表 ({grants.length})
        </Typography.Title>
        <Table
          rowKey="id"
          size="small"
          loading={grantsLoading}
          dataSource={grants}
          pagination={false}
          columns={[
            {
              title: '类型',
              dataIndex: 'grantee_type',
              width: 80,
              render: (t: string) =>
                t === 'user' ? <Tag color="blue">用户</Tag> : <Tag color="green">团队</Tag>,
            },
            {
              title: '授权主体 ID',
              dataIndex: 'grantee_id',
              render: (id: string, record: PackageGrant) => {
                if (record.grantee_type === 'user') {
                  const targetUser = allUsers.find((u) => u.id === id);
                  return targetUser ? `${targetUser.display_name || targetUser.username} (${targetUser.username})` : id;
                }
                const targetTeam = allTeams.find((t) => t.id === id);
                return targetTeam ? `${targetTeam.name}` : id;
              },
            },
            {
              title: '权限级别',
              dataIndex: 'permission',
              width: 120,
              render: (p: string) =>
                p === 'operator' ? (
                  <Tag color="magenta">读写 (operator)</Tag>
                ) : (
                  <Tag color="cyan">只读 (viewer)</Tag>
                ),
            },
            {
              title: '授权时间',
              dataIndex: 'created_at',
              width: 140,
              render: (v?: string) => (v ? new Date(v).toLocaleDateString() : '-'),
            },
            {
              title: '操作',
              key: 'actions',
              width: 70,
              render: (_v, record: PackageGrant) => (
                <Popconfirm
                  title="确认撤销该权限？"
                  onConfirm={() => revokeGrantMutation.mutate(record.id)}
                  okText="撤销"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" type="link" danger>
                    撤销
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
          locale={{ emptyText: <Empty description="暂无单独授予的 ACL 权限" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Modal>

      {/* Remote URL Import Modal */}
      <Modal
        title={
          <Space>
            <LinkOutlined style={{ color: '#722ed1' }} />
            <span>从远程 HTTP/HTTPS 下载导入文件</span>
          </Space>
        }
        open={isImportRemoteModalOpen}
        onOk={() => {
          if (!importRemoteUrl.trim()) {
            message.warning('请输入远程下载 URL');
            return;
          }
          importRemoteMutation.mutate();
        }}
        confirmLoading={importRemoteMutation.isPending}
        onCancel={() => setIsImportRemoteModalOpen(false)}
        okText="开始认证下载"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <Typography.Text strong>目标保存目录：</Typography.Text>
            <Tag color="blue" style={{ marginLeft: 8, fontSize: 13 }}>
              {currentPath || '根目录 (root)'}
            </Tag>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              远程文件下载 URL <span style={{ color: '#ff4d4f' }}>*</span>
            </Typography.Text>
            <Input
              placeholder="https://nexus.corp.internal/repository/npm/app-1.0.0.tgz"
              value={importRemoteUrl}
              onChange={(e) => {
                const url = e.target.value;
                setImportRemoteUrl(url);
                if (!importRemoteFilename && url) {
                  try {
                    const parsed = new URL(url);
                    const name = parsed.pathname.split('/').filter(Boolean).pop();
                    if (name) setImportRemoteFilename(name);
                  } catch {
                    // Ignore URL parse error while typing
                  }
                }
                const trimmed = url?.trim();
                if (trimmed && !importRemoteCredentialId) {
                  matchCredentials(trimmed)
                    .then((matched) => {
                      const first = matched[0];
                      if (first && !importRemoteCredentialId) {
                        setImportRemoteCredentialId(first.id);
                        message.info(`💡 已根据下载域名自动匹配凭据：${first.name}`);
                      }
                    })
                    .catch(() => {});
                }
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              保存文件名 (可选)
            </Typography.Text>
            <Input
              placeholder="留空则自动从 URL 中解析文件名"
              value={importRemoteFilename}
              onChange={(e) => setImportRemoteFilename(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              关联认证凭据 (可选)
            </Typography.Text>
            <CredentialSelect
              placeholder="无需认证 / 公开下载链接"
              filterTypes={['username_password', 'secret_text']}
              suggestedUrl={importRemoteUrl}
              value={importRemoteCredentialId}
              onChange={(val) => setImportRemoteCredentialId(val)}
            />
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
              支持 Basic Auth (用户名+密码) 与 Bearer Token。系统将在后台安全拉取并落库。
            </Typography.Paragraph>
          </div>
        </div>
      </Modal>

      {/* Storage Analytics Drawer */}
      <Drawer
        title={
          <Space>
            <PieChartOutlined style={{ color: '#1677ff', fontSize: 18 }} />
            <span>制品仓库存储空间可视化分析</span>
          </Space>
        }
        open={statsDrawerOpen}
        onClose={() => setStatsDrawerOpen(false)}
        width={760}
        extra={
          <Space>
            <Radio.Group
              size="small"
              value={statsScope === '' ? 'all' : 'current'}
              onChange={(e) => {
                setStatsScope(e.target.value === 'all' ? '' : currentPath);
              }}
            >
              <Radio.Button value="all">全库统计</Radio.Button>
              <Radio.Button value="current">当前目录</Radio.Button>
            </Radio.Group>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={statsLoading}
              onClick={() => void refetchStats()}
            />
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Summary Stats Cards */}
          <Row gutter={16}>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(22, 119, 255, 0.04)' }}>
                <Statistic
                  title="占用总容量"
                  value={formatSize(storageStats?.total_size_bytes || 0)}
                  valueStyle={{ color: '#1677ff', fontWeight: 700, fontSize: 20 }}
                  prefix={<PieChartOutlined />}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(82, 196, 26, 0.04)' }}>
                <Statistic
                  title="文件总数"
                  value={storageStats?.total_files || 0}
                  valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 20 }}
                  prefix={<FileTextOutlined />}
                  suffix="个"
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: 'rgba(250, 173, 20, 0.04)' }}>
                <Statistic
                  title="子目录总数"
                  value={storageStats?.total_dirs || 0}
                  valueStyle={{ color: '#faad14', fontWeight: 700, fontSize: 20 }}
                  prefix={<FolderOutlined />}
                  suffix="个"
                />
              </Card>
            </Col>
          </Row>

          {/* Scope Indicator */}
          <div
            style={{
              padding: '6px 12px',
              background: token.colorFillQuaternary,
              borderRadius: 6,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Typography.Text type="secondary">统计分析范围：</Typography.Text>
            <Typography.Text strong code style={{ marginLeft: 8 }}>
              {storageStats?.scope_path ? storageStats.scope_path : '全景根目录 (Root)'}
            </Typography.Text>
          </div>

          {/* Zones Distribution Breakdown */}
          {storageStats?.zones && storageStats.zones.length > 0 && (
            <Card size="small" title={<Space><BarChartOutlined /><span>存储分区容量分布 (Storage Zones)</span></Space>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {storageStats.zones.map((zone) => (
                  <div
                    key={zone.zone}
                    style={{
                      padding: '8px 12px',
                      background: token.colorFillQuaternary,
                      borderRadius: 6,
                      border: `1px solid ${token.colorBorderSecondary}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Space>
                        <Typography.Text strong>{zone.name}</Typography.Text>
                        <Typography.Text type="secondary" code>
                          {zone.zone}/
                        </Typography.Text>
                      </Space>
                      <Space>
                        <Typography.Text strong style={{ color: '#1677ff' }}>
                          {formatSize(zone.size_bytes)}
                        </Typography.Text>
                        <Tag color="blue">{zone.percentage}%</Tag>
                        <Button
                          size="small"
                          type="link"
                          onClick={() => {
                            handleNavigate(zone.zone);
                            setStatsDrawerOpen(false);
                          }}
                        >
                          进入分区 <RightOutlined />
                        </Button>
                      </Space>
                    </div>
                    <Progress
                      percent={zone.percentage}
                      strokeColor="#1677ff"
                      size="small"
                      showInfo={false}
                    />
                    <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        包含 {zone.file_count} 个文件 · {zone.dir_count} 个子目录
                      </Typography.Text>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* File Types Breakdown */}
          {storageStats?.types && storageStats.types.length > 0 && (
            <Card size="small" title={<Space><PieChartOutlined /><span>文件类型空间占用分布 (File Types)</span></Space>}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {storageStats.types.map((type) => (
                  <div key={type.category}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Space>
                        <Tag color={type.color} style={{ margin: 0 }}>
                          {type.label}
                        </Tag>
                        <Typography.Text type="secondary">
                          ({type.file_count} 个文件)
                        </Typography.Text>
                      </Space>
                      <Space>
                        <Typography.Text strong>{formatSize(type.size_bytes)}</Typography.Text>
                        <Typography.Text type="secondary">({type.percentage}%)</Typography.Text>
                      </Space>
                    </div>
                    <Progress
                      percent={type.percentage}
                      strokeColor={type.color}
                      size="small"
                      showInfo={false}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Top 10 Largest Items */}
          {storageStats?.top_largest && storageStats.top_largest.length > 0 && (
            <Card
              size="small"
              title={<Space><ThunderboltOutlined style={{ color: '#faad14' }} /><span>单体占用空间排行榜 TOP 10 (Largest Files & Folders)</span></Space>}
            >
              <List
                size="small"
                dataSource={storageStats.top_largest}
                renderItem={(item, index) => (
                  <List.Item
                    key={item.path}
                    actions={[
                      <Button
                        key="jump"
                        size="small"
                        type="link"
                        onClick={() => {
                          const targetNav = item.is_dir
                            ? item.path
                            : item.path.includes('/')
                            ? item.path.substring(0, item.path.lastIndexOf('/'))
                            : '';
                          handleNavigate(targetNav);
                          setStatsDrawerOpen(false);
                        }}
                      >
                        定位跳转
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <Tag
                          color={index < 3 ? (index === 0 ? 'gold' : index === 1 ? 'cyan' : 'blue') : 'default'}
                          style={{ fontWeight: 700, minWidth: 28, textAlign: 'center' }}
                        >
                          #{index + 1}
                        </Tag>
                      }
                      title={
                        <Space>
                          {item.is_dir ? (
                            <FolderOutlined style={{ color: '#faad14' }} />
                          ) : (
                            <FileTextOutlined style={{ color: '#1677ff' }} />
                          )}
                          <Typography.Text strong>{item.name}</Typography.Text>
                          {item.is_dir && <Tag color="orange">文件夹</Tag>}
                        </Space>
                      }
                      description={
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          路径: {item.path}
                        </Typography.Text>
                      }
                    />
                    <div style={{ textAlign: 'right' }}>
                      <Typography.Text strong style={{ color: '#cf1322', fontSize: 14 }}>
                        {formatSize(item.size_bytes)}
                      </Typography.Text>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </div>
      </Drawer>
    </div>
  );
}


