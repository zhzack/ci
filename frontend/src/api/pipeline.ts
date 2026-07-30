import { http } from './http';
import type {
  CreatePipelineRequest,
  PipelineParamsSchema,
  PipelineRecord,
  UpdatePipelineRequest,
} from '@/types/pipeline';

export async function listPipelines(): Promise<PipelineRecord[]> {
  const { data } = await http.get<PipelineRecord[]>('/pipelines');
  return data;
}

export async function createPipeline(payload: CreatePipelineRequest): Promise<PipelineRecord> {
  const { data } = await http.post<PipelineRecord>('/pipelines', payload);
  return data;
}

export async function updatePipeline(
  identifier: string,
  payload: UpdatePipelineRequest,
): Promise<PipelineRecord> {
  const { data } = await http.put<PipelineRecord>(
    `/pipelines/${encodeURIComponent(identifier)}`,
    payload,
  );
  return data;
}

export async function getPipelineYaml(identifier: string): Promise<string> {
  const { data } = await http.get<string>(`/pipelines/${encodeURIComponent(identifier)}`, {
    transformResponse: [(raw) => raw],
    responseType: 'text',
  });
  return data;
}

export async function getPipelineParamsSchema(
  identifier: string,
): Promise<PipelineParamsSchema> {
  const { data } = await http.get<PipelineParamsSchema>(
    `/pipelines/${encodeURIComponent(identifier)}/params-schema`,
  );
  return data;
}

export async function deletePipeline(identifier: string): Promise<void> {
  await http.delete(`/pipelines/${encodeURIComponent(identifier)}`);
}
