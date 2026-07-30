import React from "react";
import { useMemo } from 'react';
import type { PipelineDefinition } from '@/types/pipeline';
import { summarizeGraph } from './pipelineGraph';

export type PipelineGraphProps = {
  definition: PipelineDefinition;
};

export function PipelineGraph({ definition }: PipelineGraphProps): React.JSX.Element {
  const data = useMemo(() => summarizeGraph(definition), [definition]);

  return (
    <div className="json-viewer">
      <strong>Nodes</strong>
      <ul>
        {data.nodes.map((node) => (
          <li key={node.id}>{node.label}</li>
        ))}
      </ul>
      <strong>Edges</strong>
      <ul>
        {data.edges.length === 0 ? (
          <li>(no dependencies)</li>
        ) : (
          data.edges.map((edge) => (
            <li key={`${edge.from}-${edge.to}`}>
              {edge.from} → {edge.to}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
