import type {
  DropPosition,
  LayoutNode,
  SplitDirection,
  SplitNode,
  TabGroupNode,
} from './types';

let idCounter = 1;
export function generateNodeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

/** Deep clones a layout node tree. */
export function cloneTree(node: LayoutNode): LayoutNode {
  if (node.type === 'tabGroup') {
    return {
      ...node,
      tabs: [...node.tabs],
    };
  }
  return {
    ...node,
    children: node.children.map(cloneTree),
    sizes: [...node.sizes],
  };
}

/** Finds a node by id in the layout tree. */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return root;
  if (root.type === 'split') {
    for (const child of root.children) {
      const res = findNode(child, id);
      if (res) return res;
    }
  }
  return null;
}

export function findTabGroupWithTab(root: LayoutNode, tabId: string): TabGroupNode | null {
  if (root.type === 'tabGroup') {
    if (root.tabs.includes(tabId)) return root;
    return null;
  }
  for (const child of root.children) {
    const res = findTabGroupWithTab(child, tabId);
    if (res) return res;
  }
  return null;
}

/** Finds parent split node containing the target node ID. */
export function findParent(
  root: LayoutNode,
  childId: string
): { parent: SplitNode; index: number } | null {
  if (root.type === 'split') {
    const idx = root.children.findIndex((c) => c.id === childId);
    if (idx !== -1) {
      return { parent: root, index: idx };
    }
    for (const child of root.children) {
      const res = findParent(child, childId);
      if (res) return res;
    }
  }
  return null;
}

/** Recursively cleans up empty tab groups and collapses redundant single-child splits. */
export function cleanTree(node: LayoutNode): LayoutNode | null {
  if (node.type === 'tabGroup') {
    if (node.tabs.length === 0) {
      return null;
    }
    // Ensure activeTab is valid
    if (!node.tabs.includes(node.activeTab)) {
      node.activeTab = node.tabs[0] || '';
    }
    return node;
  }

  // Split node cleaning
  const cleanedChildren: LayoutNode[] = [];
  const cleanedSizes: number[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const c = node.children[i];
    if (!c) continue;
    const cleanedChild = cleanTree(c);
    if (cleanedChild) {
      cleanedChildren.push(cleanedChild);
      cleanedSizes.push(node.sizes[i] || 100 / node.children.length);
    }
  }

  if (cleanedChildren.length === 0) {
    return null;
  }

  if (cleanedChildren.length === 1) {
    return cleanedChildren[0] || null;
  }

  // Normalize sizes to sum to 100
  const total = cleanedSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes =
    total > 0
      ? cleanedSizes.map((s) => Math.round((s / total) * 100))
      : cleanedChildren.map(() => Math.round(100 / cleanedChildren.length));

  return {
    ...node,
    children: cleanedChildren,
    sizes: normalizedSizes,
  };
}

/** Selects an active tab in a given TabGroup. */
export function selectTab(root: LayoutNode, groupId: string, tabId: string): LayoutNode {
  const cloned = cloneTree(root);
  const target = findNode(cloned, groupId);
  if (target && target.type === 'tabGroup' && target.tabs.includes(tabId)) {
    target.activeTab = tabId;
  }
  return cloned;
}

/** Closes a tab from a group. Cleans up empty groups. */
export function closeTab(root: LayoutNode, groupId: string, tabId: string): LayoutNode | null {
  const cloned = cloneTree(root);
  const target = findNode(cloned, groupId);
  if (target && target.type === 'tabGroup') {
    const idx = target.tabs.indexOf(tabId);
    if (idx !== -1) {
      target.tabs.splice(idx, 1);
      if (target.activeTab === tabId) {
        target.activeTab = target.tabs[Math.max(0, idx - 1)] || '';
      }
    }
  }
  return cleanTree(cloned);
}

/** Closes all tabs except the specified one. */
export function closeOtherTabs(
  root: LayoutNode,
  groupId: string,
  tabId: string
): LayoutNode | null {
  const cloned = cloneTree(root);
  const target = findNode(cloned, groupId);
  if (target && target.type === 'tabGroup' && target.tabs.includes(tabId)) {
    target.tabs = [tabId];
    target.activeTab = tabId;
  }
  return cleanTree(cloned);
}

/** Closes all tabs to the right of the specified tab. */
export function closeRightTabs(
  root: LayoutNode,
  groupId: string,
  tabId: string
): LayoutNode | null {
  const cloned = cloneTree(root);
  const target = findNode(cloned, groupId);
  if (target && target.type === 'tabGroup') {
    const idx = target.tabs.indexOf(tabId);
    if (idx !== -1) {
      target.tabs = target.tabs.slice(0, idx + 1);
      if (!target.tabs.includes(target.activeTab)) {
        target.activeTab = tabId;
      }
    }
  }
  return cleanTree(cloned);
}

/** Closes all tabs in a group. */
export function closeAllTabs(root: LayoutNode, groupId: string): LayoutNode | null {
  const cloned = cloneTree(root);
  const target = findNode(cloned, groupId);
  if (target && target.type === 'tabGroup') {
    target.tabs = [];
    target.activeTab = '';
  }
  return cleanTree(cloned);
}

/** Moves a tab from source group to target group (or reorders within group). */
export function moveTab(
  root: LayoutNode,
  sourceGroupId: string,
  targetGroupId: string,
  tabId: string,
  targetIndex?: number
): LayoutNode {
  const cloned = cloneTree(root);
  const sourceNode = findNode(cloned, sourceGroupId);
  const targetNode = findNode(cloned, targetGroupId);

  if (!targetNode || targetNode.type !== 'tabGroup') {
    return root;
  }

  // Remove from source if found
  if (sourceNode && sourceNode.type === 'tabGroup') {
    const sIdx = sourceNode.tabs.indexOf(tabId);
    if (sIdx !== -1) {
      sourceNode.tabs.splice(sIdx, 1);
      if (sourceNode.activeTab === tabId) {
        sourceNode.activeTab = sourceNode.tabs[Math.max(0, sIdx - 1)] || '';
      }
    }
  }

  // Insert into target
  if (typeof targetIndex === 'number' && targetIndex >= 0) {
    targetNode.tabs.splice(targetIndex, 0, tabId);
  } else {
    // avoid duplicates
    if (!targetNode.tabs.includes(tabId)) {
      targetNode.tabs.push(tabId);
    }
  }
  targetNode.activeTab = tabId;

  const cleaned = cleanTree(cloned);
  return cleaned || targetNode;
}

/**
 * Splits a TabGroup and docks the dragged Tab into the new direction
 * (left, right, top, bottom, center).
 */
export function splitTab(
  root: LayoutNode,
  sourceGroupId: string,
  targetGroupId: string,
  tabId: string,
  position: DropPosition
): LayoutNode {
  if (position === 'center') {
    return moveTab(root, sourceGroupId, targetGroupId, tabId);
  }

  const cloned = cloneTree(root);
  const sourceNode = findNode(cloned, sourceGroupId);
  const targetNode = findNode(cloned, targetGroupId);

  if (
    !sourceNode ||
    !targetNode ||
    sourceNode.type !== 'tabGroup' ||
    targetNode.type !== 'tabGroup'
  ) {
    return root;
  }

  // Remove tab from source
  const sIdx = sourceNode.tabs.indexOf(tabId);
  if (sIdx !== -1) {
    sourceNode.tabs.splice(sIdx, 1);
    if (sourceNode.activeTab === tabId) {
      sourceNode.activeTab = sourceNode.tabs[Math.max(0, sIdx - 1)] || '';
    }
  }

  // Create new TabGroup node for the dropped tab
  const newGroupNode: TabGroupNode = {
    id: generateNodeId('group'),
    type: 'tabGroup',
    tabs: [tabId],
    activeTab: tabId,
  };

  const isHorizontal = position === 'left' || position === 'right';
  const splitDirection: SplitDirection = isHorizontal ? 'horizontal' : 'vertical';
  const isBefore = position === 'left' || position === 'top';

  // Find parent of target node
  const parentInfo = findParent(cloned, targetGroupId);

  if (parentInfo && parentInfo.parent.direction === splitDirection) {
    // Can insert into existing parent SplitNode directly!
    const { parent, index } = parentInfo;
    const insertIdx = isBefore ? index : index + 1;
    parent.children.splice(insertIdx, 0, newGroupNode);

    // Rebalance sizes
    const count = parent.children.length;
    parent.sizes = parent.children.map(() => Math.round(100 / count));
  } else {
    // Create new SplitNode replacing targetNode in place
    const replacementSplit: SplitNode = {
      id: generateNodeId('split'),
      type: 'split',
      direction: splitDirection,
      children: isBefore ? [newGroupNode, targetNode] : [targetNode, newGroupNode],
      sizes: [50, 50],
    };

    if (parentInfo) {
      parentInfo.parent.children[parentInfo.index] = replacementSplit;
    } else {
      // Target was root node!
      const cleaned = cleanTree(replacementSplit);
      return cleaned || replacementSplit;
    }
  }

  const cleaned = cleanTree(cloned);
  return cleaned || root;
}

/** Resizes a split node's children sizes. */
export function resizeSplitNode(
  root: LayoutNode,
  splitId: string,
  newSizes: number[]
): LayoutNode {
  const cloned = cloneTree(root);
  const target = findNode(cloned, splitId);
  if (target && target.type === 'split') {
    target.sizes = [...newSizes];
  }
  return cloned;
}

/** Collects all tab IDs present across the entire tree. */
export function getAllOpenTabIds(root: LayoutNode): string[] {
  if (root.type === 'tabGroup') {
    return [...root.tabs];
  }
  return root.children.flatMap(getAllOpenTabIds);
}

/** Serializes a layout tree to JSON. */
export function serializeLayout(root: LayoutNode): string {
  return JSON.stringify(root);
}

/** Creates a single tab group layout. */
export function createSingleGroupLayout(
  tabs: string[],
  activeTab?: string
): LayoutNode {
  return {
    id: generateNodeId('group-main'),
    type: 'tabGroup',
    tabs: [...tabs],
    activeTab: activeTab ?? tabs[0] ?? '',
  };
}

/** Creates a 2-column horizontal split layout. */
export function createDualHorizontalLayout(
  leftTabs: string[],
  rightTabs: string[],
  sizes: number[] = [50, 50]
): LayoutNode {
  return {
    id: generateNodeId('split-h'),
    type: 'split',
    direction: 'horizontal',
    sizes,
    children: [
      {
        id: generateNodeId('group-left'),
        type: 'tabGroup',
        tabs: [...leftTabs],
        activeTab: leftTabs[0] ?? '',
      },
      {
        id: generateNodeId('group-right'),
        type: 'tabGroup',
        tabs: [...rightTabs],
        activeTab: rightTabs[0] ?? '',
      },
    ],
  };
}

/** Creates a 2-row vertical split layout. */
export function createDualVerticalLayout(
  topTabs: string[],
  bottomTabs: string[],
  sizes: number[] = [50, 50]
): LayoutNode {
  return {
    id: generateNodeId('split-v'),
    type: 'split',
    direction: 'vertical',
    sizes,
    children: [
      {
        id: generateNodeId('group-top'),
        type: 'tabGroup',
        tabs: [...topTabs],
        activeTab: topTabs[0] ?? '',
      },
      {
        id: generateNodeId('group-bottom'),
        type: 'tabGroup',
        tabs: [...bottomTabs],
        activeTab: bottomTabs[0] ?? '',
      },
    ],
  };
}

/** Creates a classic 4-pane IDE Quad layout (Top-Left, Bottom-Left, Top-Right, Bottom-Right). */
export function createQuadLayout(
  topLeft: string[],
  bottomLeft: string[],
  topRight: string[],
  bottomRight: string[],
  horizontalSizes: number[] = [45, 55],
  leftVerticalSizes: number[] = [40, 60],
  rightVerticalSizes: number[] = [45, 55]
): LayoutNode {
  return {
    id: generateNodeId('split-root'),
    type: 'split',
    direction: 'horizontal',
    sizes: horizontalSizes,
    children: [
      {
        id: generateNodeId('split-left'),
        type: 'split',
        direction: 'vertical',
        sizes: leftVerticalSizes,
        children: [
          {
            id: generateNodeId('group-top-left'),
            type: 'tabGroup',
            tabs: [...topLeft],
            activeTab: topLeft[0] ?? '',
          },
          {
            id: generateNodeId('group-bottom-left'),
            type: 'tabGroup',
            tabs: [...bottomLeft],
            activeTab: bottomLeft[0] ?? '',
          },
        ],
      },
      {
        id: generateNodeId('split-right'),
        type: 'split',
        direction: 'vertical',
        sizes: rightVerticalSizes,
        children: [
          {
            id: generateNodeId('group-top-right'),
            type: 'tabGroup',
            tabs: [...topRight],
            activeTab: topRight[0] ?? '',
          },
          {
            id: generateNodeId('group-bottom-right'),
            type: 'tabGroup',
            tabs: [...bottomRight],
            activeTab: bottomRight[0] ?? '',
          },
        ],
      },
    ],
  };
}

/** Deserializes and validates a layout tree from JSON. */
export function deserializeLayout(
  json: string,
  validTabIds?: string[],
  fallback?: LayoutNode
): LayoutNode | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && (parsed.type === 'split' || parsed.type === 'tabGroup')) {
      const cleaned = cleanTree(parsed);
      if (cleaned) {
        if (validTabIds && validTabIds.length > 0) {
          const openTabs = getAllOpenTabIds(cleaned);
          const hasValid = openTabs.some((t) => validTabIds.includes(t));
          if (hasValid) {
            return cleaned;
          }
        } else {
          return cleaned;
        }
      }
    }
  } catch {
    // Ignore invalid stored layout
  }
  return fallback ?? null;
}

/** Finds the first TabGroup node in the layout tree. */
export function findFirstTabGroup(
  root: LayoutNode,
  preferredGroupId?: string | null
): TabGroupNode | null {
  if (preferredGroupId) {
    const found = findNode(root, preferredGroupId);
    if (found && found.type === 'tabGroup') return found;
  }
  if (root.type === 'tabGroup') {
    return root;
  }
  for (const child of root.children) {
    const res = findFirstTabGroup(child);
    if (res) return res;
  }
  return null;
}

/** Switches to the next tab in the target (or first) tab group. */
export function switchNextTab(
  root: LayoutNode,
  targetGroupId?: string | null
): LayoutNode {
  const cloned = cloneTree(root);
  const group = findFirstTabGroup(cloned, targetGroupId);
  if (group && group.tabs.length > 1) {
    const idx = group.tabs.indexOf(group.activeTab);
    const nextIdx = idx === -1 ? 0 : (idx + 1) % group.tabs.length;
    group.activeTab = group.tabs[nextIdx] ?? group.activeTab;
  }
  return cloned;
}

/** Switches to the previous tab in the target (or first) tab group. */
export function switchPrevTab(
  root: LayoutNode,
  targetGroupId?: string | null
): LayoutNode {
  const cloned = cloneTree(root);
  const group = findFirstTabGroup(cloned, targetGroupId);
  if (group && group.tabs.length > 1) {
    const idx = group.tabs.indexOf(group.activeTab);
    const prevIdx =
      idx === -1 ? 0 : (idx - 1 + group.tabs.length) % group.tabs.length;
    group.activeTab = group.tabs[prevIdx] ?? group.activeTab;
  }
  return cloned;
}

/** Switches to a tab by index (0..8, or -1 for last tab). */
export function switchToTabIndex(
  root: LayoutNode,
  index: number,
  targetGroupId?: string | null
): LayoutNode {
  const cloned = cloneTree(root);
  const group = findFirstTabGroup(cloned, targetGroupId);
  if (group && group.tabs.length > 0) {
    if (index === -1 || index >= group.tabs.length) {
      group.activeTab = group.tabs[group.tabs.length - 1] ?? group.activeTab;
    } else if (index >= 0 && index < group.tabs.length) {
      group.activeTab = group.tabs[index] ?? group.activeTab;
    }
  }
  return cloned;
}

/** Closes the active tab in the target (or first) tab group. */
export function closeActiveTab(
  root: LayoutNode,
  targetGroupId?: string | null
): { newLayout: LayoutNode | null; closedTabId: string | null } {
  const group = findFirstTabGroup(root, targetGroupId);
  if (!group || !group.activeTab) {
    return { newLayout: root, closedTabId: null };
  }
  const closedId = group.activeTab;
  const newTree = closeTab(root, group.id, closedId);
  return { newLayout: newTree, closedTabId: closedId };
}

