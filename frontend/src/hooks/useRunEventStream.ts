import { useEffect, useRef, useState } from 'react';

import { openRunEventStream } from '@/api/run';
import type { PipelineRun, RunEventMessage } from '@/types/run';

export type RunLiveState = {
  /** Latest run snapshot; refreshed by SSE snapshots and task events. */
  run: PipelineRun | null;
  /** Last message received (diagnostics / toast material). */
  lastEvent: RunEventMessage | null;
  connected: boolean;
};

/**
 * Live run progress via Server-Sent Events (sub-second latency, no polling).
 *
 * The hook merges SSE payloads into the latest known run shape:
 * - `snapshot` events carry the full run detail;
 * - `task.status` / `task.retry` events patch the corresponding task and the
 *   run status so the UI updates immediately, then the next full snapshot
 *   reconciles everything.
 */
export function useRunEventStream(
  runId: string,
  initial: PipelineRun | null,
  options: { enabled?: boolean } = {},
): RunLiveState {
  const { enabled = true } = options;
  const [run, setRun] = useState<PipelineRun | null>(initial);
  const [lastEvent, setLastEvent] = useState<RunEventMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const runRef = useRef<PipelineRun | null>(initial);

  useEffect(() => {
    setRun(initial);
    runRef.current = initial;
  }, [initial]);

  useEffect(() => {
    if (!enabled || !runId) return;
    const applySnapshot = (snapshot: PipelineRun) => {
      runRef.current = snapshot;
      setRun(snapshot);
    };
    const dispose = openRunEventStream(runId, {
      onSnapshot: (snapshot) => {
        setConnected(true);
        applySnapshot(snapshot);
      },
      onEvent: (event) => {
        setLastEvent(event);
        const current = runRef.current;
        if (!current) return;
        const status = event.data.status;
        if (event.type === 'run.status' && typeof status === 'string') {
          applySnapshot({ ...current, status });
          return;
        }
        if (event.type === 'task.status' && event.step_name) {
          const tasks = current.tasks.map((task) =>
            task.name === event.step_name
              ? {
                  ...task,
                  status: (typeof status === 'string' ? status : task.status) as typeof task.status,
                  message:
                    typeof event.data.message === 'string'
                      ? event.data.message
                      : task.message,
                  outputs:
                    event.data.outputs && typeof event.data.outputs === 'object'
                      ? (event.data.outputs as Record<string, unknown>)
                      : task.outputs,
                }
              : task,
          );
          applySnapshot({ ...current, tasks });
          const taskStatuses = new Set(tasks.map((task) => task.status));
          const running = taskStatuses.has('PENDING') || taskStatuses.has('READY') || taskStatuses.has('RUNNING');
          applySnapshot({
            ...current,
            tasks,
            status: running ? 'RUNNING' : current.status,
          });
        }
      },
      onClose: () => setConnected(false),
    });
    return dispose;
  }, [runId, enabled]);

  return { run, lastEvent, connected };
}
