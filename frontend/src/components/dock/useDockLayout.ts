import { useCallback, useEffect, useState } from 'react';
import type { LayoutNode, TabItemConfig } from './types';
import {
  deserializeLayout,
  findTabGroupWithTab,
  getAllOpenTabIds,
  moveTab,
  selectTab,
  serializeLayout,
} from './dockEngine';

export interface UseDockLayoutOptions {
  storageKey?: string;
  defaultLayout: LayoutNode;
  tabRegistry?: Record<string, TabItemConfig>;
}

export interface UseDockLayoutReturn {
  layout: LayoutNode;
  setLayout: (layout: LayoutNode) => void;
  resetLayout: (newDefault?: LayoutNode) => void;
  openTab: (tabConfig: TabItemConfig, targetGroupId?: string) => void;
  closeTabById: (tabId: string) => void;
  focusTab: (tabId: string) => void;
  isOpen: (tabId: string) => boolean;
  openTabIds: string[];
}

export function useDockLayout({
  storageKey,
  defaultLayout,
}: UseDockLayoutOptions): UseDockLayoutReturn {
  const [layout, setLayout] = useState<LayoutNode>(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = deserializeLayout(saved);
        if (parsed) return parsed;
      }
    }
    return defaultLayout;
  });

  // Sync to localStorage when layout changes
  useEffect(() => {
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, serializeLayout(layout));
      } catch {
        // Ignore localStorage quota errors
      }
    }
  }, [storageKey, layout]);

  const resetLayout = useCallback(
    (newDefault?: LayoutNode) => {
      const target = newDefault ?? defaultLayout;
      setLayout(target);
      if (storageKey) {
        localStorage.removeItem(storageKey);
      }
    },
    [defaultLayout, storageKey]
  );

  const openTabIds = getAllOpenTabIds(layout);

  const isOpen = useCallback(
    (tabId: string) => {
      return openTabIds.includes(tabId);
    },
    [openTabIds]
  );

  const focusTab = useCallback(
    (tabId: string) => {
      const group = findTabGroupWithTab(layout, tabId);
      if (group) {
        setLayout((prev) => selectTab(prev, group.id, tabId));
      }
    },
    [layout]
  );

  const openTab = useCallback(
    (tabConfig: TabItemConfig, targetGroupId?: string) => {
      const tabId = tabConfig.id;
      const existingGroup = findTabGroupWithTab(layout, tabId);
      if (existingGroup) {
        setLayout((prev) => selectTab(prev, existingGroup.id, tabId));
        return;
      }

      // If targetGroupId not provided, find first tab group or existing group
      let destGroupId = targetGroupId;
      if (!destGroupId) {
        const findFirstGroup = (node: LayoutNode): string | null => {
          if (node.type === 'tabGroup') return node.id;
          for (const child of node.children) {
            const res = findFirstGroup(child);
            if (res) return res;
          }
          return null;
        };
        destGroupId = findFirstGroup(layout) ?? undefined;
      }

      if (destGroupId) {
        setLayout((prev) => moveTab(prev, destGroupId!, destGroupId!, tabId));
      }
    },
    [layout]
  );

  const closeTabById = useCallback(
    (tabId: string) => {
      const group = findTabGroupWithTab(layout, tabId);
      if (group) {
        import('./dockEngine').then(({ closeTab }) => {
          setLayout((prev) => {
            const updated = closeTab(prev, group.id, tabId);
            return updated ?? prev;
          });
        });
      }
    },
    [layout]
  );

  return {
    layout,
    setLayout,
    resetLayout,
    openTab,
    closeTabById,
    focusTab,
    isOpen,
    openTabIds,
  };
}
