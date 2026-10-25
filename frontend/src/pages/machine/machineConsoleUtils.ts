/**
 * Pure helpers and constants for the machine console.
 *
 * Extracted from MachineConsoleDrawer so the dock-layout, file-tree and
 * path semantics can be reasoned about (and tested) without mounting the
 * 2000+ line component.
 */
import type { TreeDataNode } from 'antd';

import type { LayoutNode } from '@/components/dock/types';

export const ALL_CORE_TABS = ['files', 'terminal', 'processes', 'network', 'overview'];

// Default 4-Quadrant IDE Layout: 左上系统全景, 左下进程与网络, 右上在线终端, 右下远程文件
export const DEFAULT_IDE_LAYOUT: LayoutNode = {
  id: 'root-split',
  type: 'split',
  direction: 'horizontal',
  sizes: [42, 58],
  children: [
    {
      id: 'left-split',
      type: 'split',
      direction: 'vertical',
      sizes: [45, 55],
      children: [
        {
          id: 'overview-group',
          type: 'tabGroup',
          tabs: ['overview'],
          activeTab: 'overview',
        },
        {
          id: 'proc-group',
          type: 'tabGroup',
          tabs: ['processes', 'network'],
          activeTab: 'processes',
        },
      ],
    },
    {
      id: 'right-split',
      type: 'split',
      direction: 'vertical',
      sizes: [52, 48],
      children: [
        {
          id: 'term-group',
          type: 'tabGroup',
          tabs: ['terminal'],
          activeTab: 'terminal',
        },
        {
          id: 'files-group',
          type: 'tabGroup',
          tabs: ['files'],
          activeTab: 'files',
        },
      ],
    },
  ],
};

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 秒';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (mins > 0) parts.push(`${mins}分`);
  if (parts.length === 0 || secs > 0) parts.push(`${secs}秒`);
  return parts.join(' ');
}

// Normalize directory path across Windows and Linux
export const normalizePath = (p: string): string => {
  if (!p) return '/';
  let s = p.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (/^[a-zA-Z]:$/.test(s)) {
    return s + '/';
  }
  if (/^[a-zA-Z]:\/$/.test(s)) {
    return s;
  }
  if (s.length > 1 && s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
};

// Get all ancestor paths leading to targetPath
export const getPathAncestors = (targetPath: string): string[] => {
  const norm = normalizePath(targetPath);
  if (norm === '/' || norm === 'C:/' || norm === 'D:/') {
    return [norm];
  }
  const isWin = /^[a-zA-Z]:/.test(norm);
  const prefix = isWin ? norm.substring(0, 3) : '/'; // 'C:/' or '/'
  const rest = isWin ? norm.substring(3) : norm.substring(1);
  const parts = rest.split('/').filter(Boolean);

  const result: string[] = [prefix];
  let cur = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  for (const part of parts) {
    cur = `${cur}/${part}`;
    result.push(cur);
  }
  return result;
};

// Recursively merge tree nodes and their children while preserving sibling nodes
export const mergeTreeNodes = (
  nodes: TreeDataNode[],
  targetKey: string,
  newChildren: TreeDataNode[]
): TreeDataNode[] => {
  const normTarget = normalizePath(targetKey);
  return nodes.map((node) => {
    const normNodeKey = normalizePath(node.key as string);
    if (normNodeKey === normTarget) {
      const existingMap = new Map<string, TreeDataNode>();
      (node.children || []).forEach((c) =>
        existingMap.set(normalizePath(c.key as string), c)
      );

      newChildren.forEach((child) => {
        const childKey = normalizePath(child.key as string);
        const existing = existingMap.get(childKey);
        if (existing) {
          existingMap.set(childKey, {
            ...existing,
            ...child,
            children:
              child.children && child.children.length > 0
                ? child.children
                : existing.children,
          });
        } else {
          existingMap.set(childKey, child);
        }
      });

      return {
        ...node,
        children: Array.from(existingMap.values()),
      };
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: mergeTreeNodes(node.children, targetKey, newChildren),
      };
    }
    return node;
  });
};
