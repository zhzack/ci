export type PluginVersion = {
  id: string;
  name: string;
  version: string;
  description: string;
  source_type: string;
  source_url: string | null;
  source_revision: string | null;
  runtime_type: string;
  entry: string;
  status: string;
  plugin_id?: string;
  owner_id?: string | null;
  visibility?: 'private' | 'public' | string;
  review_status?: 'none' | 'pending' | 'approved' | 'rejected' | string;
};

export type PluginManifestValue = {
  type?: string;
  source?: string;
  target?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  runtime: { type: string };
  entry: string;
  inputs: Record<string, PluginManifestValue>;
  outputs: Record<string, PluginManifestValue>;
};

export const RUNTIME_OPTIONS = ['shell', 'python', 'node', 'executable', 'docker'] as const;
export type RuntimeType = (typeof RUNTIME_OPTIONS)[number];

export type PluginSourceRequest = {
  type: 'git' | 'http' | 'upload';
  url?: string;
  branch?: string;
  tag?: string;
  revision?: string;
  commit?: string;
  credential_id?: string;
};

export type RegisterPluginRequest = {
  source: PluginSourceRequest;
};

export type PluginListParams = {
  page?: number;
  page_size?: number;
  search?: string;
};

export type GitBranchProbeResult = {
  branches: string[];
  tags: string[];
  default_branch: string;
};
