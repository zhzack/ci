import React from 'react';

export type SplitDirection = 'horizontal' | 'vertical'; // horizontal: 左右左右分栏, vertical: 上下上下分栏

export type DropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center';

export interface TabItemConfig {
  id: string;
  title: string;
  icon?: React.ReactNode;
  closable?: boolean;
  content: React.ReactNode;
}

export interface TabGroupNode {
  id: string;
  type: 'tabGroup';
  tabs: string[]; // tab ids
  activeTab: string; // active tab id
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[]; // e.g. [50, 50]
}

export type LayoutNode = SplitNode | TabGroupNode;

export interface DraggingTabState {
  sourceGroupId: string;
  tabId: string;
}

export interface DockContextType {
  tabRegistry: Record<string, TabItemConfig>;
  activeDrag: DraggingTabState | null;
  setActiveDrag: (drag: DraggingTabState | null) => void;
  onTabSelect: (groupId: string, tabId: string) => void;
  onTabClose: (groupId: string, tabId: string) => void;
  onTabCloseOthers: (groupId: string, tabId: string) => void;
  onTabCloseRight: (groupId: string, tabId: string) => void;
  onTabCloseAll: (groupId: string) => void;
  onTabMove: (sourceGroupId: string, targetGroupId: string, tabId: string, targetIndex?: number) => void;
  onTabSplit: (sourceGroupId: string, targetGroupId: string, tabId: string, position: DropPosition) => void;
  onSplitResize: (splitId: string, index: number, newSizes: number[]) => void;
}
