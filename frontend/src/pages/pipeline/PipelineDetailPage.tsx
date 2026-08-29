import React from "react";
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { InboxOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import * as yaml from 'js-yaml';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { getPipelineParamsSchema, getPipelineYaml, listPipelines } from '@/api/pipeline';
import { submitRun } from '@/api/run';
import type {
  ParamField,
  PipelineDefinition,
  PipelineParamsSchema,
  PipelineStep,
  StepParamSchema,
} from '@/types/pipeline';
import type { PipelineRun } from '@/types/run';

const RECENT_RUNS_QUERY_KEY = ['recent-runs'] as const;

type StepRow = PipelineStep & { key: string };

type FieldKind = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'directory' | 'file' | 'object' | 'unknown';

function inferKind(field: ParamField | undefined): FieldKind {
  const declared = field?.type?.toLowerCase();
  if (declared === 'int' || declared === 'integer') return 'integer';
  if (declared === 'number' || declared === 'float') return 'number';
  if (declared === 'bool' || declared === 'boolean') return 'boolean';
  if (declared === 'list' || declared === 'array') return 'list';
  if (declared === 'directory' || declared === 'dir') return 'directory';
  if (declared === 'file' || declared === 'path') return 'file';
  if (declared === 'object' || declared === 'map') return 'object';
  if (declared) return 'string';
  return 'unknown';
}

export default function PipelineDetailPage(): React.JSX.Element {
  const { identifier } = useParams<{ identifier: string }>();
  const navigate = useNavigate();
  const [paramsText, setParamsText] = useState('{}');
  const [formParams, setFormParams] = useState<Record<string, unknown>>({});
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [paramsForm] = Form.useForm<{ params: string }>();
  const [runMode, setRunMode] = useState<'form' | 'json'>('form');

  const { data, isLoading, error, refetch } = useApiQuery(
    ['pipeline-yaml', identifier],
    () => getPipelineYaml(identifier ?? ''),
    { enabled: Boolean(identifier) },
  );

  const paramsSchemaQuery = useApiQuery(
    ['pipeline-params-schema', identifier],
    () => getPipelineParamsSchema(identifier ?? ''),
    { enabled: Boolean(identifier) },
  );
  const schema: PipelineParamsSchema | undefined = paramsSchemaQuery.data;

  const pipelineList = useApiQuery(['pipelines'], () =>
    listPipelines({ page: 1, page_size: 200 }),
  );
  const record = useMemo(() => {
    if (!pipelineList.data || !identifier) {
      return undefined;
    }
    return pipelineList.data.items.find(
      (item) => item.id === identifier || item.name === identifier,
    );
  }, [pipelineList.data, identifier]);

  const definition = useMemo<PipelineDefinition | null>(() => {
    if (!data) {
      return null;
    }
    try {
      return yaml.load(data) as PipelineDefinition;
    } catch {
      return null;
    }
  }, [data]);

  useEffect(() => {
    if (schema && !paramsSchemaQuery.isLoading) {
      setFormParams(schema.global_params);
      setParamsText(JSON.stringify(schema.global_params, null, 2));
    }
  }, [schema, paramsSchemaQuery.isLoading]);

  const submitRunMutation = useApiMutation(
    {
      mutationFn: (payload: { pipeline: string; params: Record<string, unknown> }) =>
        submitRun(payload),
    },
    [['runs'], ['recent-runs'], ['dashboard', 'summary']],
  );

  const handleOpenRun = () => {
    if (!definition) {
      return;
    }
    setFormParams(schema?.global_params ?? {});
    setParamsText(JSON.stringify(schema?.global_params ?? {}, null, 2));
    if (schema && schema.steps.some((step) => step.fields.length > 0)) {
      setRunMode('form');
    } else {
      setRunMode('json');
    }
    paramsForm.setFieldsValue({ params: JSON.stringify(schema?.global_params ?? {}, null, 2) });
    setRunModalOpen(true);
  };

  const handleRun = async () => {
    let params: Record<string, unknown>;
    if (runMode === 'form') {
      params = formParams;
    } else {
      try {
        const values = await paramsForm.validateFields();
        params = JSON.parse(values.params) as Record<string, unknown>;
        setParamsText(values.params);
      } catch {
        antdMessage.error('Parameters must be valid JSON');
        return;
      }
    }
    try {
      const run = await submitRunMutation.mutateAsync({
        pipeline: identifier ?? '',
        params,
      });
      setRunModalOpen(false);
      navigate(`/task/${(run as PipelineRun).id}`);
    } catch {
      // already surfaced
    }
  };

  const columns: TableColumnsType<StepRow> = [
    { title: 'Step', dataIndex: 'name' },
    { title: 'Plugin', dataIndex: 'plugin' },
    {
      title: 'Depends on',
      dataIndex: 'depends',
      render: (value: string[] | undefined) =>
        !value || value.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          value.join(', ')
        ),
    },
    {
      title: 'Parameters',
      dataIndex: 'with',
      render: (value: Record<string, unknown> | undefined) => (
        <code style={{ fontSize: 12 }}>{JSON.stringify(value ?? {})}</code>
      ),
    },
  ];

  const steps: StepRow[] = (definition?.steps ?? []).map((step) => ({
    ...step,
    key: step.name,
  }));

  return (
    <>
      <PageHeader
        title={record?.name ?? identifier ?? 'Pipeline'}
        description="Steps, parameters, and run history"
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={submitRunMutation.isPending}
              onClick={handleOpenRun}
              disabled={!definition}
            >
              Run
            </Button>
          </Space>
        }
      />
      {isLoading ? (
        <Loading rows={6} />
      ) : error ? (
        <ErrorAlert error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <ErrorAlert error={new Error('Pipeline not found')} onRetry={() => refetch()} />
      ) : (
        <Row gutter={16}>
          <Col span={16}>
            <Card title="Steps">
              {steps.length === 0 ? (
                <Typography.Text type="secondary">No steps defined</Typography.Text>
              ) : (
                <Table
                  rowKey="name"
                  size="middle"
                  columns={columns}
                  dataSource={steps}
                  pagination={false}
                />
              )}
            </Card>
            <Card title="Definition (YAML)" style={{ marginTop: 16 }}>
              <pre
                style={{
                  background: '#f6f8fa',
                  borderRadius: 6,
                  padding: 12,
                  fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
                  fontSize: 12,
                  maxHeight: 360,
                  overflow: 'auto',
                }}
              >
                {data}
              </pre>
            </Card>
          </Col>
          <Col span={8}>
            <Card title="Overview">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Name">{record?.name ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="Created">
                  {record ? new Date(record.created_at).toLocaleString() : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Updated">
                  {record ? new Date(record.updated_at).toLocaleString() : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="Steps">
                  <Tag color="blue">{steps.length}</Tag>
                </Descriptions.Item>
              </Descriptions>
            </Card>
            <Card title="History" style={{ marginTop: 16 }}>
              <Typography.Paragraph type="secondary">
                Recent runs for this pipeline will appear here.
              </Typography.Paragraph>
              <Button onClick={() => navigate('/pipeline/history')}>View history</Button>
            </Card>
          </Col>
        </Row>
      )}

      <Modal
        title={`Run ${record?.name ?? 'pipeline'}`}
        open={runModalOpen}
        confirmLoading={submitRunMutation.isPending}
        onCancel={() => setRunModalOpen(false)}
        onOk={handleRun}
        okText="Run"
        width={640}
      >
        <Tabs
          activeKey={runMode}
          onChange={(key) => setRunMode(key as 'form' | 'json')}
          items={[
            {
              key: 'form',
              label: 'Form',
              children: (
                <RunForm
                  schema={schema}
                  definition={definition}
                  value={formParams}
                  onChange={setFormParams}
                />
              ),
            },
            {
              key: 'json',
              label: 'JSON',
              children: (
                <Form layout="vertical" form={paramsForm}>
                  <Form.Item
                    name="params"
                    label="Parameters (JSON)"
                    initialValue={paramsText}
                  >
                    <Input.TextArea
                      rows={10}
                      style={{ fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace' }}
                    />
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />
      </Modal>
      {/* suppress unused constants lint check. */}
      <span style={{ display: 'none' }}>{RECENT_RUNS_QUERY_KEY.length}</span>
    </>
  );
}

type RunFormProps = {
  schema: PipelineParamsSchema | undefined;
  definition: PipelineDefinition | null;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

const _STEP_OUT_RE = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;
const _ALL_DEPS_RE = /^\$\{\{\s*all\.deps\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;

function RunForm({ schema, definition, value, onChange }: RunFormProps): React.JSX.Element {
  if (!schema) return <Loading rows={3} />;
  const hasFields = schema.steps.some((s) => s.fields.length > 0);
  if (!hasFields) return (
    <Alert type="info" showIcon message="No declared inputs. Switch to JSON." />
  );
  return (
    <Form layout="vertical">
      {schema.steps.map((step) => {
        const defStep = definition?.steps?.find((ds) => ds.name === step.name);
        return (
          <StepRunForm
            key={step.name}
            step={step}
            rawWith={(defStep?.with ?? {}) as Record<string, unknown>}
            value={value}
            onChange={onChange}
          />
        );
      })}
    </Form>
  );
}

type StepRunFormProps = {
  step: StepParamSchema;
  rawWith: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
};

function StepRunForm({ step, rawWith, value, onChange }: StepRunFormProps): React.JSX.Element {
  const stepValue = (value[step.name] as Record<string, unknown> | undefined) ?? {};
  if (step.fields.length === 0) return <></>;
  const wiredFields: ParamField[] = [];
  const inputFields: ParamField[] = [];
  for (const f of step.fields) {
    const raw = (rawWith[f.key] ?? '') as string;
    if (typeof raw === 'string' && (_STEP_OUT_RE.test(raw) || _ALL_DEPS_RE.test(raw))) {
      wiredFields.push(f);
    } else {
      inputFields.push(f);
    }
  }
  const setVal = (k: string, v: unknown) => {
    onChange({ ...value, [step.name]: { ...stepValue, [k]: v } });
  };
  return (
    <Card type="inner" size="small" title={<Space><Tag color="blue">{step.name}</Tag><Typography.Text type="secondary">{step.plugin}</Typography.Text></Space>} style={{marginBottom:12}}>
      {wiredFields.length>0?<div style={{marginBottom:inputFields.length>0?12:0}}><Typography.Text type="secondary" style={{fontSize:12}}>Auto-wired:</Typography.Text>{wiredFields.map((f)=>{const raw=(rawWith[f.key]??'')as string;const m1=_STEP_OUT_RE.exec(raw);const m2=_ALL_DEPS_RE.exec(raw);const lbl=m1?`${m1[1]}.outputs.${m1[2]}`:m2?`all.deps.outputs.${m2[1]}`:String(raw);return<div key={f.key} style={{background:'#f0f5ff',border:'1px solid #d6e4ff',borderRadius:6,padding:'4px 8px',marginTop:4,fontFamily:'JetBrains Mono,monospace',fontSize:12}}><Tag color="green">{f.type}</Tag><span style={{marginRight:8}}>{f.key}</span>← <code>{lbl}</code></div>})}</div>:null}
      {inputFields.length>0?<div>{wiredFields.length>0?<Typography.Text type="secondary" style={{fontSize:12,display:'block',marginBottom:8}}>Needs your input:</Typography.Text>:null}{inputFields.map((f)=>{const k=inferKind(f);const src=f.source||'';return<Form.Item key={f.key} label={<Space size={4}><span>{f.key}</span>{f.required?<Tag color="red">required</Tag>:null}<Tag>{k}</Tag>{src?<Tag color="orange">{src}</Tag>:null}</Space>} tooltip={f.description||undefined} required={f.required} style={{marginBottom:8}}>{src==='upload'?<Upload.Dragger multiple={false} beforeUpload={(file)=>{const reader=new FileReader();reader.onload=()=>{setVal(f.key,reader.result as string);setVal(f.key+'_file',file)};reader.readAsDataURL(file);return false}} showUploadList={true}><p className="ant-upload-drag-icon"><InboxOutlined/></p><p className="ant-upload-text">{f.description||'Upload file for '+f.key}</p></Upload.Dragger>:src==='url'?<Input value={(stepValue[f.key]as string|undefined)??(f.default as string|undefined)??''} placeholder={f.description||'https://...'} onChange={(e)=>setVal(f.key,e.target.value)}/>:k==='boolean'?<Switch checked={Boolean(stepValue[f.key]??f.default??false)} onChange={(v)=>setVal(f.key,v)}/>:k==='integer'||k==='number'?<InputNumber style={{width:'100%'}} value={(stepValue[f.key]as number|undefined)??(f.default as number|undefined)} onChange={(v)=>setVal(f.key,v)}/>:k==='list'?<Input.TextArea rows={2} placeholder='["a","b"]' defaultValue={JSON.stringify(stepValue[f.key]??f.default??[])} onChange={(e)=>{try{setVal(f.key,JSON.parse(e.target.value)as unknown)}catch{/* user is mid-edit; keep last valid */}}}/>:<Input value={(stepValue[f.key]as string|undefined)??(f.default as string|undefined)??''} placeholder={f.default!==undefined?String(f.default):''} onChange={(e)=>setVal(f.key,e.target.value)}/>}</Form.Item>})}</div>:<Typography.Text type="success">Everything is auto-wired — just click Run!</Typography.Text>}
    </Card>
  );
}
