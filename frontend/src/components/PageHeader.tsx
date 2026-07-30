import React from "react";
import { Breadcrumb, Space, Typography } from 'antd';
import type { ItemType } from 'antd/es/breadcrumb/Breadcrumb';
import { useBreadcrumbFromRoute } from '@/hooks/useBreadcrumbFromRoute';

type Props = {
  title: string;
  description?: string;
  extra?: React.ReactNode;
  breadcrumb?: ItemType[];
};

export function PageHeader({
  title,
  description,
  extra,
  breadcrumb,
}: Props): React.JSX.Element {
  const generated = useBreadcrumbFromRoute();
  const items = breadcrumb ?? generated;
  return (
    <div className="page-header">
      <Breadcrumb items={items} style={{ marginBottom: 8 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <Space direction="vertical" size={4}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {description ? (
            <Typography.Text type="secondary">{description}</Typography.Text>
          ) : null}
        </Space>
        {extra ? <div>{extra}</div> : null}
      </div>
    </div>
  );
}
