import React from "react";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Space, Switch, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';

type Props = {
  log: string;
  loading?: boolean;
  title?: string;
  downloadName?: string;
  height?: number;
};

const LEVEL_PATTERN = /^\s*(INFO|WARN|WARNING|ERROR|SUCCESS|FAIL)\b/;

function classify(line: string): string {
  const match = line.match(LEVEL_PATTERN);
  if (!match) {
    return '';
  }
  const token = match[1]!.toUpperCase();
  if (token === 'WARNING') {
    return 'warn';
  }
  if (token === 'FAIL') {
    return 'error';
  }
  return token.toLowerCase();
}

export function LogViewer({
  log,
  loading = false,
  title = 'Log',
  downloadName = 'log.txt',
  height = 480,
}: Props): React.JSX.Element {
  const [keyword, setKeyword] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => log.split(/\r?\n/), [log]);

  const filtered = useMemo(() => {
    if (!keyword.trim()) {
      return lines;
    }
    const needle = keyword.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, keyword]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filtered.join('\n'));
    } catch {
      // ignore clipboard failure
    }
  };

  const handleDownload = () => {
    const blob = new Blob([filtered.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-content-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Space>
          <Typography.Text strong>{title}</Typography.Text>
          <Typography.Text type="secondary">
            {loading ? 'streaming…' : `${filtered.length} lines`}
          </Typography.Text>
        </Space>
        <Space>
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Filter"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            style={{ width: 200 }}
          />
          <Switch
            size="small"
            checkedChildren="Auto"
            unCheckedChildren="Off"
            checked={autoScroll}
            onChange={setAutoScroll}
          />
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={handleCopy}
            disabled={!filtered.length}
          >
            Copy
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
            disabled={!filtered.length}
          >
            Download
          </Button>
        </Space>
      </div>
      <div
        ref={containerRef}
        className="log-viewer"
        style={{ height }}
      >
        {filtered.length === 0 ? (
          <span className="log-line">No log entries</span>
        ) : (
          filtered.map((line, index) => {
            const level = classify(line);
            const className = level ? `log-line log-line__${level}` : 'log-line';
            return (
              <span key={index} className={className}>
                {line || ' '}
                {'\n'}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
