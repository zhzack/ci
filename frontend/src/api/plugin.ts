import { http } from './http';
import type { Paged } from '@/types/common';
import type { PluginManifest, PluginVersion, RegisterPluginRequest } from '@/types/plugin';


import type { PluginListParams, GitBranchProbeResult } from '@/types/plugin';
export type { PluginListParams, GitBranchProbeResult };

export async function listPlugins(params: PluginListParams = {}): Promise<Paged<PluginVersion>> {
  const { data } = await http.get<Paged<PluginVersion>>('/plugins', { params });
  return data;
}

export async function getPlugin(name: string, version: string): Promise<PluginVersion> {
  const { data } = await http.get<PluginVersion>(`/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  return data;
}

export async function getPluginManifest(
  name: string,
  version: string,
): Promise<PluginManifest> {
  const { data } = await http.get<PluginManifest>(
    `/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}/manifest`,
  );
  return data;
}

export async function registerPlugin(payload: RegisterPluginRequest): Promise<PluginVersion> {
  const { data } = await http.post<PluginVersion>('/plugins/register', payload);
  return data;
}

export async function uploadPlugin(file: File): Promise<PluginVersion> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await http.post<PluginVersion>('/plugins/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function uploadPluginFolder(files: File[]): Promise<PluginVersion> {
  const formData = new FormData();
  for (const file of files) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
      ?? file.name;
    formData.append('files', file, relative);
  }
  const { data } = await http.post<PluginVersion>('/plugins/upload-folder', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function deletePlugin(name: string, version: string): Promise<void> {
  await http.delete(`/plugins/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
}


export async function detectGitBranches(
  url: string,
  credentialId?: string,
): Promise<GitBranchProbeResult> {
  const { data } = await http.post<GitBranchProbeResult>('/plugins/git-branches', {
    url,
    credential_id: credentialId || undefined,
  });
  return data;
}
