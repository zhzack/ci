import { create } from 'zustand';
import type { LayoutNode } from '@/components/dock';
import {
  closeTab,
  deserializeLayout,
  findTabGroupWithTab,
  generateNodeId,
  getAllOpenTabIds,
  moveTab,
  selectTab,
  serializeLayout,
} from '@/components/dock';

const STORAGE_KEY = 'mini_pipeline_global_ide_workbench_v1';

export const DEFAULT_WORKBENCH_LAYOUT: LayoutNode = {
  id: 'group-main',
  type: 'tabGroup',
  tabs: ['dashboard'],
  activeTab: 'dashboard',
};

export interface DynamicTabParam {
  id: string;
  type: string;
  title: string;
  icon?: string;
  props?: Record<string, unknown>;
}

interface WorkbenchState {
  layout: LayoutNode;
  dynamicTabs: Record<string, DynamicTabParam>;
  setLayout: (layout: LayoutNode) => void;
  resetLayout: (newDefault?: LayoutNode) => void;
  openTab: (tabId: string, dynamicInfo?: DynamicTabParam, targetGroupId?: string) => void;
  closeTabById: (tabId: string) => void;
  focusTab: (tabId: string) => void;
  isOpen: (tabId: string) => boolean;
}

function loadInitialLayout(): LayoutNode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = deserializeLayout(saved);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore localStorage read errors
  }
  return DEFAULT_WORKBENCH_LAYOUT;
}

function persistLayout(layout: LayoutNode) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeLayout(layout));
  } catch {
    // Ignore localStorage write errors
  }
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  layout: loadInitialLayout(),
  dynamicTabs: {},

  setLayout: (newLayout) => {
    persistLayout(newLayout);
    set({ layout: newLayout });
  },

  resetLayout: (newDefault) => {
    const target = newDefault ?? DEFAULT_WORKBENCH_LAYOUT;
    persistLayout(target);
    set({ layout: target, dynamicTabs: {} });
  },

  focusTab: (tabId) => {
    const { layout } = get();
    const group = findTabGroupWithTab(layout, tabId);
    if (group) {
      const updated = selectTab(layout, group.id, tabId);
      persistLayout(updated);
      set({ layout: updated });
    }
  },

  isOpen: (tabId) => {
    const { layout } = get();
    const openTabs = getAllOpenTabIds(layout);
    return openTabs.includes(tabId);
  },

  openTab: (tabId, dynamicInfo, targetGroupId) => {
    const { layout, dynamicTabs } = get();

    if (dynamicInfo) {
      set({ dynamicTabs: { ...dynamicTabs, [tabId]: dynamicInfo } });
    }

    const existingGroup = findTabGroupWithTab(layout, tabId);
    if (existingGroup) {
      const updated = selectTab(layout, existingGroup.id, tabId);
      persistLayout(updated);
      set({ layout: updated });
      return;
    }

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
      const updated = moveTab(layout, destGroupId, destGroupId, tabId);
      persistLayout(updated);
      set({ layout: updated });
    } else {
      // If tree is empty, create root group
      const newGroup: LayoutNode = {
        id: generateNodeId('group-root'),
        type: 'tabGroup',
        tabs: [tabId],
        activeTab: tabId,
      };
      persistLayout(newGroup);
      set({ layout: newGroup });
    }
  },

  closeTabById: (tabId) => {
    const { layout } = get();
    const group = findTabGroupWithTab(layout, tabId);
    if (group) {
      const updated = closeTab(layout, group.id, tabId);
      if (updated) {
        persistLayout(updated);
        set({ layout: updated });
      }
    }
  },
}));
