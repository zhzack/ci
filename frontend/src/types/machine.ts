/**
 * Types for the machine API surface.
 *
 * Single source of truth: api/machine.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/machine'.
 */

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
  connection_type: 'agent' | 'ssh' | 'builtin';
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
  hostname?: string | null;
  platform?: string | null;
  os_release?: string | null;
  arch?: string | null;
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

export type Grant = {
  id: string;
  resource_type: 'pipeline' | 'plugin' | 'machine';
  resource_id: string;
  grantee_type: 'user' | 'team';
  grantee_id: string;
  permission: 'viewer' | 'operator';
  created_at: string;
};

export type Team = {
  id: string;
  name: string;
  member_ids: string[];
};

export type DeployKeyInfo = {
  public_key: string;
  key_type: string;
  fingerprint: string;
  source: string;
  comment?: string;
  machine_name?: string;
  machine_id?: string;
};
