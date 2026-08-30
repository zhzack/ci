import React, { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ReloadOutlined,
  SearchOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import type { ProcessInfo } from '@/api/diagnostics';
import { useThemeStore } from '@/store/theme';

interface Props {
  processes: ProcessInfo[];
  loading: boolean;
  onRefresh: () => void;
}

export function ProcessManagerPane({
  processes,
  loading,
  onRefresh,
}: Props): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'dark';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('cpu_desc');

  const safeProcesses = Array.isArray(processes) ? processes : [];

  // Filter processes with defensive null/undefined checks
  const filtered = safeProcesses.filter((p) => {
    if (!p) return false;
    const name = String(p.name || '');
    const cmd = String(p.command || '');
    const user = String(p.user || '');
    const pid = String(p.pid ?? '');
    const status = String(p.status || '');

    const matchesSearch =
      !search ||
      name.toLowerCase().includes(search.toLowerCase()) ||
      cmd.toLowerCase().includes(search.toLowerCase()) ||
      user.toLowerCase().includes(search.toLowerCase()) ||
      pid.includes(search);

    const matchesStatus =
      statusFilter === 'all' ||
      status.toLowerCase().includes(statusFilter.toLowerCase());

    return matchesSearch && matchesStatus;
  });

  // Sort processes
  const sorted = [...filtered].sort((a, b) => {
    const aCpu = Number(a?.cpu_percent) || 0;
    const bCpu = Number(b?.cpu_percent) || 0;
    const aMem = Number(a?.memory_percent) || 0;
    const bMem = Number(b?.memory_percent) || 0;
    const aPid = Number(a?.pid) || 0;
    const bPid = Number(b?.pid) || 0;
    const aName = String(a?.name || '');
    const bName = String(b?.name || '');

    if (sortBy === 'cpu_desc') return bCpu - aCpu;
    if (sortBy === 'cpu_asc') return aCpu - bCpu;
    if (sortBy === 'mem_desc') return bMem - aMem;
    if (sortBy === 'mem_asc') return aMem - bMem;
    if (sortBy === 'pid_asc') return aPid - bPid;
    if (sortBy === 'pid_desc') return bPid - aPid;
    if (sortBy === 'name_asc') return aName.localeCompare(bName);
    return bCpu - aCpu;
  });

  // Aggregate stats
  const totalCpu = Math.min(
    100,
    Math.round(safeProcesses.reduce((acc, p) => acc + (Number(p?.cpu_percent) || 0), 0) * 10) / 10
  );
  const totalMem = Math.min(
    100,
    Math.round(safeProcesses.reduce((acc, p) => acc + (Number(p?.memory_percent) || 0), 0) * 10) / 10
  );

  const columns: TableColumnsType<ProcessInfo> = [
    {
      title: 'PID',
      dataIndex: 'pid',
      width: 80,
      sorter: (a, b) => a.pid - b.pid,
      render: (pid: number) => <Tag color="blue" style={{ fontFamily: 'monospace' }}>{pid}</Tag>,
    },
    {
      title: '进程名称 (Image Name)',
      dataIndex: 'name',
      width: 180,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ fontSize: 13, color: isDark ? '#58a6ff' : '#1677ff' }}>
            {name}
          </Typography.Text>
          {record.command && record.command !== name && (
            <Typography.Text
              type="secondary"
              ellipsis={{ tooltip: record.command }}
              style={{ fontSize: 11, maxWidth: 220 }}
            >
              {record.command}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: '用户名 / 会话',
      dataIndex: 'user',
      width: 120,
      sorter: (a, b) => a.user.localeCompare(b.user),
      render: (u: string) => <Tag>{u || 'SYSTEM'}</Tag>,
    },
    {
      title: 'CPU 占用',
      dataIndex: 'cpu_percent',
      width: 100,
      sorter: (a, b) => a.cpu_percent - b.cpu_percent,
      render: (val: number) => (
        <Space size={4}>
          <Tag color={val > 50 ? 'red' : val > 15 ? 'orange' : val > 0 ? 'green' : 'default'}>
            {val.toFixed(1)}%
          </Tag>
        </Space>
      ),
    },
    {
      title: '内存占用',
      dataIndex: 'memory_percent',
      width: 100,
      sorter: (a, b) => a.memory_percent - b.memory_percent,
      render: (val: number) => (
        <Tag color={val > 40 ? 'red' : val > 10 ? 'orange' : 'cyan'}>
          {val.toFixed(1)}%
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      sorter: (a, b) => a.status.localeCompare(b.status),
      render: (status: string) => {
        const s = status.toLowerCase();
        const color = s.includes('run') || s.includes('r') ? 'processing' : s.includes('sleep') || s.includes('s') ? 'default' : 'warning';
        return <Tag color={color}>{status || 'Running'}</Tag>;
      },
    },
    {
      title: '启动时间 / 详细指令',
      dataIndex: 'command',
      ellipsis: true,
      render: (cmd: string, record) => (
        <Typography.Text code copyable style={{ fontSize: 11 }}>
          {cmd || record.name}
        </Typography.Text>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px' }}>
      {/* Top Header Summary Cards */}
      <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                监控进程总数
              </Typography.Text>
              <Tag color="blue">{processes.length} 个</Tag>
            </div>
            <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 2 }}>
              {filtered.length} <span style={{ fontSize: 12, fontWeight: 'normal', color: '#888' }}>当前显示</span>
            </div>
          </Card>
        </Col>

        <Col span={8}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                应用 CPU 汇总
              </Typography.Text>
              <Typography.Text strong style={{ fontSize: 12 }}>{totalCpu}%</Typography.Text>
            </div>
            <Progress percent={totalCpu} strokeColor="#1677ff" size="small" showInfo={false} style={{ margin: '4px 0 0 0' }} />
          </Card>
        </Col>

        <Col span={8}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                应用内存汇总
              </Typography.Text>
              <Typography.Text strong style={{ fontSize: 12 }}>{totalMem}%</Typography.Text>
            </div>
            <Progress percent={totalMem} strokeColor="#52c41a" size="small" showInfo={false} style={{ margin: '4px 0 0 0' }} />
          </Card>
        </Col>
      </Row>

      {/* Toolbar: Search, Filter, Sort, Refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <Input
          size="small"
          prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
          placeholder="快速过滤 PID、进程名、用户名或指令..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          style={{ flex: 1, maxWidth: 360 }}
        />

        <Space size={6}>
          <Select
            size="small"
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 105 }}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '运行中', value: 'run' },
              { label: '休眠/空闲', value: 'sleep' },
            ]}
          />

          <Select
            size="small"
            value={sortBy}
            onChange={setSortBy}
            style={{ width: 130 }}
            suffixIcon={<SortAscendingOutlined />}
            options={[
              { label: 'CPU 占用降序', value: 'cpu_desc' },
              { label: 'CPU 占用升序', value: 'cpu_asc' },
              { label: '内存占用降序', value: 'mem_desc' },
              { label: '内存占用升序', value: 'mem_asc' },
              { label: 'PID 升序', value: 'pid_asc' },
              { label: 'PID 降序', value: 'pid_desc' },
              { label: '进程名称 A-Z', value: 'name_asc' },
            ]}
          />

          <Button
            size="small"
            type="primary"
            ghost
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
          >
            刷新进程
          </Button>
        </Space>
      </div>

      {/* Process Table with internal scrolling */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Table<ProcessInfo>
          rowKey="pid"
          columns={columns}
          dataSource={sorted}
          loading={loading}
          size="small"
          pagination={false}
        />
      </div>
    </div>
  );
}
