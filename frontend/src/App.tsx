import React, { useEffect } from "react";
import { ConfigProvider, App as AntApp } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { antdThemeFor } from '@/styles/theme';
import { useThemeStore } from '@/store/theme';
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
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    // Synchronize data-theme attribute, background, and colorScheme with mode
    document.documentElement.setAttribute('data-theme', mode);
    document.body.style.background = mode === 'dark' ? '#0e1220' : '#f4f6fb';
    document.body.style.color = mode === 'dark' ? '#e6edf3' : '#1e293b';
    document.body.style.colorScheme = mode;
  }, [mode]);

  return (
    <ConfigProvider theme={antdThemeFor(mode)}>
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
