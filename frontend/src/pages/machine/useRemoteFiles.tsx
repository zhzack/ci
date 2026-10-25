/**
 * Remote file-explorer domain of the machine console: directory listing,
 * multi-drive tree, modals (create/rename/chmod), upload/delete actions and
 * the two context menus.
 *
 * Extracted verbatim from MachineConsoleDrawer; the main component
 * destructures the return value so its JSX keeps the original names.
 * Cross-domain wiring arrives via options: `overview`/`platform` decide
 * Windows vs POSIX tree roots, `handleOpenTab`/`handleOpenFileEditor` come
 * from the dock-layout domain, and `pendingTerminalCmd` is the file->terminal
 * bridge consumed by the terminal pane.
 */
import React, { useCallback, useMemo, useState } from 'react';

import type { MenuProps } from 'antd';
import { message as antdMessage, TreeDataNode,
  Modal } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  HddOutlined,
  LockOutlined,
} from '@ant-design/icons';

import {
  batchDeleteMachineFiles,
  chmodMachinePath,
  createMachineDirectory,
  createMachineFile,
  getDownloadFilesUrl,
  getMachineDrives,
  listMachineDirectory,
  renameMachinePath,
  uploadMachineFile,
  type DirectoryEntry,
  type DriveInfo,
  type SystemOverview,
} from '@/api/diagnostics';

import { getPathAncestors, mergeTreeNodes, normalizePath } from './machineConsoleUtils';

interface UseRemoteFilesOptions {
  machineId: string | null;
  platform?: string;
  overview: SystemOverview | null;
  handleOpenTab: (tabId: string) => void;
  handleOpenFileEditor: (filePath: string) => void;
}

export function useRemoteFiles({
  machineId,
  platform,
  overview,
  handleOpenTab,
  handleOpenFileEditor,
}: UseRemoteFilesOptions) {
  // 2. Directory state
  const [currentPath, setCurrentPath] = useState('/');
  const [inputPath, setInputPath] = useState('/');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [files, setFiles] = useState<DirectoryEntry[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [fileSortBy, setFileSortBy] = useState<string>('default');

  // Multi-drive & in-memory directory cache
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [dirCache, setDirCache] = useState<Map<string, DirectoryEntry[]>>(() => new Map());

  // Directory Tree sidebar state
  const [treeData, setTreeData] = useState<TreeDataNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [treeSearch, setTreeSearch] = useState<string>('');

  // In-directory instant search filter
  const [fileFilter, setFileFilter] = useState<string>('');

  // Modals for create / rename / chmod
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createModalType, setCreateModalType] = useState<'file' | 'dir'>('file');
  const [newItemName, setNewItemName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [targetRenamePath, setTargetRenamePath] = useState('');
  const [newRenameName, setNewRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const [chmodModalVisible, setChmodModalVisible] = useState(false);
  const [targetChmodPath, setTargetChmodPath] = useState('');
  const [newChmodMode, setNewChmodMode] = useState('0755');
  const [chmodLoading, setChmodLoading] = useState(false);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingTerminalCmd, setPendingTerminalCmd] = useState<string | null>(null);

  const initTreeRoots = useCallback(() => {
    const isWin =
      overview?.platform?.toLowerCase().includes('win') ||
      currentPath.includes(':') ||
      platform?.toLowerCase().includes('win');

    if (isWin) {
      const roots: TreeDataNode[] = [
        {
          title: 'C:\\ [系统盘]',
          key: 'C:/',
          isLeaf: false,
          icon: <HddOutlined style={{ color: '#1677ff' }} />,
        },
      ];
      setTreeData(roots);
      setExpandedKeys(['C:/']);
    } else {
      const roots: TreeDataNode[] = [
        {
          title: '/ (根目录)',
          key: '/',
          isLeaf: false,
          icon: <FolderOutlined style={{ color: '#faad14' }} />,
        },
      ];
      setTreeData(roots);
      setExpandedKeys(['/']);
    }
  }, [overview?.platform, currentPath, platform]);

  const fetchDirectory = useCallback(
    async (targetPath: string, forceRefresh = false) => {
      if (!machineId) return;
      const normPath = normalizePath(targetPath);

      // 0. Instant Cache Lookup
      if (!forceRefresh && dirCache.has(normPath)) {
        const cached = dirCache.get(normPath)!;
        setFiles(cached);
        setCurrentPath(normPath);
        setInputPath(normPath);
        setSelectedFilePaths([]);

        const dirNodes: TreeDataNode[] = cached
          .filter((e) => e.is_dir)
          .map((d) => ({
            title: d.name,
            key: normalizePath(d.path),
            isLeaf: false,
            icon: <FolderOutlined style={{ color: '#faad14' }} />,
          }));
        const ancestors = getPathAncestors(normPath);
        setTreeData((origin) => {
          let updated = origin;
          for (let i = 0; i < ancestors.length - 1; i++) {
            const parentKey = ancestors[i];
            const childKey = ancestors[i + 1];
            if (!parentKey || !childKey) continue;
            const childName = childKey.split('/').pop() || childKey;
            const skeleton: TreeDataNode = {
              title: childName,
              key: childKey,
              isLeaf: false,
              icon: <FolderOutlined style={{ color: '#faad14' }} />,
            };
            updated = mergeTreeNodes(updated, parentKey, [skeleton]);
          }
          return mergeTreeNodes(updated, normPath, dirNodes);
        });
        setExpandedKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
        return;
      }

      setFilesLoading(true);
      try {
        const data = await listMachineDirectory(machineId, normPath);
        setDirCache((prev) => new Map(prev).set(normPath, data));
        setFiles(data);
        setCurrentPath(normPath);
        setInputPath(normPath);
        setSelectedFilePaths([]);

        // 1. Build child directory nodes
        const dirNodes: TreeDataNode[] = data
          .filter((e) => e.is_dir)
          .map((d) => ({
            title: d.name,
            key: normalizePath(d.path),
            isLeaf: false,
            icon: <FolderOutlined style={{ color: '#faad14' }} />,
          }));

        // 2. Ensure all ancestor branches exist in TreeData
        const ancestors = getPathAncestors(normPath);
        setTreeData((origin) => {
          let updated = origin;
          for (let i = 0; i < ancestors.length - 1; i++) {
            const parentKey = ancestors[i];
            const childKey = ancestors[i + 1];
            if (!parentKey || !childKey) continue;
            const childName = childKey.split('/').pop() || childKey;
            const skeleton: TreeDataNode = {
              title: childName,
              key: childKey,
              isLeaf: false,
              icon: <FolderOutlined style={{ color: '#faad14' }} />,
            };
            updated = mergeTreeNodes(updated, parentKey, [skeleton]);
          }
          return mergeTreeNodes(updated, normPath, dirNodes);
        });

        // 3. Expand all ancestors leading to this directory
        setExpandedKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        antdMessage.error(`读取目录 "${normPath}" 失败: ${msg}`);
      } finally {
        setFilesLoading(false);
      }
    },
     
    [machineId, dirCache]
  );

  const fetchDrives = useCallback(async () => {
    if (!machineId) return;
    try {
      const driveList = await getMachineDrives(machineId);
      setDrives(driveList);
      if (driveList.length > 0) {
        const roots: TreeDataNode[] = driveList.map((d) => {
          const vol = d.volume_name ? ` [${d.volume_name}]` : '';
          const cap = d.total_gb > 0 ? ` (${d.used_gb}G/${d.total_gb}G)` : '';
          const normMount = normalizePath(d.mount_point);
          return {
            title: `${d.device_id}${vol}${cap}`,
            key: normMount,
            isLeaf: false,
            icon: <HddOutlined style={{ color: '#1677ff' }} />,
          };
        });
        setTreeData(roots);
        const firstMount = driveList[0]?.mount_point ? normalizePath(driveList[0].mount_point) : 'C:/';
        const matchesDrive = driveList.some((d) =>
          normalizePath(currentPath)
            .toLowerCase()
            .startsWith(normalizePath(d.mount_point).toLowerCase().slice(0, 2))
        );
        const targetPath = matchesDrive && currentPath !== '/' ? currentPath : firstMount;
        setExpandedKeys((prev) => Array.from(new Set([...prev, targetPath])));
        void fetchDirectory(targetPath);
      } else {
        initTreeRoots();
        void fetchDirectory(currentPath);
      }
    } catch {
      initTreeRoots();
      void fetchDirectory(currentPath);
    }
  }, [machineId, currentPath, fetchDirectory, initTreeRoots]);

  // Dynamic tree load on expand
  const onLoadTreeData = useCallback(
    ({ key, children }: { key: React.Key; children?: TreeDataNode[] }) =>
      new Promise<void>((resolve) => {
        if (!machineId || (children && children.length > 0)) {
          resolve();
          return;
        }
        const normKey = normalizePath(key as string);
        if (dirCache.has(normKey)) {
          const cached = dirCache.get(normKey)!;
          const dirNodes: TreeDataNode[] = cached
            .filter((e) => e.is_dir)
            .map((d) => ({
              title: d.name,
              key: normalizePath(d.path),
              isLeaf: false,
              icon: <FolderOutlined style={{ color: '#faad14' }} />,
            }));
          setTreeData((origin) => mergeTreeNodes(origin, normKey, dirNodes));
          resolve();
          return;
        }

        listMachineDirectory(machineId, normKey)
          .then((entries) => {
            setDirCache((prev) => new Map(prev).set(normKey, entries));
            const dirNodes: TreeDataNode[] = entries
              .filter((e) => e.is_dir)
              .map((d) => ({
                title: d.name,
                key: normalizePath(d.path),
                isLeaf: false,
                icon: <FolderOutlined style={{ color: '#faad14' }} />,
              }));
            setTreeData((origin) => mergeTreeNodes(origin, normKey, dirNodes));
            resolve();
          })
          .catch(() => {
            resolve();
          });
      }),
     
    [machineId, dirCache]
  );

  // Tree node select handler
  const onSelectTree = useCallback(
    (selectedKeys: React.Key[]) => {
      if (selectedKeys.length > 0) {
        const target = selectedKeys[0] as string;
        void fetchDirectory(target);
      }
    },
    [fetchDirectory]
  );

  // Filtered Tree data by search term
  const filteredTreeData = useMemo(() => {
    if (!treeSearch) return treeData;
    const filterNodes = (nodes: TreeDataNode[]): TreeDataNode[] => {
      return nodes
        .map((node) => {
          const titleStr = typeof node.title === 'string' ? node.title : '';
          const match = titleStr.toLowerCase().includes(treeSearch.toLowerCase());
          const filteredChildren = node.children ? filterNodes(node.children) : undefined;
          if (match || (filteredChildren && filteredChildren.length > 0)) {
            return {
              ...node,
              children: filteredChildren,
            };
          }
          return null;
        })
        .filter(Boolean) as TreeDataNode[];
    };
    return filterNodes(treeData);
  }, [treeData, treeSearch]);

  // Batch delete files
  const handleBatchDelete = useCallback(async () => {
    if (!machineId || selectedFilePaths.length === 0) return;
    try {
      await batchDeleteMachineFiles(machineId, selectedFilePaths);
      antdMessage.success(`已删除 ${selectedFilePaths.length} 个文件/文件夹`);
      setDirCache((prev) => {
        const next = new Map(prev);
        next.delete(currentPath);
        return next;
      });
      void fetchDirectory(currentPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      antdMessage.error(`删除失败: ${msg}`);
    }
  }, [machineId, selectedFilePaths, fetchDirectory, currentPath]);

  // Single item delete
  const handleDeleteSingle = useCallback(
    async (path: string) => {
      if (!machineId) return;
      try {
        await batchDeleteMachineFiles(machineId, [path]);
        antdMessage.success('已成功删除');
        setDirCache((prev) => {
          const next = new Map(prev);
          next.delete(currentPath);
          return next;
        });
        void fetchDirectory(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        antdMessage.error(`删除失败: ${msg}`);
      }
    },
    [machineId, currentPath, fetchDirectory]
  );

  // Upload file
  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!machineId) return false;
      try {
        await uploadMachineFile(machineId, currentPath, file);
        antdMessage.success(`文件 "${file.name}" 上传成功`);
        setDirCache((prev) => {
          const next = new Map(prev);
          next.delete(currentPath);
          return next;
        });
        void fetchDirectory(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        antdMessage.error(`上传失败: ${msg}`);
      }
      return false;
    },
    [machineId, currentPath, fetchDirectory]
  );

  // Handle Create File / Folder
  const handleCreateSubmit = useCallback(async () => {
    if (!machineId || !newItemName.trim()) {
      antdMessage.warning('请输入名称');
      return;
    }
    const cleanName = newItemName.trim();
    const fullPath = (
      currentPath.endsWith('/') ? currentPath + cleanName : `${currentPath}/${cleanName}`
    ).replace('\\', '/');

    setCreateLoading(true);
    try {
      if (createModalType === 'file') {
        await createMachineFile(machineId, fullPath);
        antdMessage.success(`文件 "${cleanName}" 创建成功`);
      } else {
        await createMachineDirectory(machineId, fullPath);
        antdMessage.success(`文件夹 "${cleanName}" 创建成功`);
      }
      setCreateModalVisible(false);
      setNewItemName('');
      setDirCache((prev) => {
        const next = new Map(prev);
        next.delete(currentPath);
        return next;
      });
      void fetchDirectory(currentPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      antdMessage.error(`创建失败: ${msg}`);
    } finally {
      setCreateLoading(false);
    }
  }, [machineId, currentPath, newItemName, createModalType, fetchDirectory]);

  // Handle Rename
  const handleRenameSubmit = useCallback(async () => {
    if (!machineId || !targetRenamePath || !newRenameName.trim()) return;
    const parentDir = targetRenamePath.substring(0, targetRenamePath.lastIndexOf('/')) || '/';
    const newFullPath = (
      parentDir.endsWith('/')
        ? parentDir + newRenameName.trim()
        : `${parentDir}/${newRenameName.trim()}`
    ).replace('\\', '/');

    setRenameLoading(true);
    try {
      await renameMachinePath(machineId, targetRenamePath, newFullPath);
      antdMessage.success('重命名成功');
      setRenameModalVisible(false);
      setDirCache((prev) => {
        const next = new Map(prev);
        next.delete(currentPath);
        next.delete(parentDir);
        return next;
      });
      void fetchDirectory(currentPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      antdMessage.error(`重命名失败: ${msg}`);
    } finally {
      setRenameLoading(false);
    }
  }, [machineId, targetRenamePath, newRenameName, currentPath, fetchDirectory]);

  // Handle Chmod
  const handleChmodSubmit = useCallback(async () => {
    if (!machineId || !targetChmodPath || !newChmodMode.trim()) return;
    setChmodLoading(true);
    try {
      await chmodMachinePath(machineId, targetChmodPath, newChmodMode.trim());
      antdMessage.success('权限修改成功');
      setChmodModalVisible(false);
      setDirCache((prev) => {
        const next = new Map(prev);
        next.delete(currentPath);
        return next;
      });
      void fetchDirectory(currentPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误';
      antdMessage.error(`权限修改失败: ${msg}`);
    } finally {
      setChmodLoading(false);
    }
  }, [machineId, targetChmodPath, newChmodMode, currentPath, fetchDirectory]);

  // Handle Drop Upload
  const handleDropUpload = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      if (!machineId || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
      const droppedFiles = Array.from(e.dataTransfer.files);
      antdMessage.loading({
        content: `正在上传 ${droppedFiles.length} 个文件...`,
        key: 'drop-upload',
      });
      try {
        for (const file of droppedFiles) {
          await uploadMachineFile(machineId, currentPath, file);
        }
        antdMessage.success({
          content: `成功上传 ${droppedFiles.length} 个文件`,
          key: 'drop-upload',
        });
        setDirCache((prev) => {
          const next = new Map(prev);
          next.delete(currentPath);
          return next;
        });
        void fetchDirectory(currentPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误';
        antdMessage.error({ content: `上传失败: ${msg}`, key: 'drop-upload' });
      }
    },
    [machineId, currentPath, fetchDirectory]
  );

  // Manual Refresh of current directory
  const handleRefreshCurrentDir = useCallback(() => {
    setDirCache((prev) => {
      const next = new Map(prev);
      next.delete(currentPath);
      return next;
    });
    void fetchDirectory(currentPath);
    antdMessage.success('已刷新当前目录');
  }, [currentPath, fetchDirectory]);

  const handleParentNav = useCallback(() => {
    if (
      currentPath === '/' ||
      currentPath === '' ||
      currentPath === 'C:/' ||
      currentPath === 'D:/'
    )
      return;
    const isWin = /^[a-zA-Z]:/.test(currentPath);
    const prefix = isWin ? currentPath.substring(0, 3) : '/';
    const rest = isWin ? currentPath.substring(3) : currentPath.substring(1);
    const parts = rest.split('/').filter(Boolean);
    parts.pop();
    const parentPath =
      parts.length === 0
        ? prefix
        : (prefix.endsWith('/') ? prefix.slice(0, -1) : prefix) + '/' + parts.join('/');
    void fetchDirectory(parentPath);
  }, [currentPath, fetchDirectory]);

  // File sorting
  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      if (fileSortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (fileSortBy === 'name_desc') return b.name.localeCompare(a.name);
      if (fileSortBy === 'size_desc') return b.size_bytes - a.size_bytes;
      if (fileSortBy === 'size_asc') return a.size_bytes - b.size_bytes;
      if (fileSortBy === 'time_desc') return b.modified_at.localeCompare(a.modified_at);
      if (fileSortBy === 'time_asc') return a.modified_at.localeCompare(b.modified_at);
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [files, fileSortBy]);

  // Filtered files in current directory
  const filteredSortedFiles = useMemo(() => {
    if (!fileFilter.trim()) return sortedFiles;
    const term = fileFilter.trim().toLowerCase();
    return sortedFiles.filter((f) => f.name.toLowerCase().includes(term));
  }, [sortedFiles, fileFilter]);

  // Open in terminal handler
  const handleOpenInTerminal = useCallback(
    (targetPath: string) => {
      handleOpenTab('terminal');
      const isWin =
        overview?.platform?.toLowerCase().includes('win') ||
        targetPath.includes(':') ||
        platform?.toLowerCase().includes('win');
      const cmd = isWin
        ? `cd /d "${targetPath.replace(/\//g, '\\')}"\r`
        : `cd "${targetPath}"\r`;
      setPendingTerminalCmd(cmd);
      antdMessage.success(`已切换控制台并进入目录: ${targetPath}`);
    },
    [handleOpenTab, overview, platform]
  );

  // Context menu builder for Tree nodes
  const getTreeContextMenu = useCallback(
    (node: TreeDataNode): MenuProps['items'] => {
      const path = node.key as string;
      return [
        {
          key: 'open_dir',
          icon: <FolderOpenOutlined />,
          label: '进入此目录',
          onClick: () => void fetchDirectory(path),
        },
        {
          key: 'open_in_term',
          icon: <DesktopOutlined style={{ color: '#52c41a' }} />,
          label: '在终端中打开此目录',
          onClick: () => handleOpenInTerminal(path),
        },
        {
          key: 'copy_path',
          icon: <CopyOutlined />,
          label: '复制路径',
          onClick: () => {
            void navigator.clipboard.writeText(path);
            antdMessage.success('已复制绝对路径');
          },
        },
        { type: 'divider' },
        {
          key: 'mkdir',
          icon: <FolderAddOutlined />,
          label: '在此新建子文件夹',
          onClick: () => {
            setCurrentPath(path);
            setCreateModalType('dir');
            setNewItemName('');
            setCreateModalVisible(true);
          },
        },
        {
          key: 'touch',
          icon: <FileAddOutlined />,
          label: '在此新建文件',
          onClick: () => {
            setCurrentPath(path);
            setCreateModalType('file');
            setNewItemName('');
            setCreateModalVisible(true);
          },
        },
        {
          key: 'chmod',
          icon: <LockOutlined />,
          label: '设置权限 (chmod)',
          onClick: () => {
            setTargetChmodPath(path);
            setNewChmodMode('0755');
            setChmodModalVisible(true);
          },
        },
        { type: 'divider' },
        {
          key: 'delete',
          icon: <DeleteOutlined />,
          danger: true,
          label: '删除此目录',
          onClick: () => {
            Modal.confirm({
              title: `确认删除 "${node.title}" 及其内容？`,
              content: '删除后不可恢复，请确认。',
              okText: '确认删除',
              okType: 'danger',
              cancelText: '取消',
              onOk: () => handleDeleteSingle(path),
            });
          },
        },
      ];
    },
    [fetchDirectory, handleOpenInTerminal, handleDeleteSingle]
  );

  // Context menu builder for files & folders
  const getContextMenu = useCallback(
    (record: DirectoryEntry): MenuProps['items'] => [
      ...(!record.is_dir
        ? [
            {
              key: 'edit',
              icon: <EditOutlined />,
              label: '在线编辑',
              onClick: () => handleOpenFileEditor(record.path),
            },
          ]
        : [
            {
              key: 'open',
              icon: <FolderOpenOutlined />,
              label: '打开文件夹',
              onClick: () => void fetchDirectory(record.path),
            },
          ]),
      {
        key: 'download',
        icon: <DownloadOutlined />,
        label: '下载',
        onClick: () => {
          if (machineId) {
            window.open(getDownloadFilesUrl(machineId, [record.path]), '_blank');
          }
        },
      },
      {
        key: 'rename',
        icon: <EditOutlined />,
        label: '重命名',
        onClick: () => {
          setTargetRenamePath(record.path);
          setNewRenameName(record.name);
          setRenameModalVisible(true);
        },
      },
      ...(record.is_dir
        ? [
            {
              key: 'open_in_term',
              icon: <DesktopOutlined style={{ color: '#52c41a' }} />,
              label: '在终端中打开此目录',
              onClick: () => handleOpenInTerminal(record.path),
            },
          ]
        : []),
      { type: 'divider' },
      {
        key: 'mkdir',
        icon: <FolderAddOutlined />,
        label: '新建子文件夹',
        onClick: () => {
          setCreateModalType('dir');
          setNewItemName('');
          setCreateModalVisible(true);
        },
      },
      {
        key: 'touch',
        icon: <FileAddOutlined />,
        label: '新建文件',
        onClick: () => {
          setCreateModalType('file');
          setNewItemName('');
          setCreateModalVisible(true);
        },
      },
      {
        key: 'copy_path',
        icon: <CopyOutlined />,
        label: '复制路径',
        onClick: () => {
          void navigator.clipboard.writeText(record.path);
          antdMessage.success('已复制绝对路径');
        },
      },
      {
        key: 'chmod',
        icon: <LockOutlined />,
        label: '设置权限 (chmod)',
        onClick: () => {
          setTargetChmodPath(record.path);
          setNewChmodMode(record.permissions || '0755');
          setChmodModalVisible(true);
        },
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        danger: true,
        label: '删除',
        onClick: () => {
          Modal.confirm({
            title: `确认删除 "${record.name}"？`,
            content: '删除后不可恢复，请确认。',
            okText: '确认删除',
            okType: 'danger',
            cancelText: '取消',
            onOk: () => handleDeleteSingle(record.path),
          });
        },
      },
    ],
    [machineId, fetchDirectory, handleOpenFileEditor, handleDeleteSingle, handleOpenInTerminal]
  );

  return {
    currentPath,
    inputPath,
    isEditingPath,
    files,
    filesLoading,
    selectedFilePaths,
    fileSortBy,
    drives,
    dirCache,
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
    setCurrentPath,
    setInputPath,
    setIsEditingPath,
    setFiles,
    setFilesLoading,
    setSelectedFilePaths,
    setFileSortBy,
    setDrives,
    setExpandedKeys,
    setDirCache,
    setTreeData,
    setTreeSearch,
    setFileFilter,
    setCreateModalVisible,
    setCreateModalType,
    setNewItemName,
    setCreateLoading,
    setRenameModalVisible,
    setTargetRenamePath,
    setNewRenameName,
    setRenameLoading,
    setChmodModalVisible,
    setTargetChmodPath,
    setNewChmodMode,
    setChmodLoading,
    setIsDraggingOver,
    setPendingTerminalCmd,
    initTreeRoots,
    fetchDirectory,
    fetchDrives,
    onLoadTreeData,
    onSelectTree,
    filteredTreeData,
    sortedFiles,
    filteredSortedFiles,
    handleBatchDelete,
    handleDeleteSingle,
    handleUploadFile,
    handleCreateSubmit,
    handleRenameSubmit,
    handleChmodSubmit,
    handleDropUpload,
    handleRefreshCurrentDir,
    handleParentNav,
    handleOpenInTerminal,
    getTreeContextMenu,
    getContextMenu,
  };
}
