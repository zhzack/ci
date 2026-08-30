import React, { createContext, useContext, useRef, useState } from 'react';
import type {
  DockContextType,
  DraggingTabState,
  DropPosition,
  LayoutNode,
  SplitNode,
  TabItemConfig,
} from './types';
import {
  closeAllTabs,
  closeOtherTabs,
  closeRightTabs,
  closeTab,
  moveTab,
  resizeSplitNode,
  selectTab,
  splitTab,
} from './dockEngine';
import { DockTabGroup } from './DockTabGroup';

interface DockLayoutProps {
  layout: LayoutNode;
  tabRegistry: Record<string, TabItemConfig>;
  onChange: (newLayout: LayoutNode) => void;
}

const DockContext = createContext<DockContextType | null>(null);

export function DockLayout({
  layout,
  tabRegistry,
  onChange,
}: DockLayoutProps): React.JSX.Element {
  const [activeDrag, setActiveDrag] = useState<DraggingTabState | null>(null);

  const contextValue: DockContextType = {
    tabRegistry,
    activeDrag,
    setActiveDrag,
    onTabSelect: (groupId, tabId) => {
      const updated = selectTab(layout, groupId, tabId);
      onChange(updated);
    },
    onTabClose: (groupId, tabId) => {
      const updated = closeTab(layout, groupId, tabId);
      if (updated) onChange(updated);
    },
    onTabCloseOthers: (groupId, tabId) => {
      const updated = closeOtherTabs(layout, groupId, tabId);
      if (updated) onChange(updated);
    },
    onTabCloseRight: (groupId, tabId) => {
      const updated = closeRightTabs(layout, groupId, tabId);
      if (updated) onChange(updated);
    },
    onTabCloseAll: (groupId) => {
      const updated = closeAllTabs(layout, groupId);
      if (updated) onChange(updated);
    },
    onTabMove: (sourceGroupId, targetGroupId, tabId, targetIndex) => {
      const updated = moveTab(layout, sourceGroupId, targetGroupId, tabId, targetIndex);
      onChange(updated);
    },
    onTabSplit: (sourceGroupId, targetGroupId, tabId, position: DropPosition) => {
      const updated = splitTab(layout, sourceGroupId, targetGroupId, tabId, position);
      onChange(updated);
    },
    onSplitResize: (splitId, _index, newSizes) => {
      const updated = resizeSplitNode(layout, splitId, newSizes);
      onChange(updated);
    },
  };

  return (
    <DockContext.Provider value={contextValue}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <DockNodeRenderer node={layout} context={contextValue} />
      </div>
    </DockContext.Provider>
  );
}

interface NodeRendererProps {
  node: LayoutNode;
  context: DockContextType;
}

function DockNodeRenderer({ node, context }: NodeRendererProps): React.JSX.Element {
  if (node.type === 'tabGroup') {
    return <DockTabGroup group={node} context={context} />;
  }

  return <SplitPaneRenderer split={node} context={context} />;
}

interface SplitPaneProps {
  split: SplitNode;
  context: DockContextType;
}

function SplitPaneRenderer({ split, context }: SplitPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHorizontal = split.direction === 'horizontal';

  const handleStartResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const totalPx = isHorizontal ? rect.width : rect.height;

    const initialSizes = [...split.sizes];
    const prevSize = initialSizes[index] || 50;
    const nextSize = initialSizes[index + 1] || 50;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
      const deltaPx = currentPos - startPos;
      const deltaPercent = (deltaPx / totalPx) * 100;

      const newPrevSize = Math.max(10, Math.min(prevSize + nextSize - 10, prevSize + deltaPercent));
      const newNextSize = Math.max(10, Math.min(prevSize + nextSize - 10, nextSize - deltaPercent));

      const newSizes = [...initialSizes];
      newSizes[index] = Math.round(newPrevSize);
      newSizes[index + 1] = Math.round(newNextSize);

      context.onSplitResize(split.id, index, newSizes);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {split.children.map((child, idx) => {
        const sizePercent = split.sizes[idx] ?? Math.round(100 / split.children.length);

        return (
          <React.Fragment key={child.id}>
            <div
              style={{
                flex: `0 0 ${sizePercent}%`,
                width: isHorizontal ? `${sizePercent}%` : '100%',
                height: isHorizontal ? '100%' : `${sizePercent}%`,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <DockNodeRenderer node={child} context={context} />
            </div>

            {/* Splitter Resizer Handle between siblings */}
            {idx < split.children.length - 1 && (
              <div
                onMouseDown={(e) => handleStartResize(idx, e)}
                style={{
                  flex: '0 0 6px',
                  cursor: isHorizontal ? 'col-resize' : 'row-resize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  userSelect: 'none',
                  zIndex: 5,
                }}
                title={isHorizontal ? '拖拽调整左右宽度' : '拖拽调整上下高度'}
              >
                <div
                  style={{
                    width: isHorizontal ? 2 : '60%',
                    height: isHorizontal ? '60%' : 2,
                    borderRadius: 1,
                    background: '#cbd5e1',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#1677ff')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#cbd5e1')}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function useDockContext(): DockContextType {
  const ctx = useContext(DockContext);
  if (!ctx) {
    throw new Error('useDockContext must be used within DockLayout');
  }
  return ctx;
}
