import React, { useState } from 'react';
import { Dropdown, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  CloseOutlined,
  FolderOpenOutlined,
  HolderOutlined,
  SplitCellsOutlined,
} from '@ant-design/icons';
import type {
  DockContextType,
  DropPosition,
  TabGroupNode,
} from './types';
import { useThemeStore } from '@/store/theme';

interface Props {
  group: TabGroupNode;
  context: DockContextType;
}

export function DockTabGroup({ group, context }: Props): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'dark';

  const [hoverDropPos, setHoverDropPos] = useState<DropPosition | null>(null);
  const [hoverTabIndex, setHoverTabIndex] = useState<number | null>(null);

  const {
    tabRegistry,
    activeDrag,
    setActiveDrag,
    onTabSelect,
    onTabClose,
    onTabCloseOthers,
    onTabCloseRight,
    onTabMove,
    onTabSplit,
  } = context;

  const handleBodyDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!activeDrag) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;

    // Detect 5-zone drop target
    if (xRatio < 0.2) {
      setHoverDropPos('left');
    } else if (xRatio > 0.8) {
      setHoverDropPos('right');
    } else if (yRatio < 0.2) {
      setHoverDropPos('top');
    } else if (yRatio > 0.8) {
      setHoverDropPos('bottom');
    } else {
      // Center: Merge into current tab group as peer tabs
      setHoverDropPos('center');
    }
  };

  const handleBodyDragLeave = () => {
    setHoverDropPos(null);
  };

  const handleBodyDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!activeDrag || !hoverDropPos) return;

    if (hoverDropPos === 'center') {
      onTabMove(activeDrag.sourceGroupId, group.id, activeDrag.tabId);
    } else {
      onTabSplit(activeDrag.sourceGroupId, group.id, activeDrag.tabId, hoverDropPos);
    }
    setHoverDropPos(null);
    setActiveDrag(null);
  };

  // Drop on tab bar (inserting into specific index)
  const handleTabBarDrop = (e: React.DragEvent<HTMLDivElement>, targetIdx?: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!activeDrag) return;

    onTabMove(activeDrag.sourceGroupId, group.id, activeDrag.tabId, targetIdx);
    setHoverTabIndex(null);
    setHoverDropPos(null);
    setActiveDrag(null);
  };

  // Build Context Menu items for a Tab
  const getTabContextMenu = (tabId: string): MenuProps => ({
    items: [
      {
        key: 'close',
        label: '关闭标签页',
        icon: <CloseOutlined />,
        onClick: () => onTabClose(group.id, tabId),
      },
      {
        key: 'close-others',
        label: '关闭其他标签页',
        onClick: () => onTabCloseOthers(group.id, tabId),
      },
      {
        key: 'close-right',
        label: '关闭右侧标签页',
        onClick: () => onTabCloseRight(group.id, tabId),
      },
      { type: 'divider' },
      {
        key: 'split-right',
        label: '向右拆分分栏 (Split Right)',
        icon: <SplitCellsOutlined />,
        onClick: () => onTabSplit(group.id, group.id, tabId, 'right'),
      },
      {
        key: 'split-down',
        label: '向下拆分分栏 (Split Down)',
        onClick: () => onTabSplit(group.id, group.id, tabId, 'bottom'),
      },
    ],
  });

  const activeTabConfig = tabRegistry[group.activeTab];

  // Theme token styling
  const tabGroupBg = isDark ? '#141414' : '#ffffff';
  const tabHeaderBg = isDark ? '#1f1f1f' : '#f1f5f9';
  const tabActiveBg = isDark ? '#141414' : '#ffffff';
  const tabBorder = isDark ? '#30363d' : '#e2e8f0';
  const tabText = isDark ? '#e6edf3' : '#1e293b';
  const tabActiveText = isDark ? '#58a6ff' : '#1677ff';

  // Drop Preview Overlay Styles & Texts
  const getOverlayConfig = (): { style: React.CSSProperties; label: string; icon: React.ReactNode } => {
    const base: React.CSSProperties = {
      position: 'absolute',
      background: 'rgba(22, 119, 255, 0.18)',
      border: '2px dashed #1677ff',
      borderRadius: 6,
      pointerEvents: 'none',
      zIndex: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#1677ff',
      fontWeight: 600,
      fontSize: 13,
      transition: 'all 0.1s ease',
    };

    switch (hoverDropPos) {
      case 'left':
        return {
          style: { ...base, top: 0, bottom: 0, left: 0, width: '50%' },
          label: '← 放置于左侧创建新分栏',
          icon: <SplitCellsOutlined style={{ marginRight: 6 }} />,
        };
      case 'right':
        return {
          style: { ...base, top: 0, bottom: 0, right: 0, width: '50%' },
          label: '放置于右侧创建新分栏 →',
          icon: <SplitCellsOutlined style={{ marginRight: 6 }} />,
        };
      case 'top':
        return {
          style: { ...base, top: 0, left: 0, right: 0, height: '50%' },
          label: '↑ 放置于上方创建新分栏',
          icon: <SplitCellsOutlined style={{ marginRight: 6 }} />,
        };
      case 'bottom':
        return {
          style: { ...base, bottom: 0, left: 0, right: 0, height: '50%' },
          label: '↓ 放置于下方创建新分栏',
          icon: <SplitCellsOutlined style={{ marginRight: 6 }} />,
        };
      case 'center':
      default:
        return {
          style: { ...base, top: 0, bottom: 0, left: 0, right: 0, background: 'rgba(82, 196, 26, 0.15)', borderColor: '#52c41a', color: '#52c41a' },
          label: '📑 释放以放入当前窗口作为同级标签页',
          icon: <FolderOpenOutlined style={{ marginRight: 6 }} />,
        };
    }
  };

  const overlayConfig = hoverDropPos && activeDrag ? getOverlayConfig() : null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: tabGroupBg,
        border: `1px solid ${tabBorder}`,
        borderRadius: 8,
        position: 'relative',
      }}
    >
      {/* Tab Bar Header - Directly supports dropping tabs into this bar as peers */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => handleTabBarDrop(e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          background: tabHeaderBg,
          borderBottom: `1px solid ${tabBorder}`,
          padding: '2px 4px 0 4px',
          overflowX: 'auto',
          userSelect: 'none',
          minHeight: 34,
        }}
      >
        <div style={{ display: 'flex', flex: 1, gap: 2, alignItems: 'flex-end' }}>
          {group.tabs.map((tabId, idx) => {
            const config = tabRegistry[tabId];
            if (!config) return null;
            const isActive = tabId === group.activeTab;
            const isDropTarget = hoverTabIndex === idx && activeDrag?.tabId !== tabId;

            return (
              <Dropdown
                key={tabId}
                menu={getTabContextMenu(tabId)}
                trigger={['contextMenu']}
              >
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', tabId);
                    setActiveDrag({ sourceGroupId: group.id, tabId });
                  }}
                  onDragEnd={() => {
                    setActiveDrag(null);
                    setHoverTabIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setHoverTabIndex(idx);
                  }}
                  onDragLeave={() => setHoverTabIndex(null)}
                  onDrop={(e) => handleTabBarDrop(e, idx)}
                  onClick={() => onTabSelect(group.id, tabId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '5px 12px',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? tabActiveText : tabText,
                    background: isDropTarget ? 'rgba(22, 119, 255, 0.15)' : isActive ? tabActiveBg : 'transparent',
                    borderTop: isActive ? `2px solid ${tabActiveText}` : '2px solid transparent',
                    borderLeft: isDropTarget ? '2px solid #1677ff' : isActive ? `1px solid ${tabBorder}` : '1px solid transparent',
                    borderRight: isActive ? `1px solid ${tabBorder}` : '1px solid transparent',
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Tooltip title="按住拖拽可调整同级顺序或拖到其他区域">
                    <HolderOutlined style={{ fontSize: 11, opacity: 0.5, cursor: 'grab' }} />
                  </Tooltip>
                  {config.icon}
                  <span>{config.title}</span>
                  {config.closable !== false && (
                    <CloseOutlined
                      style={{
                        fontSize: 10,
                        marginLeft: 4,
                        opacity: isActive ? 0.8 : 0.4,
                        padding: 2,
                        borderRadius: 2,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onTabClose(group.id, tabId);
                      }}
                    />
                  )}
                </div>
              </Dropdown>
            );
          })}

          {/* Empty Space Drop Indicator */}
          {activeDrag && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={(e) => handleTabBarDrop(e)}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                color: '#1677ff',
                border: '1px dashed #1677ff',
                borderRadius: 4,
                marginBottom: 2,
                cursor: 'pointer',
              }}
            >
              + 放入此处作为同级标签
            </div>
          )}
        </div>
      </div>

      {/* Tab Content Body & Drop Zone */}
      <div
        onDragOver={handleBodyDragOver}
        onDragLeave={handleBodyDragLeave}
        onDrop={handleBodyDrop}
        style={{
          flex: 1,
          height: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
      >
        {activeTabConfig ? (
          <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {activeTabConfig.content}
          </div>
        ) : (
          <div style={{ padding: 24, textAlign: 'center' }}>
            <Typography.Text type="secondary">此标签页无内容</Typography.Text>
          </div>
        )}

        {/* Drop Preview Overlay with visual feedback */}
        {overlayConfig && (
          <div style={overlayConfig.style}>
            {overlayConfig.icon}
            <span>{overlayConfig.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}
