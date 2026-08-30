import React, { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ApiOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  GlobalOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import type {
  NetworkConnectionInfo,
  NetworkDiagnostics,
  NetworkInterfaceInfo,
} from '@/api/diagnostics';
import { Loading } from '@/components/Loading';
import { useThemeStore } from '@/store/theme';

interface Props {
  data: NetworkDiagnostics | null;
  loading: boolean;
  onRefresh: () => void;
}

export function NetworkDiagnosticsPane({
  data,
  loading,
  onRefresh,
}: Props): React.JSX.Element {
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'dark';

  const [activeTab, setActiveTab] = useState<'sockets' | 'adapters'>('sockets');
  const [sockSearch, setSockSearch] = useState('');
  const [protoFilter, setProtoFilter] = useState<'ALL' | 'TCP' | 'UDP' | 'LISTEN' | 'ESTABLISHED'>('ALL');

  const interfaces = data?.interfaces || [];
  const connections = data?.connections || [];

  // Filter connections
  const filteredConnections = connections.filter((c) => {
    const matchesSearch =
      c.local_addr.toLowerCase().includes(sockSearch.toLowerCase()) ||
      c.remote_addr.toLowerCase().includes(sockSearch.toLowerCase()) ||
      (c.process_name && c.process_name.toLowerCase().includes(sockSearch.toLowerCase())) ||
      (c.pid && String(c.pid).includes(sockSearch));

    if (!matchesSearch) return false;

    if (protoFilter === 'ALL') return true;
    if (protoFilter === 'TCP') return c.proto.toUpperCase() === 'TCP';
    if (protoFilter === 'UDP') return c.proto.toUpperCase() === 'UDP';
    if (protoFilter === 'LISTEN') return c.state.toUpperCase().includes('LISTEN');
    if (protoFilter === 'ESTABLISHED') return c.state.toUpperCase().includes('ESTABLISHED');
    return true;
  });

  const listeningCount = connections.filter((c) => c.state.toUpperCase().includes('LISTEN')).length;
  const establishedCount = connections.filter((c) => c.state.toUpperCase().includes('ESTABLISHED')).length;

  // Socket table columns
  const socketColumns: TableColumnsType<NetworkConnectionInfo> = [
    {
      title: '协议',
      dataIndex: 'proto',
      width: 75,
      sorter: (a, b) => a.proto.localeCompare(b.proto),
      render: (p: string) => (
        <Tag color={p.toUpperCase() === 'TCP' ? 'blue' : 'purple'} style={{ fontWeight: 600 }}>
          {p.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: '本地绑定地址与端口 (Local Address)',
      dataIndex: 'local_addr',
      width: 220,
      sorter: (a, b) => a.local_addr.localeCompare(b.local_addr),
      render: (addr: string) => (
        <Typography.Text code copyable style={{ fontSize: 12 }}>
          {addr}
        </Typography.Text>
      ),
    },
    {
      title: '外部连接地址 (Remote Address)',
      dataIndex: 'remote_addr',
      width: 200,
      sorter: (a, b) => a.remote_addr.localeCompare(b.remote_addr),
      render: (addr: string) => (
        <Typography.Text style={{ fontSize: 12, color: addr === '*:*' || addr === '0.0.0.0:0' ? '#888' : undefined }}>
          {addr || '*:*'}
        </Typography.Text>
      ),
    },
    {
      title: '状态 (State)',
      dataIndex: 'state',
      width: 130,
      sorter: (a, b) => a.state.localeCompare(b.state),
      render: (state: string) => {
        const s = state.toUpperCase();
        if (s.includes('LISTEN')) {
          return <Tag color="green">LISTENING</Tag>;
        }
        if (s.includes('ESTABLISHED')) {
          return <Tag color="cyan">ESTABLISHED</Tag>;
        }
        if (s.includes('TIME_WAIT') || s.includes('CLOSE_WAIT')) {
          return <Tag color="orange">{state}</Tag>;
        }
        return <Tag>{state || 'ACTIVE'}</Tag>;
      },
    },
    {
      title: '占用 PID / 进程信息',
      dataIndex: 'pid',
      render: (pid: number | undefined | null, record) => (
        <Space size={6}>
          {pid ? <Tag color="geekblue">PID: {pid}</Tag> : null}
          {record.process_name ? (
            <Typography.Text strong style={{ fontSize: 12 }}>
              {record.process_name}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
  ];

  // Adapter table columns
  const adapterColumns: TableColumnsType<NetworkInterfaceInfo> = [
    {
      title: '网卡接口名称',
      dataIndex: 'name',
      width: 180,
      render: (name: string) => (
        <Space>
          <GlobalOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>{name}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'IPv4 地址',
      dataIndex: 'ipv4',
      width: 180,
      render: (ip: string) => (
        <Typography.Text code copyable style={{ fontSize: 12 }}>
          {ip || '未配置'}
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => {
        const isUp = status.toLowerCase() === 'up' || status.toLowerCase() === 'connected';
        return <Badge status={isUp ? 'success' : 'default'} text={status.toUpperCase()} />;
      },
    },
    {
      title: '已接收流量 (Rx)',
      dataIndex: 'rx_mb',
      width: 140,
      sorter: (a, b) => a.rx_mb - b.rx_mb,
      render: (mb: number) => (
        <span style={{ color: '#52c41a', fontWeight: 600 }}>
          <ArrowDownOutlined style={{ marginRight: 4 }} />
          {mb} MB
        </span>
      ),
    },
    {
      title: '已发送流量 (Tx)',
      dataIndex: 'tx_mb',
      width: 140,
      sorter: (a, b) => a.tx_mb - b.tx_mb,
      render: (mb: number) => (
        <span style={{ color: '#1677ff', fontWeight: 600 }}>
          <ArrowUpOutlined style={{ marginRight: 4 }} />
          {mb} MB
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '8px 12px' }}>
      {/* Top 4 Network Overview Cards */}
      <Row gutter={[8, 8]} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              总接收流量 (Download)
            </Typography.Text>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#52c41a', marginTop: 2 }}>
              <ArrowDownOutlined style={{ marginRight: 4 }} />
              {data?.recv_total_mb ?? 0} <span style={{ fontSize: 11, fontWeight: 'normal' }}>MB</span>
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              总发送流量 (Upload)
            </Typography.Text>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1677ff', marginTop: 2 }}>
              <ArrowUpOutlined style={{ marginRight: 4 }} />
              {data?.sent_total_mb ?? 0} <span style={{ fontSize: 11, fontWeight: 'normal' }}>MB</span>
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              监听端口 (Listening)
            </Typography.Text>
            <div style={{ fontSize: 16, fontWeight: 'bold', marginTop: 2 }}>
              {listeningCount} <span style={{ fontSize: 11, fontWeight: 'normal', color: '#888' }}>个端口开放</span>
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card size="small" style={{ borderRadius: 6, background: isDark ? '#1f1f1f' : '#f8fafc' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              活跃连接 (Established)
            </Typography.Text>
            <div style={{ fontSize: 16, fontWeight: 'bold', color: '#722ed1', marginTop: 2 }}>
              {establishedCount} <span style={{ fontSize: 11, fontWeight: 'normal', color: '#888' }}>/ {connections.length} 总套接字</span>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Tabs & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <Radio.Group
          size="small"
          value={activeTab}
          onChange={(e) => setActiveTab(e.target.value)}
          buttonStyle="solid"
        >
          <Radio.Button value="sockets">
            <ApiOutlined style={{ marginRight: 4 }} />
            网络连接与监听端口 ({filteredConnections.length})
          </Radio.Button>
          <Radio.Button value="adapters">
            <GlobalOutlined style={{ marginRight: 4 }} />
            网卡适配器全览 ({interfaces.length})
          </Radio.Button>
        </Radio.Group>

        <Space size={6}>
          {activeTab === 'sockets' && (
            <>
              <Input
                size="small"
                prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
                placeholder="搜索 IP、端口、PID 或进程..."
                value={sockSearch}
                onChange={(e) => setSockSearch(e.target.value)}
                allowClear
                style={{ width: 220 }}
              />

              <Select
                size="small"
                value={protoFilter}
                onChange={setProtoFilter}
                style={{ width: 120 }}
                options={[
                  { label: '全部套接字', value: 'ALL' },
                  { label: '仅监听 (LISTEN)', value: 'LISTEN' },
                  { label: '已建立 (ESTAB)', value: 'ESTABLISHED' },
                  { label: '仅 TCP', value: 'TCP' },
                  { label: '仅 UDP', value: 'UDP' },
                ]}
              />
            </>
          )}

          <Button
            size="small"
            type="primary"
            ghost
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
          >
            刷新网络
          </Button>
        </Space>
      </div>

      {/* Body Table with internal scrolling */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && !data ? (
          <div style={{ padding: 40 }}>
            <Loading rows={4} />
          </div>
        ) : activeTab === 'sockets' ? (
          <Table<NetworkConnectionInfo>
            rowKey={(r) => `${r.proto}-${r.local_addr}-${r.remote_addr}-${r.pid}`}
            columns={socketColumns}
            dataSource={filteredConnections}
            loading={loading}
            size="small"
            pagination={false}
          />
        ) : (
          <Table<NetworkInterfaceInfo>
            rowKey="name"
            columns={adapterColumns}
            dataSource={interfaces}
            loading={loading}
            size="small"
            pagination={false}
          />
        )}
      </div>
    </div>
  );
}
