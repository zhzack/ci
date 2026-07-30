import React from "react";
import { ConfigProvider, App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { antdTheme } from '@/styles/theme';
import { router } from '@/router';
import { ApiAntdBridge } from '@/components/ApiAntdBridge';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

export function App(): React.JSX.Element {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <ApiAntdBridge>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ApiAntdBridge>
      </AntApp>
    </ConfigProvider>
  );
}
