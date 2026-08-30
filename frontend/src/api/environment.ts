import { http } from './http';

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

export async function listEnvironments(): Promise<RuntimeEnvironment[]> {
  const { data } = await http.get<RuntimeEnvironment[]>('/environments');
  return data;
}

export async function getEnvironment(id: string): Promise<RuntimeEnvironment> {
  const { data } = await http.get<RuntimeEnvironment>(`/environments/${encodeURIComponent(id)}`);
  return data;
}

export async function createEnvironment(
  payload: CreateRuntimeEnvironmentPayload
): Promise<RuntimeEnvironment> {
  const { data } = await http.post<RuntimeEnvironment>('/environments', payload);
  return data;
}

export async function updateEnvironment(
  id: string,
  payload: UpdateRuntimeEnvironmentPayload
): Promise<RuntimeEnvironment> {
  const { data } = await http.patch<RuntimeEnvironment>(
    `/environments/${encodeURIComponent(id)}`,
    payload
  );
  return data;
}

export async function deleteEnvironment(id: string): Promise<void> {
  await http.delete(`/environments/${encodeURIComponent(id)}`);
}

export async function deployEnvironment(
  envId: string,
  machineIds: string[]
): Promise<EnvironmentDeployTask[]> {
  const { data } = await http.post<EnvironmentDeployTask[]>(
    `/environments/${encodeURIComponent(envId)}/deploy`,
    { machine_ids: machineIds }
  );
  return data;
}

export async function listDeployTasks(limit = 50): Promise<EnvironmentDeployTask[]> {
  const { data } = await http.get<EnvironmentDeployTask[]>('/environments/deploy-tasks', {
    params: { limit },
  });
  return data;
}

export async function getDeployTask(taskId: string): Promise<EnvironmentDeployTask> {
  const { data } = await http.get<EnvironmentDeployTask>(
    `/environments/deploy-tasks/${encodeURIComponent(taskId)}`
  );
  return data;
}
