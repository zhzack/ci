import { http } from './http';







import type { CredentialType, CredentialScope, CredentialMaskedData, CredentialItem, CreateCredentialRequest, UpdateCredentialRequest, RawCredentialResponse } from '@/types/credentials';
export type { CredentialType, CredentialScope, CredentialMaskedData, CredentialItem, CreateCredentialRequest, UpdateCredentialRequest, RawCredentialResponse };

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
