import React from "react";
import { Empty } from 'antd';

type Props = {
  description?: string;
  children?: React.ReactNode;
};

export function EmptyState({ description, children }: Props): React.JSX.Element {
  return (
    <Empty description={description ?? 'No data'}>
      {children ?? null}
    </Empty>
  );
}
