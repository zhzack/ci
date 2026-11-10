/** Interactive DAG editor built on React Flow.

The graph is a projection of the page's ``FormState.steps`` (YAML stays the
single source of truth): dragging updates only UI positions, while connecting
or deleting edges rewrites the steps' ``depends`` arrays. Cycles, self-links
and duplicate edges are rejected before they reach the definition.
*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeProps,
  Position as HandlePosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button, Space, Tag, Typography, message as antdMessage } from 'antd';
import { FormOutlined, PlusOutlined } from '@ant-design/icons';

import {
  FLOW_NODE_TYPE,
  addDependency,
  removeDependency,
  removeStep,
  toFlowGraph,
  type FlowNode,
  type FlowStepLike,
  type NodePosition,
} from './flowModel';

export type PipelineFlowEditorProps<T extends FlowStepLike> = {
  steps: T[];
  onStepsChange: (steps: T[]) => void;
  onAddStep?: () => void;
  onEditStep?: (name: string) => void;
  onSelectStep?: (name: string | null) => void;
  height?: number;
};

function PipelineStepNode({ data, selected }: NodeProps<FlowNode>): React.JSX.Element {
  return (
    <div
      style={{
        width: 210,
        padding: '10px 12px',
        borderRadius: 8,
        border: `2px solid ${selected ? '#1677ff' : 'var(--mp-border-color, #d9d9d9)'}`,
        background: 'var(--mp-bg-container, #fff)',
        color: 'var(--mp-text-color, rgba(0, 0, 0, 0.88))',
        boxShadow: selected
          ? '0 0 0 3px rgba(22, 119, 255, 0.18)'
          : '0 1px 4px rgba(0, 0, 0, 0.12)',
        fontSize: 12,
        position: 'relative',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{data.label}</div>
      <div
        style={{
          color: 'var(--mp-text-secondary, rgba(0, 0, 0, 0.45))',
          marginBottom: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={data.plugin}
      >
        {data.plugin || '未选择插件'}
      </div>
      <Space size={4} wrap>
        {data.cache ? (
          <Tag color="gold" bordered={false} style={{ marginInlineEnd: 0 }}>
            ⚡ Cached
          </Tag>
        ) : null}
        {data.retries > 0 ? (
          <Tag color="blue" bordered={false} style={{ marginInlineEnd: 0 }}>
            ↻ {data.retries}
          </Tag>
        ) : null}
        {data.machine ? (
          <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
            🖥 {data.machine}
          </Tag>
        ) : null}
        {data.depends.length > 0 ? (
          <Tag bordered={false} style={{ marginInlineEnd: 0 }}>
            {data.depends.length} 依赖
          </Tag>
        ) : null}
      </Space>
      <Handle type="target" position={HandlePosition.Left} />
      <Handle type="source" position={HandlePosition.Right} />
    </div>
  );
}

const nodeTypes = { [FLOW_NODE_TYPE]: PipelineStepNode };

export function PipelineFlowEditor<T extends FlowStepLike>({
  steps,
  onStepsChange,
  onAddStep,
  onEditStep,
  onSelectStep,
  height = 560,
}: PipelineFlowEditorProps<T>): React.JSX.Element {
  const positionsRef = useRef<Record<string, NodePosition>>({});
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowGraph(steps).nodes);
  const [edges, setEdges] = useState<Edge[]>(() => toFlowGraph(steps).edges);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Rebuild the projection whenever the definition or selection changes,
  // keeping any positions the user dragged earlier.
  useEffect(() => {
    const graph = toFlowGraph(steps as FlowStepLike[], positionsRef.current);
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]));
      return graph.nodes.map((node) => ({
        ...node,
        position: byId.get(node.id)?.position ?? node.position,
        selected: node.id === selectedName,
      }));
    });
    setEdges(graph.edges);
    const known = new Set(steps.map((step) => step.name));
    for (const name of Object.keys(positionsRef.current)) {
      if (!known.has(name)) delete positionsRef.current[name];
    }
  }, [steps, selectedName]);

  const handleNodesChange = useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((current) => {
      const next = applyNodeChanges(changes, current) as FlowNode[];
      for (const node of next) positionsRef.current[node.id] = node.position;
      return next;
    });
  }, []);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const emit = useCallback(
    (next: FlowStepLike[]) => {
      onStepsChange(next as T[]);
    },
    [onStepsChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const result = addDependency(
        steps as FlowStepLike[],
        connection.source,
        connection.target,
      );
      if (result.error !== null) {
        antdMessage.error(result.error);
        return;
      }
      emit(result.steps);
    },
    [steps, emit],
  );

  const handleNodesDelete = useCallback(
    (deleted: FlowNode[]) => {
      let next: FlowStepLike[] = steps as FlowStepLike[];
      for (const node of deleted) next = removeStep(next, node.id);
      emit(next);
      if (deleted.some((node) => node.id === selectedName)) {
        setSelectedName(null);
        onSelectStep?.(null);
      }
    },
    [steps, emit, selectedName, onSelectStep],
  );

  const handleEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      let next: FlowStepLike[] = steps as FlowStepLike[];
      for (const edge of deleted) next = removeDependency(next, edge.source, edge.target);
      emit(next);
    },
    [steps, emit],
  );

  const selectNode = useCallback(
    (name: string | null) => {
      setSelectedName(name);
      onSelectStep?.(name);
    },
    [onSelectStep],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          拖拽节点调整布局；从节点右侧端口拖线到目标节点左侧添加依赖；选中节点或连线后按
          Delete 删除。连线与删除会实时写回定义，YAML 同步生成。
        </Typography.Text>
        {onAddStep ? (
          <Button icon={<PlusOutlined />} onClick={onAddStep}>
            Add step
          </Button>
        ) : null}
      </div>
      <div
        style={{
          height,
          border: '1px solid var(--mp-border-color, #f0f0f0)',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          background: 'var(--mp-bg-subtle, #fafafa)',
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodesDelete={handleNodesDelete}
          onEdgesDelete={handleEdgesDelete}
          onNodeClick={(_event, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          onNodeDoubleClick={(_event, node) => onEditStep?.(node.id)}
          fitView
          minZoom={0.2}
          deleteKeyCode={['Backspace', 'Delete']}
          nodesConnectable
        >
          <Background gap={16} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {steps.length === 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Typography.Text type="secondary">
              暂无步骤，点击右上角 Add step 添加插件节点
            </Typography.Text>
          </div>
        ) : null}
      </div>
      {selectedName !== null ? (
        <div
          style={{
            marginTop: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Tag color="blue">{selectedName}</Tag>
          <Button
            size="small"
            icon={<FormOutlined />}
            onClick={() => onEditStep?.(selectedName)}
          >
            在表单中编辑
          </Button>
        </div>
      ) : null}
    </div>
  );
}
