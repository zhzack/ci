import React from "react";
import { Skeleton, Spin } from 'antd';

type Props = {
  inline?: boolean;
  rows?: number;
};

export function Loading({ inline = false, rows = 4 }: Props): React.JSX.Element {
  if (inline) {
    return <Spin />;
  }
  return <Skeleton active paragraph={{ rows }} />;
}
