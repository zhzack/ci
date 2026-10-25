import { Suspense } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import { Loading } from '@/components/Loading';
import { MainLayout } from '@/layouts/MainLayout';
import { RouterErrorElement } from '@/components/RouteErrorBoundary';
import { AuthGate } from '@/router/AuthGate';
import React from 'react';

import { lazyPages } from '@/pages/lazyPages';

const {
  LoginPage,
  RegisterPage,
  DashboardPage,
  PluginListPage,
  PluginRegisterPage,
  PluginDetailPage,
  PipelineListPage,
  PipelineCreatePage,
  PipelineVisualEditorPage,
  PipelineDetailPage,
  PipelineHistoryPage,
  TaskRunningPage,
  TaskHistoryPage,
  TaskDetailPage,
  MachinesPage: MachinePage,
  StorePage,
  AdminPage,
  ArtifactPage,
  CredentialPage,
  ShareImportPage,
  SettingPage,
} = lazyPages;

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
      { path: 'credential', element: withSuspense(<CredentialPage />), handle: breadcrumb('Credentials') },
      { path: 'credentials', element: <Navigate to="/credential" replace /> },
      { path: 'admin', element: withSuspense(<AdminPage />), handle: breadcrumb('Admin') },
      { path: 'setting', element: withSuspense(<SettingPage />), handle: breadcrumb('Setting') },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
