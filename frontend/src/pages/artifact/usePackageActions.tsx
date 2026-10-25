/**
 * Action domain of the Package Hub: preview/edit drawer state, batch
 * selection (click / ctrl / shift / swipe-drag), single + batch
 * download/delete/copy actions, and the breadcrumb / visible-row filters.
 *
 * Extracted from PackageHubTab; the component destructures the return
 * value so its JSX keeps the original names. `data` (directory query
 * payload) drives filteredItems/breadcrumb; `setCurrentPath` is injected
 * because navigation mutates the browse domain's state.
 */
import { useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Typography } from 'antd';
import { FolderOutlined } from '@ant-design/icons';

import {
  batchCopyPackageItems,
  batchDeletePackageItems,
  batchDownloadPackagesDirect,
  downloadPackageFileDirect,
  previewPackageFile,
  savePackageFile,
  type DirectoryListing,
  type FilePreview,
  type StorageItem,
} from '@/api/packages';

interface Notify {
  success: (content: string) => void;
  error: (content: string) => void;
}

interface UsePackageActionsOptions {
  /** Query payload of the current directory listing. */
  data: DirectoryListing | undefined;
  currentPath: string;
  setCurrentPath: (p: string) => void;
  /** Instant search filter text from the browse domain. */
  searchFilter: string;
  message: Notify;
}

export function usePackageActions({
  data,
  currentPath,
  setCurrentPath,
  searchFilter,
  message,
}: UsePackageActionsOptions) {
  const queryClient = useQueryClient();
  // Preview / Edit state
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [currentPreview, setCurrentPreview] = useState<FilePreview | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);

  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [selectedRows, setSelectedRows] = useState<StorageItem[]>([]);
  const [batchCopyModalOpen, setBatchCopyModalOpen] = useState(false);
  const [batchCopyTargetDir, setBatchCopyTargetDir] = useState('');
  const [batchActionLoading, setBatchActionLoading] = useState(false);

  const [isMouseSelecting, setIsMouseSelecting] = useState(false);

  const dragStartIndexRef = useRef<number | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Global mouseup to finish drag/swipe selection
  useEffect(() => {
    if (!isMouseSelecting) return;
    const handleGlobalMouseUp = () => {
      setIsMouseSelecting(false);
      dragStartIndexRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isMouseSelecting]);

  const handleDownload = async (record: StorageItem) => {
    setDownloadingPath(record.path);
    try {
      const filename = record.is_dir ? `${record.name}.zip` : record.name;
      await downloadPackageFileDirect(record.path, filename);
    } catch {
      message.error('下载失败');
    } finally {
      setDownloadingPath(null);
    }
  };

  const handleOpenPreview = async (item: StorageItem) => {
    setPreviewLoading(true);
    setPreviewDrawerOpen(true);
    setIsEditing(false);
    try {
      const p = await previewPackageFile(item.path);
      setCurrentPreview(p);
      setEditBuffer(p.content || '');
    } catch {
      setPreviewDrawerOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSaveText = async () => {
    if (!currentPreview) return;
    setSaveLoading(true);
    try {
      await savePackageFile(currentPreview.path, editBuffer);
      message.success('文件保存成功');
      setCurrentPreview({
        ...currentPreview,
        content: editBuffer,
        size: new Blob([editBuffer]).size,
        line_count: editBuffer.split('\n').length,
      });
      setIsEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleNavigate = (newPath: string) => {
    setSelectedRowKeys([]);
    setSelectedRows([]);
    setCurrentPath(newPath);
  };

  const handleBatchDownload = async () => {
    if (selectedRows.length === 0) return;
    setBatchActionLoading(true);
    try {
      const paths = selectedRows.map((r) => r.path);
      await batchDownloadPackagesDirect(paths);
      message.success(`已开始打包下载选中的 ${paths.length} 个项目`);
    } catch (err) {
      message.error(`批量下载失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRows.length === 0) return;
    setBatchActionLoading(true);
    try {
      const paths = selectedRows.map((r) => r.path);
      const res = await batchDeletePackageItems(paths);
      message.success(`成功批量删除 ${res.deleted_count} 个项目`);
      setSelectedRowKeys([]);
      setSelectedRows([]);
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    } catch (err) {
      message.error(`批量删除失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchCopy = async () => {
    if (selectedRows.length === 0 || !batchCopyTargetDir.trim()) return;
    setBatchActionLoading(true);
    try {
      const paths = selectedRows.map((r) => r.path);
      const res = await batchCopyPackageItems(paths, batchCopyTargetDir.trim());
      message.success(`成功批量复制 ${res.copied_count} 个项目到 ${batchCopyTargetDir}`);
      setBatchCopyModalOpen(false);
      setBatchCopyTargetDir('');
      setSelectedRowKeys([]);
      setSelectedRows([]);
      void queryClient.invalidateQueries({ queryKey: ['packages', currentPath] });
    } catch (err) {
      message.error(`批量复制失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchActionLoading(false);
    }
  };

  // Breadcrumb items
  const pathSegments = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const breadcrumbItems = [
    {
      title: (
        <a onClick={() => handleNavigate('')}>
          <FolderOutlined /> 根目录 (Root)
        </a>
      ),
    },
    ...pathSegments.map((segment, index) => {
      const segmentPath = pathSegments.slice(0, index + 1).join('/');
      const isLast = index === pathSegments.length - 1;
      return {
        title: isLast ? (
          <Typography.Text strong>{segment}</Typography.Text>
        ) : (
          <a onClick={() => handleNavigate(segmentPath)}>{segment}</a>
        ),
      };
    }),
  ];

  const filteredItems = (data?.items || []).filter((item) =>
    item.name.toLowerCase().includes(searchFilter.toLowerCase()),
  );

  // Row click & Swipe-drag selection
  const toggleRowSelection = (record: StorageItem, index: number, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('.ant-checkbox-wrapper') ||
      target.closest('.ant-dropdown') ||
      target.closest('.ant-popover')
    ) {
      return;
    }

    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, index);
      const end = Math.max(lastClickedIndexRef.current, index);
      const rangeItems = filteredItems.slice(start, end + 1);
      const newKeys = Array.from(new Set([...selectedRowKeys, ...rangeItems.map((it) => it.path)]));
      const newRows = filteredItems.filter((it) => newKeys.includes(it.path));
      setSelectedRowKeys(newKeys);
      setSelectedRows(newRows);
    } else if (e.ctrlKey || e.metaKey) {
      const isSelected = selectedRowKeys.includes(record.path);
      const newKeys = isSelected
        ? selectedRowKeys.filter((k) => k !== record.path)
        : [...selectedRowKeys, record.path];
      const newRows = filteredItems.filter((it) => newKeys.includes(it.path));
      setSelectedRowKeys(newKeys);
      setSelectedRows(newRows);
      lastClickedIndexRef.current = index;
    } else {
      const isSelected = selectedRowKeys.includes(record.path);
      const newKeys = isSelected
        ? selectedRowKeys.filter((k) => k !== record.path)
        : [...selectedRowKeys, record.path];
      const newRows = filteredItems.filter((it) => newKeys.includes(it.path));
      setSelectedRowKeys(newKeys);
      setSelectedRows(newRows);
      lastClickedIndexRef.current = index;
    }
  };

  const handleRowMouseDown = (record: StorageItem, index: number, e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('input') ||
      target.closest('.ant-checkbox-wrapper') ||
      target.closest('.ant-dropdown')
    ) {
      return;
    }

    setIsMouseSelecting(true);
    dragStartIndexRef.current = index;
    lastClickedIndexRef.current = index;

    if (!e.ctrlKey && !e.shiftKey) {
      setSelectedRowKeys([record.path]);
      setSelectedRows([record]);
    } else {
      toggleRowSelection(record, index, e);
    }
  };

  const handleRowMouseEnter = (_record: StorageItem, index: number) => {
    if (!isMouseSelecting || dragStartIndexRef.current === null) return;

    const start = Math.min(dragStartIndexRef.current, index);
    const end = Math.max(dragStartIndexRef.current, index);
    const rangeItems = filteredItems.slice(start, end + 1);
    const newKeys = rangeItems.map((it) => it.path);
    setSelectedRowKeys(newKeys);
    setSelectedRows(rangeItems);
  };

  const clearSelection = () => {
    setSelectedRowKeys([]);
    setSelectedRows([]);
  };

  return {
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
    setCurrentPreview,
    setIsEditing,
    setEditBuffer,
    setSaveLoading,
    setSelectedRowKeys,
    setSelectedRows,
    setBatchCopyModalOpen,
    setBatchCopyTargetDir,
    clearSelection,
    filteredItems,
    pathSegments,
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
  };
}
