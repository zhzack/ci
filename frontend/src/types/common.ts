export type ApiError = {
  detail: string;
  status?: number;
};

/** Known pipeline/task lifecycle states, single source for type + guard. */
export const STATUS_VALUES = [
  'PENDING',
  'READY',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
  'INSTALLING',
] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

/** Runtime check for statuses arriving over untyped JSON (SSE/REST). */
export function isStatusValue(value: unknown): value is StatusValue {
  return (
    typeof value === 'string' &&
    (STATUS_VALUES as readonly string[]).includes(value)
  );
}

export type Id = string;

/** Server-driven pagination envelope returned by every list endpoint. */
export type Paged<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

export type PageParams = {
  page?: number;
  page_size?: number;
};
