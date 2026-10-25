/**
 * Dock-layout domain of the machine console.
 *
 * Owns the persisted layout tree, the editor-tab open list, and the
 * operations that mutate both (split/open/select). Extracted from
 * MachineConsoleDrawer; the main component destructures the return value
 * so its JSX and callbacks keep their original names.
 */
import { useCallback, useState } from 'react';

import { message as antdMessage } from 'antd';

import {
  findTabGroupWithTab,
  getAllOpenTabIds,
  moveTab,
  selectTab,
  serializeLayout,
  splitTab,
  deserializeLayout,
} from '@/components/dock/dockEngine';
import type { LayoutNode } from '@/components/dock/types';

import { ALL_CORE_TABS, DEFAULT_IDE_LAYOUT } from './machineConsoleUtils';

export function useConsoleDockLayout(machineId: string | null) {
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
        return deserializeLayout(saved, ALL_CORE_TABS, DEFAULT_IDE_LAYOUT) ?? DEFAULT_IDE_LAYOUT;
      }
    } catch {
      // Ignore localStorage read errors
    }
    return DEFAULT_IDE_LAYOUT;
  });

  const handleLayoutChange = useCallback(
    (newLayout: LayoutNode) => {
      setLayout(newLayout);
      try {
        localStorage.setItem(storageKey, serializeLayout(newLayout));
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  // Quick action: Open tab
  const handleOpenTab = useCallback(
    (tabId: string) => {
      const openTabIds = getAllOpenTabIds(layout);
      if (!openTabIds.includes(tabId)) {
        const rootId = layout.id;
        const updated = splitTab(layout, rootId, rootId, tabId, 'right');
        handleLayoutChange(updated);
      }
    },
    [layout, handleLayoutChange]
  );

  // Open file in Docking Editor Tab (in the same TabGroup as files by default)
  const handleOpenFileEditor = useCallback((filePath: string) => {
    const tabId = `file:${filePath}`;
    setOpenFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));

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
  }, [layout, handleLayoutChange]);

  return {
    storageKey,
    openFiles,
    layout,
    handleLayoutChange,
    handleOpenTab,
    handleOpenFileEditor,
  };
}
