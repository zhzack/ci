import { useCallback, useEffect, useRef, useState } from 'react';

import { openTaskLogStream, getTaskLog } from '@/api/run';

export type LogStream = {
  content: string;
  loading: boolean;
  append: (chunk: string) => void;
  reset: () => void;
};

export type UseLogStreamOptions = {
  /** Stream live via SSE (default). Falls back to one-shot polling when disabled. */
  live?: boolean;
  pollIntervalMs?: number;
  enabled?: boolean;
};

/**
 * Live log stream for one task.
 *
 * `live` mode tails the log file through the backend's SSE endpoint with
 * sub-second latency; the connection is closed by the server once the task
 * reaches a terminal state. Falls back to the historical whole-file polling
 * when `live: false` (or to fetch the initial content once).
 */
export function useLogStream(
  runId: string,
  stepName: string,
  options: UseLogStreamOptions = {},
): LogStream {
  const { live = true, pollIntervalMs = 2000, enabled = true } = options;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(0);

  const append = useCallback((chunk: string) => {
    setContent((current) => `${current}${chunk}`);
  }, []);

  const reset = useCallback(() => {
    offsetRef.current = 0;
    setContent('');
  }, []);

  useEffect(() => {
    if (!enabled || !runId || !stepName) {
      return;
    }
    reset();
    let disposed = false;

    if (!live) {
      let timer: number | null = null;
      const tick = async () => {
        try {
          setLoading(true);
          const next = await getTaskLog(runId, stepName);
          if (!disposed) setContent(next);
        } catch {
          // Best-effort; callers surface errors through the run query.
        } finally {
          if (!disposed) {
            setLoading(false);
            timer = window.setTimeout(tick, pollIntervalMs);
          }
        }
      };
      void tick();
      return () => {
        disposed = true;
        if (timer !== null) window.clearTimeout(timer);
      };
    }

    const dispose = openTaskLogStream(runId, stepName, {
      onChunk: (chunkPayload) => {
        offsetRef.current = chunkPayload.offset;
        append(chunkPayload.chunk);
      },
      onEnd: () => setLoading(false),
      onError: () => setLoading(false),
    });
    // Fetch whatever the plugin already logged before we connected.
    void getTaskLog(runId, stepName)
      .then((initial) => {
        if (!disposed && offsetRef.current === 0) setContent(initial);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      dispose();
    };
  }, [runId, stepName, live, pollIntervalMs, enabled, append, reset]);

  return { content, loading, append, reset };
}
