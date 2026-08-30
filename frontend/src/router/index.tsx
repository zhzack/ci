import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { Loading } from '@/components/Loading';
import { MainLayout } from '@/layouts/MainLayout';
import { RouterErrorElement } from '@/components/RouteErrorBoundary';
import { AuthGate } from '@/router/AuthGate';
import React from 'react';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const DashboardPage = lazy(() => import('@/pages/dashboard'));
const PluginListPage = lazy(() => import('@/pages/plugin/PluginListPage'));
const PluginRegisterPage = lazy(() => import('@/pages/plugin/PluginRegisterPage'));
const PluginDetailPage = lazy(() => import('@/pages/plugin/PluginDetailPage'));
const PipelineListPage = lazy(() => import('@/pages/pipeline/PipelineListPage'));
const PipelineCreatePage = lazy(() => import('@/pages/pipeline/PipelineCreatePage'));
const PipelineVisualEditorPage = lazy(
  () => import('@/pages/pipeline/PipelineVisualEditorPage'),
);
const PipelineDetailPage = lazy(() => import('@/pages/pipeline/PipelineDetailPage'));
const PipelineHistoryPage = lazy(() => import('@/pages/pipeline/PipelineHistoryPage'));
const TaskRunningPage = lazy(() => import('@/pages/task/TaskRunningPage'));
const TaskHistoryPage = lazy(() => import('@/pages/task/TaskHistoryPage'));
const TaskDetailPage = lazy(() => import('@/pages/task/TaskDetailPage'));
const MachinePage = lazy(() => import('@/pages/machine/MachinesPage'));
const StorePage = lazy(() => import('@/pages/store/StorePage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const ArtifactPage = lazy(() => import('@/pages/artifact/ArtifactPage'));
const ShareImportPage = lazy(() =>
  import('@/pages/artifact/ShareImportPage').then((m) => ({ default: m.ShareImportPage })),
);
const SettingPage = lazy(() => import('@/pages/setting/SettingPage'));

const withSuspense = (element: React.JSX.Element): React.JSX.Element => (
  <Suspense fallback={<Loading rows={6} />}>{element}</Suspense>
);

const breadcrumb = (label: string) => ({ breadcrumb: label });

const routes: RouteObject[] = [
  { path: '/login', element: withSuspense(<LoginPage />) },
  { path: '/register', element: withSuspense(<RegisterPage />) },
  { path: '/share/:token', element: withSuspense(<ShareImportPage />) },
  {
    path: '/',
    element: (
      <AuthGate>
        <MainLayout />
      </AuthGate>
    ),
    errorElement: <RouterErrorElement />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: withSuspense(<DashboardPage />), handle: breadcrumb('Dashboard') },
      {
        path: 'plugin',
        handle: breadcrumb('Plugin'),
        children: [
          { index: true, element: <Navigate to="/plugin/list" replace /> },
          { path: 'list', element: withSuspense(<PluginListPage />), handle: breadcrumb('List') },
          { path: 'register', element: withSuspense(<PluginRegisterPage />), handle: breadcrumb('Register') },
          { path: ':name/:version', element: withSuspense(<PluginDetailPage />), handle: breadcrumb('Detail') },
        ],
      },
      { path: 'store', element: withSuspense(<StorePage />), handle: breadcrumb('Store') },
      {
        path: 'pipeline',
        handle: breadcrumb('Pipeline'),
        children: [
          { index: true, element: <Navigate to="/pipeline/list" replace /> },
          { path: 'list', element: withSuspense(<PipelineListPage />), handle: breadcrumb('List') },
          { path: 'create', element: withSuspense(<PipelineCreatePage />), handle: breadcrumb('Create') },
          { path: 'visual', element: withSuspense(<PipelineVisualEditorPage />), handle: breadcrumb('Visual') },
          { path: 'edit/:id', element: withSuspense(<PipelineVisualEditorPage />), handle: breadcrumb('Edit') },
          { path: 'history', element: withSuspense(<PipelineHistoryPage />), handle: breadcrumb('History') },
          { path: ':identifier', element: withSuspense(<PipelineDetailPage />), handle: breadcrumb('Detail') },
        ],
      },
      {
        path: 'task',
        handle: breadcrumb('Task'),
        children: [
          { index: true, element: <Navigate to="/task/running" replace /> },
          { path: 'running', element: withSuspense(<TaskRunningPage />), handle: breadcrumb('Running') },
          { path: 'history', element: withSuspense(<TaskHistoryPage />), handle: breadcrumb('History') },
          { path: ':runId', element: withSuspense(<TaskDetailPage />), handle: breadcrumb('Detail') },
        ],
      },
      { path: 'machine', element: withSuspense(<MachinePage />), handle: breadcrumb('Machines') },
      { path: 'artifact', element: withSuspense(<ArtifactPage />), handle: breadcrumb('Artifact') },
      { path: 'admin', element: withSuspense(<AdminPage />), handle: breadcrumb('Admin') },
      { path: 'setting', element: withSuspense(<SettingPage />), handle: breadcrumb('Setting') },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
