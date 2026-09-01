import { http } from './http';

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

export async function getCredentials(): Promise<CredentialItem[]> {
  const { data } = await http.get<CredentialItem[]>('/credentials');
  return data;
}

export async function getCredential(id: string): Promise<CredentialItem> {
  const { data } = await http.get<CredentialItem>(`/credentials/${id}`);
  return data;
}

export async function matchCredentials(url: string): Promise<CredentialItem[]> {
  const { data } = await http.get<CredentialItem[]>('/credentials/match', {
    params: { url },
  });
  return data;
}

export async function getRawCredential(id: string): Promise<RawCredentialResponse> {
  const { data } = await http.get<RawCredentialResponse>(`/credentials/${id}/raw`);
  return data;
}

export async function createCredential(req: CreateCredentialRequest): Promise<CredentialItem> {
  const { data } = await http.post<CredentialItem>('/credentials', req);
  return data;
}

export async function updateCredential(
  id: string,
  req: UpdateCredentialRequest
): Promise<CredentialItem> {
  const { data } = await http.put<CredentialItem>(`/credentials/${id}`, req);
  return data;
}

export async function deleteCredential(id: string): Promise<void> {
  await http.delete(`/credentials/${id}`);
}
