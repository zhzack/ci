import React from "react";
import { YamlEditor } from '@/components/YamlEditor';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Tooltip,
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
import { useQueries as useApiQueries } from '@tanstack/react-query';
import { useApiMutation } from '@/hooks/useApiMutation';
import { listPlugins, getPluginManifest } from '@/api/plugin';
import { createPipeline, getPipelineYaml, updatePipeline } from '@/api/pipeline';
import {
  KeyValueEditor,
  AutoWiredChip,
  KEY_VALUE_KINDS,
  entryToRow,
  inferKind,
  type KeyValueKind,
  type KeyValueRow,
  type WiringSelection,
  detectBinding,
} from '@/components/KeyValueEditor';
import type { PluginManifest, PluginManifestValue, PluginVersion } from '@/types/plugin';

type InputKind = 'string' | 'integer' | 'number' | 'boolean' | 'list' | 'directory' | 'file' | 'object' | 'unknown';

function inferInputKind(value: PluginManifestValue | undefined): InputKind {
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
  cache?: boolean;
  retries?: number;
  machine?: string;
};

/** A candidate wiring the platform could apply for one param key.
 *  Surfaced in the UI as a per-row chip with a switch menu; the user can
 *  pick any candidate or "not wired".
 */
export type WiringChoice =
  | { kind: 'expr'; expression: string; label: string }
  | { kind: 'not-wired'; expression: '' };

export type WiringCandidate = {
  /** Display label, e.g. "a.outputs.threshold" or "all.deps.outputs.x". */
  label: string;
  /** The expression to insert when this candidate is chosen. */
  expression: string;
  /** Which upstream step produces the value. Empty for all_deps. */
  dep: string;
  /** Output key on the dep. Empty for all_deps. */
  output: string;
};

export type AutoWirePlan = {
  /** One entry per key observed in the step's resolved param set
   *  (declared inputs + Advanced rows). Ordered by dep presence then key. */
  candidates: Record<string, WiringCandidate[]>;
  /** The platform's default pick per key, or null when no upstream can wire it. */
  defaultChoice: Record<string, WiringChoice>;
};

function serialiseRowValue(row: KeyValueRow): unknown {
  if (row.value === undefined || row.value === null || row.value === '') {
    return '';
  }
  switch (row.kind) {
    case 'boolean':
      return Boolean(row.value);
    case 'integer': {
      const parsed = typeof row.value === 'number'
        ? row.value
        : parseInt(String(row.value), 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'number': {
      const parsed = typeof row.value === 'number'
        ? row.value
        : parseFloat(String(row.value));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case 'list':
    case 'json': {
      const text = typeof row.value === 'string' ? row.value : '';
      const trimmed = text.trim();
      if (!trimmed) return [];
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    }
    case 'string':
    default:
      return typeof row.value === 'string' ? row.value : String(row.value);
  }
}

/** Serialise a Pipeline-level (global) parameter value to a YAML-safe form.
 *  Mirrors `serialiseRowValue` but is keyed off `(kind, raw)` since global
 *  params don't carry a row id, just a key.
 */
function serialiseGlobalRowValue(kind: KeyValueKind, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return '';
  switch (kind) {
    case 'boolean':
      return Boolean(raw);
    case 'integer': {
      const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : 0;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      return Number.isFinite(n) ? n : 0;
    }
    case 'list':
    case 'json': {
      const text = typeof raw === 'string' ? raw : '';
      const trimmed = text.trim();
      if (!trimmed) return [];
      try {
        return JSON.parse(trimmed);
      } catch {
        return text;
      }
    }
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

/* -------------------------------------------------------------------------
 * Auto-wire engine
 *
 * One function powers both the declared-input rows and the Advanced (free-form)
 * rows. The platform's default behaviour: when a step's input key appears in
 * at least one upstream dep's declared outputs, surface those deps as wiring
 * candidates. The UI shows a per-row chip listing every candidate plus a
 * "Not wired" option. When there's exactly one candidate, the chip is set as
 * the row's default expression automatically. When there are multiple, the
 * user must pick — the chip is left empty until then. When no dep provides
 * the key, no chip is shown.
 *
 * The function is pure: it does not mutate step.params.
 * ------------------------------------------------------------------------- */

type ManifestLike = {
  inputs: ArrayLike<{ name: string }> | Record<string, unknown>;
  outputs: ArrayLike<{ name: string }> | Record<string, unknown>;
};

function manifestInputNames(manifest: ManifestLike | undefined): string[] {
  if (!manifest) return [];
  // Prefer the v2 nested `contract.inputs`; fall back to flat `inputs`.
  const inputs: unknown = (manifest as { contract?: { inputs?: unknown } }).contract?.inputs ?? manifest.inputs;
  if (inputs == null) return [];
  return Array.isArray(inputs)
    ? (inputs as Array<{ name: string }>).map((r) => r.name)
    : Object.keys(inputs as Record<string, unknown>);
}

function manifestOutputNames(manifest: ManifestLike | undefined): string[] {
  if (!manifest) return [];
  const outputs: unknown = (manifest as { contract?: { outputs?: unknown } }).contract?.outputs ?? manifest.outputs;
  if (outputs == null) return [];
  return Array.isArray(outputs)
    ? (outputs as Array<{ name: string }>).map((r) => r.name)
    : Object.keys(outputs as Record<string, unknown>);
}

export function resolveAutoWirePlan(
  step: StepDraft,
  steps: StepDraft[],
  manifests: Record<string, ManifestLike | undefined>,
): AutoWirePlan {
  const myManifest = manifests[step.pluginRef];
  const declaredKeys = manifestInputNames(myManifest);

  // All candidate keys = declared inputs ∪ Advanced rows (i.e. step.params keys
  // that aren't in declaredKeys).
  const keys = new Set<string>(declaredKeys);
  for (const key of Object.keys(step.params ?? {})) {
    if (!declaredKeys.includes(key)) keys.add(key);
  }

  const candidates: Record<string, WiringCandidate[]> = {};
  const defaultChoice: Record<string, WiringChoice> = {};

  for (const key of keys) {
    const offerings: WiringCandidate[] = [];

    // Walk the declared deps in order. The UI keeps the same order we follow.
    for (const depName of step.depends) {
      const depStep = steps.find((s) => s.name === depName);
      if (!depStep) continue;
      const depManifest = manifests[depStep.pluginRef];
      const outputs = manifestOutputNames(depManifest);
      if (outputs.includes(key)) {
        offerings.push({
          label: `${depName}.outputs.${key}`,
          expression: `\${{ steps.${depName}.outputs.${key} }}`,
          dep: depName,
          output: key,
        });
      }
    }

    if (offerings.length === 1) {
      // Single upstream gives us a safe default — fill in only when the current
      // value is empty or already pointing to params.<key>.
      const current = step.params[key];
      const expression = offerings[0]!.expression;
      const isUnset =
        current === undefined ||
        current === null ||
        current === '' ||
        (typeof current === 'string' && /^\$\{\{\s*params\.[A-Za-z0-9_.-]+\s*\}\}$/.test(current.trim()));
      if (isUnset) {
        defaultChoice[key] = { kind: 'expr', expression, label: offerings[0]!.label };
      }
    } else if (offerings.length > 1) {
      // Multi-dep ambiguity — force the user to pick.
      defaultChoice[key] = { kind: 'not-wired', expression: '' };
    }
    // offerings.length === 0 → no upstream matches this key; nothing to surface.

    if (offerings.length > 0) {
      candidates[key] = offerings;
    }
  }

  return { candidates, defaultChoice };
}

/** Materialise the auto-wire defaults into a fresh params object.
 *  Caller passes the plan and the current params; returns a merged map
 *  where platform-default expressions are filled in for unset keys.
 */
export function applyAutoWireDefaults(
  step: StepDraft,
  plan: AutoWirePlan,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...step.params };
  for (const [key, choice] of Object.entries(plan.defaultChoice)) {
    if (choice.kind === 'expr') {
      const current = result[key];
      const isUnset =
        current === undefined ||
        current === null ||
        current === '' ||
        (typeof current === 'string' && /^\$\{\{\s*params\.[A-Za-z0-9_.-]+\s*\}\}$/.test(current.trim()));
      if (isUnset) {
        result[key] = choice.expression;
      }
    }
  }
  return result;
}

/* -------------------------------------------------------------------------
 * Save-time validation
 *
 * Two severity levels:
 *   - `error` blocks Save (declared.required has no resolvable source)
 *   - `warning` lets Save pass (advanced row duplicates a declared key,
 *     stale dep reference, etc.)
 * ------------------------------------------------------------------------- */

export type SaveIssue = {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Optional key/path for click-to-focus later. */
  key?: string;
};

function bindingExpr(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\$\{\{[^{}]+\}\}$/.test(trimmed)) return trimmed;
  }
  return null;
}

function extractParamKeyFromExpr(expr: string): string | null {
  const m = /^\$\{\{\s*params\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/.exec(expr.trim());
  return m ? (m[1] ?? null) : null;
}

function extractStepOutFromExpr(
  expr: string,
): { dep: string; output: string } | null {
  const m = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}$/.exec(
    expr.trim(),
  );
  return m ? { dep: m[1]!, output: m[2]! } : null;
}

export function buildSaveIssues(
  step: StepDraft,
  plan: AutoWirePlan,
  declaredKeys: string[],
  manifests: Record<string, ManifestLike | undefined>,
): SaveIssue[] {
  const issues: SaveIssue[] = [];

  // 1) declared.required with no resolvable source.
  for (const key of declaredKeys) {
    const value = step.params[key];
    const required = isRequiredInput(manifests[step.pluginRef], key);
    if (!required) continue;
    const hasValue =
      value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
    if (hasValue) {
      // Even with a value, check it's a valid binding.
      const bindingKind = classifyValue(value);
      if (bindingKind === 'invalid') {
        issues.push({
          severity: 'error',
          code: 'INVALID_BINDING',
          message: `Required input '${key}' has an unrecognised value.`,
          key,
        });
      }
      continue;
    }
    // No value. Acceptable if the param will resolve at runtime via the
    // pipeline.params (i.e. the binding form is `params.<key>` and that
    // pipeline param will be supplied at run time).
    const expectedParamsKey = key;
    const isPendingParamBinding = Object.values(plan.defaultChoice).some(
      (choice) => choice.kind === 'expr' && extractParamKeyFromExpr(choice.expression) === expectedParamsKey,
    );
    if (!isPendingParamBinding) {
      issues.push({
        severity: 'error',
        code: 'REQUIRED_UNRESOLVED',
        message: `Required input '${key}' has no value. Add a default, wire an upstream step output, or supply it as a pipeline param at run time.`,
        key,
      });
    }
  }

  // 2) Stale step-output references (dep was removed).
  for (const [key, value] of Object.entries(step.params ?? {})) {
    const expr = bindingExpr(value);
    if (!expr) continue;
    const stepOut = extractStepOutFromExpr(expr);
    if (!stepOut) continue;
    if (!step.depends.includes(stepOut.dep)) {
      issues.push({
        severity: 'warning',
        code: 'STALE_STEP_REFERENCE',
        message: `Input '${key}' references '${stepOut.dep}.outputs.${stepOut.output}' but '${stepOut.dep}' is no longer a dep. Remove the expression or re-add the dep.`,
        key,
      });
      continue;
    }
    const depStepKey = step.depends.find((d) => d === stepOut.dep);
    if (depStepKey) {
      const depManifestKey = step.pluginRef; // not used here; placeholder
      void depManifestKey;
    }
  }

  // 3) Multi-dep ambiguity: surfaced as a warning so users know nothing
  //    auto-picked for them.
  for (const [key, choice] of Object.entries(plan.defaultChoice)) {
    if (choice.kind === 'not-wired') {
      const value = step.params[key];
      const candidates = plan.candidates[key] ?? [];
      if (candidates.length > 1 && (value === undefined || value === null || value === '')) {
        issues.push({
          severity: 'warning',
          code: 'MULTI_UPSTREAM_PICK_REQUIRED',
          message: `Input '${key}' is produced by ${candidates.length} upstream steps. Pick one from the chip menu (or "Not wired").`,
          key,
        });
      }
    }
  }

  return issues;
}

function classifyValue(value: unknown): 'constant' | 'binding' | 'invalid' | 'empty' {
  if (value === undefined || value === null) return 'empty';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 'empty';
    if (/^\$\{\{[^{}]+\}\}$/.test(trimmed)) return 'binding';
    return 'constant';
  }
  return 'constant';
}

function isRequiredInput(manifest: ManifestLike | undefined, key: string): boolean {
  if (!manifest) return false;
  const inputs: unknown = (manifest as { contract?: { inputs?: unknown } }).contract?.inputs ?? manifest.inputs;
  if (Array.isArray(inputs)) {
    const found = (inputs as Array<{ name: string; required?: boolean }>).find((i) => i.name === key);
    return Boolean(found?.required);
  }
  const dict = inputs as Record<string, { required?: boolean }>;
  return Boolean(dict[key]?.required);
}

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
  params: {},
  steps: [
    {
      key: 'gen',
      name: 'gen',
      pluginRef: 'num-gen@1.0.0',
      depends: [],
      params: {},
    },
    {
      key: 'double',
      name: 'double',
      pluginRef: 'num-double@1.0.0',
      depends: ['gen'],
      params: {
        value: '${{ steps.gen.outputs.value }}',
      },
    },
    {
      key: 'triple',
      name: 'triple',
      pluginRef: 'num-triple@1.0.0',
      depends: ['gen'],
      params: {
        value: '${{ steps.gen.outputs.value }}',
      },
    },
    {
      key: 'sum',
      name: 'sum',
      pluginRef: 'num-sum@1.0.0',
      depends: ['double', 'triple'],
      params: {
        values: '${{ all.deps.outputs.result }}',
      },
    },
  ],
};

function toYamlPreview(state: FormState): string {
  const filterEmpty = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === '') continue;
      out[k] = v;
    }
    return out;
  };
  return yaml.dump(
    {
      name: state.name || 'my-pipeline',
      params: filterEmpty(state.params ?? {}),
      steps: state.steps.map((step) => ({
        name: step.name,
        plugin: step.pluginRef,
        ...(step.depends.length > 0 ? { depends: step.depends } : {}),
        ...(step.cache ? { cache: true } : {}),
        ...(typeof step.retries === 'number' && step.retries > 0 ? { retries: step.retries } : {}),
        ...(step.machine ? { machine: step.machine } : {}),
        ...(Object.keys(step.params ?? {}).filter(Boolean).length > 0
          ? { with: filterEmpty(step.params ?? {}) }
          : {}),
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
      cache: Boolean(stepObj.cache),
      retries: typeof stepObj.retries === 'number' ? stepObj.retries : 0,
      machine: typeof stepObj.machine === 'string' ? stepObj.machine : undefined,
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
  const [globalUsageKey, setGlobalUsageKey] = useState<string | null>(null);

  /** Reverse-index: every step param value that is a `${{ params.X }}` binding
   *  is mapped to the global param X with the consuming (step, input). */
  const globalUsage = useMemo(() => {
    const map: Record<string, Array<{ stepName: string; inputKey: string; expr: string }>> = {};
    const KEY_RE = /\$\{\{\s*params\.([A-Za-z_][A-Za-z0-9_.-]*)/g;
    const visit = (stepName: string, inputKey: string, rawValue: unknown) => {
      if (typeof rawValue !== 'string') return;
      const expr = rawValue;
      for (const m of expr.matchAll(KEY_RE)) {
        const key = m[1]!;
        const list = map[key] ?? [];
        list.push({ stepName, inputKey, expr });
        map[key] = list;
      }
    };
    for (const step of state.steps) {
      for (const [inputKey, value] of Object.entries(step.params ?? {})) {
        visit(step.name, inputKey, value);
      }
    }
    return map;
  }, [state.steps]);

  type GlobalParamRow = {
    id: string;
    key: string;
    kind: KeyValueKind;
    value: unknown;
  };

  const globalParamRows = useMemo<GlobalParamRow[]>(() => {
    return Object.entries(state.params ?? {}).map(([key, value], idx) => ({
      // Stable id derived from index + key — avoids Math.random() which
      // would regenerate on every render and cause inputs to lose focus.
      id: `gp-${idx}-${key}`,
      key,
      kind: inferKind(value),
      value,
    }));
  }, [state.params]);

  const updateGlobalRow = (index: number, patch: Partial<GlobalParamRow>) => {
    setState((current) => {
      const entries = Object.entries(current.params ?? {});
      const prev = entries[index] ?? ['', ''];
      const nextKey = patch.key !== undefined ? patch.key : prev[0];
      const nextValue = patch.value !== undefined ? patch.value : prev[1];
      const nextKind = patch.kind !== undefined ? patch.kind : inferKind(nextValue);
      entries[index] = [nextKey, serialiseGlobalRowValue(nextKind, nextValue)];
      const next: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (!k) continue;
        next[k] = v;
      }
      return { ...current, params: next };
    });
  };

  const removeGlobalRow = (index: number) => {
    setState((current) => {
      const entries = Object.entries(current.params ?? {}).filter((_, i) => i !== index);
      const next: Record<string, unknown> = {};
      for (const [k, v] of entries) if (k) next[k] = v;
      return { ...current, params: next };
    });
  };

  const addGlobalRow = () => {
    setState((current) => {
      let n = 1;
      let key = `param_${n}`;
      const taken = new Set(Object.keys(current.params ?? {}));
      while (taken.has(key)) {
        n += 1;
        key = `param_${n}`;
      }
      return { ...current, params: { ...(current.params ?? {}), [key]: '' } };
    });
  };

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

  const pluginsQuery = useApiQuery(['plugins'], () =>
    listPlugins({ page: 1, page_size: 200 }),
  );
  const plugins = useMemo<PluginVersion[]>(
    () => pluginsQuery.data?.items ?? [],
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
      const rawInputs: unknown =
        (manifest as { contract?: { inputs?: unknown } }).contract?.inputs ??
        (manifest as { inputs?: unknown }).inputs;
      const inputs = (rawInputs ?? {}) as Record<string, unknown>;
      const items: Array<{ name: string; required?: boolean; type?: string; default?: unknown; source?: string }> = Array.isArray(inputs)
        ? (inputs as Array<{ name: string; required?: boolean; type?: string; default?: unknown; source?: string }>)
        : Object.entries(inputs as Record<string, { required?: boolean; type?: string; default?: unknown; source?: string }>).map(
            ([name, spec]) => ({ name, ...spec }),
          );
      for (const spec of items) {
        const key = spec.name;
        if (spec.required) {
          autoParams[key] = `\${{ params.${key} }}`;
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

    // When the dependency set changes, the auto-wire planner re-runs against
    // the projected step. We:
    //   1. clear out any binding that references a dep being removed;
    //   2. fetch manifests for the new dep list + the current step;
    //   3. apply platform defaults into the params (single-source keys
    //      become expressions, multi-source keys stay unset and surface via
    //      the chip later).
    if (patch.depends !== undefined) {
      const currentStep = state.steps[index];
      if (!currentStep) return;
      const removedDeps = currentStep.depends.filter((d) => !patch.depends!.includes(d));
      // Clear stale step-output bindings pointing at a removed dep.
      for (const [key, value] of Object.entries(currentStep.params ?? {})) {
        if (typeof value !== 'string') continue;
        const m = /^\$\{\{\s*steps\.([A-Za-z_][A-Za-z0-9_.-]*)\.outputs\.[^{}]+\s*\}\}$/.exec(
          value.trim(),
        );
        if (!m) continue;
        const depName = m[1];
        if (depName && removedDeps.includes(depName)) {
          extraParams[key] = '';
        }
      }

      // Build a manifest cache for the projected step + its deps.
      const projectedRef = patch.pluginRef ?? currentStep.pluginRef;
      const cache: Record<string, ManifestLike | undefined> = { [projectedRef]: undefined };
      try {
        const [name, version] = projectedRef.split('@');
        cache[projectedRef] = await getPluginManifest(name ?? '', version ?? '');
      } catch {
        // ignore
      }
      for (const depName of patch.depends) {
        const depStep = state.steps.find((s) => s.name === depName);
        if (!depStep) continue;
        if (!(depStep.pluginRef in cache)) {
          try {
            const [name, version] = depStep.pluginRef.split('@');
            cache[depStep.pluginRef] = await getPluginManifest(name ?? '', version ?? '');
          } catch {
            // ignore
          }
        }
      }

      const projected: StepDraft = {
        ...currentStep,
        ...patch,
        depends: patch.depends,
        params: { ...currentStep.params, ...extraParams },
      };
      const plan = resolveAutoWirePlan(projected, state.steps, cache);
      const wireDefaults = applyAutoWireDefaults(projected, plan);
      // Single-source keys land here with their expression set; user-touched
      // keys are preserved by applyAutoWireDefaults.
      Object.assign(extraParams, wireDefaults);
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

  const [allIssues, setAllIssues] = useState<SaveIssue[]>([]);
  const handleStepIssues = useCallback(
    (stepIndex: number, issues: SaveIssue[]) => {
      const prefix = `__step_${stepIndex}__`;
      const tagged: SaveIssue[] = issues.map((i) => ({ ...i, code: prefix + i.code }));
      setAllIssues((prev) => {
        const others = prev.filter((i) => !i.code.startsWith(prefix));
        const candidate = [...others, ...tagged];
        // De-dupe by signature to short-circuit identical writes — keeps
        // StepCard→Main→StepCard render-storm from looping.
        const sigOf = (list: SaveIssue[]) =>
          list
            .map((i) => `${i.severity}|${i.code}|${i.message}|${i.key ?? ''}`)
            .join('\n');
        if (sigOf(candidate) === sigOf(prev)) return prev;
        return candidate;
      });
    },
    [],
  );

  const blockingErrors = allIssues.filter((i) => i.severity === 'error');

  const handleSave = async () => {
    if (!state.name.trim()) {
      antdMessage.error('Pipeline name is required');
      return;
    }
    if (state.steps.length === 0) {
      antdMessage.error('Add at least one step');
      return;
    }
    if (blockingErrors.length > 0) {
      antdMessage.error(
        `${blockingErrors.length} issue${blockingErrors.length === 1 ? '' : 's'} must be resolved before saving.`,
      );
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
              disabled={blockingErrors.length > 0 || !state.name.trim() || state.steps.length === 0}
              onClick={handleSave}
            >
              Save pipeline
              {blockingErrors.length > 0 ? ` (${blockingErrors.length} blocking)` : null}
            </Button>
          </Space>
        }
      />
      {blockingErrors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${blockingErrors.length} blocking issue${blockingErrors.length === 1 ? '' : 's'} prevent Save`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {blockingErrors.map((i) => {
                const m = /^__step_(\d+)__/.exec(i.code);
                const stepIndex = m ? Number(m[1]) : -1;
                const label = i.message;
                const clickable = stepIndex >= 0;
                return (
                  <li key={i.code} style={{ marginBottom: 4 }}>
                    {clickable ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ padding: 0, height: 'auto', textAlign: 'left' }}
                        onClick={() => {
                          const card = document.getElementById(
                            `step-card-${stepIndex}`,
                          );
                          if (card) {
                            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            card.classList.add('mp-step-card-highlight');
                            window.setTimeout(() => {
                              card.classList.remove('mp-step-card-highlight');
                            }, 2000);
                          }
                          if (i.key) {
                            const inputId = `step-input-${stepIndex}-${i.key}`;
                            window.setTimeout(() => {
                              const target = document.getElementById(inputId);
                              if (target instanceof HTMLElement) {
                                target.classList.add('mp-input-highlight');
                                const focusable =
                                  target.querySelector('input, textarea') ||
                                  target;
                                if (focusable instanceof HTMLElement) {
                                  focusable.focus();
                                  try {
                                    (focusable as HTMLInputElement).select?.();
                                  } catch {
                                    /* noop */
                                  }
                                }
                                window.setTimeout(() => {
                                  target.classList.remove('mp-input-highlight');
                                }, 2000);
                              }
                            }, 300);
                          }
                        }}
                      >
                        → Step {stepIndex + 1}: {label}
                      </Button>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          }
        />
      ) : allIssues.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${allIssues.length} warning${allIssues.length === 1 ? '' : 's'}`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {allIssues.slice(0, 6).map((i) => (
                <li key={i.code}>{i.message}</li>
              ))}
              {allIssues.length > 6 ? <li>… and {allIssues.length - 6} more</li> : null}
            </ul>
          }
        />
      ) : null}
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
                  <Form.Item label="Pipeline-level parameters (set by Run)">
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      {globalParamRows.length === 0 ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          No top-level parameters. Add ones referenced by steps via{' '}
                          <code>$&#123;&#123; params.X &#125;&#125;</code>.
                        </Typography.Text>
                      ) : null}
                      {globalParamRows.map((row, idx) => {
                        const seen = globalParamRows.filter(
                          (other, otherIdx) => otherIdx !== idx && other.key === row.key,
                        );
                        const duplicate = seen.length > 0 && row.key !== '';
                        const empty = row.key === '';
                        const usageList = row.key ? (globalUsage[row.key] ?? []) : [];
                        const usageLabel =
                          usageList.length === 0
                            ? '— unused —'
                            : `used by ${usageList.length} step${usageList.length === 1 ? '' : 's'}`;
                        return (
                          <div
                            key={row.id}
                            style={{
                              border: '1px solid var(--mp-border-color, #f0f0f0)',
                              borderRadius: 6,
                              padding: 8,
                              background: duplicate || empty ? 'rgba(250, 173, 20, 0.15)' : 'var(--mp-bg-subtle, #fafafa)',
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
                                placeholder="param_name"
                                status={duplicate || empty ? 'warning' : ''}
                                onChange={(event) => updateGlobalRow(idx, { key: event.target.value })}
                              />
                              <Select<KeyValueKind>
                                value={row.kind}
                                options={KEY_VALUE_KINDS.map((kind) => ({ value: kind, label: kind }))}
                                onChange={(kind) => updateGlobalRow(idx, { kind })}
                              />
                              <GlobalParamValueControl
                                row={row}
                                onChange={(value) => updateGlobalRow(idx, { value })}
                              />
                              <Tooltip title="Remove parameter">
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => removeGlobalRow(idx)}
                                />
                              </Tooltip>
                              <Button
                                size="small"
                                type="link"
                                onClick={() => setGlobalUsageKey(row.key || null)}
                              >
                                {usageLabel}
                              </Button>
                            </div>
                            {duplicate ? (
                              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                                Duplicate key — last row wins.
                              </Typography.Text>
                            ) : null}
                            {empty ? (
                              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                                Empty key — row ignored at save.
                              </Typography.Text>
                            ) : null}
                          </div>
                        );
                      })}
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={addGlobalRow}
                      >
                        Add parameter
                      </Button>
                    </Space>
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
                        allSteps={state.steps}
                        availableDependencies={state.steps
                          .filter((_, otherIndex) => otherIndex < index)
                          .map((other) => other.name)}
                        depStepRefs={state.steps
                          .slice(0, index)
                          .filter((s) => step.depends.includes(s.name))
                          .map((s) => ({ name: s.name, pluginRef: s.pluginRef }))}
                        pluginOptions={pluginOptions}
                        pipelineParamKeys={Object.keys(state.params ?? {})}
                        onChange={(patch) => updateStep(index, patch)}
                        onRemove={() => removeStep(index)}
                        onIssuesChange={handleStepIssues}
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
                <YamlEditor
                  value={yamlText}
                  onChange={setYamlText}
                  height={520}
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
              <PluginPickerCard
                key={plugin.id}
                plugin={plugin}
                onClick={() => addStep(`${plugin.name}@${plugin.version}`)}
              />
            ))}
          </Space>
        )}
      </Drawer>
      <Drawer
        title={
          globalUsageKey
            ? `Where is "${globalUsageKey}" used?`
            : 'Where is this parameter used?'
        }
        open={globalUsageKey !== null}
        onClose={() => setGlobalUsageKey(null)}
        width={420}
      >
        {globalUsageKey === null ? null : (globalUsage[globalUsageKey] ?? []).length === 0 ? (
          <Typography.Text type="secondary">
            No step currently references this parameter. Add{' '}
            <code>{`{{ params.${globalUsageKey} }}`}</code> to a step input
            (or set the relevant default) to bind it.
          </Typography.Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {(globalUsage[globalUsageKey ?? ''] ?? []).map((usage) => (
              <Button
                key={`${usage.stepName}/${usage.inputKey}`}
                block
                onClick={() => {
                  // Find the step index in state.steps by name and scroll to it.
                  const stepIndex = state.steps.findIndex(
                    (s) => s.name === usage.stepName,
                  );
                  if (stepIndex >= 0) {
                    const card = document.getElementById(
                      `step-card-${stepIndex}`,
                    );
                    if (card) {
                      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      window.setTimeout(() => {
                        const inputId = `step-input-${stepIndex}-${usage.inputKey}`;
                        const target = document.getElementById(inputId);
                        if (target instanceof HTMLElement) {
                          target.classList.add('mp-input-highlight');
                          target.focus();
                          window.setTimeout(() => {
                            target.classList.remove('mp-input-highlight');
                          }, 2000);
                        }
                      }, 300);
                    }
                  }
                  setGlobalUsageKey(null);
                }}
              >
                <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                  {usage.stepName} → {usage.inputKey}
                </code>
              </Button>
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
  allSteps: StepDraft[];
  availableDependencies: string[];
  depStepRefs: { name: string; pluginRef: string }[];
  pluginOptions: { label: string; value: string; description?: string }[];
  pipelineParamKeys: string[];
  onChange: (patch: Partial<StepDraft>) => void;
  onRemove: () => void;
  onIssuesChange?: (index: number, issues: SaveIssue[]) => void;
};

function StepCard({
  index,
  step,
  allSteps,
  availableDependencies,
  depStepRefs,
  pluginOptions,
  pipelineParamKeys,
  onChange,
  onRemove,
  onIssuesChange,
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
  const inputs = useMemo<Record<string, PluginManifestValue>>(() => {
    /* The /manifest response nests inputs/outputs under `contract` when the
     * plugin uses the v2 format.  Fall back to the legacy flat fields. */
    const raw: unknown =
      (manifest as { contract?: { inputs?: unknown } } | undefined)?.contract?.inputs ??
      manifest?.inputs;
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const out: Record<string, PluginManifestValue> = {};
      for (const item of raw as PluginManifestValue[]) {
        if (item && typeof item === 'object' && 'name' in item) {
          out[(item as { name: string }).name] = item;
        }
      }
      return out;
    }
    return raw as Record<string, PluginManifestValue>;
  }, [manifest]);
  const declaredKeys = useMemo(() => Object.keys(inputs), [inputs]);

  // Per-dep manifest queries. Same key as the StepCard fetch — TanStack Query
  // dedupes across components, so this is a no-op except for the first time
  // a dep appears in the pipeline.
  const depManifests = useApiQueries({
    queries: depStepRefs.map((d) => ({
      queryKey: ['plugin-manifest', d.pluginRef] as const,
      queryFn: async () => {
        const [name, version] = d.pluginRef.split('@');
        return getPluginManifest(name ?? '', version ?? '');
      },
      enabled: d.pluginRef.includes('@'),
    })),
  });
  const depManifestByName = useMemo(() => {
    const map: Record<string, PluginManifest | undefined> = {};
    depStepRefs.forEach((d, idx) => {
      map[d.name] = depManifests[idx]?.data as PluginManifest | undefined;
    });
    return map;
  }, [depStepRefs, depManifests]);

  // Manifest cache for the auto-wire planner: own + every dep.
  const manifestsForPlan = useMemo(() => {
    const cache: Record<string, ManifestLike | undefined> = {};
    cache[step.pluginRef] = manifest;
    for (const d of depStepRefs) {
      cache[d.pluginRef] = depManifestByName[d.name];
    }
    return cache;
  }, [step.pluginRef, manifest, depStepRefs, depManifestByName]);

  // Auto-wire plan. Multi-source keys surface a dropdown; single-source
  // keys land the wiring expression directly into the row's default.
  const autoWirePlan = useMemo(
    () => resolveAutoWirePlan(step, allSteps, manifestsForPlan),
    [step, allSteps, manifestsForPlan],
  );

  // Issue tracking for Save validation.
  const wireIssues = useMemo(
    () => buildSaveIssues(step, autoWirePlan, declaredKeys, manifestsForPlan),
    [step, autoWirePlan, declaredKeys, manifestsForPlan],
  );

  // Push a stable signature upward so Main doesn't loop on every render.
  // Including `index` and the per-issue content (severity/code/message/key)
  // means child re-renders that recompute the same issues won't re-trigger
  // the parent's setState — only real changes flow through.
  const issueSignature = useMemo(
    () =>
      wireIssues
        .map((i) => `${i.severity}|${i.code}|${i.message}|${i.key ?? ''}`)
        .join('\n'),
    [wireIssues],
  );
  useEffect(() => {
    if (onIssuesChange) onIssuesChange(index, wireIssues);
    return () => {
      if (onIssuesChange) onIssuesChange(index, []);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, issueSignature, onIssuesChange]);

  const pickWiring = (key: string, choice: WiringChoice) => {
    const next = { ...step.params };
    if (choice.kind === 'not-wired') {
      next[key] = '';
    } else {
      next[key] = choice.expression;
    }
    onChange({ params: next });
  };

  const declaredExtras = useMemo(() => {
    return Object.fromEntries(
      Object.entries(step.params ?? {}).filter(([key]) => declaredKeys.includes(key)),
    );
  }, [step.params, declaredKeys]);

  const extraRows = useMemo<KeyValueRow[]>(() => {
    return Object.entries(step.params ?? {})
      .filter(([key]) => !declaredKeys.includes(key))
      .map(([key, value]) => entryToRow(key, value));
  }, [step.params, declaredKeys]);

  const resolveDepOutputs = async (depName: string): Promise<string[]> => {
    const depStep = depStepRefs.find((d) => d.name === depName);
    if (!depStep) return [];
    const [name, version] = depStep.pluginRef.split('@');
    try {
      const depManifest = await getPluginManifest(name ?? '', version ?? '');
      const outMap: unknown =
        (depManifest as { contract?: { outputs?: unknown } }).contract?.outputs ??
        (depManifest as { outputs?: unknown }).outputs ??
        {};
      const arr = Array.isArray(outMap)
        ? (outMap as Array<{ name: string }>).map((r) => r.name)
        : Object.keys((outMap ?? {}) as Record<string, unknown>);
      return arr;
    } catch {
      return [];
    }
  };

  const handleExtraChange = (rows: KeyValueRow[]) => {
    const seen = new Set<string>();
    const next: Record<string, unknown> = { ...declaredExtras };
    for (const row of rows) {
      const key = row.key.trim();
      // Allow empty keys through so the added row survives in step.params
      // and re-appears in `extraRows` on next render. The UI warns about
      // empty keys; `toYamlPreview` skips them automatically (Object.keys
      // with empty string is still a valid key in JS).
      if (seen.has(key)) continue;
      seen.add(key);
      next[key] = serialiseRowValue(row);
    }
    onChange({ params: next });
  };

  return (
    <Card
      id={`step-card-${index}`}
      size="small"
      title={
        <Space size={8}>
          <span>Step {index + 1}: {step.name || '(unnamed)'}</span>
          {step.cache ? (
            <Tag color="cyan" style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10 }}>
              ⚡ Cached
            </Tag>
          ) : null}
          {typeof step.retries === 'number' && step.retries > 0 ? (
            <Tag color="orange" style={{ fontSize: 11, lineHeight: '18px', padding: '0 6px', borderRadius: 10 }}>
              ↻ {step.retries} {step.retries === 1 ? 'retry' : 'retries'}
            </Tag>
          ) : null}
        </Space>
      }
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
        {wireIssues.length > 0 ? (
          <Alert
            type={wireIssues.some((i) => i.severity === 'error') ? 'error' : 'warning'}
            showIcon
            style={{ marginBottom: 12 }}
            message={`Step ${index + 1}: ${wireIssues[0]?.message}`}
            description={
              wireIssues.length > 1
                ? (
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {wireIssues.slice(1).map((i) => (
                      <li key={i.code + (i.key ?? '')}>{i.message}</li>
                    ))}
                  </ul>
                )
                : null
            }
          />
        ) : null}
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
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            padding: '10px 14px',
            marginBottom: 12,
            background: 'var(--mp-bg-subtle, rgba(0, 0, 0, 0.02))',
            border: '1px solid var(--mp-border-color, rgba(0, 0, 0, 0.06))',
            borderRadius: 6,
          }}
        >
          <Form.Item
            label={
              <Space size={4}>
                <span>Step Cache</span>
                <Tooltip title="When enabled, steps with identical plugin version, parameters, and input files skip re-execution and reuse previous outputs and artifacts instantly.">
                  <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', cursor: 'pointer' }}>
                    SHA-256
                  </Tag>
                </Tooltip>
              </Space>
            }
            style={{ marginBottom: 0 }}
          >
            <Space size={10}>
              <Switch
                checked={Boolean(step.cache)}
                checkedChildren="⚡ ON"
                unCheckedChildren="OFF"
                onChange={(checked) => onChange({ cache: checked })}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {step.cache ? 'Content-Addressed Cache enabled' : 'Disabled'}
              </Typography.Text>
            </Space>
          </Form.Item>

          <Form.Item
            label={
              <Space size={4}>
                <span>Auto Retries</span>
                <Tooltip title="Automatic retry count on failure (0-10, with exponential backoff).">
                  <span style={{ color: 'var(--mp-text-secondary, #8c8c8c)', fontSize: 11, cursor: 'help' }}>ℹ️</span>
                </Tooltip>
              </Space>
            }
            style={{ marginBottom: 0 }}
          >
            <InputNumber
              min={0}
              max={10}
              value={step.retries ?? 0}
              onChange={(val) => onChange({ retries: typeof val === 'number' ? val : 0 })}
              style={{ width: 120 }}
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
                <div key={key} id={`step-input-${index}-${key}`} style={{ borderRadius: 6 }}>
                  <InputField
                    fieldKey={key}
                    spec={spec}
                    value={step.params[key]}
                    depSteps={depStepRefs.filter((s) => step.depends.includes(s.name))}
                    pipelineParams={pipelineParamKeys}
                    autoWireCandidates={autoWirePlan.candidates[key] ?? []}
                    onPickAuto={(sel) => pickWiring(key, sel)}
                    onChange={(value) =>
                      onChange({
                        params: { ...step.params, [key]: value },
                    })
                  }
                />
                </div>
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
          <KeyValueEditor
            rows={extraRows}
            reservedKeys={declaredKeys}
            pipelineParamKeys={pipelineParamKeys}
            depSteps={depStepRefs}
            resolveDepOutputs={resolveDepOutputs}
            autoWireByKey={autoWirePlan.candidates}
            onChange={handleExtraChange}
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
          const depOutputs: unknown =
            (manifest as { contract?: { outputs?: unknown } }).contract?.outputs ??
            (manifest as { outputs?: unknown }).outputs ??
            {};
          for (const [outKey] of Object.entries((depOutputs ?? {}) as Record<string, unknown>)) {
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
  depSteps: { name: string; pluginRef: string }[];
  pipelineParams: string[];
  autoWireCandidates?: Array<{ label: string; expression: string }>;
  onChange: (value: unknown) => void;
  onPickAuto?: (selection: WiringChoice) => void;
};

function InputField({
  fieldKey,
  spec,
  value,
  depSteps,
  pipelineParams,
  autoWireCandidates = [],
  onChange,
  onPickAuto,
}: InputFieldProps): React.JSX.Element {
  const kind = inferInputKind(spec);
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
          const depOuts: unknown =
            (manifest as { contract?: { outputs?: unknown } }).contract?.outputs ??
            (manifest as { outputs?: unknown }).outputs;
          setStepOutputs({ dep, outputs: Object.keys((depOuts ?? {}) as Record<string, unknown>) });
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
        <>
          {renderValueInput()}
          {autoWireCandidates.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              <AutoWiredChip
                current={null}
                candidates={autoWireCandidates}
                onPick={(next: WiringSelection) => {
                  if (onPickAuto) onPickAuto(next);
                }}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            background: 'var(--mp-bg-subtle, #f5f5f5)',
            border: '1px solid var(--mp-border-color, #d9d9d9)',
            borderRadius: 6,
            padding: '4px 8px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'var(--mp-text-color, #555)',
            marginTop: 4,
          }}
        >
          ← {bindingLabel}
          {autoWireCandidates.length > 0 ? (
            <span style={{ marginLeft: 8 }}>
              <AutoWiredChip
                current={typeof value === 'string' ? value.trim() : null}
                candidates={autoWireCandidates}
                onPick={(next: WiringSelection) => {
                  if (onPickAuto) onPickAuto(next);
                }}
              />
            </span>
          ) : null}
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

/** Inline value editor for a Pipeline-level parameter row. Mirrors the per-row
 *  shape from `KeyValueEditor` but only renders the value pane — type is set
 *  on the parent row, so we narrow here.
 */
function GlobalParamValueControl({
  row,
  onChange,
}: {
  row: { kind: KeyValueKind; value: unknown };
  onChange: (next: unknown) => void;
}): React.JSX.Element {
  switch (row.kind) {
    case 'boolean':
      return (
        <Switch
          checked={Boolean(row.value)}
          onChange={(checked) => onChange(checked)}
        />
      );
    case 'integer':
    case 'number': {
      const numeric =
        typeof row.value === 'number'
          ? row.value
          : row.value === '' || row.value === undefined || row.value === null
          ? undefined
          : parseFloat(String(row.value));
      return (
        <InputNumber
          style={{ width: '100%' }}
          step={row.kind === 'integer' ? 1 : 0.01}
          value={Number.isFinite(numeric) ? numeric : undefined}
          onChange={(value) => onChange(value ?? 0)}
          placeholder="value"
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
            placeholder={row.kind === 'list' ? '["a", "b"]' : '{"k": "v"}'}
            onChange={(event) => onChange(event.target.value)}
          />
          {!valid && text.trim() ? (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              Invalid JSON — saved as raw text.
            </Typography.Text>
          ) : null}
        </div>
      );
    }
    case 'string':
    default:
      return (
        <Input
          value={typeof row.value === 'string' ? row.value : row.value == null ? '' : String(row.value)}
          placeholder="value"
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** Card shown in the plugin picker drawer.  Fetches the manifest on mount
 *  so the user can see inputs / outputs before adding a step. */
function PluginPickerCard({
  plugin,
  onClick,
}: {
  plugin: PluginVersion;
  onClick: () => void;
}): React.JSX.Element {
  const manifestQuery = useApiQuery(
    ['plugin-manifest', `${plugin.name}@${plugin.version}`],
    async () => getPluginManifest(plugin.name, plugin.version),
    { staleTime: 5 * 60_000 },
  );
  const manifest = manifestQuery.data;
  const inputs: Array<{ name: string; type?: string; required?: boolean }> = useMemo(() => {
    if (!manifest) return [];
    const raw: unknown = (manifest as { contract?: { inputs?: unknown } }).contract?.inputs ?? (manifest as { inputs?: unknown }).inputs;
    if (Array.isArray(raw)) return raw as Array<{ name: string; type?: string; required?: boolean }>;
    if (raw && typeof raw === 'object') return Object.entries(raw as Record<string, { type?: string; required?: boolean }>).map(([name, spec]) => ({ name, type: spec.type, required: spec.required }));
    return [];
  }, [manifest]);
  const outputs: Array<{ name: string; type?: string }> = useMemo(() => {
    if (!manifest) return [];
    const raw: unknown = (manifest as { contract?: { outputs?: unknown } }).contract?.outputs ?? (manifest as { outputs?: unknown }).outputs;
    if (Array.isArray(raw)) return raw as Array<{ name: string; type?: string }>;
    if (raw && typeof raw === 'object') return Object.entries(raw as Record<string, { type?: string }>).map(([name, spec]) => ({ name, type: spec.type }));
    return [];
  }, [manifest]);

  return (
    <Card hoverable onClick={onClick}>
      <Typography.Text strong>
        {plugin.name}@{plugin.version}
      </Typography.Text>
      <div style={{ marginTop: 2 }}>
        <Tag color="geekblue">{plugin.source_type}</Tag>
        <Tag color="blue">{plugin.runtime_type}</Tag>
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 6 }}>
        {plugin.description || 'No description'}
      </Typography.Paragraph>
      {(inputs.length > 0 || outputs.length > 0) && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          {inputs.length > 0 && (
            <div>
              <span style={{ fontWeight: 600 }}>Inputs: </span>
              {inputs.map((inp, i) => (
                <span key={inp.name}>
                  <code>{inp.name}</code>
                  <Tag style={{ fontSize: 10, lineHeight: '16px', marginLeft: 2 }} color={inp.required ? 'red' : 'default'}>
                    {inp.type ?? 'string'}{inp.required ? ', req' : ''}
                  </Tag>
                  {i < inputs.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
          {outputs.length > 0 && (
            <div style={{ marginTop: 2 }}>
              <span style={{ fontWeight: 600 }}>Outputs: </span>
              {outputs.map((out, i) => (
                <span key={out.name}>
                  <code>{out.name}</code>
                  <Tag style={{ fontSize: 10, lineHeight: '16px', marginLeft: 2 }} color="green">
                    {out.type ?? 'file'}
                  </Tag>
                  {i < outputs.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
