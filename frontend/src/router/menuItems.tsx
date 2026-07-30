import React from "react";
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ApartmentOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';

export type MenuEntry = {
  key: string;
  path: string;
  label: string;
  icon: React.ReactNode;
  children?: MenuEntry[];
};

export const MENU_ITEMS: MenuEntry[] = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: <AppstoreOutlined /> },
  {
    key: 'plugin',
    path: '/plugin',
    label: 'Plugin',
    icon: <CodeOutlined />,
    children: [
      { key: 'plugin-list', path: '/plugin/list', label: 'List', icon: <DatabaseOutlined /> },
      { key: 'plugin-register', path: '/plugin/register', label: 'Register', icon: <FileTextOutlined /> },
    ],
  },
  {
    key: 'pipeline',
    path: '/pipeline',
    label: 'Pipeline',
    icon: <ApartmentOutlined />,
    children: [
      { key: 'pipeline-list', path: '/pipeline/list', label: 'List', icon: <DatabaseOutlined /> },
      { key: 'pipeline-create', path: '/pipeline/create', label: 'Create', icon: <FileTextOutlined /> },
      { key: 'pipeline-visual', path: '/pipeline/visual', label: 'Visual editor', icon: <CodeOutlined /> },
      { key: 'pipeline-history', path: '/pipeline/history', label: 'History', icon: <HistoryOutlined /> },
    ],
  },
  {
    key: 'task',
    path: '/task',
    label: 'Task',
    icon: <PlayCircleOutlined />,
    children: [
      { key: 'task-running', path: '/task/running', label: 'Running', icon: <PlayCircleOutlined /> },
      { key: 'task-history', path: '/task/history', label: 'History', icon: <HistoryOutlined /> },
    ],
  },
  { key: 'artifact', path: '/artifact', label: 'Artifact', icon: <FileTextOutlined /> },
  { key: 'setting', path: '/setting', label: 'Setting', icon: <SettingOutlined /> },
];

export function toAntdMenu(items: MenuEntry[]): MenuProps['items'] {
  return items.map((item) => {
    if (item.children && item.children.length > 0) {
      return {
        key: item.path,
        icon: item.icon,
        label: item.label,
        children: toAntdMenu(item.children),
      };
    }
    return {
      key: item.path,
      icon: item.icon,
      label: item.label,
    };
  });
}
