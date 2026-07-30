import { http } from './http';
import type { PipelineRun, RunRequest } from '@/types/run';

export async function submitRun(payload: RunRequest): Promise<PipelineRun> {
  const { data } = await http.post<PipelineRun>('/runs', payload);
  return data;
}

export async function getRun(runId: string): Promise<PipelineRun> {
  const { data } = await http.get<PipelineRun>(`/runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function getTaskLog(runId: string, stepName: string): Promise<string> {
  const { data } = await http.get<string>(
    `/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(stepName)}/log`,
    {
      transformResponse: [(raw) => raw],
      responseType: 'text',
    },
  );
  return data;
}

export async function getAggregatedLog(runId: string): Promise<string> {
  const { data } = await http.get<string>(
    `/runs/${encodeURIComponent(runId)}/aggregated-log`,
    {
      transformResponse: [(raw) => raw],
      responseType: 'text',
    },
  );
  return data;
}

export async function branchRun(
  parentRunId: string,
  fromStep: string,
  params: Record<string, unknown>,
): Promise<PipelineRun> {
  const { data } = await http.post<PipelineRun>(
    `/runs/${encodeURIComponent(parentRunId)}/branches`,
    { from_step: fromStep, params },
  );
  return data;
}

export function downloadArtifactUrl(runId: string, artifactId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}
