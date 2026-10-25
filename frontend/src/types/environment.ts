/**
 * Types for the environment API surface.
 *
 * Single source of truth: api/environment.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/environment'.
 */

export type RuntimeEnvironment = {
  id: string;
  name: string;
  env_type: string;
  version: string;
  os_arch: string;
  package_path?: string | null;
  download_url?: string | null;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateRuntimeEnvironmentPayload = {
  name: string;
  env_type?: string;
  version: string;
  os_arch?: string;
  package_path?: string;
  download_url?: string;
  description?: string;
  is_default?: boolean;
};

export type UpdateRuntimeEnvironmentPayload = Partial<CreateRuntimeEnvironmentPayload>;

export type EnvironmentDeployTask = {
  id: string;
  environment_id: string;
  environment_name: string;
  environment_version: string;
  machine_id: string;
  machine_name: string;
  machine_host: string;
  status: 'pending' | 'preparing' | 'transferring' | 'extracting' | 'validating' | 'success' | 'failed';
  progress: number;
  message: string;
  logs: string;
  triggered_by?: string | null;
  created_at: string;
  finished_at?: string | null;
};
