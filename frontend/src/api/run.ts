import { http, loadStoredAuth } from './http';
import type { Paged } from '@/types/common';
import type {
  PipelineRun,
  RunEventMessage,
  RunEventSnapshot,
  RunListParams,
  RunRequest,
  RunSummary,
  TaskLogChunk,
  TaskLogEnd,
} from '@/types/run';

export async function submitRun(payload: RunRequest): Promise<PipelineRun> {
  const { data } = await http.post<PipelineRun>('/runs', payload);
  return data;
}

export type UploadProgressCallback = (percent: number, loaded: number, total: number) => void;

export async function submitRunWithFiles(
  pipeline: string,
  params: Record<string, unknown>,
  files: Record<string, File>,
  machine?: string,
  parentRunId?: string,
  reuseUploads: boolean = true,
  onProgress?: UploadProgressCallback,
): Promise<PipelineRun> {
  const formData = new FormData();
  formData.append('pipeline', pipeline);
  formData.append('params_json', JSON.stringify(params));
  if (machine) {
    formData.append('machine', machine);
  }
  if (parentRunId) {
    formData.append('parent_run_id', parentRunId);
  }
  formData.append('reuse_uploads', String(reuseUploads));
  for (const [key, file] of Object.entries(files)) {
    if (file instanceof File) {
      formData.append(key, file);
    }
  }
  const { data } = await http.post<PipelineRun>('/runs/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total && onProgress) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent, progressEvent.loaded, progressEvent.total);
      }
    },
  });
  return data;
}



export async function getRun(runId: string): Promise<PipelineRun> {
  const { data } = await http.get<PipelineRun>(`/runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function listRuns(params: RunListParams = {}): Promise<Paged<RunSummary>> {
  const { data } = await http.get<Paged<RunSummary>>('/runs', { params });
  return data;
}

export async function cancelRun(runId: string): Promise<PipelineRun> {
  const { data } = await http.post<PipelineRun>(
    `/runs/${encodeURIComponent(runId)}/cancel`,
  );
  return data;
}

export type RunStreamHandlers = {
  onSnapshot?: (run: RunEventSnapshot) => void;
  onEvent?: (event: RunEventMessage) => void;
  /** Called when the stream closes (terminal status reached or error). */
  onClose?: () => void;
};

/**
 * Subscribe to live run/task state via Server-Sent Events.
 * Returns a disposer. The server closes the stream itself once the run
 * reaches a terminal status, so long-lived reconnect logic is unnecessary.
 */
/**
 * EventSource cannot send Authorization headers, so the backend accepts the
 * session token via the `?token=` query parameter (same channel the
 * WebSocket terminal uses). Auth-disabled deployments return a tokenless URL.
 */
function withStreamToken(url: string): string {
  const token = loadStoredAuth()?.token;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export function openRunEventStream(runId: string, handlers: RunStreamHandlers): () => void {
  const source = new EventSource(withStreamToken(`/api/runs/${encodeURIComponent(runId)}/events`));
  source.addEventListener('snapshot', (ev) => {
    try {
      handlers.onSnapshot?.(JSON.parse((ev as MessageEvent<string>).data));
    } catch {
      /* ignore malformed frames */
    }
  });
  source.addEventListener('event', (ev) => {
    try {
      handlers.onEvent?.(JSON.parse((ev as MessageEvent<string>).data));
    } catch {
      /* ignore malformed frames */
    }
  });
  source.onerror = () => handlers.onClose?.();
  return () => source.close();
}

export type LogStreamHandlers = {
  onChunk?: (chunk: TaskLogChunk) => void;
  onEnd?: (end: TaskLogEnd) => void;
  onError?: () => void;
};

/** Tail a task log via SSE until the task finishes. Returns a disposer. */
export function openTaskLogStream(
  runId: string,
  stepName: string,
  handlers: LogStreamHandlers,
): () => void {
  const url = withStreamToken(
    `/api/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(stepName)}/log/stream`,
  );
  const source = new EventSource(url);
  source.addEventListener('log', (ev) => {
    try {
      handlers.onChunk?.(JSON.parse((ev as MessageEvent<string>).data));
    } catch {
      /* ignore malformed frames */
    }
  });
  source.addEventListener('end', (ev) => {
    try {
      handlers.onEnd?.(JSON.parse((ev as MessageEvent<string>).data));
    } finally {
      source.close();
    }
  });
  source.onerror = () => handlers.onError?.();
  return () => source.close();
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
  reuseUploads: boolean = true,
): Promise<PipelineRun> {
  const { data } = await http.post<PipelineRun>(
    `/runs/${encodeURIComponent(parentRunId)}/branches`,
    { from_step: fromStep, params, reuse_uploads: reuseUploads },
  );
  return data;
}


export function downloadArtifactUrl(runId: string, artifactId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

