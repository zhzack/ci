/** PipelineDefinition ⇄ React Flow graph conversion.

Pure functions only: the visual editor keeps YAML as the single source of
truth (``FormState.steps``) and these helpers translate between that state
and the React Flow node/edge model. Node positions are UI-only and never
written back into the pipeline definition.
*/

import type { Edge, Node } from '@xyflow/react';

/** Minimal step shape the graph model needs (compatible with StepDraft). */
export type FlowStepLike = {
  name: string;
  pluginRef: string;
  depends: string[];
  cache?: boolean;
  retries?: number;
  machine?: string;
};

export type FlowNodeData = {
  label: string;
  plugin: string;
  depends: string[];
  cache: boolean;
  retries: number;
  machine?: string;
  [key: string]: unknown;
};

export type FlowNode = Node<FlowNodeData, 'pipelineStep'>;

export type FlowGraph = {
  nodes: FlowNode[];
  edges: Edge[];
};

export type NodePosition = { x: number; y: number };

export const FLOW_NODE_TYPE = 'pipelineStep';

const X_GAP = 280;
const Y_GAP = 140;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

/**
 * Longest-path layering: a step lives one layer right of its deepest
 * dependency, so left-to-right reads as execution order.
 */
export function computeLayers(steps: FlowStepLike[]): Map<string, number> {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const layers = new Map<string, number>();
  const visiting = new Set<string>();

  const resolve = (name: string): number => {
    const cached = layers.get(name);
    if (cached !== undefined) return cached;
    // Defensive: a cycle should be rejected before rendering, but never recurse forever.
    if (visiting.has(name)) return 0;
    const step = byName.get(name);
    if (step === undefined) return 0;
    visiting.add(name);
    const knownDeps = step.depends.filter((dep) => byName.has(dep));
    const layer = knownDeps.length === 0 ? 0 : 1 + Math.max(...knownDeps.map(resolve));
    visiting.delete(name);
    layers.set(name, layer);
    return layer;
  };

  for (const step of steps) resolve(step.name);
  return layers;
}

/** Default grid layout derived from dependency layers. */
export function layoutPositions(steps: FlowStepLike[]): Map<string, NodePosition> {
  const layers = computeLayers(steps);
  const rowsPerLayer = new Map<number, number>();
  const positions = new Map<string, NodePosition>();
  for (const step of steps) {
    const layer = layers.get(step.name) ?? 0;
    const row = rowsPerLayer.get(layer) ?? 0;
    rowsPerLayer.set(layer, row + 1);
    positions.set(step.name, {
      x: ORIGIN_X + layer * X_GAP,
      y: ORIGIN_Y + row * Y_GAP,
    });
  }
  return positions;
}

/**
 * Build the React Flow graph for the given steps.
 *
 * ``positions`` carries user-dragged coordinates (UI-only); steps without an
 * entry fall back to the computed layer layout. Unknown dependencies are
 * skipped so a half-edited definition still renders.
 */
export function toFlowGraph(
  steps: FlowStepLike[],
  positions: Record<string, NodePosition> = {},
): FlowGraph {
  const layout = layoutPositions(steps);
  const known = new Set(steps.map((step) => step.name));
  const nodes: FlowNode[] = steps.map((step) => ({
    id: step.name,
    type: FLOW_NODE_TYPE,
    position: positions[step.name] ?? layout.get(step.name) ?? { x: ORIGIN_X, y: ORIGIN_Y },
    data: {
      label: step.name,
      plugin: step.pluginRef,
      depends: [...step.depends],
      cache: Boolean(step.cache),
      retries: step.retries ?? 0,
      machine: step.machine || undefined,
    },
  }));
  const edges: Edge[] = steps.flatMap((step) =>
    step.depends
      .filter((dep) => known.has(dep))
      .map((dep) => ({
        id: `${dep}->${step.name}`,
        source: dep,
        target: step.name,
        type: 'smoothstep',
      })),
  );
  return { nodes, edges };
}

/** First dependency cycle found (as a name path), or null when acyclic. */
export function findDependencyCycle(steps: FlowStepLike[]): string[] | null {
  const byName = new Map(steps.map((step) => [step.name, step]));
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const stack: string[] = [];

  const dfs = (name: string): string[] | null => {
    state.set(name, 1);
    stack.push(name);
    for (const dep of byName.get(name)?.depends ?? []) {
      if (!byName.has(dep)) continue;
      const depState = state.get(dep);
      if (depState === 1) {
        const start = stack.indexOf(dep);
        return [...stack.slice(start), dep];
      }
      if (depState === undefined) {
        const found = dfs(dep);
        if (found !== null) return found;
      }
    }
    stack.pop();
    state.set(name, 2);
    return null;
  };

  for (const step of steps) {
    if (!state.has(step.name)) {
      const found = dfs(step.name);
      if (found !== null) return found;
    }
  }
  return null;
}

export type DependencyEditResult = {
  steps: FlowStepLike[];
  error: string | null;
};

/** Add ``source → target`` (target depends on source) with validation. */
export function addDependency(
  steps: FlowStepLike[],
  source: string,
  target: string,
): DependencyEditResult {
  if (source === target) {
    return { steps, error: 'A step cannot depend on itself' };
  }
  const known = new Set(steps.map((step) => step.name));
  if (!known.has(source) || !known.has(target)) {
    return { steps, error: 'Both steps must exist before linking them' };
  }
  const targetStep = steps.find((step) => step.name === target);
  if (targetStep === undefined) {
    return { steps, error: 'Target step not found' };
  }
  if (targetStep.depends.includes(source)) {
    return { steps, error: `${target} already depends on ${source}` };
  }
  const next = steps.map((step) =>
    step.name === target ? { ...step, depends: [...step.depends, source] } : step,
  );
  const cycle = findDependencyCycle(next);
  if (cycle !== null) {
    return {
      steps,
      error: `Dependency would create a cycle: ${cycle.join(' → ')}`,
    };
  }
  return { steps: next, error: null };
}

/** Remove ``source → target`` (no-op when the edge is absent). */
export function removeDependency(
  steps: FlowStepLike[],
  source: string,
  target: string,
): FlowStepLike[] {
  return steps.map((step) =>
    step.name === target
      ? { ...step, depends: step.depends.filter((dep) => dep !== source) }
      : step,
  );
}

/** Drop a step and every reference to it in other steps' dependencies. */
export function removeStep(
  steps: FlowStepLike[],
  name: string,
): FlowStepLike[] {
  return steps
    .filter((step) => step.name !== name)
    .map((step) => ({
      ...step,
      depends: step.depends.filter((dep) => dep !== name),
    }));
}
