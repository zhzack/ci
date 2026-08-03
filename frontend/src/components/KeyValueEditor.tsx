import React from 'react';
import { Alert, Button, Drawer, Input, InputNumber, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';

export type WiringSelection =
  | { kind: 'expr'; expression: string; label: string }
  | { kind: 'not-wired'; expression: '' };

export type WiringSource = {
  label: string;
  expression: string;
};

/** Per-key chip that shows the current auto-wire status + a switch menu. */
export function AutoWiredChip({
  current,
  candidates,
  onPick,
}: {
  current: string | null;
  candidates: WiringSource[];
  onPick: (next: WiringSelection) => void;
}): React.JSX.Element | null {
  // Show the chip only when there's at least one candidate upstream.
  if (candidates.length === 0) return null;

  const matchedCandidate = candidates.find((c) => c.expression === current);
  const isWired = matchedCandidate !== undefined;
  const allDepsExpression = current?.includes('all.deps.outputs') ? current : null;

  const pickFromMenu = (value: string) => {
    if (value === '__not-wired__') {
      onPick({ kind: 'not-wired', expression: '' });
      return;
    }
    if (value === '__all_deps__') {
      // The caller decides what field key this maps to via fieldKeyForAllDeps.
      onPick({ kind: 'expr', expression: '__all_deps__', label: 'all.deps (fan-in)' });
      return;
    }
    const src = candidates.find((c) => c.expression === value);
    if (!src) return;
    onPick({ kind: 'expr', expression: src.expression, label: src.label });
  };

  const currentLabel = matchedCandidate?.label ?? (allDepsExpression ? 'all.deps' : null);

  const dropdownOptions: Array<{ value: string; label: string }> = candidates.map((c) => ({
    value: c.expression,
    label: c.label,
  }));
  dropdownOptions.push({ value: '__all_deps__', label: 'all.deps (fan-in)' });
  dropdownOptions.push({ value: '__not-wired__', label: '—— Not wired ——' });

  const displayLabel = currentLabel ?? 'Not wired';
  return (
    <Tooltip title="Auto-wire candidates from upstream steps">
      <Tag
        color={isWired || allDepsExpression ? 'geekblue' : 'default'}
        icon={isWired || allDepsExpression ? <CheckCircleOutlined /> : <WarningOutlined />}
        style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: 11 }}
      >
        {isWired || allDepsExpression ? `Auto: ${displayLabel}` : `Auto-wire (${candidates.length})`}
        <Select<string>
          size="small"
          variant="borderless"
          value="__switch__"
          onChange={pickFromMenu}
          options={dropdownOptions}
          style={{ marginLeft: 6, minWidth: 24 }}
          suffixIcon={null}
          dropdownMatchSelectWidth={false}
        />
      </Tag>
    </Tooltip>
  );
}

export type KeyValueKind = 'string' | 'number' | 'integer' | 'boolean' | 'list' | 'json';

export const KEY_VALUE_KINDS: KeyValueKind[] = ['string', 'number', 'integer', 'boolean', 'list', 'json'];

export type KeyValueRow = {
  /** Stable id used as React key; never persisted. */
  id: string;
  key: string;
  kind: KeyValueKind;
  /** Raw text for list/json (parsed on commit) or the value itself for scalar kinds. */
  value: unknown;
};

export type Binding =
  | { kind: 'constant'; display: string }
  | { kind: 'param'; key: string }
  | { kind: 'step'; dep: string; output: string }
  | { kind: 'all_deps'; output: string };

const PARAM_EXPR = /^\$\{\{\s*params\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;
const STEP_OUT_EXPR = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;
const ALL_DEPS_EXPR = /^\$\{\{\s*all\.deps\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/;

export function detectBinding(value: unknown): Binding {
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

export function inferKind(value: unknown): KeyValueKind {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  if (Array.isArray(value)) return 'list';
  if (value && typeof value === 'object') return 'json';
  return 'string';
}

/** Generate a short stable id for React list keys. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function entryToRow(key: string, value: unknown): KeyValueRow {
  return {
    id: newId(),
    key,
    kind: inferKind(value),
    value: normaliseValueForKind(value, inferKind(value)),
  };
}

function normaliseValueForKind(value: unknown, kind: KeyValueKind): unknown {
  if (kind === 'list' || kind === 'json') {
    if (value === undefined) return '';
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (value === undefined || value === null) return '';
  return value;
}

export type KeyValueEditorProps = {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  /** Names already reserved by the plugin manifest; flagged as conflict in the UI. */
  reservedKeys?: string[];
  /** Names of pipeline params, offered as binding targets. */
  pipelineParamKeys?: string[];
  /** Names of upstream step dependencies, offered as binding sources. */
  depSteps?: { name: string; pluginRef: string }[];
  /** Resolves upstream step output names. Promise or sync. */
  resolveDepOutputs?: (depName: string) => Promise<string[]> | string[];
  /** Per-row auto-wire candidates keyed by the row's key. */
  autoWireByKey?: Record<string, Array<{ label: string; expression: string }>>;
  /** Field used for `all.deps.outputs.<key>` binding default. */
  fieldKeyForAllDeps?: string;
};

const bindingLabel = (b: Binding): string => {
  switch (b.kind) {
    case 'param':
      return `params.${b.key}`;
    case 'step':
      return `steps.${b.dep}.outputs.${b.output}`;
    case 'all_deps':
      return `all.deps.outputs.${b.output}`;
    default:
      return `Constant: ${b.display || '(empty)'}`;
  }
};

export function KeyValueEditor({
  rows,
  onChange,
  reservedKeys = [],
  pipelineParamKeys = [],
  depSteps = [],
  resolveDepOutputs,
  autoWireByKey = {},
  fieldKeyForAllDeps,
}: KeyValueEditorProps): React.JSX.Element {
  const update = (index: number, patch: Partial<KeyValueRow>) => {
    const next = rows.map((row, i) => {
      if (i !== index) return row;
      const merged: KeyValueRow = { ...row, ...patch };
      if (patch.kind !== undefined && patch.kind !== row.kind) {
        merged.value = normaliseValueForKind(merged.value, patch.kind);
      }
      return merged;
    });
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const add = () => {
    onChange([...rows, { id: newId(), key: '', kind: 'string', value: '' }]);
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {rows.map((row, index) => {
        const duplicate = rows.some(
          (other, otherIndex) => otherIndex !== index && other.key && other.key === row.key,
        );
        const conflictsWithReserved = row.key !== '' && reservedKeys.includes(row.key);
        const warnings: string[] = [];
        if (!row.key) warnings.push('Key is empty — row is ignored on save.');
        if (duplicate) warnings.push('Duplicate key — later rows will overwrite earlier ones.');
        if (conflictsWithReserved)
          warnings.push('Key conflicts with a declared input. Move this entry to "Parameters" instead?');

        const binding = detectBinding(row.value);

        return (
          <div
            key={row.id}
            style={{
              border: '1px solid #f0f0f0',
              borderRadius: 6,
              padding: 8,
              background: warnings.length > 0 ? '#fffbe6' : '#fafafa',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 1fr) 110px minmax(160px, 2fr) auto auto',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <Input
                value={row.key}
                placeholder="key"
                status={warnings.length > 0 ? 'warning' : ''}
                onChange={(event) => update(index, { key: event.target.value })}
              />
              <Select<KeyValueKind>
                value={row.kind}
                options={KEY_VALUE_KINDS.map((kind) => ({ value: kind, label: kind }))}
                onChange={(kind) => update(index, { kind })}
              />
              <ValueEditor
                row={row}
                binding={binding}
                pipelineParamKeys={pipelineParamKeys}
                depSteps={depSteps}
                resolveDepOutputs={resolveDepOutputs}
                fieldKeyForAllDeps={fieldKeyForAllDeps}
                onChange={(next) => update(index, { value: next })}
                autoWireCandidates={
                  row.key && autoWireByKey[row.key]
                    ? autoWireByKey[row.key] ?? []
                    : []
                }
              />
              <Tooltip title="Remove row">
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(index)} />
              </Tooltip>
              <Tooltip title="Insert row below">
                <Button
                  size="small"
                  type="text"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    const next = [...rows];
                    next.splice(index + 1, 0, { id: newId(), key: '', kind: 'string', value: '' });
                    onChange(next);
                  }}
                />
              </Tooltip>
            </div>
            {warnings.length > 0 ? (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <WarningOutlined style={{ color: '#faad14' }} />
                {warnings.map((w) => (
                  <Tag key={w} color="warning" style={{ margin: 0 }}>
                    {w}
                  </Tag>
                ))}
              </div>
            ) : null}
            {binding.kind !== 'constant' ? (
              <Tag color="geekblue" style={{ marginTop: 6 }}>
                ← {bindingLabel(binding)}
              </Tag>
            ) : null}
            {row.key && (autoWireByKey[row.key]?.length ?? 0) > 0 ? (
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <AutoWiredChip
                  current={
                    typeof row.value === 'string' && /^\$\{\{[^{}]+\}\}$/.test(row.value.trim())
                      ? row.value.trim()
                      : null
                  }
                  candidates={autoWireByKey[row.key] ?? []}
                  onPick={(next) => update(index, { value: next.kind === 'not-wired' ? '' : next.expression })}
                />
              </div>
            ) : null}
          </div>
        );
      })}
      <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={add} style={{ width: '100%' }}>
        Add row
      </Button>
    </Space>
  );
}

type ValueEditorProps = {
  row: KeyValueRow;
  binding: Binding;
  pipelineParamKeys: string[];
  depSteps: { name: string; pluginRef: string }[];
  resolveDepOutputs?: (depName: string) => Promise<string[]> | string[];
  fieldKeyForAllDeps?: string;
  autoWireCandidates: Array<{ label: string; expression: string }>;
  onChange: (next: unknown) => void;
};

function ValueEditor({
  row,
  binding,
  pipelineParamKeys,
  depSteps,
  resolveDepOutputs,
  fieldKeyForAllDeps,
  autoWireCandidates,
  onChange,
}: ValueEditorProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerOutputs, setPickerOutputs] = React.useState<{ dep: string; outputs: string[] } | null>(null);

  const bindingSelectValue = (() => {
    if (binding.kind === 'param') return `params:${binding.key}`;
    if (binding.kind === 'all_deps') return 'all_deps:__all__';
    if (binding.kind === 'step') return `step:${binding.dep}|${binding.output}`;
    return '__constant__';
  })();

  const bindingOptions = [
    { value: '__constant__', label: 'Constant' },
    ...pipelineParamKeys.map((p) => ({ value: `params:${p}`, label: `params.${p}` })),
    ...depSteps.map((d) => ({ value: `dep:${d.name}`, label: `${d.name} (output…)` })),
    { value: 'all_deps:__all__', label: 'all.deps (fan-in)' },
    ...(binding.kind === 'step'
      ? [{ value: `step:${binding.dep}|${binding.output}`, label: `${binding.dep}.${binding.output}` }]
      : []),
  ];

  const handleSelect = async (selected: string) => {
    if (selected === '__constant__') {
      const text = binding.kind === 'constant' ? binding.display : '';
      onChange(text);
      return;
    }
    if (selected.startsWith('params:')) {
      onChange(`\${{ params.${selected.slice('params:'.length)} }}`);
      return;
    }
    if (selected === 'all_deps:__all__') {
      const key = fieldKeyForAllDeps ?? row.key;
      onChange(`\${{ all.deps.outputs.${key} }}`);
      return;
    }
    if (selected.startsWith('step:')) {
      const [, dep, output] = selected.split('|');
      onChange(`\${{ steps.${dep}.outputs.${output} }}`);
      return;
    }
    if (selected.startsWith('dep:')) {
      const dep = selected.slice('dep:'.length);
      setPickerOpen(true);
      let outputs: string[] = [];
      try {
        if (resolveDepOutputs) {
          const resolved = await resolveDepOutputs(dep);
          outputs = Array.isArray(resolved) ? resolved : [];
        }
      } catch {
        outputs = [];
      }
      setPickerOutputs({ dep, outputs });
    }
  };

  if (binding.kind !== 'constant') {
    const currentExpr = typeof row.value === 'string' ? row.value.trim() : '';
    return (
      <>
        <Input
          readOnly
          value={bindingLabel(binding)}
          style={{ background: '#f5f5f5', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
          addonAfter={
            <Select<string>
              size="small"
              value={bindingSelectValue}
              onChange={handleSelect}
              options={bindingOptions}
              style={{ minWidth: 160 }}
            />
          }
        />
        {autoWireCandidates.length > 0 ? (
          <AutoWiredChip
            current={currentExpr}
            candidates={autoWireCandidates}
            onPick={(next) =>
              onChange(next.kind === 'not-wired' ? '' : next.expression)
            }
          />
        ) : null}
        <BindingPickerDrawer
          open={pickerOpen}
          state={pickerOutputs}
          onClose={() => {
            setPickerOpen(false);
            setPickerOutputs(null);
          }}
          onPick={(output) => {
            if (!pickerOutputs) return;
            onChange(`\${{ steps.${pickerOutputs.dep}.outputs.${output} }}`);
            setPickerOpen(false);
            setPickerOutputs(null);
          }}
        />
      </>
    );
  }

  // Constant path
  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        {renderValueControl(row, binding.display, onChange)}
        <Select<string>
          size="small"
          value={bindingSelectValue}
          onChange={handleSelect}
          options={bindingOptions}
          style={{ minWidth: 160 }}
        />
      </Space.Compact>
      {autoWireCandidates.length > 0 ? (
        <AutoWiredChip
          current={null}
          candidates={autoWireCandidates}
          onPick={(next) =>
            onChange(next.kind === 'not-wired' ? '' : next.expression)
          }
        />
      ) : null}
      <BindingPickerDrawer
        open={pickerOpen}
        state={pickerOutputs}
        onClose={() => {
          setPickerOpen(false);
          setPickerOutputs(null);
        }}
        onPick={(output) => {
          if (!pickerOutputs) return;
          onChange(`\${{ steps.${pickerOutputs.dep}.outputs.${output} }}`);
          setPickerOpen(false);
          setPickerOutputs(null);
        }}
      />
    </>
  );
}

function renderValueControl(
  row: KeyValueRow,
  fallback: string,
  onChange: (next: unknown) => void,
): React.JSX.Element {
  switch (row.kind) {
    case 'boolean':
      return (
        <Switch
          checked={Boolean(row.value)}
          onChange={(checked) => onChange(checked)}
          style={{ width: '100%' }}
        />
      );
    case 'integer':
    case 'number': {
      const numeric = typeof row.value === 'number' ? row.value : parseFloat(String(fallback));
      return (
        <InputNumber
          style={{ width: '100%' }}
          step={row.kind === 'integer' ? 1 : 0.01}
          value={Number.isFinite(numeric) ? numeric : undefined}
          onChange={(value) => onChange(value ?? 0)}
        />
      );
    }
    case 'list':
    case 'json': {
      const text = typeof row.value === 'string' ? row.value : '';
      let valid = true;
      try {
        if (text.trim()) JSON.parse(text);
      } catch {
        valid = false;
      }
      return (
        <div style={{ width: '100%' }}>
          <Input.TextArea
            rows={row.kind === 'list' ? 2 : 4}
            value={text}
            spellCheck={false}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
            onChange={(event) => onChange(event.target.value)}
            placeholder={row.kind === 'list' ? '["a", "b"]' : '{"k": "v"}'}
          />
          {!valid && text.trim() ? (
            <div style={{ marginTop: 4 }}>
              <Alert
                type="warning"
                showIcon
                message="Invalid JSON — value will be saved as raw text."
                style={{ padding: '2px 8px', fontSize: 12 }}
              />
            </div>
          ) : null}
        </div>
      );
    }
    case 'string':
    default:
      return (
        <Input value={fallback} onChange={(event) => onChange(event.target.value)} placeholder="value" />
      );
  }
}

function BindingPickerDrawer({
  open,
  state,
  onClose,
  onPick,
}: {
  open: boolean;
  state: { dep: string; outputs: string[] } | null;
  onClose: () => void;
  onPick: (output: string) => void;
}): React.JSX.Element {
  return (
    <Drawer
      title={state ? `Pick output from "${state.dep}"` : 'Pick output'}
      open={open}
      onClose={onClose}
      width={360}
    >
      {state && state.outputs.length === 0 ? (
        <Typography.Text type="secondary">
          This step has no declared outputs. Use a constant instead.
        </Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {state?.outputs.map((output) => (
            <Button key={output} block onClick={() => onPick(output)}>
              <code>{output}</code>
            </Button>
          ))}
        </Space>
      )}
    </Drawer>
  );
}
