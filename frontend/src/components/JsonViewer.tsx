import React from "react";
import { useMemo } from 'react';
import { Typography } from 'antd';

type Props = {
  value: unknown;
  emptyText?: string;
};

export function JsonViewer({ value, emptyText }: Props): React.JSX.Element {
  const formatted = useMemo(() => {
    if (value === undefined || value === null) {
      return emptyText ?? '';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value, emptyText]);

  return (
    <div className="json-viewer">
      <Typography.Paragraph
        copyable={!!formatted}
        style={{ margin: 0, whiteSpace: 'pre-wrap' }}
      >
        {formatted || emptyText || '∅'}
      </Typography.Paragraph>
    </div>
  );
}
