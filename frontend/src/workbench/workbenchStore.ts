import { create } from 'zustand';
import { loadStoredAuth } from '@/api/http';
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
  currentUserId: string | null;
  layout: LayoutNode;
  dynamicTabs: Record<string, DynamicTabParam>;
  switchUser: (userId: string | null) => void;
  setLayout: (layout: LayoutNode) => void;
  resetLayout: (newDefault?: LayoutNode) => void;
  openTab: (tabId: string, dynamicInfo?: DynamicTabParam, targetGroupId?: string) => void;
  closeTabById: (tabId: string) => void;
  focusTab: (tabId: string) => void;
  isOpen: (tabId: string) => boolean;
}

function getStorageKey(userId?: string | null): string {
  return userId ? `mini_pipeline_workbench_user_${userId}` : 'mini_pipeline_workbench_guest';
}

function loadInitialLayout(userId?: string | null): LayoutNode {
  try {
    const key = getStorageKey(userId);
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = deserializeLayout(saved);
      if (parsed) return parsed;
    }
  } catch {
    // Ignore localStorage read errors
  }
  return DEFAULT_WORKBENCH_LAYOUT;
}

function persistLayout(layout: LayoutNode, userId?: string | null) {
  try {
    const key = getStorageKey(userId);
    localStorage.setItem(key, serializeLayout(layout));
  } catch {
    // Ignore localStorage write errors
  }
}

const initialUser = loadStoredAuth()?.user;
const initialUserId = initialUser?.id ?? null;

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  currentUserId: initialUserId,
  layout: loadInitialLayout(initialUserId),
  dynamicTabs: {},

  switchUser: (newUserId) => {
    const { currentUserId, layout } = get();
    if (currentUserId === newUserId) return;
    // Persist current layout under current user id
    persistLayout(layout, currentUserId);
    // Load layout for new user
    const newLayout = loadInitialLayout(newUserId);
    set({ currentUserId: newUserId, layout: newLayout, dynamicTabs: {} });
  },

  setLayout: (newLayout) => {
    const { currentUserId } = get();
    persistLayout(newLayout, currentUserId);
    set({ layout: newLayout });
  },

  resetLayout: (newDefault) => {
    const { currentUserId } = get();
    const target = newDefault ?? DEFAULT_WORKBENCH_LAYOUT;
    persistLayout(target, currentUserId);
    set({ layout: target, dynamicTabs: {} });
  },

  focusTab: (tabId) => {
    const { layout, currentUserId } = get();
    const group = findTabGroupWithTab(layout, tabId);
    if (group) {
      const updated = selectTab(layout, group.id, tabId);
      persistLayout(updated, currentUserId);
      set({ layout: updated });
    }
  },

  isOpen: (tabId) => {
    const { layout } = get();
    const openTabs = getAllOpenTabIds(layout);
    return openTabs.includes(tabId);
  },

  openTab: (tabId, dynamicInfo, targetGroupId) => {
    const { layout, dynamicTabs, currentUserId } = get();

    if (dynamicInfo) {
      set({ dynamicTabs: { ...dynamicTabs, [tabId]: dynamicInfo } });
    }

    const existingGroup = findTabGroupWithTab(layout, tabId);
    if (existingGroup) {
      const updated = selectTab(layout, existingGroup.id, tabId);
      persistLayout(updated, currentUserId);
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
      persistLayout(updated, currentUserId);
      set({ layout: updated });
    } else {
      // If tree is empty, create root group
      const newGroup: LayoutNode = {
        id: generateNodeId('group-root'),
        type: 'tabGroup',
        tabs: [tabId],
        activeTab: tabId,
      };
      persistLayout(newGroup, currentUserId);
      set({ layout: newGroup });
    }
  },

  closeTabById: (tabId) => {
    const { layout, currentUserId } = get();
    const group = findTabGroupWithTab(layout, tabId);
    if (group) {
      const updated = closeTab(layout, group.id, tabId);
      if (updated) {
        persistLayout(updated, currentUserId);
        set({ layout: updated });
      }
    }
  },
}));

