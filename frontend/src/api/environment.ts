import { http } from './http';





import type { RuntimeEnvironment, CreateRuntimeEnvironmentPayload, UpdateRuntimeEnvironmentPayload, EnvironmentDeployTask } from '@/types/environment';
export type { RuntimeEnvironment, CreateRuntimeEnvironmentPayload, UpdateRuntimeEnvironmentPayload, EnvironmentDeployTask };

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
