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
    // The algorithm restyles AntD components; the page background itself
    // lives on <body> and must be switched alongside the mode.
    document.body.style.background = mode === 'dark' ? '#0f0f0f' : '';
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
