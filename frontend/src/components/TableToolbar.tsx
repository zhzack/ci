import React from "react";
import { Space } from 'antd';

type Props = {
  left?: React.ReactNode;
  right?: React.ReactNode;
};

export function TableToolbar({ left, right }: Props): React.JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <Space>{left}</Space>
      </div>
      <div className="toolbar-right">
        <Space>{right}</Space>
      </div>
    </div>
  );
}
