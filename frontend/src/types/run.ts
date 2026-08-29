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
  /** 1-based execution attempt; > 1 when automatic retries were applied. */
  attempt?: number;
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

/** Run list item (GET /api/runs) — same as PipelineRun without params/tasks. */
export type RunSummary = Omit<PipelineRun, 'params' | 'tasks'> & {
  task_count: number;
  failed_tasks: number;
};

export type RunRequest = {
  pipeline: string;
  params: Record<string, unknown>;
  /** Execution target: machine id (built-in runner if omitted). */
  machine?: string;
};

export type RunListParams = {
  page?: number;
  page_size?: number;
  status?: string;
  pipeline?: string;
};

/** Payload of the SSE `snapshot` event for /api/runs/{id}/events. */
export type RunEventSnapshot = PipelineRun;

/** Payload of the SSE `event` message: run.status | task.status | task.retry. */
export type RunEventMessage = {
  type: 'run.status' | 'task.status' | 'task.retry';
  run_id: string;
  task_id: string | null;
  step_name: string | null;
  data: Record<string, unknown>;
  timestamp: number;
};

/** Payload of the SSE `log` event for /api/runs/{id}/tasks/{step}/log/stream. */
export type TaskLogChunk = {
  chunk: string;
  offset: number;
};

export type TaskLogEnd = {
  status: StatusValue;
  attempt: number;
};
