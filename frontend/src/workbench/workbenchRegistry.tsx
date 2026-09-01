import React, { lazy, Suspense } from 'react';
import {
  AppstoreOutlined,
  BranchesOutlined,
  ClockCircleOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DesktopOutlined,
  HistoryOutlined,
  InboxOutlined,
  KeyOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { TabItemConfig } from '@/components/dock';
import { Loading } from '@/components/Loading';
import type { DynamicTabParam } from './workbenchStore';

// Lazy load actual pages
const DashboardPage = lazy(() => import('@/pages/dashboard'));
const PluginListPage = lazy(() => import('@/pages/plugin/PluginListPage'));
const PluginRegisterPage = lazy(() => import('@/pages/plugin/PluginRegisterPage'));
const PluginDetailPage = lazy(() => import('@/pages/plugin/PluginDetailPage'));
const PipelineListPage = lazy(() => import('@/pages/pipeline/PipelineListPage'));
const PipelineCreatePage = lazy(() => import('@/pages/pipeline/PipelineCreatePage'));
const PipelineVisualEditorPage = lazy(
  () => import('@/pages/pipeline/PipelineVisualEditorPage')
);
const PipelineDetailPage = lazy(() => import('@/pages/pipeline/PipelineDetailPage'));
const PipelineHistoryPage = lazy(() => import('@/pages/pipeline/PipelineHistoryPage'));
const TaskRunningPage = lazy(() => import('@/pages/task/TaskRunningPage'));
const TaskHistoryPage = lazy(() => import('@/pages/task/TaskHistoryPage'));
const TaskDetailPage = lazy(() => import('@/pages/task/TaskDetailPage'));
const MachinesPage = lazy(() => import('@/pages/machine/MachinesPage'));
const MachineConsoleTabModule = lazy(() => import('@/pages/machine/MachineConsoleDrawer').then(m => ({ default: m.MachineConsoleTab })));
const StorePage = lazy(() => import('@/pages/store/StorePage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const ArtifactPage = lazy(() => import('@/pages/artifact/ArtifactPage'));
const CredentialPage = lazy(() => import('@/pages/credential/CredentialPage'));
const SettingPage = lazy(() => import('@/pages/setting/SettingPage'));

function wrapPage(Component: React.ComponentType): React.ReactNode {
  return (
    <div style={{ height: '100%', width: '100%', overflow: 'auto', padding: '16px' }}>
      <Suspense fallback={<Loading rows={6} />}>
        <Component />
      </Suspense>
    </div>
  );
}

export interface WorkbenchModuleMeta {
  id: string;
  title: string;
  category: 'plugin' | 'pipeline' | 'machine' | 'task' | 'system';
  icon: React.ReactNode;
  closable?: boolean;
}

export const WORKBENCH_CATALOG: WorkbenchModuleMeta[] = [
  {
    id: 'plugin-register',
    title: '注册插件 (Register Plugin)',
    category: 'plugin',
    icon: <PlusCircleOutlined style={{ color: '#13c2c2' }} />,
    closable: true,
  },
  {
    id: 'plugin-list',
    title: '插件列表 (Plugins)',
    category: 'plugin',
    icon: <AppstoreOutlined style={{ color: '#1890ff' }} />,
    closable: true,
  },
  {
    id: 'plugin-store',
    title: '插件市场 (Plugin Store)',
    category: 'plugin',
    icon: <ShopOutlined style={{ color: '#722ed1' }} />,
    closable: true,
  },
  {
    id: 'pipeline-visual',
    title: '编写流水线 (Visual Pipeline Editor)',
    category: 'pipeline',
    icon: <BranchesOutlined style={{ color: '#52c41a' }} />,
    closable: true,
  },
  {
    id: 'pipeline-list',
    title: '流水线列表 (Pipelines)',
    category: 'pipeline',
    icon: <ClusterOutlined style={{ color: '#fa8c16' }} />,
    closable: true,
  },
  {
    id: 'pipeline-create',
    title: '新建流水线 (New Pipeline)',
    category: 'pipeline',
    icon: <PlusOutlined style={{ color: '#eb2f96' }} />,
    closable: true,
  },
  {
    id: 'pipeline-history',
    title: '流水线历史 (Pipeline History)',
    category: 'pipeline',
    icon: <HistoryOutlined style={{ color: '#faad14' }} />,
    closable: true,
  },
  {
    id: 'machines',
    title: '计算节点与控制台 (Machines & Environments)',
    category: 'machine',
    icon: <DesktopOutlined style={{ color: '#2f54eb' }} />,
    closable: true,
  },
  {
    id: 'task-running',
    title: '任务实时监控 (Task Monitor)',
    category: 'task',
    icon: <ThunderboltOutlined style={{ color: '#fa541c' }} />,
    closable: true,
  },
  {
    id: 'task-history',
    title: '任务历史 (Task History)',
    category: 'task',
    icon: <ClockCircleOutlined style={{ color: '#13c2c2' }} />,
    closable: true,
  },
  {
    id: 'artifacts',
    title: '产物管理 (Artifacts)',
    category: 'system',
    icon: <InboxOutlined style={{ color: '#fa8c16' }} />,
    closable: true,
  },
  {
    id: 'credential',
    title: '凭证与密钥中心 (Credentials Vault)',
    category: 'system',
    icon: <KeyOutlined style={{ color: '#1677ff' }} />,
    closable: true,
  },
  {
    id: 'dashboard',
    title: '仪表盘概览 (Dashboard)',
    category: 'system',
    icon: <DashboardOutlined style={{ color: '#1890ff' }} />,
    closable: true,
  },
  {
    id: 'admin',
    title: '用户与权限管理 (Admin)',
    category: 'system',
    icon: <TeamOutlined style={{ color: '#722ed1' }} />,
    closable: true,
  },
  {
    id: 'settings',
    title: '系统与个人设置 (Settings)',
    category: 'system',
    icon: <SettingOutlined style={{ color: '#8c8c8c' }} />,
    closable: true,
  },
];

/** Constructs the full TabItemConfig registry for static and dynamic tabs */
export function buildWorkbenchTabRegistry(
  openTabIds: string[],
  dynamicTabs: Record<string, DynamicTabParam> = {}
): Record<string, TabItemConfig> {
  const registry: Record<string, TabItemConfig> = {
    dashboard: {
      id: 'dashboard',
      title: '仪表盘概览',
      icon: <DashboardOutlined style={{ color: '#1890ff' }} />,
      closable: true,
      content: wrapPage(DashboardPage),
    },
    'plugin-register': {
      id: 'plugin-register',
      title: '注册插件',
      icon: <PlusCircleOutlined style={{ color: '#13c2c2' }} />,
      closable: true,
      content: wrapPage(PluginRegisterPage),
    },
    'plugin-list': {
      id: 'plugin-list',
      title: '插件列表',
      icon: <AppstoreOutlined style={{ color: '#1890ff' }} />,
      closable: true,
      content: wrapPage(PluginListPage),
    },
    'plugin-store': {
      id: 'plugin-store',
      title: '插件市场',
      icon: <ShopOutlined style={{ color: '#722ed1' }} />,
      closable: true,
      content: wrapPage(StorePage),
    },
    'pipeline-visual': {
      id: 'pipeline-visual',
      title: '编写流水线 (可视化)',
      icon: <BranchesOutlined style={{ color: '#52c41a' }} />,
      closable: true,
      content: wrapPage(PipelineVisualEditorPage),
    },
    'pipeline-list': {
      id: 'pipeline-list',
      title: '流水线列表',
      icon: <ClusterOutlined style={{ color: '#fa8c16' }} />,
      closable: true,
      content: wrapPage(PipelineListPage),
    },
    'pipeline-create': {
      id: 'pipeline-create',
      title: '新建流水线',
      icon: <PlusOutlined style={{ color: '#eb2f96' }} />,
      closable: true,
      content: wrapPage(PipelineCreatePage),
    },
    'pipeline-history': {
      id: 'pipeline-history',
      title: '流水线历史',
      icon: <HistoryOutlined style={{ color: '#faad14' }} />,
      closable: true,
      content: wrapPage(PipelineHistoryPage),
    },
    machines: {
      id: 'machines',
      title: '计算节点与控制台',
      icon: <DesktopOutlined style={{ color: '#2f54eb' }} />,
      closable: true,
      content: wrapPage(MachinesPage),
    },
    'task-running': {
      id: 'task-running',
      title: '任务实时监控',
      icon: <ThunderboltOutlined style={{ color: '#fa541c' }} />,
      closable: true,
      content: wrapPage(TaskRunningPage),
    },
    'task-history': {
      id: 'task-history',
      title: '任务历史',
      icon: <ClockCircleOutlined style={{ color: '#13c2c2' }} />,
      closable: true,
      content: wrapPage(TaskHistoryPage),
    },
    artifacts: {
      id: 'artifacts',
      title: '产物管理',
      icon: <InboxOutlined style={{ color: '#fa8c16' }} />,
      closable: true,
      content: wrapPage(ArtifactPage),
    },
    credential: {
      id: 'credential',
      title: '凭证与密钥中心',
      icon: <KeyOutlined style={{ color: '#1677ff' }} />,
      closable: true,
      content: wrapPage(CredentialPage),
    },
    admin: {
      id: 'admin',
      title: '用户与权限管理',
      icon: <TeamOutlined style={{ color: '#722ed1' }} />,
      closable: true,
      content: wrapPage(AdminPage),
    },
    settings: {
      id: 'settings',
      title: '系统与个人设置',
      icon: <SettingOutlined style={{ color: '#8c8c8c' }} />,
      closable: true,
      content: wrapPage(SettingPage),
    },
  };

  // Handle dynamic tabs
  for (const tabId of openTabIds) {
    if (registry[tabId]) continue;

    if (tabId.startsWith('task-detail:')) {
      registry[tabId] = {
        id: tabId,
        title: `任务详情: ${tabId.replace('task-detail:', '')}`,
        icon: <ThunderboltOutlined style={{ color: '#fa541c' }} />,
        closable: true,
        content: wrapPage(TaskDetailPage),
      };
    } else if (tabId.startsWith('pipeline-detail:')) {
      registry[tabId] = {
        id: tabId,
        title: `流水线: ${tabId.replace('pipeline-detail:', '')}`,
        icon: <ClusterOutlined style={{ color: '#fa8c16' }} />,
        closable: true,
        content: wrapPage(PipelineDetailPage),
      };
    } else if (tabId.startsWith('plugin-detail:')) {
      registry[tabId] = {
        id: tabId,
        title: `插件详情: ${tabId.replace('plugin-detail:', '')}`,
        icon: <AppstoreOutlined style={{ color: '#1890ff' }} />,
        closable: true,
        content: wrapPage(PluginDetailPage),
      };
    } else if (tabId.startsWith('machine-console:')) {
      const info = dynamicTabs[tabId];
      const machineId = tabId.replace('machine-console:', '');
      const machineName = (info?.props?.machineName as string) ?? machineId;
      const connectionType = (info?.props?.connectionType as string) ?? 'agent';
      registry[tabId] = {
        id: tabId,
        title: `控制台: ${machineName}`,
        icon: <DesktopOutlined style={{ color: '#1677ff' }} />,
        closable: true,
        content: (
          <div style={{ height: '100%', width: '100%', overflow: 'hidden' }}>
            <Suspense fallback={<Loading rows={6} />}>
              <MachineConsoleTabModule
                machineId={machineId}
                machineName={machineName}
                connectionType={connectionType}
              />
            </Suspense>
          </div>
        ),
      };
    }
  }

  return registry;
}
