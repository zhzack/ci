import React from "react";
import { useEffect } from 'react';
import { App } from 'antd';
import { bindAntdApis } from '@/api/http';

type Props = {
  children: React.ReactNode;
};

export function ApiAntdBridge({ children }: Props): React.JSX.Element {
  const apis = App.useApp();
  useEffect(() => {
    bindAntdApis(apis);
  }, [apis]);
  return <>{children}</>;
}
