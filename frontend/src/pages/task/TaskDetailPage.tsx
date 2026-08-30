import React from "react";
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  BranchesOutlined,
  DownloadOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { LogViewer } from '@/components/LogViewer';
import { StatusTag } from '@/components/StatusTag';
import { JsonViewer } from '@/components/JsonViewer';
import { confirmDanger } from '@/components/Confirm';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { useRunEventStream } from '@/hooks/useRunEventStream';
import { useLogStream } from '@/hooks/useLogStream';
import {
  getRun,
  getAggregatedLog,
  branchRun as branchRunApi,
  submitRun,
  downloadArtifactUrl,
  cancelRun,
} from '@/api/run';
import type { PipelineRun, TaskRun } from '@/types/run';

const ACTIVE = new Set(['PENDING', 'READY', 'RUNNING']);

function isEmptyObj(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length === 0;
  return false;
}

export default function TaskDetailPage(): React.JSX.Element {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  // REST query seeds the first render and reconciles the cache; live updates
  // arrive over SSE (see useRunEventStream) without polling.
  const { data: fetched, isLoading, error, refetch } = useApiQuery(
    ['run', runId],
    () => getRun(runId ?? ''),
    { enabled: Boolean(runId) },
  );
  const live = useRunEventStream(runId ?? '', fetched ?? null, {
    enabled: Boolean(runId) && Boolean(fetched) && ACTIVE.has(fetched?.status ?? ''),
  });
  const data: PipelineRun | undefined = live.run ?? fetched;

  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [logMode, setLogMode] = useState<'per-step' | 'aggregated'>('aggregated');
  const [aggLogText, setAggLogText] = useState('');
  const [aggLogLoading, setAggLogLoading] = useState(false);
  const [aggLogError, setAggLogError] = useState<unknown>(null);

  const [branchDrawer, setBranchDrawer] = useState(false);
  const [branchParams, setBranchParams] = useState('{}');

  const steps = useMemo(() => data?.tasks ?? [], [data?.tasks]);
  const runActive = Boolean(data?.status && ACTIVE.has(data.status));

  const branchMutation = useApiMutation(
    {
      mutationFn: ({ fromStep, params }: { fromStep: string; params: Record<string, unknown> }) =>
        branchRunApi(runId ?? '', fromStep, params),
    },
    [['runs'], ['recent-runs'], ['dashboard', 'summary']],
  );

  const cancelMutation = useApiMutation(
    { mutationFn: (id: string) => cancelRun(id) },
    [['run', runId], ['runs'], ['dashboard', 'summary']],
  );

  const submitRunMutation = useApiMutation(
    {
      mutationFn: (payload: { pipeline: string; params: Record<string, unknown> }) =>
        submitRun(payload),
    },
    [['runs'], ['recent-runs'], ['dashboard', 'summary']],
  );

  const handleCancel = async () => {
    if (!runId) return;
    const ok = await confirmDanger({
      title: 'Cancel run',
      content: 'Running plugin processes will be terminated and remaining steps cancelled.',
      okText: 'Cancel run',
    });
    if (!ok) return;
    try {
      await cancelMutation.mutateAsync(runId);
      antdMessage.success('Run cancelled');
      void refetch();
    } catch (err) {
      console.error(describeError(err));
    }
  };

  const handleBranch = async () => {
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(branchParams) as Record<string, unknown>;
    } catch {
      antdMessage.error('Branch params must be valid JSON');
      return;
    }
    const step = steps.find((s) => s.name === selectedStep);
    if (!step) {
      antdMessage.error('Select a step to branch from');
      return;
    }
    try {
      const result = await branchMutation.mutateAsync({ fromStep: step.name, params });
      setBranchDrawer(false);
      antdMessage.success('Branch run submitted');
      navigate(`/task/${result.id}`);
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  useEffect(() => {
    if (selectedStep === null && steps.length > 0) {
      setSelectedStep(steps[0]!.name);
    }
  }, [selectedStep, steps]);

  // Live per-step log: SSE tail while the task runs, full content otherwise.
  const perStepLog = useLogStream(runId ?? '', selectedStep ?? '', {
    live: true,
    enabled: Boolean(runId) && Boolean(selectedStep),
  });

  const fetchAggregatedLog = useCallback(async () => {
    if (!runId) return;
    setAggLogLoading(true);
    setAggLogError(null);
    try {
      const text = await getAggregatedLog(runId);
      setAggLogText(text);
    } catch (err) {
      setAggLogError(err);
    } finally {
      setAggLogLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    void fetchAggregatedLog();
  }, [fetchAggregatedLog]);

  // Poll aggregated log while the run is active; refresh once on terminal.
  const runStatus = data?.status;
  useEffect(() => {
    if (!runId || !runStatus) return;
    if (ACTIVE.has(runStatus)) {
      const handle = window.setInterval(() => { void fetchAggregatedLog(); }, 2_000);
      return () => window.clearInterval(handle);
    }
    void fetchAggregatedLog();
    return undefined;
  }, [runId, runStatus, fetchAggregatedLog]);

  const taskColumns: TableColumnsType<TaskRun> = [
    { title: 'Step', dataIndex: 'name' },
    { title: 'Plugin', dataIndex: 'plugin' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => <StatusTag status={value} />,
    },
    {
      title: 'Attempt',
      dataIndex: 'attempt',
      render: (value: number | undefined) => (value && value > 1 ? `#${value}` : '—'),
    },
    { title: 'Duration', dataIndex: 'finished_at' },
  ];

  return (
    <>
      <PageHeader
        title={`Run ${runId?.slice(0, 8) ?? ''}`}
        description={data ? `${data.pipeline_name} · ${data.status}` : 'Loading run…'}
        extra={
          <Space>
            <Tag color="blue">id: {runId}</Tag>
            {data && runActive ? (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleCancel}
                loading={cancelMutation.isPending}
              >
                Cancel
              </Button>
            ) : null}
            {data && !runActive ? (
              <>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    if (!data) return;
                    submitRunMutation.mutateAsync({
                      pipeline: data.pipeline_id,
                      params: data.params as Record<string, unknown>,
                    }).then((run) => {
                      antdMessage.success('Re-run submitted');
                      navigate(`/task/${(run as PipelineRun).id}`);
                    }).catch((err) => {
                      antdMessage.error(describeError(err));
                    });
                  }}
                  loading={submitRunMutation.isPending}
                >
                  Re-run
                </Button>
                <Button
                  icon={<BranchesOutlined />}
                  onClick={() => setBranchDrawer(true)}
                >
                  Branch from step
                </Button>
              </>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
              Refresh
            </Button>
          </Space>
        }
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : data ? (
        <Row gutter={16}>
          <Col span={16}>
            <Card title="Tasks">
              <Table
                rowKey="id"
                size="middle"
                columns={taskColumns}
                dataSource={steps}
                pagination={false}
                onRow={(record) => ({
                  onClick: () => setSelectedStep(record.name),
                  style: { cursor: 'pointer' },
                })}
                rowClassName={(record) =>
                  record.name === selectedStep ? 'ant-table-row-selected' : ''
                }
              />
            </Card>
            <div style={{ marginTop: 16 }}>
              <Tabs
                activeKey={logMode}
                onChange={(key) => setLogMode(key as 'per-step' | 'aggregated')}
                items={[
                  {
                    key: 'per-step',
                    label: `Step log · ${selectedStep ?? ''}`,
                    children: (
                      <LogViewer
                        log={perStepLog.content}
                        loading={perStepLog.loading}
                        title={selectedStep ?? 'Step'}
                        downloadName={`${selectedStep ?? 'task'}.log`}
                      />
                    ),
                  },
                  {
                    key: 'aggregated',
                    label: 'Run log (all steps)',
                    children: aggLogError ? (
                      <ErrorAlert error={aggLogError} onRetry={fetchAggregatedLog} />
                    ) : (
                      <LogViewer
                        log={aggLogText}
                        loading={aggLogLoading}
                        title="All steps"
                        downloadName="run.log"
                      />
                    ),
                  },
                ]}
              />
            </div>
          </Col>
          <Col span={8}>
            <Card title="Run">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Pipeline">{data.pipeline_name}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <Space>
                    <StatusTag status={data.status} />
                    {runActive ? <Tag color="green">live</Tag> : null}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="Created">
                  {new Date(data.created_at).toLocaleString()}
                </Descriptions.Item>
                <Descriptions.Item label="Started">
                  {data.started_at ? new Date(data.started_at).toLocaleString() : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Finished">
                  {data.finished_at ? new Date(data.finished_at).toLocaleString() : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Message">
                  {data.message ?? '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Params">
                  <JsonViewer value={data.params} />
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          {/* ── All Outputs · every step ── */}
          <Col span={24} style={{ marginTop: 16 }}>
            <Card title="All Outputs" size="small">
              {steps.length === 0 ? (
                <Typography.Text type="secondary">No steps.</Typography.Text>
              ) : (
                <Row gutter={[12, 12]}>
                  {steps.map((step) => (
                    <Col key={step.id} xs={24} sm={12} md={8} lg={6}>
                      <Card
                        size="small"
                        type="inner"
                        title={
                          <Space size={4}>
                            <StatusTag status={step.status} />
                            <span>{step.name}</span>
                          </Space>
                        }
                        extra={
                          <Tag style={{ fontSize: 10 }}>{step.plugin}</Tag>
                        }
                      >
                        {step.message ? (
                          <Typography.Paragraph
                            type="secondary"
                            style={{ fontSize: 12, marginBottom: 4 }}
                            ellipsis={{ rows: 1 }}
                          >
                            {step.message}
                          </Typography.Paragraph>
                        ) : null}
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          Outputs
                        </Typography.Text>
                        <div style={{ marginBottom: 6 }}>
                          {isEmptyObj(step.outputs) ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>
                          ) : (
                            <pre style={{
                              background: '#f6f8fa', borderRadius: 4, padding: '4px 6px',
                              fontSize: 11, margin: '2px 0', maxHeight: 120, overflow: 'auto',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}>
                              {JSON.stringify(step.outputs, null, 2)}
                            </pre>
                          )}
                        </div>
                        {step.artifacts.length > 0 ? (
                          <>
                            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                              Artifacts
                            </Typography.Text>
                            {step.artifacts.map((a) => (
                              <div key={a.id} style={{ fontSize: 12, marginTop: 2 }}>
                                <a
                                  href={downloadArtifactUrl(runId ?? '', a.id)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <DownloadOutlined style={{ marginRight: 4 }} />
                                  {a.name}
                                </a>
                                <span style={{ color: '#999', marginLeft: 6 }}>
                                  {(a.size / 1024).toFixed(2)} KiB
                                </span>
                              </div>
                            ))}
                          </>
                        ) : null}
                      </Card>
                    </Col>
                  ))}
                </Row>
              )}
            </Card>
          </Col>
        </Row>
      ) : null}

      <Drawer
        title="Branch from step"
        open={branchDrawer}
        onClose={() => setBranchDrawer(false)}
        width={420}
      >
        <Form layout="vertical">
          <Form.Item label="Pipeline" required>
            <Input disabled value={data?.pipeline_name ?? ''} />
          </Form.Item>
          <Form.Item label="Branch from step" required>
            <Select
              value={selectedStep ?? undefined}
              onChange={(value) => setSelectedStep(value)}
              placeholder="Pick a step to branch from"
            >
              {steps.map((step) => (
                <Select.Option key={step.name} value={step.name}>
                  {step.name} ({step.plugin})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="New parameters (JSON)">
            <Input.TextArea
              rows={6}
              placeholder='{"extra": 100}'
              value={branchParams}
              onChange={(event) => setBranchParams(event.target.value)}
              style={{ fontFamily: 'JetBrains Mono, monospace' }}
            />
          </Form.Item>
          <Button
            type="primary"
            block
            loading={branchMutation.isPending}
            onClick={handleBranch}
            disabled={!selectedStep}
          >
            Branch new run
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
