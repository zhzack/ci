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
  | 'INSTALLING'
  | string;

export type Id = string;

export type PageMeta = {
  total: number;
};
