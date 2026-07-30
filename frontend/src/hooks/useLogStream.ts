import { useEffect, useState } from 'react';

export type LogStream = {
  content: string;
  loading: boolean;
  append: (chunk: string) => void;
  reset: () => void;
};

/**
 * Lightweight log stream placeholder. The HTTP polling implementation lives in
 * {@link usePollingLog}; the WebSocket upgrade path will swap the polling
 * implementation for an EventSource/WebSocket while keeping the same shape.
 */
export function useLogStream(
  fetcher: () => Promise<string>,
  options: { pollIntervalMs?: number; enabled?: boolean } = {},
): LogStream {
  const { pollIntervalMs = 2000, enabled = true } = options;
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let timer: number | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        setLoading(true);
        const next = await fetcher();
        if (cancelled) {
          return;
        }
        setContent(next);
      } catch {
        // Errors are surfaced via the polling hook; stream is best-effort.
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = window.setTimeout(tick, pollIntervalMs);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [fetcher, pollIntervalMs, enabled]);

  return {
    content,
    loading,
    append: (chunk: string) => setContent((current) => `${current}${chunk}`),
    reset: () => setContent(''),
  };
}
