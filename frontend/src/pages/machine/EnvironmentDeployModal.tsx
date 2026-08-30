import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  CodeOutlined,
  LoadingOutlined,
  RocketOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  deployEnvironment,
  getDeployTask,
  type EnvironmentDeployTask,
  type RuntimeEnvironment,
} from '@/api/environment';

export interface MachineOption {
  id: string;
  name: string;
  kind: string;
  connection_type: string;
  status: string;
}

interface Props {
  open: boolean;
  environment: RuntimeEnvironment | null;
  machines: MachineOption[];
  onClose: () => void;
}

export function EnvironmentDeployModal({
  open,
  environment,
  machines,
  onClose,
}: Props): React.JSX.Element {
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [activeTasks, setActiveTasks] = useState<EnvironmentDeployTask[]>([]);
  const [expandedLogTaskId, setExpandedLogTaskId] = useState<string | null>(null);

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      setSelectedMachineIds([]);
      setActiveTasks([]);
      setDeploying(false);
      setExpandedLogTaskId(null);
    }
  }, [open]);

  // Polling active deployment tasks progress
  useEffect(() => {
    if (activeTasks.length === 0) return;
    const allFinished = activeTasks.every((t) => t.status === 'success' || t.status === 'failed');
    if (allFinished) return;

    const interval = setInterval(async () => {
      try {
        const updated = await Promise.all(
          activeTasks.map(async (t) => {
            if (t.status === 'success' || t.status === 'failed') return t;
            return await getDeployTask(t.id);
          })
        );
        setActiveTasks(updated);
      } catch {
        // ignore poll error
      }
    }, 800);

    return () => clearInterval(interval);
  }, [activeTasks]);

  const handleStartDeploy = async () => {
    if (!environment || selectedMachineIds.length === 0) return;
    setDeploying(true);
    try {
      const tasks = await deployEnvironment(environment.id, selectedMachineIds);
      setActiveTasks(tasks);
      antdMessage.success(`已向 ${tasks.length} 台机器下发部署任务`);
    } catch {
      // handled by interceptor
    } finally {
      setDeploying(false);
    }
  };

  const machineColumns: TableColumnsType<MachineOption> = [
    {
      title: '机器名称',
      dataIndex: 'name',
      render: (name: string, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ID: {record.id.slice(0, 8)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '连接协议',
      dataIndex: 'connection_type',
      render: (type: string) => (
        <Tag color={type === 'ssh' ? 'cyan' : 'blue'}>{type.toUpperCase()}</Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      render: (kind: string) => (
        <Tag color={kind === 'admin_pool' ? 'purple' : 'default'}>
          {kind === 'admin_pool' ? '管理员共享池' : '个人专属'}
        </Tag>
      ),
    },
    {
      title: '在线状态',
      dataIndex: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'default'}>{status}</Tag>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <RocketOutlined style={{ color: '#1677ff' }} />
          <span>批量下发环境部署 — {environment?.name}</span>
        </Space>
      }
      open={open}
      width={780}
      onCancel={onClose}
      footer={
        activeTasks.length === 0 ? (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              disabled={selectedMachineIds.length === 0}
              loading={deploying}
              onClick={handleStartDeploy}
            >
              开始部署 ({selectedMachineIds.length} 台机器)
            </Button>
          </Space>
        ) : (
          <Button
            type="primary"
            onClick={onClose}
            disabled={activeTasks.some((t) => t.status !== 'success' && t.status !== 'failed')}
          >
            完成并关闭
          </Button>
        )
      }
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 8 }}>
          将选定的运行时环境（版本：<b>{environment?.version}</b>，架构：<b>{environment?.os_arch}</b>
          ）下发至指定机器的 <code>~/.mini-pipeline-runner/environments/{environment?.name}</code> 目录并自动装配。
        </Typography.Paragraph>
      </div>

      {activeTasks.length === 0 ? (
        <>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>
            选择需要部署的目标机器：
          </Typography.Title>
          <Table<MachineOption>
            rowKey="id"
            columns={machineColumns}
            dataSource={machines}
            size="small"
            pagination={false}
            rowSelection={{
              type: 'checkbox',
              selectedRowKeys: selectedMachineIds,
              onChange: (keys) => setSelectedMachineIds(keys as string[]),
            }}
          />
        </>
      ) : (
        <div>
          <Typography.Title level={5} style={{ marginBottom: 12 }}>
            实时部署进度与状态监控：
          </Typography.Title>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {activeTasks.map((task) => {
              const isSuccess = task.status === 'success';
              const isFailed = task.status === 'failed';
              const isRunning = !isSuccess && !isFailed;

              return (
                <Card
                  key={task.id}
                  size="small"
                  style={{
                    borderRadius: 8,
                    border: isSuccess
                      ? '1px solid #b7eb8f'
                      : isFailed
                      ? '1px solid #ffa39e'
                      : '1px solid #91caff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Space>
                      {isRunning && <LoadingOutlined style={{ color: '#1677ff' }} />}
                      {isSuccess && <CheckCircleOutlined style={{ color: '#52c41a' }} />}
                      {isFailed && <WarningOutlined style={{ color: '#ff4d4f' }} />}
                      <Typography.Text strong>{task.machine_name}</Typography.Text>
                      <Tag color="geekblue">{task.machine_host || 'RUNNER'}</Tag>
                    </Space>
                    <Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {task.message}
                      </Typography.Text>
                      <Button
                        type="link"
                        size="small"
                        icon={<CodeOutlined />}
                        onClick={() =>
                          setExpandedLogTaskId(expandedLogTaskId === task.id ? null : task.id)
                        }
                      >
                        {expandedLogTaskId === task.id ? '收起日志' : '实时日志'}
                      </Button>
                    </Space>
                  </div>

                  <Progress
                    percent={task.progress}
                    status={isSuccess ? 'success' : isFailed ? 'exception' : 'active'}
                    strokeColor={isSuccess ? '#52c41a' : undefined}
                  />

                  {expandedLogTaskId === task.id && (
                    <pre
                      style={{
                        marginTop: 10,
                        padding: 10,
                        background: '#141414',
                        color: '#d9d9d9',
                        borderRadius: 6,
                        maxHeight: 180,
                        overflowY: 'auto',
                        fontSize: 12,
                        lineHeight: 1.4,
                      }}
                    >
                      {task.logs || '等待日志输出...'}
                    </pre>
                  )}
                </Card>
              );
            })}
          </Space>
        </div>
      )}
    </Modal>
  );
}
