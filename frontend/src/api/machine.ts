import { http } from './http';

export type SshConnection = {
  host: string;
  port?: number;
  username: string;
  password?: string;
  private_key?: string;
};

export type Machine = {
  id: string;
  name: string;
  kind: 'admin' | 'personal';
  connection_type: 'agent' | 'ssh';
  owner_id: string | null;
  assigned_user_id: string | null;
  labels: Record<string, string>;
  max_concurrency: number;
  notes: string;
  agent_version: string | null;
  status: 'active' | 'revoked';
  online: boolean;
  last_heartbeat: string | null;
  has_credentials: boolean;
  can_manage: boolean;
  can_use: boolean;
};

export type MachineRegistration = {
  machine: Machine;
  token: string;
};

export type RegisterMachineRequest = {
  name: string;
  labels?: Record<string, string>;
  max_concurrency?: number;
  notes?: string;
  connection_type?: 'agent' | 'ssh';
  connection?: SshConnection;
};

export type AdminMachineRequest = RegisterMachineRequest & {
  assigned_user_id?: string | null;
  credentials?: Record<string, string>;
};

export async function listMachines(): Promise<Machine[]> {
  const { data } = await http.get<Machine[]>('/machines');
  return data;
}

export async function registerMachine(
  payload: RegisterMachineRequest,
): Promise<MachineRegistration> {
  const { data } = await http.post<MachineRegistration>('/machines', payload);
  return data;
}

export async function createAdminMachine(
  payload: AdminMachineRequest,
): Promise<MachineRegistration> {
  const { data } = await http.post<MachineRegistration>('/machines/admin', payload);
  return data;
}

export async function testMachineConnection(
  machineId: string,
): Promise<{ ok: boolean; latency_ms?: number; error?: string; online?: boolean }> {
  const { data } = await http.post<{
    ok: boolean;
    latency_ms?: number;
    error?: string;
    online?: boolean;
  }>(`/machines/${encodeURIComponent(machineId)}/test-connection`);
  return data;
}

export async function readCredentials(machineId: string): Promise<Record<string, string> | null> {
  const { data } = await http.get<{ credentials: Record<string, string> | null }>(
    `/machines/${encodeURIComponent(machineId)}/credentials`,
  );
  return data.credentials;
}

export async function updateMachine(
  machineId: string,
  payload: {
    name?: string;
    labels?: Record<string, string>;
    max_concurrency?: number;
    notes?: string;
    assigned_user_id?: string | null;
    transfer_to_user_id?: string;
  },
): Promise<Machine> {
  const { data } = await http.patch<Machine>(
    `/machines/${encodeURIComponent(machineId)}`,
    payload,
  );
  return data;
}

export async function rotateMachineToken(machineId: string): Promise<{ token: string }> {
  const { data } = await http.post<{ token: string }>(
    `/machines/${encodeURIComponent(machineId)}/token`,
  );
  return data;
}

export async function revokeMachine(machineId: string): Promise<void> {
  await http.delete(`/machines/${encodeURIComponent(machineId)}`);
}

export type Grant = {
  id: string;
  resource_type: 'pipeline' | 'plugin' | 'machine';
  resource_id: string;
  grantee_type: 'user' | 'team';
  grantee_id: string;
  permission: 'viewer' | 'operator';
  created_at: string;
};

export async function listGrants(
  resourceType: Grant['resource_type'],
  resourceId: string,
): Promise<Grant[]> {
  const { data } = await http.get<Grant[]>('/grants', {
    params: { resource_type: resourceType, resource_id: resourceId },
  });
  return data;
}

export async function createGrant(payload: {
  resource_type: Grant['resource_type'];
  resource_id: string;
  grantee_type: Grant['grantee_type'];
  grantee_id: string;
  permission: Grant['permission'];
}): Promise<Grant> {
  const { data } = await http.post<Grant>('/grants', payload);
  return data;
}

export async function deleteGrant(grantId: string): Promise<void> {
  await http.delete(`/grants/${encodeURIComponent(grantId)}`);
}

export type Team = {
  id: string;
  name: string;
  member_ids: string[];
};

export async function listTeams(): Promise<Team[]> {
  const { data } = await http.get<Team[]>('/teams');
  return data;
}

export type DeployKeyInfo = {
  public_key: string;
  key_type: string;
  fingerprint: string;
  source: string;
  comment?: string;
  machine_name?: string;
  machine_id?: string;
};

export async function getMachineDeployKey(machineId?: string): Promise<DeployKeyInfo> {
  const endpoint = machineId
    ? `/machines/${encodeURIComponent(machineId)}/deploy-key`
    : '/system/deploy-key';
  const { data } = await http.get<DeployKeyInfo>(endpoint);
  return data;
}

