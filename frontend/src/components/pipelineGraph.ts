import type { PipelineDefinition } from '@/types/pipeline';

export type PipelineGraphData = {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string }[];
};

/**
 * Summarise a pipeline definition into nodes and edges. The contract stays
 * stable so a future React Flow renderer can plug into the same shape.
 */
export function summarizeGraph(definition: PipelineDefinition): PipelineGraphData {
  const nodes = definition.steps.map((step) => ({
    id: step.name,
    label: `${step.name} (${step.plugin})`,
  }));
  const edges = definition.steps.flatMap((step) =>
    step.depends.map((dependency) => ({ from: dependency, to: step.name })),
  );
  return { nodes, edges };
}
