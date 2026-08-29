import React from "react";
import { Tag } from 'antd';
import type { StatusValue } from '@/types/common';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'default',
  READY: 'cyan',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  SKIPPED: 'warning',
  CANCELLED: 'default',
  INSTALLING: 'blue',
};

type Props = {
  status: StatusValue;
};

export function StatusTag({ status }: Props): React.JSX.Element {
  const color = STATUS_COLORS[status] ?? 'default';
  return <Tag color={color}>{status}</Tag>;
}
