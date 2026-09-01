import { create } from 'zustand';
import { loadStoredAuth } from '@/api/http';
import type { LayoutNode } from '@/components/dock';
import {
  closeActiveTab,
  closeTab,
  deserializeLayout,
  findFirstTabGroup,
  findTabGroupWithTab,
  generateNodeId,
  getAllOpenTabIds,
  moveTab,
  selectTab,
  serializeLayout,
  switchNextTab,
  switchPrevTab,
  switchToTabIndex,
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

export interface SavedLayout {
  id: string;
  name: string;
  serializedLayout: string;
  createdAt: number;
  tabCount: number;
}

interface WorkbenchState {
  currentUserId: string | null;
  layout: LayoutNode;
  dynamicTabs: Record<string, DynamicTabParam>;
  savedLayouts: SavedLayout[];
  closedTabsHistory: string[];
  switchUser: (userId: string | null) => void;
  setLayout: (layout: LayoutNode) => void;
  resetLayout: (newDefault?: LayoutNode) => void;
  openTab: (tabId: string, dynamicInfo?: DynamicTabParam, targetGroupId?: string) => void;
  closeTabById: (tabId: string) => void;
  closeActiveTab: () => string | null;
  reopenLastClosedTab: () => boolean;
  nextTab: () => void;
  prevTab: () => void;
  switchToTabIndex: (index: number) => void;
  focusTab: (tabId: string) => void;
  isOpen: (tabId: string) => boolean;
  saveCurrentLayout: (name: string) => SavedLayout;
  applySavedLayout: (layoutId: string) => boolean;
  deleteSavedLayout: (layoutId: string) => void;
  renameSavedLayout: (layoutId: string, newName: string) => void;
}

function getStorageKey(userId?: string | null): string {
  return userId ? `mini_pipeline_workbench_user_${userId}` : 'mini_pipeline_workbench_guest';
}

function getSavedLayoutsStorageKey(userId?: string | null): string {
  return userId ? `mini_pipeline_saved_layouts_${userId}` : 'mini_pipeline_saved_layouts_guest';
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

function loadSavedLayouts(userId?: string | null): SavedLayout[] {
  try {
    const key = getSavedLayoutsStorageKey(userId);
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore localStorage read errors
  }
  return [];
}

function persistLayout(layout: LayoutNode, userId?: string | null) {
  try {
    const key = getStorageKey(userId);
    localStorage.setItem(key, serializeLayout(layout));
  } catch {
    // Ignore localStorage write errors
  }
}

function persistSavedLayouts(layouts: SavedLayout[], userId?: string | null) {
  try {
    const key = getSavedLayoutsStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(layouts));
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
  savedLayouts: loadSavedLayouts(initialUserId),
  closedTabsHistory: [],

  switchUser: (newUserId) => {
    const { currentUserId, layout } = get();
    if (currentUserId === newUserId) return;
    // Persist current layout under current user id
    persistLayout(layout, currentUserId);
    // Load layout & saved templates for new user
    const newLayout = loadInitialLayout(newUserId);
    const newSavedLayouts = loadSavedLayouts(newUserId);
    set({
      currentUserId: newUserId,
      layout: newLayout,
      savedLayouts: newSavedLayouts,
      closedTabsHistory: [],
      dynamicTabs: {},
    });
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

  saveCurrentLayout: (name: string) => {
    const { layout, currentUserId, savedLayouts } = get();
    const serialized = serializeLayout(layout);
    const openTabs = getAllOpenTabIds(layout);
    const newEntry: SavedLayout = {
      id: `layout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim() || `自定义布局 (${new Date().toLocaleTimeString()})`,
      serializedLayout: serialized,
      createdAt: Date.now(),
      tabCount: openTabs.length,
    };
    const updated = [newEntry, ...savedLayouts];
    persistSavedLayouts(updated, currentUserId);
    set({ savedLayouts: updated });
    return newEntry;
  },

  applySavedLayout: (layoutId: string) => {
    const { savedLayouts, currentUserId } = get();
    const entry = savedLayouts.find((item) => item.id === layoutId);
    if (!entry) return false;
    const parsed = deserializeLayout(entry.serializedLayout);
    if (parsed) {
      persistLayout(parsed, currentUserId);
      set({ layout: parsed });
      return true;
    }
    return false;
  },

  deleteSavedLayout: (layoutId: string) => {
    const { savedLayouts, currentUserId } = get();
    const updated = savedLayouts.filter((item) => item.id !== layoutId);
    persistSavedLayouts(updated, currentUserId);
    set({ savedLayouts: updated });
  },

  renameSavedLayout: (layoutId: string, newName: string) => {
    const { savedLayouts, currentUserId } = get();
    const updated = savedLayouts.map((item) =>
      item.id === layoutId ? { ...item, name: newName.trim() || item.name } : item
    );
    persistSavedLayouts(updated, currentUserId);
    set({ savedLayouts: updated });
  },

  closeActiveTab: () => {
    const { layout, currentUserId, closedTabsHistory } = get();
    const group = findFirstTabGroup(layout);
    if (!group || !group.activeTab) return null;
    const closedId = group.activeTab;
    const { newLayout } = closeActiveTab(layout);
    const fallbackLayout: LayoutNode = newLayout || {
      id: generateNodeId('group-root'),
      type: 'tabGroup',
      tabs: [],
      activeTab: '',
    };
    persistLayout(fallbackLayout, currentUserId);
    const newHistory = [closedId, ...closedTabsHistory.filter((t) => t !== closedId)].slice(0, 20);
    set({ layout: fallbackLayout, closedTabsHistory: newHistory });
    return closedId;
  },

  reopenLastClosedTab: () => {
    const { closedTabsHistory, openTab } = get();
    if (closedTabsHistory.length === 0) return false;
    const [lastTab, ...remaining] = closedTabsHistory;
    if (lastTab) {
      set({ closedTabsHistory: remaining });
      openTab(lastTab);
      return true;
    }
    return false;
  },

  nextTab: () => {
    const { layout, currentUserId } = get();
    const updated = switchNextTab(layout);
    persistLayout(updated, currentUserId);
    set({ layout: updated });
  },

  prevTab: () => {
    const { layout, currentUserId } = get();
    const updated = switchPrevTab(layout);
    persistLayout(updated, currentUserId);
    set({ layout: updated });
  },

  switchToTabIndex: (index: number) => {
    const { layout, currentUserId } = get();
    const updated = switchToTabIndex(layout, index);
    persistLayout(updated, currentUserId);
    set({ layout: updated });
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
    const { layout, currentUserId, closedTabsHistory } = get();
    const group = findTabGroupWithTab(layout, tabId);
    if (group) {
      const updated = closeTab(layout, group.id, tabId);
      const targetLayout: LayoutNode = updated || {
        id: generateNodeId('group-root'),
        type: 'tabGroup',
        tabs: [],
        activeTab: '',
      };
      persistLayout(targetLayout, currentUserId);
      const newHistory = [tabId, ...closedTabsHistory.filter((t) => t !== tabId)].slice(0, 20);
      set({ layout: targetLayout, closedTabsHistory: newHistory });
    }
  },
}));


