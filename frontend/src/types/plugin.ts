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
};

export type RegisterPluginRequest = {
  source: PluginSourceRequest;
};
