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
import type { StatusValue } from '@/types/common';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useDebounce } from '@/hooks/useDebounce';
import { listRuns } from '@/api/run';
import type { RunSummary } from '@/types/run';

const PAGE_SIZE = 10;

export default function TaskHistoryPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(keyword, 300);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['runs', 'history', { page, pipeline: debounced }],
    () => listRuns({ page, page_size: PAGE_SIZE, pipeline: debounced || undefined }),
    { refetchInterval: 5_000 },
  );

  const filtered = data?.items ?? [];

  const columns: ColumnsType<RunSummary> = [
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
      render: (value: StatusValue) => <StatusTag status={value} />,
    },
    {
      title: 'Tasks',
      dataIndex: 'task_count',
      render: (value: number, record) =>
        record.failed_tasks > 0 ? `${value} (${record.failed_tasks} failed)` : value,
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
          left={
            <SearchBar
              value={keyword}
              onChange={(value) => {
                setKeyword(value);
                setPage(1);
              }}
              placeholder="Search by pipeline"
            />
          }
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
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total: data?.total ?? 0,
              showSizeChanger: false,
              onChange: (next) => setPage(next),
            }}
          />
        )}
      </div>
    </>
  );
}
