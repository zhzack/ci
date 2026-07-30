import React from "react";
import { useState } from 'react';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { TableToolbar } from '@/components/TableToolbar';
import { SearchBar } from '@/components/SearchBar';
import { StatusTag } from '@/components/StatusTag';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useDebounce } from '@/hooks/useDebounce';
import { dashboardSummary } from '@/api/dashboard';
import type { PipelineRun } from '@/types/run';

export default function TaskHistoryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const debounced = useDebounce(keyword, 300);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['task-history'],
    dashboardSummary,
    { refetchInterval: 5_000 },
  );

  const filtered = (data?.recent_runs ?? []).filter((run) => {
    if (!debounced.trim()) {
      return true;
    }
    const needle = debounced.toLowerCase();
    return (
      run.pipeline_name.toLowerCase().includes(needle) ||
      run.status.toLowerCase().includes(needle)
    );
  });

  const columns: ColumnsType<PipelineRun> = [
    {
      title: 'Run',
      dataIndex: 'id',
      render: (value: string, record) => (
        <a
          onClick={(event) => {
            event.preventDefault();
            navigate(`/task/${record.id}`);
          }}
          href={`/task/${record.id}`}
        >
          {value.slice(0, 8)}
        </a>
      ),
    },
    { title: 'Pipeline', dataIndex: 'pipeline_name' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => <StatusTag status={value} />,
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (value: string) => new Date(value).toLocaleString(),
    },
  ];

  return (
    <>
      <PageHeader
        title="Task history"
        description="Recent runs"
      />
      <div className="app-content-card">
        <TableToolbar
          left={<SearchBar value={keyword} onChange={setKeyword} placeholder="Search by pipeline or status" />}
        />
        {isLoading ? (
          <Loading rows={6} />
        ) : error ? (
          <ErrorAlert error={error} onRetry={() => refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState description="No runs recorded yet" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 10 }}
          />
        )}
      </div>
    </>
  );
}
