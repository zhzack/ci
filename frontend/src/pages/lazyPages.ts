/**
 * Single source of lazily loaded page components.
 *
 * Both the URL router (`router/index.tsx`) and the workbench tab registry
 * (`workbench/workbenchRegistry.tsx`) must render the same pages; importing
 * from here guarantees a new page only needs one lazy declaration.
 */
import { lazy } from 'react';

export const lazyPages = {
  LoginPage: lazy(() => import('@/pages/auth/LoginPage')),
  RegisterPage: lazy(() => import('@/pages/auth/RegisterPage')),
  DashboardPage: lazy(() => import('@/pages/dashboard')),
  PluginListPage: lazy(() => import('@/pages/plugin/PluginListPage')),
  PluginRegisterPage: lazy(() => import('@/pages/plugin/PluginRegisterPage')),
  PluginDetailPage: lazy(() => import('@/pages/plugin/PluginDetailPage')),
  PipelineListPage: lazy(() => import('@/pages/pipeline/PipelineListPage')),
  PipelineCreatePage: lazy(() => import('@/pages/pipeline/PipelineCreatePage')),
  PipelineVisualEditorPage: lazy(
    () => import('@/pages/pipeline/PipelineVisualEditorPage'),
  ),
  PipelineDetailPage: lazy(() => import('@/pages/pipeline/PipelineDetailPage')),
  PipelineHistoryPage: lazy(() => import('@/pages/pipeline/PipelineHistoryPage')),
  TaskRunningPage: lazy(() => import('@/pages/task/TaskRunningPage')),
  TaskHistoryPage: lazy(() => import('@/pages/task/TaskHistoryPage')),
  TaskDetailPage: lazy(() => import('@/pages/task/TaskDetailPage')),
  MachinesPage: lazy(() => import('@/pages/machine/MachinesPage')),
  MachineConsoleTab: lazy(
    () =>
      import('@/pages/machine/MachineConsoleDrawer').then((m) => ({
        default: m.MachineConsoleTab,
      })),
  ),
  StorePage: lazy(() => import('@/pages/store/StorePage')),
  AdminPage: lazy(() => import('@/pages/admin/AdminPage')),
  ArtifactPage: lazy(() => import('@/pages/artifact/ArtifactPage')),
  CredentialPage: lazy(() => import('@/pages/credential/CredentialPage')),
  ShareImportPage: lazy(
    () =>
      import('@/pages/artifact/ShareImportPage').then((m) => ({
        default: m.ShareImportPage,
      })),
  ),
  SettingPage: lazy(() => import('@/pages/setting/SettingPage')),
} as const;
