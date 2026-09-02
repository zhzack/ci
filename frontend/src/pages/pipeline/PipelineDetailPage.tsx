import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,

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
import { InboxOutlined, PlayCircleOutlined, ShareAltOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import * as yaml from 'js-yaml';
import { PageHeader } from '@/components/PageHeader';
import { Loading } from '@/components/Loading';
import { ErrorAlert } from '@/components/ErrorAlert';
import { useApiQuery, describeError } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { getPipelineParamsSchema, getPipelineYaml, listPipelines } from '@/api/pipeline';
import { submitRun, submitRunWithFiles } from '@/api/run';

import { listMachines, listGrants, createGrant, deleteGrant, listTeams, type Machine, type Grant, type Team } from '@/api/machine';
import { adminListUsers, type AdminUser } from '@/api/admin';
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
  const [targetMachine, setTargetMachine] = useState<string | undefined>(undefined);
  const machinesQuery = useApiQuery(['machines'], listMachines, { enabled: Boolean(identifier) });
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ percent: 0, loaded: 0, total: 0, speedMBs: 0 });
  const [shareDrawerOpen, setShareDrawerOpen] = useState(false);
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
      mutationFn: (payload: {
        pipeline: string;
        params: Record<string, unknown>;
        machine?: string;
      }) => submitRun(payload),
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

    const uploadFiles: Record<string, File> = {};
    const cleanParams: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const stepMap: Record<string, unknown> = {};
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (sk.endsWith('_file') && sv instanceof File) {
            const fieldKey = sk.slice(0, -5);
            uploadFiles[fieldKey] = sv;
          } else if (sv instanceof File) {
            uploadFiles[sk] = sv;
            stepMap[sk] = sv.name;
          } else {
            stepMap[sk] = sv;
          }
        }
        cleanParams[k] = stepMap;
      } else if (k.endsWith('_file') && v instanceof File) {
        const fieldKey = k.slice(0, -5);
        uploadFiles[fieldKey] = v;
      } else if (v instanceof File) {
        uploadFiles[k] = v;
        cleanParams[k] = v.name;
      } else {
        cleanParams[k] = v;
      }
    }

    const hasFiles = Object.keys(uploadFiles).length > 0;
    try {
      let run: PipelineRun;
      if (hasFiles) {
        setUploading(true);
        const startTime = Date.now();
        setUploadProgress({ percent: 0, loaded: 0, total: 0, speedMBs: 0 });
        run = await submitRunWithFiles(
          identifier ?? '',
          cleanParams,
          uploadFiles,
          targetMachine || undefined,
          undefined,
          true,
          (percent, loaded, total) => {
            const elapsed = Math.max((Date.now() - startTime) / 1000, 0.1);
            const speed = loaded / (1024 * 1024) / elapsed;
            setUploadProgress({ percent, loaded, total, speedMBs: speed });
          },
        );
      } else {
        run = await submitRunMutation.mutateAsync({
          pipeline: identifier ?? '',
          params: cleanParams,
          machine: targetMachine || undefined,
        });
      }
      setRunModalOpen(false);
      navigate(`/task/${run.id}`);
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setUploading(false);
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
            {record?.id ? (
              <Button
                icon={<ShareAltOutlined />}
                onClick={() => setShareDrawerOpen(true)}
              >
                Share
              </Button>
            ) : null}
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
              <pre className="json-viewer" style={{ margin: 0 }}>
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
        confirmLoading={submitRunMutation.isPending || uploading}
        onCancel={() => !uploading && setRunModalOpen(false)}
        onOk={handleRun}
        okText={uploading ? 'Uploading...' : 'Run'}
        okButtonProps={{ disabled: uploading, loading: uploading }}
        cancelButtonProps={{ disabled: uploading }}
        width={640}
      >
        {uploading ? (
          <div style={{ padding: '28px 16px', textAlign: 'center' }}>
            <Typography.Title level={5} style={{ marginBottom: 16 }}>
              {uploadProgress.percent >= 100
                ? 'Files uploaded. Initializing pipeline...'
                : 'Uploading assets to pipeline runner...'}
            </Typography.Title>
            <Progress
              percent={uploadProgress.percent}
              status={uploadProgress.percent >= 100 ? 'success' : 'active'}
              strokeColor={{ '0%': '#1890ff', '100%': '#52c41a' }}
            />
            <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 13 }}>
              {uploadProgress.total > 0 ? (
                <>
                  <span>
                    {(uploadProgress.loaded / (1024 * 1024)).toFixed(1)} MB /{' '}
                    {(uploadProgress.total / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <span style={{ marginLeft: 16 }}>
                    Speed: {uploadProgress.speedMBs.toFixed(2)} MB/s
                  </span>
                </>
              ) : (
                'Preparing upload...'
              )}
            </div>
          </div>
        ) : (
          <>
            <Form layout="vertical" style={{ marginBottom: 12 }}>
              <Form.Item label="Run on" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  placeholder="Built-in runner (this host)"
                  style={{ width: '100%' }}
                  value={targetMachine ?? null}
                  onChange={(value: string | undefined) => setTargetMachine(value ?? undefined)}
                  options={(machinesQuery.data ?? [])
                    .filter((m: Machine) => m.can_use && m.online)
                    .map((m: Machine) => ({
                      value: m.id,
                      label: `${m.name} (${m.kind === 'admin' ? 'assigned' : 'personal'})`,
                    }))}
                />
              </Form.Item>
            </Form>
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
          </>
        )}
      </Modal>

      {record?.id ? (
        <PipelineShareDrawer
          pipelineId={record.id}
          pipelineName={record.name}
          ownerId={record.owner_id}
          open={shareDrawerOpen}
          onClose={() => setShareDrawerOpen(false)}
        />
      ) : null}
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
      {inputFields.length>0?<div>{wiredFields.length>0?<Typography.Text type="secondary" style={{fontSize:12,display:'block',marginBottom:8}}>Needs your input:</Typography.Text>:null}{inputFields.map((f)=>{const k=inferKind(f);const src=f.source||'';const uploadedFile=stepValue[f.key+'_file']as File|undefined;const uploadedFileName=(stepValue[f.key]as string|undefined);return<Form.Item key={f.key} label={<Space size={4}><span>{f.key}</span>{f.required?<Tag color="red">required</Tag>:null}<Tag>{k}</Tag>{src?<Tag color="orange">{src}</Tag>:null}</Space>} tooltip={f.description||undefined} required={f.required} style={{marginBottom:8}}>{src==='upload'?<Upload.Dragger multiple={false} maxCount={1} fileList={uploadedFile||uploadedFileName?[{uid:'-1',name:uploadedFile?.name||uploadedFileName||f.key,status:'done'}]:[]} beforeUpload={(file)=>{setVal(f.key,file.name);setVal(f.key+'_file',file);return false}} onRemove={()=>{setVal(f.key,undefined);setVal(f.key+'_file',undefined)}}><p className="ant-upload-drag-icon"><InboxOutlined/></p><p className="ant-upload-text">{uploadedFile?.name||uploadedFileName||(f.description||'Click or drag file to upload for '+f.key)}</p></Upload.Dragger>:src==='url'?<Input value={(stepValue[f.key]as string|undefined)??(f.default as string|undefined)??''} placeholder={f.description||'https://...'} onChange={(e)=>setVal(f.key,e.target.value)}/>:k==='boolean'?<Switch checked={Boolean(stepValue[f.key]??f.default??false)} onChange={(v)=>setVal(f.key,v)}/>:k==='integer'||k==='number'?<InputNumber style={{width:'100%'}} value={(stepValue[f.key]as number|undefined)??(f.default as number|undefined)} onChange={(v)=>setVal(f.key,v)}/>:k==='list'?<Input.TextArea rows={2} placeholder='["a","b"]' defaultValue={JSON.stringify(stepValue[f.key]??f.default??[])} onChange={(e)=>{try{setVal(f.key,JSON.parse(e.target.value)as unknown)}catch{/* user is mid-edit; keep last valid */}}}/>:<Input value={(stepValue[f.key]as string|undefined)??(f.default as string|undefined)??''} placeholder={f.default!==undefined?String(f.default):''} onChange={(e)=>setVal(f.key,e.target.value)}/>}</Form.Item>})}</div>:<Typography.Text type="success">Everything is auto-wired — just click Run!</Typography.Text>}

    </Card>
  );
}

function PipelineShareDrawer({
  pipelineId,
  pipelineName,
  ownerId,
  open,
  onClose,
}: {
  pipelineId: string;
  pipelineName: string;
  ownerId?: string | null;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [granteeType, setGranteeType] = useState<'user' | 'team'>('user');
  const [selectedGrantee, setSelectedGrantee] = useState<string | null>(null);
  const [grantPermission, setGrantPermission] = useState<'viewer' | 'operator'>('viewer');
  const [loading, setLoading] = useState(false);

  const fetchGrants = useCallback(async () => {
    if (!pipelineId) return;
    try {
      const list = await listGrants('pipeline', pipelineId);
      setGrants(list);
    } catch {
      setGrants([]);
    }
  }, [pipelineId]);

  useEffect(() => {
    if (open && pipelineId) {
      void fetchGrants();
      void adminListUsers().then(setUsers).catch(() => setUsers([]));
      void listTeams().then(setTeams).catch(() => setTeams([]));
    }
  }, [open, pipelineId, fetchGrants]);

  const handleShare = async () => {
    if (!selectedGrantee) return;
    setLoading(true);
    try {
      await createGrant({
        resource_type: 'pipeline',
        resource_id: pipelineId,
        grantee_type: granteeType,
        grantee_id: selectedGrantee,
        permission: grantPermission,
      });
      antdMessage.success(`Pipeline shared with ${granteeType}`);
      setSelectedGrantee(null);
      void fetchGrants();
    } catch (err) {
      antdMessage.error(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (grantId: string) => {
    try {
      await deleteGrant(grantId);
      antdMessage.success('Access revoked');
      void fetchGrants();
    } catch (err) {
      antdMessage.error(describeError(err));
    }
  };

  return (
    <Drawer title={`Share · ${pipelineName}`} open={open} onClose={onClose} width={480}>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          Grant users or teams access to view or run this pipeline.
        </Typography.Paragraph>

        <Typography.Title level={5} style={{ marginBottom: 0 }}>
          Access List
        </Typography.Title>
        {grants.length === 0 ? (
          <Typography.Text type="secondary">Not shared with anyone yet.</Typography.Text>
        ) : (
          grants.map((grant) => {
            const isTeam = grant.grantee_type === 'team';
            const displayName = isTeam
              ? teams.find((t) => t.id === grant.grantee_id)?.name ?? grant.grantee_id
              : users.find((u) => u.id === grant.grantee_id)?.username ?? grant.grantee_id;
            return (
              <Space key={grant.id}>
                <Tag color="purple">{grant.permission}</Tag>
                <Tag color={isTeam ? 'cyan' : 'geekblue'}>{grant.grantee_type}</Tag>
                <Typography.Text>{displayName}</Typography.Text>
                <Button type="link" size="small" danger onClick={() => void handleRevoke(grant.id)}>
                  Revoke
                </Button>
              </Space>
            );
          })
        )}

        <Typography.Title level={5} style={{ marginBottom: 0 }}>
          Add Access
        </Typography.Title>
        <Space.Compact style={{ width: '100%' }}>
          <Select
            value={granteeType}
            onChange={(v) => {
              setGranteeType(v);
              setSelectedGrantee(null);
            }}
            style={{ width: 100 }}
            options={[
              { value: 'user', label: 'User' },
              { value: 'team', label: 'Team' },
            ]}
          />
          <Select
            placeholder={granteeType === 'user' ? 'Select user' : 'Select team'}
            style={{ flex: 1 }}
            value={selectedGrantee}
            onChange={setSelectedGrantee}
            showSearch
            filterOption={(input, opt) =>
              (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={
              granteeType === 'user'
                ? users
                    .filter(
                      (u) =>
                        u.id !== ownerId &&
                        !grants.some((g) => g.grantee_type === 'user' && g.grantee_id === u.id),
                    )
                    .map((u) => ({
                      value: u.id,
                      label: `${u.username}${u.display_name ? ` (${u.display_name})` : ''}`,
                    }))
                : teams
                    .filter(
                      (t) =>
                        !grants.some((g) => g.grantee_type === 'team' && g.grantee_id === t.id),
                    )
                    .map((t) => ({ value: t.id, label: t.name }))
            }
          />
          <Select
            value={grantPermission}
            onChange={setGrantPermission}
            style={{ width: 105 }}
            options={[
              { value: 'viewer', label: 'Viewer' },
              { value: 'operator', label: 'Operator' },
            ]}
          />
          <Button
            type="primary"
            loading={loading}
            disabled={!selectedGrantee}
            onClick={() => void handleShare()}
          >
            Share
          </Button>
        </Space.Compact>
      </Space>
    </Drawer>
  );
}

