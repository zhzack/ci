import { describe, expect, it } from 'vitest';

import {
  addDependency,
  computeLayers,
  findDependencyCycle,
  layoutPositions,
  removeDependency,
  removeStep,
  toFlowGraph,
  type FlowStepLike,
} from './flowModel';

function step(
  name: string,
  depends: string[] = [],
  extra: Partial<FlowStepLike> = {},
): FlowStepLike {
  return { name, pluginRef: `${name}-plugin@1.0.0`, depends, ...extra };
}

const CHAIN: FlowStepLike[] = [
  step('a'),
  step('b', ['a']),
  step('c', ['b']),
];

const FANOUT: FlowStepLike[] = [
  step('gen'),
  step('left', ['gen']),
  step('right', ['gen']),
  step('merge', ['left', 'right']),
];

describe('computeLayers', () => {
  it('assigns longest-path layers', () => {
    const layers = computeLayers(FANOUT);
    expect(layers.get('gen')).toBe(0);
    expect(layers.get('left')).toBe(1);
    expect(layers.get('right')).toBe(1);
    expect(layers.get('merge')).toBe(2);
  });

  it('tolerates a cycle without recursing forever', () => {
    const layers = computeLayers([step('x', ['y']), step('y', ['x'])]);
    expect(layers.size).toBe(2);
  });

  it('ignores dependencies on missing steps', () => {
    const layers = computeLayers([step('only', ['ghost'])]);
    expect(layers.get('only')).toBe(0);
  });
});

describe('layoutPositions', () => {
  it('places deeper layers further right and same-layer nodes further down', () => {
    const positions = layoutPositions(FANOUT);
    expect(positions.get('gen')!.x).toBeLessThan(positions.get('left')!.x);
    expect(positions.get('left')!.x).toBeLessThan(positions.get('merge')!.x);
    expect(positions.get('left')!.y).toBeLessThan(positions.get('right')!.y);
  });
});

describe('toFlowGraph', () => {
  it('projects steps into nodes and edges', () => {
    const graph = toFlowGraph(CHAIN);
    expect(graph.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(graph.edges.map((edge) => edge.id)).toEqual(['a->b', 'b->c']);
    expect(graph.edges[0]).toMatchObject({ source: 'a', target: 'b' });
    expect(graph.nodes[1]!.data.plugin).toBe('b-plugin@1.0.0');
  });

  it('carries execution metadata into node data', () => {
    const graph = toFlowGraph([
      step('a', [], { cache: true, retries: 2, machine: 'builder' }),
    ]);
    expect(graph.nodes[0]!.data).toMatchObject({
      cache: true,
      retries: 2,
      machine: 'builder',
    });
  });

  it('drops edges pointing at unknown steps', () => {
    const graph = toFlowGraph([step('a', ['ghost'])]);
    expect(graph.edges).toHaveLength(0);
  });

  it('prefers user-dragged positions over the computed layout', () => {
    const graph = toFlowGraph(CHAIN, { b: { x: 999, y: 123 } });
    const node = graph.nodes.find((entry) => entry.id === 'b');
    expect(node?.position).toEqual({ x: 999, y: 123 });
  });
});

describe('findDependencyCycle', () => {
  it('returns null for a DAG', () => {
    expect(findDependencyCycle(FANOUT)).toBeNull();
  });

  it('reports a cycle path', () => {
    const cycle = findDependencyCycle([step('x', ['y']), step('y', ['x'])]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
  });
});

describe('addDependency', () => {
  it('adds the dependency while preserving extra step fields', () => {
    const draft = { ...step('b'), params: { value: '${{ steps.a.outputs.v }}' } };
    const result = addDependency([step('a'), draft], 'a', 'b');
    expect(result.error).toBeNull();
    expect(result.steps[1]!.depends).toEqual(['a']);
    expect((result.steps[1] as { params?: unknown }).params).toEqual(draft.params);
  });

  it('rejects self-links', () => {
    const result = addDependency([step('a')], 'a', 'a');
    expect(result.error).toMatch(/itself/i);
  });

  it('rejects duplicates', () => {
    const result = addDependency([step('a'), step('b', ['a'])], 'a', 'b');
    expect(result.error).toMatch(/already depends/i);
  });

  it('rejects missing steps', () => {
    const result = addDependency([step('a')], 'a', 'nope');
    expect(result.error).toMatch(/must exist/i);
  });

  it('rejects edges that would close a cycle and leaves steps untouched', () => {
    const steps = [step('a', ['b']), step('b')];
    const result = addDependency(steps, 'a', 'b');
    expect(result.error).toMatch(/cycle/i);
    expect(result.steps).toBe(steps);
  });
});

describe('removeDependency and removeStep', () => {
  it('removes only the given edge', () => {
    const next = removeDependency(FANOUT, 'gen', 'left');
    expect(next.find((entry) => entry.name === 'left')!.depends).toEqual([]);
    expect(next.find((entry) => entry.name === 'right')!.depends).toEqual(['gen']);
  });

  it('removes a step and every reference to it', () => {
    const next = removeStep(FANOUT, 'gen');
    expect(next.map((entry) => entry.name)).toEqual(['left', 'right', 'merge']);
    expect(next.find((entry) => entry.name === 'left')!.depends).toEqual([]);
    expect(next.find((entry) => entry.name === 'merge')!.depends).toEqual([
      'left',
      'right',
    ]);
  });
});
