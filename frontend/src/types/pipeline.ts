export type PipelineStep = {
  name: string;
  plugin: string;
  depends: string[];
  with: Record<string, unknown>;
  cache?: boolean;
  retries?: number;
  machine?: string | null;
};

export type PipelineRecord = {
  id: string;
  name: string;
  owner_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type PipelineDefinition = {
  name: string;
  params?: Record<string, unknown>;
  steps: PipelineStep[];
};

export type PipelineDefinitionPayload = {
  definition: string;
};

export type CreatePipelineRequest = PipelineDefinitionPayload;
export type UpdatePipelineRequest = PipelineDefinitionPayload;

export type ParamField = {
  key: string;
  type: string;
  source?: string;
  target?: string;
  required: boolean;
  default: unknown;
  description: string;
};

export type StepParamSchema = {
  name: string;
  plugin: string;
  depends: string[];
  fields: ParamField[];
};

export type PipelineParamsSchema = {
  name: string;
  global_params: Record<string, unknown>;
  steps: StepParamSchema[];
};

export type PipelineListParams = {
  page?: number;
  page_size?: number;
};
