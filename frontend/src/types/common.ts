export type ApiError = {
  detail: string;
  status?: number;
};

export type StatusValue =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'INSTALLING'
  | string;

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
