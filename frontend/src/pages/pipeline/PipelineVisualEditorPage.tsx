import React from "react";
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import {
  ArrowLeftOutlined,
  CodeOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import * as yaml from 'js-yaml';
import { PageHeader } from '@/components/PageHeader';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useApiMutation } from '@/hooks/useApiMutation';
import { listPlugins, getPluginManifest } from '@/api/plugin';
import { createPipeline, getPipelineYaml, updatePipeline } from '@/api/pipeline';
import type { PluginManifest, PluginManifestValue, PluginVersion } from '@/types/plugin';

type InputKind = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'directory' | 'file' | 'object' | 'unknown';

function inferKind(value: PluginManifestValue | undefined): InputKind {
  const declared = value?.type?.toLowerCase();
  if (declared === 'int' || declared === 'integer') {
    return 'integer';
  }
  if (declared === 'number' || declared === 'float') {
    return 'number';
  }
  if (declared === 'bool' || declared === 'boolean') {
    return 'boolean';
  }
  if (declared === 'list' || declared === 'array') {
    return 'list';
  }
  if (declared === 'directory' || declared === 'dir') {
    return 'directory';
  }
  if (declared === 'file' || declared === 'path') {
    return 'file';
  }
  if (declared === 'object' || declared === 'map') {
    return 'object';
  }
  if (declared) {
    return 'string';
  }
  return 'unknown';
}

type StepDraft = {
  key: string;
  name: string;
  pluginRef: string;
  depends: string[];
  params: Record<string, unknown>;
};

type FormState = {
  name: string;
  params: Record<string, unknown>;
  steps: StepDraft[];
};

const EMPTY_FORM: FormState = {
  name: '',
  params: {},
  steps: [],
};

const FANOUT_TEMPLATE: FormState = {
  name: 'fanout-demo',
  params: { greeting: 'Mini Pipeline' },
  steps: [
    {
      key: 'branch-a',
      name: 'branch-a',
      pluginRef: 'fanout-echo@1.0.0',
      depends: [],
      params: {
        message: '${{ params.greeting }} A',
        tag: 'alpha',
      },
    },
    {
      key: 'branch-b',
      name: 'branch-b',
      pluginRef: 'fanout-echo@1.0.0',
      depends: [],
      params: {
        message: '${{ params.greeting }} B',
        tag: 'beta',
      },
    },
    {
      key: 'branch-c',
      name: 'branch-c',
      pluginRef: 'fanout-echo@1.0.0',
      depends: [],
      params: {
        message: '${{ params.greeting }} C',
        tag: 'gamma',
      },
    },
    {
      key: 'aggregate',
      name: 'aggregate',
      pluginRef: 'fanout-aggregate@1.0.0',
      depends: ['branch-a', 'branch-b', 'branch-c'],
      params: {
        title: 'Fan-in summary',
        messages: '${{ all.deps.outputs.message }}',
      },
    },
  ],
};

function paramTemplateSuggestions(kind: InputKind, stepDepends: string[]): string[] {
  const suggestions: string[] = [];
  if (kind === 'string' || kind === 'list' || kind === 'unknown' || kind === 'file' || kind === 'directory') {
    suggestions.push('${{ params.<key> }}');
    for (const dep of stepDepends) {
      suggestions.push('${{ steps.' + dep + '.outputs.<key> }}');
      suggestions.push('${{ steps.' + dep + '.artifacts.<name>.path }}');
    }
    if (stepDepends.length > 0) {
      suggestions.push('${{ all.deps.outputs.<key> }}');
    }
  }
  return suggestions;
}

function toYamlPreview(state: FormState): string {
  return yaml.dump(
    {
      name: state.name || 'my-pipeline',
      params: state.params,
      steps: state.steps.map((step) => ({
        name: step.name,
        plugin: step.pluginRef,
        ...(step.depends.length > 0 ? { depends: step.depends } : {}),
        ...(Object.keys(step.params).length > 0 ? { with: step.params } : {}),
      })),
    },
    { lineWidth: 120, sortKeys: false },
  );
}

function parseYamlToForm(text: string): FormState {
  const raw = yaml.load(text);
  if (!raw || typeof raw !== 'object') {
    throw new Error('YAML root must be a mapping');
  }
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : '';
  const params = (obj.params && typeof obj.params === 'object' ? obj.params : {}) as Record<string, unknown>;
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const steps: StepDraft[] = rawSteps.map((rawStep, index) => {
    const stepObj = (rawStep ?? {}) as Record<string, unknown>;
    return {
      key: `${index}-${Date.now()}-${Math.random()}`,
      name: String(stepObj.name ?? `step-${index + 1}`),
      pluginRef: String(stepObj.plugin ?? ''),
      depends: Array.isArray(stepObj.depends)
        ? stepObj.depends.map(String)
        : [],
      params: (stepObj.with && typeof stepObj.with === 'object'
        ? (stepObj.with as Record<string, unknown>)
        : {}),
    };
  });
  return { name, params, steps };
}

export default function PipelineVisualEditorPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { id: editingId } = useParams<{ id?: string }>();
  const [state, setState] = useState<FormState>(EMPTY_FORM);
  const [yamlText, setYamlText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);

  const existingQuery = useApiQuery(
    ['pipeline-yaml', editingId],
    () => getPipelineYaml(editingId ?? ''),
    { enabled: Boolean(editingId) },
  );

  useEffect(() => {
    if (existingQuery.data) {
      try {
        setState(parseYamlToForm(existingQuery.data));
      } catch {
        // ignore parse error, user can use the YAML tab
      }
    }
  }, [existingQuery.data]);

  const pluginsQuery = useApiQuery(['plugins'], listPlugins);
  const plugins = useMemo<PluginVersion[]>(
    () => pluginsQuery.data ?? [],
    [pluginsQuery.data],
  );

  useEffect(() => {
    setYamlText(toYamlPreview(state));
  }, [state]);

  const pluginOptions = useMemo(
    () =>
      plugins.map((plugin) => ({
        label: `${plugin.name}@${plugin.version}`,
        value: `${plugin.name}@${plugin.version}`,
        description: plugin.description,
      })),
    [plugins],
  );

  const createMutation = useApiMutation(
    {
      mutationFn: (definition: string) =>
        editingId
          ? updatePipeline(editingId, { definition })
          : createPipeline({ definition }),
    },
    [['pipelines'], ['pipeline-yaml', editingId]],
  );

  const addStep = async (pluginRef: string) => {
    const [pluginName, pluginVersion] = pluginRef.split('@');
    const autoParams: Record<string, unknown> = {};
    const newGlobalParams: Record<string, unknown> = {};
    try {
      const manifest = await getPluginManifest(pluginName ?? '', pluginVersion ?? '');
      for (const [key, spec] of Object.entries(manifest.inputs ?? {})) {
        if (spec.required) {
          autoParams[key] = `\${{ params.${key} }}`;
          // Auto-add to pipeline-level params with a sensible placeholder
          if (spec.default !== undefined && spec.default !== null) {
            newGlobalParams[key] = spec.default;
          } else if (spec.type === 'number' || spec.type === 'integer') {
            newGlobalParams[key] = 0;
          } else if (spec.type === 'boolean') {
            newGlobalParams[key] = false;
          } else {
            newGlobalParams[key] = '';
          }
        } else if (spec.default !== undefined && spec.default !== null) {
          autoParams[key] = spec.default;
        }
      }
    } catch {
      // Plugin not registered yet or manifest unavailable; proceed with empty params.
    }

    setState((current) => {
      const stepNumber = current.steps.length + 1;
      const candidate = pluginRef.split('@')[0] ?? 'step';
      const baseName = candidate.replace(/[^A-Za-z0-9_.-]/g, '-').toLowerCase();
      const used = new Set(current.steps.map((step) => step.name));
      let name = `${baseName}-${stepNumber}`;
      let counter = stepNumber;
      while (used.has(name)) {
        counter += 1;
        name = `${baseName}-${counter}`;
      }
      const newStep: StepDraft = {
        key: `step-${Date.now()}-${Math.random()}`,
        name,
        pluginRef,
        depends: [],
        params: autoParams,
      };
      const mergedParams = { ...current.params, ...newGlobalParams };
      return { ...current, params: mergedParams, steps: [...current.steps, newStep] };
    });
    setPickerOpen(false);
  };

  const updateStep = async (index: number, patch: Partial<StepDraft>) => {
    const extraParams: Record<string, unknown> = {};

    // Auto-wire: when a new dependency is added, replace ${{ params.xxx }} with
    // ${{ steps.<dep>.outputs.xxx }} for any key that matches the dependency's
    // declared outputs.
    if (patch.depends !== undefined) {
      const currentStep = state.steps[index];
      if (!currentStep) return;
      try {
        // Fetch the current step's manifest (inputs)
        const [myName, myVer] = currentStep.pluginRef.split('@');
        const myManifest = await getPluginManifest(myName ?? '', myVer ?? '');
        const myInputKeys = new Set(Object.keys(myManifest.inputs ?? {}));

        // For each dependency, fetch its manifest and check outputs
        for (const depName of patch.depends) {
          const depStep = state.steps.find((s) => s.name === depName);
          if (!depStep) continue;
          const [depPName, depPVer] = depStep.pluginRef.split('@');
          try {
            const depManifest = await getPluginManifest(depPName ?? '', depPVer ?? '');
            for (const [outKey] of Object.entries(depManifest.outputs ?? {})) {
              if (myInputKeys.has(outKey)) {
                extraParams[outKey] = `\${{ steps.${depName}.outputs.${outKey} }}`;
              }
            }
          } catch {
            // Dependency manifest unavailable; skip auto-wire
          }
        }
      } catch {
        // Current step manifest unavailable; skip auto-wire
      }
    }

    setState((current) => {
      const nextSteps = current.steps.map((step, i) => {
        if (i !== index) return step;
        const mergedParams = { ...step.params, ...extraParams, ...(patch.params ?? {}) };
        return { ...step, ...patch, params: mergedParams };
      });
      return { ...current, steps: nextSteps };
    });
  };

  const removeStep = (index: number) => {
    setState((current) => {
      const removedName = current.steps[index]?.name;
      const steps = current.steps
        .filter((_, i) => i !== index)
        .map((step) => ({
          ...step,
          depends: step.depends.filter((dep) => dep !== removedName),
        }));
      return { ...current, steps };
    });
    setActiveStepIndex(null);
  };

  const syncFromYaml = () => {
    try {
      setState(parseYamlToForm(yamlText));
      antdMessage.success('Synced from YAML');
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : 'Invalid YAML');
    }
  };

  const handleSave = async () => {
    if (!state.name.trim()) {
      antdMessage.error('Pipeline name is required');
      return;
    }
    if (state.steps.length === 0) {
      antdMessage.error('Add at least one step');
      return;
    }
    try {
      const record = await createMutation.mutateAsync(toYamlPreview(state));
      antdMessage.success(`Pipeline ${record.name} saved`);
      navigate(`/pipeline/${record.id}`);
    } catch {
      // already surfaced
    }
  };

  const applyTemplate = () => {
    setState(FANOUT_TEMPLATE);
    antdMessage.success('Fan-out demo template loaded');
  };

  return (
    <>
      <PageHeader
        title={editingId ? 'Edit pipeline' : 'Visual pipeline editor'}
        description={
          editingId
            ? 'Load an existing pipeline, edit it visually, and save your changes'
            : 'Compose plugins, set parameters, and preview the generated YAML'
        }
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/pipeline/list')}>
              Back
            </Button>
            <Button icon={<ThunderboltOutlined />} onClick={applyTemplate}>
              Use fan-out demo
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={createMutation.isPending}
              onClick={handleSave}
            >
              Save pipeline
            </Button>
          </Space>
        }
      />
      <Tabs
        defaultActiveKey="visual"
        items={[
          {
            key: 'visual',
            label: 'Visual',
            children: (
              <div className="app-content-card">
                <Form layout="vertical" style={{ maxWidth: 720 }}>
                  <Form.Item
                    label="Pipeline name"
                    required
                    help="Must start with a letter (A-Z, a-z), up to 128 chars. Letters, digits, dots, underscores, and hyphens are allowed."
                    validateStatus={
                      state.name && !/^[A-Za-z]/.test(state.name) ? 'error' : ''
                    }
                  >
                    <Input
                      value={state.name}
                      placeholder="my-pipeline"
                      onChange={(event) =>
                        setState((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </Form.Item>
                  <Form.Item label="Global parameters (JSON)">
                    <Input.TextArea
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      style={{ fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace' }}
                      defaultValue={JSON.stringify(state.params, null, 2)}
                      onChange={(event) => {
                        try {
                          const parsed = JSON.parse(event.target.value || '{}') as Record<string, unknown>;
                          setState((current) => ({ ...current, params: parsed }));
                        } catch {
                          // ignore parse errors, wait for valid input
                        }
                      }}
                    />
                  </Form.Item>
                </Form>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}
                >
                  <Typography.Title level={5} style={{ margin: 0 }}>
                    Steps
                  </Typography.Title>
                  <Space>
                    <Badge count={state.steps.length} showZero color="blue" />
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={() => setPickerOpen(true)}
                    >
                      Add step
                    </Button>
                  </Space>
                </div>

                {state.steps.length === 0 ? (
                  <Alert
                    type="info"
                    showIcon
                    message="No steps yet. Click Add step to pick a plugin."
                  />
                ) : (
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {state.steps.map((step, index) => (
                      <StepCard
                        key={step.key}
                        index={index}
                        step={step}
                        availableDependencies={state.steps
                          .filter((_, otherIndex) => otherIndex < index)
                          .map((other) => other.name)}
                        depStepRefs={state.steps
                          .slice(0, index)
                          .filter((s) => step.depends.includes(s.name))
                          .map((s) => ({ name: s.name, pluginRef: s.pluginRef }))}
                        pluginOptions={pluginOptions}
                        pipelineParamKeys={Object.keys(state.params)}
                        onChange={(patch) => updateStep(index, patch)}
                        onRemove={() => removeStep(index)}
                      />
                    ))}
                  </Space>
                )}
              </div>
            ),
          },
          {
            key: 'yaml',
            label: 'YAML',
            children: (
              <div className="app-content-card">
                <Space style={{ marginBottom: 12 }}>
                  <Button icon={<CodeOutlined />} onClick={syncFromYaml}>
                    Sync form from YAML
                  </Button>
                  <Typography.Text type="secondary">
                    Edits to YAML only take effect after pressing Sync.
                  </Typography.Text>
                </Space>
                <Input.TextArea
                  value={yamlText}
                  onChange={(event) => setYamlText(event.target.value)}
                  autoSize={{ minRows: 18, maxRows: 40 }}
                  spellCheck={false}
                  style={{ fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace', fontSize: 12 }}
                />
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title="Pick a plugin"
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        width={420}
      >
        {pluginsQuery.isLoading ? (
          <Typography.Text type="secondary">Loading plugins…</Typography.Text>
        ) : plugins.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="No plugins registered yet"
            description="Register a plugin before composing a pipeline."
          />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {plugins.map((plugin) => (
              <Card
                key={plugin.id}
                hoverable
                onClick={() => addStep(`${plugin.name}@${plugin.version}`)}
              >
                <Typography.Text strong>
                  {plugin.name}@{plugin.version}
                </Typography.Text>
                <div>
                  <Tag color="geekblue">{plugin.source_type}</Tag>
                  <Tag color="blue">{plugin.runtime_type}</Tag>
                </div>
                <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
                  {plugin.description || 'No description'}
                </Typography.Paragraph>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>
      {/* suppress unused var lint for activeStepIndex when expanded later */}
      <span style={{ display: 'none' }}>{String(activeStepIndex)}</span>
    </>
  );
}

type StepCardProps = {
  index: number;
  step: StepDraft;
  availableDependencies: string[];
  depStepRefs: { name: string; pluginRef: string }[];
  pluginOptions: { label: string; value: string; description?: string }[];
  pipelineParamKeys: string[];
  onChange: (patch: Partial<StepDraft>) => void;
  onRemove: () => void;
};

function StepCard({
  index,
  step,
  availableDependencies,
  depStepRefs,
  pluginOptions,
  pipelineParamKeys,
  onChange,
  onRemove,
}: StepCardProps): React.JSX.Element {
  const manifestQuery = useApiQuery(
    ['plugin-manifest', step.pluginRef],
    async () => {
      const [name, version] = step.pluginRef.split('@');
      return getPluginManifest(name ?? '', version ?? '');
    },
    { enabled: step.pluginRef.includes('@') },
  );
  const manifest: PluginManifest | undefined = manifestQuery.data;
  const inputs = manifest?.inputs ?? {};

  return (
    <Card
      size="small"
      title={`Step ${index + 1}`}
      extra={
        <Button
          type="link"
          danger
          icon={<DeleteOutlined />}
          onClick={onRemove}
        >
          Remove
        </Button>
      }
    >
      <Form layout="vertical" size="small">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Form.Item label="Step name" required>
            <Input
              value={step.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </Form.Item>
          <Form.Item label="Plugin">
            <Select
              value={step.pluginRef}
              options={pluginOptions}
              onChange={(value) => onChange({ pluginRef: value, params: {} })}
              showSearch
              optionFilterProp="label"
              placeholder="Select plugin"
            />
          </Form.Item>
        </div>
        <Form.Item label="Depends on">
          <Checkbox.Group
            value={step.depends}
            onChange={(values) => onChange({ depends: values as string[] })}
          >
            {availableDependencies.length === 0 ? (
              <Typography.Text type="secondary">
                Earlier steps will appear here once you add them.
              </Typography.Text>
            ) : (
              <Space size={8} wrap>
                {availableDependencies.map((name) => (
                  <Checkbox key={name} value={name}>
                    {name}
                  </Checkbox>
                ))}
              </Space>
            )}
          </Checkbox.Group>
        </Form.Item>
        <Form.Item label="Parameters">
          {Object.keys(inputs).length === 0 ? (
            <Typography.Text type="secondary">
              This plugin declares no inputs. Add free-form keys below if needed.
            </Typography.Text>
          ) : (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {Object.entries(inputs).map(([key, spec]) => (
                <InputField
                  key={key}
                  fieldKey={key}
                  spec={spec}
                  value={step.params[key]}
                  dependsOn={step.depends}
                  depSteps={depStepRefs.filter((s) => step.depends.includes(s.name))}
                  pipelineParams={pipelineParamKeys}
                  onChange={(value) =>
                    onChange({
                      params: { ...step.params, [key]: value },
                    })
                  }
                />
              ))}
            </Space>
          )}
        </Form.Item>
        {step.depends.length > 0 ? (
          <WiringCheck
            depends={step.depends}
            pluginOptions={pluginOptions}
            currentParams={step.params}
            onChange={(patch) => onChange({ params: { ...step.params, ...patch } })}
          />
        ) : null}
        <Form.Item label="Free-form parameters (advanced)">
          <Input.TextArea
            placeholder='{"extra": "value"}'
            autoSize={{ minRows: 2, maxRows: 6 }}
            style={{ fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace' }}
            defaultValue={JSON.stringify(
              Object.fromEntries(
                Object.entries(step.params).filter(([key]) => !(key in inputs)),
              ),
              null,
              2,
            )}
            onChange={(event) => {
              try {
                const raw = event.target.value.trim();
                const extra = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
                onChange({
                  params: { ...step.params, ...extra, ...Object.fromEntries(
                    Object.entries(step.params).filter(([k]) => !(k in (raw ? extra : {}))),
                  ) },
                });
              } catch {
                // ignore while user is typing
              }
            }}
          />
        </Form.Item>
      </Form>
    </Card>
  );
}

type WiringCheckProps = {
  depends: string[];
  pluginOptions: { label: string; value: string; description?: string }[];
  currentParams: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
};

function WiringCheck({
  depends,
  pluginOptions,
  currentParams,
  onChange,
}: WiringCheckProps): React.JSX.Element | null {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const missing: string[] = [];
      for (const depName of depends) {
        const depOpt = pluginOptions.find((opt) => opt.label.startsWith(`${depName}@`));
        if (!depOpt) continue;
        const [name, version] = depOpt.label.split('@');
        try {
          const manifest = await getPluginManifest(name ?? '', version ?? '');
          for (const [outKey] of Object.entries(manifest.outputs ?? {})) {
            const currentValue = currentParams[outKey];
            // If this param is still pointing to params (not wired), suggest wiring
            if (typeof currentValue === 'string' && currentValue.includes('${{ params.')) {
              if (!missing.includes(outKey)) {
                missing.push(outKey);
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (!cancelled) setSuggestions(missing);
    };
    void check();
    return () => { cancelled = true; };
  }, [depends, pluginOptions, currentParams]);

  if (suggestions.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="warning" style={{ fontSize: 12 }}>
        Some inputs match upstream outputs but are not wired yet.
        Click a suggestion to auto-wire:
      </Typography.Text>
      <Space size={4} wrap style={{ marginTop: 4 }}>
        {suggestions.map((key) => (
          <Tag
            key={key}
            color="orange"
            style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
            onClick={() => {
              // Wire to the first dependency that has this output
              const firstDep = depends[0];
              if (firstDep) {
                onChange({ [key]: `\${{ steps.${firstDep}.outputs.${key} }}` });
              }
            }}
          >
            {key}
          </Tag>
        ))}
      </Space>
    </div>
  );
}

type InputFieldProps = {
  fieldKey: string;
  spec: PluginManifestValue;
  value: unknown;
  dependsOn: string[];
  depSteps: { name: string; pluginRef: string }[];
  pipelineParams: string[];
  onChange: (value: unknown) => void;
};

const PARAM_EXPR = /^\$\{\{\s*params\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;
const STEP_OUT_EXPR = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;
const ALL_DEPS_EXPR = /^\$\{\{\s*all\.deps\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;

type Binding =
  | { kind: 'constant'; display: string }
  | { kind: 'param'; key: string }
  | { kind: 'step'; dep: string; output: string }
  | { kind: 'all_deps'; output: string };

function detectBinding(value: unknown): Binding {
  if (typeof value === 'string') {
    const v = value.trim();
    const m1 = PARAM_EXPR.exec(v);
    if (m1) return { kind: 'param', key: m1[1]! };
    const m2 = STEP_OUT_EXPR.exec(v);
    if (m2) return { kind: 'step', dep: m2[1]!, output: m2[2]! };
    const m3 = ALL_DEPS_EXPR.exec(v);
    if (m3) return { kind: 'all_deps', output: m3[1]! };
    return { kind: 'constant', display: v };
  }
  if (value === undefined || value === null) {
    return { kind: 'constant', display: '' };
  }
  return { kind: 'constant', display: String(value) };
}

function InputField({
  fieldKey,
  spec,
  value,
  dependsOn,
  depSteps,
  pipelineParams,
  onChange,
}: InputFieldProps): React.JSX.Element {
  const kind = inferKind(spec);
  const required = spec.required === true;
  const binding = useMemo(() => detectBinding(value), [value]);
  const [stepPickerOpen, setStepPickerOpen] = useState(false);
  const [stepOutputs, setStepOutputs] = useState<{ dep: string; outputs: string[] } | null>(null);

  const renderValueInput = () => {
    if (kind === 'boolean') {
      return (
        <Switch
          checked={Boolean(value ?? spec.default ?? false)}
          onChange={onChange}
        />
      );
    }
    if (kind === 'integer' || kind === 'number') {
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={(value as number | undefined) ?? (spec.default as number | undefined)}
          onChange={(next) => onChange(next)}
        />
      );
    }
    if (kind === 'list') {
      return (
        <Input.TextArea
          rows={2}
          placeholder='["a", "b"]'
          defaultValue={JSON.stringify(value ?? spec.default ?? [])}
          onChange={(event) => {
            try {
              onChange(JSON.parse(event.target.value) as unknown);
            } catch { /* wait for valid JSON */ }
          }}
        />
      );
    }
    return (
      <Input
        value={(value as string | undefined) ?? (spec.default as string | undefined) ?? ''}
        placeholder={spec.default !== undefined ? String(spec.default) : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  };

  const bindingLabel = (() => {
    if (binding.kind === 'param') return `params.${binding.key}`;
    if (binding.kind === 'step') return `steps.${binding.dep}.outputs.${binding.output}`;
    if (binding.kind === 'all_deps') return `all.deps.outputs.${binding.output}`;
    return `Constant: ${binding.display || '(empty)'}`;
  })();

  const selectValue = (() => {
    if (binding.kind === 'param') return `params:${binding.key}`;
    if (binding.kind === 'all_deps') return 'all_deps:__all__';
    if (binding.kind === 'step') return 'step:custom';
    return '__constant__';
  })();

  const selectOptions = [
    { value: '__constant__', label: 'Constant' },
    ...pipelineParams.map((p) => ({ value: `params:${p}`, label: `params.${p}` })),
    ...depSteps.map((d) => ({
      value: `dep:${d.name}`,
      label: `${d.name} (output…)`,
    })),
    { value: 'all_deps:__all__', label: 'all.deps (fan-in)' },
    ...(binding.kind === 'step'
      ? [{ value: 'step:custom', label: `${binding.dep}.${binding.output}` }]
      : []),
  ];

  const handleSelect = (selected: string) => {
    if (selected === '__constant__') {
      onChange(binding.kind === 'constant' ? binding.display : '');
    } else if (selected.startsWith('params:')) {
      onChange(`\${{ params.${selected.slice('params:'.length)} }}`);
    } else if (selected === 'all_deps:__all__') {
      onChange(`\${{ all.deps.outputs.${fieldKey} }}`);
    } else if (selected.startsWith('dep:')) {
      const dep = selected.slice('dep:'.length).split('|')[0]!;
      setStepPickerOpen(true);
      void (async () => {
        const depStep = depSteps.find((d) => d.name === dep);
        if (!depStep) {
          setStepOutputs({ dep, outputs: [] });
          return;
        }
        const [name, ver] = depStep.pluginRef.split('@');
        try {
          const manifest = await getPluginManifest(name ?? '', ver ?? '');
          setStepOutputs({ dep, outputs: Object.keys(manifest.outputs ?? {}) });
        } catch {
          setStepOutputs({ dep, outputs: [] });
        }
      })();
    }
  };

  const labelEl = (
    <Space size={4}>
      <span>{fieldKey}</span>
      {required ? <Tag color="red">required</Tag> : null}
      {kind !== 'unknown' ? <Tag>{kind}</Tag> : null}
    </Space>
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <div>{labelEl}</div>
        <Select
          size="small"
          value={selectValue}
          onChange={handleSelect}
          options={selectOptions}
          style={{ minWidth: 200 }}
        />
      </div>

      {binding.kind === 'constant' ? (
        renderValueInput()
      ) : (
        <div
          style={{
            background: '#f5f5f5',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '4px 8px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: '#555',
            marginTop: 4,
          }}
        >
          ← {bindingLabel}
        </div>
      )}

      {spec.description ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {spec.description}
        </Typography.Text>
      ) : null}

      <Drawer
        title={stepOutputs ? `Pick output from "${stepOutputs.dep}"` : ''}
        open={stepPickerOpen && stepOutputs !== null}
        onClose={() => {
          setStepPickerOpen(false);
          setStepOutputs(null);
        }}
        width={360}
      >
        {stepOutputs && stepOutputs.outputs.length === 0 ? (
          <Typography.Text type="secondary">
            This step has no declared outputs. Wire a constant instead.
          </Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {stepOutputs?.outputs.map((out) => (
              <Button
                key={out}
                block
                onClick={() => {
                  onChange(`\${{ steps.${stepOutputs.dep}.outputs.${out} }}`);
                  setStepPickerOpen(false);
                  setStepOutputs(null);
                }}
              >
                <code>{out}</code>
              </Button>
            ))}
          </Space>
        )}
      </Drawer>
    </div>
  );
}
