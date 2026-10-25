/**
 * Types for the credentials API surface.
 *
 * Single source of truth: api/credentials.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/credentials'.
 */

export type CredentialType = 'username_password' | 'secret_text' | 'ssh_key' | 'secret_file';

export type CredentialScope = 'personal' | 'team' | 'global';

export type CredentialMaskedData = {
  username?: string;
  password?: string;
  secret?: string;
  preview?: string;
  length?: number;
  private_key?: string;
  has_passphrase?: boolean;
  filename?: string;
  has_content?: boolean;
  [key: string]: unknown;
};

export type CredentialItem = {
  id: string;
  name: string;
  type: CredentialType;
  scope: CredentialScope;
  owner_id?: string | null;
  owner_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  description: string;
  domain_patterns?: string[];
  data: CredentialMaskedData;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CreateCredentialRequest = {
  name: string;
  type: CredentialType;
  scope: CredentialScope;
  payload: Record<string, unknown>;
  description?: string;
  team_id?: string | null;
  domain_patterns?: string[];
};

export type UpdateCredentialRequest = {
  name?: string;
  description?: string;
  scope?: CredentialScope;
  payload?: Record<string, unknown>;
  team_id?: string | null;
  domain_patterns?: string[];
};

export type RawCredentialResponse = {
  id: string;
  name: string;
  type: CredentialType;
  data: Record<string, unknown>;
};
