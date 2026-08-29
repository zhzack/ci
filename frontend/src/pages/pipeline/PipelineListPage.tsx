import React from "react";
import { useState } from 'react';
import { Button, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { SearchBar } from '@/components/SearchBar';
import { TableToolbar } from '@/components/TableToolbar';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { EmptyState } from '@/components/EmptyState';
import { confirmDanger } from '@/components/Confirm';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useDebounce } from '@/hooks/useDebounce';
import { deletePipeline, listPipelines } from '@/api/pipeline';
import type { PipelineRecord } from '@/types/pipeline';

const PAGE_SIZE = 10;

export default function PipelineListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(keyword, 300);
  const { data, isLoading, error, refetch } = useApiQuery(
    ['pipelines', { page, search: debounced }],
    () => listPipelines({ page, page_size: PAGE_SIZE }),
  );

  const deleteMutation = useApiMutation<unknown, string>(
    { mutationFn: (identifier: string) => deletePipeline(identifier) },
    [['pipelines']],
  );

  const items = data?.items ?? [];

  const columns: ColumnsType<PipelineRecord> = [
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Updated',
      dataIndex: 'updated_at',
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_value, record) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/pipeline/${record.id}`)}>
            View
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => navigate(`/pipeline/edit/${record.id}`)}
          >
            Edit
          </Button>
          <Button
            type="link"
            icon={<PlayCircleOutlined />}
            onClick={() => navigate(`/pipeline/${record.id}`)}
          >
            Run
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={async () => {
              const ok = await confirmDanger({
                title: 'Delete pipeline',
                content: `Delete pipeline ${record.name}?`,
              });
              if (!ok) {
                return;
              }
              try {
                await deleteMutation.mutateAsync(record.id);
              } catch (err) {
                console.error(describeError(err));
              }
            }}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Pipelines"
        description="Definitions stored on the platform"
        extra={
          <Space>
            <Link to="/pipeline/visual">
              <Button icon={<CodeOutlined />}>Visual editor</Button>
            </Link>
            <Link to="/pipeline/create">
              <Button type="primary">New pipeline</Button>
            </Link>
          </Space>
        }
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
              placeholder="Search by name"
            />
          }
          right={
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              Refresh
            </Button>
          }
        />
        {isLoading ? (
          <Loading rows={6} />
        ) : error ? (
          <ErrorAlert error={error} onRetry={() => refetch()} />
        ) : items.length === 0 ? (
          <EmptyState description="No pipelines yet" />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
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
