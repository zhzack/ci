import type { StatusValue } from './common';

export type ArtifactResponse = {
  id: string;
  name: string;
  size: number;
  sha256: string;
};

export type TaskRun = {
  id: string;
  name: string;
  plugin: string;
  status: StatusValue;
  message: string | null;
  outputs: Record<string, unknown>;
  started_at: string | null;
  finished_at: string | null;
  artifacts: ArtifactResponse[];
};

export type PipelineRun = {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  status: StatusValue;
  params: Record<string, unknown>;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  tasks: TaskRun[];
};

export type RunRequest = {
  pipeline: string;
  params: Record<string, unknown>;
};
