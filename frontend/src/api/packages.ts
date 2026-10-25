import { http, loadStoredAuth } from './http';




import type { StorageItem, DirectoryListing, FilePreview, ImportRemoteRequest, PackageShareLink, PackageGrant, ZoneUsage, TypeUsage, StorageLeaderboardItem, StorageStats } from '@/types/packages';
export type { StorageItem, DirectoryListing, FilePreview, ImportRemoteRequest, PackageShareLink, PackageGrant, ZoneUsage, TypeUsage, StorageLeaderboardItem, StorageStats };

export async function listPackageItems(path = ''): Promise<DirectoryListing> {
  const { data } = await http.get<DirectoryListing>('/packages', {
    params: { path },
  });
  return data;
}

export async function createDirectory(path: string, name: string): Promise<StorageItem> {
  const { data } = await http.post<StorageItem>('/packages/mkdir', {
    path,
    name,
  });
  return data;
}

export async function uploadPackageFile(
  file: File,
  targetDir = '',
  relativePath = '',
  onProgress?: (progressPercent: number, loadedBytes: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<StorageItem> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target_dir', targetDir);
  if (relativePath) {
    formData.append('relative_path', relativePath);
  }
  const { data } = await http.post<StorageItem>('/packages/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 0, // No client timeout for large file uploads (GB scale)
    signal,
    onUploadProgress: (progressEvent) => {
      const total = progressEvent.total || file.size || 1;
      const loaded = progressEvent.loaded || 0;
      const percent = Math.min(99, Math.round((loaded * 100) / total));
      if (onProgress) {
        onProgress(percent, loaded, total);
      }
    },
  });
  return data;
}

export async function extractPackageArchive(
  path: string,
  targetDir?: string,
): Promise<StorageItem> {
  const { data } = await http.post<StorageItem>('/packages/extract', {
    path,
    target_dir: targetDir,
  });
  return data;
}


export async function importRemotePackage(req: ImportRemoteRequest): Promise<StorageItem> {
  const { data } = await http.post<StorageItem>('/packages/import-remote', req);
  return data;
}

export function downloadPackageUrl(path: string): string {
  const auth = loadStoredAuth();
  const tokenParam = auth?.token ? `&token=${encodeURIComponent(auth.token)}` : '';
  return `/api/packages/download?path=${encodeURIComponent(path)}${tokenParam}`;
}

export async function downloadPackageFileDirect(path: string, filename: string): Promise<void> {
  const response = await http.get('/packages/download', {
    params: { path },
    responseType: 'blob',
  });
  const blob = new Blob([response.data]);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function batchDownloadPackagesDirect(paths: string[]): Promise<void> {
  const response = await http.post(
    '/packages/batch-download',
    { paths },
    { responseType: 'blob', timeout: 0 },
  );
  const blob = new Blob([response.data], { type: 'application/zip' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `batch_download_${Date.now()}.zip`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function batchDeletePackageItems(
  paths: string[],
): Promise<{ success: boolean; deleted_count: number }> {
  const { data } = await http.post<{ success: boolean; deleted_count: number }>(
    '/packages/batch-delete',
    { paths },
  );
  return data;
}

export async function batchCopyPackageItems(
  srcPaths: string[],
  dstDir: string,
): Promise<{ success: boolean; copied_count: number }> {
  const { data } = await http.post<{ success: boolean; copied_count: number }>(
    '/packages/batch-copy',
    { src_paths: srcPaths, dst_dir: dstDir },
  );
  return data;
}

export async function previewPackageFile(path: string): Promise<FilePreview> {
  const { data } = await http.get<FilePreview>('/packages/preview', {
    params: { path },
  });
  return data;
}

export async function savePackageFile(path: string, content: string): Promise<StorageItem> {
  const { data } = await http.put<StorageItem>('/packages/file', {
    path,
    content,
  });
  return data;
}

export async function deletePackageItem(path: string, recursive = false): Promise<{ success: boolean }> {
  const { data } = await http.delete<{ success: boolean }>('/packages', {
    params: { path, recursive },
  });
  return data;
}

export async function publishPackageAsPlugin(path: string): Promise<unknown> {
  const { data } = await http.post('/packages/publish-plugin', {
    path,
  });
  return data;
}

export async function copyPackageItem(srcPath: string, dstPath: string): Promise<StorageItem> {
  const { data } = await http.post<StorageItem>('/packages/copy', {
    src_path: srcPath,
    dst_path: dstPath,
  });
  return data;
}


export async function createPackageShare(payload: {
  source_path: string;
  share_type: 'live' | 'snapshot';
  description?: string;
  expires_in_hours?: number;
}): Promise<PackageShareLink> {
  const { data } = await http.post<PackageShareLink>('/packages/share', payload);
  return data;
}

export async function listPackageShares(): Promise<PackageShareLink[]> {
  const { data } = await http.get<PackageShareLink[]>('/packages/shares');
  return data;
}

export async function deletePackageShare(token: string): Promise<{ success: boolean }> {
  const { data } = await http.delete<{ success: boolean }>(`/packages/shares/${encodeURIComponent(token)}`);
  return data;
}

export async function getSharedContent(token: string, path = ''): Promise<DirectoryListing> {
  const { data } = await http.get<DirectoryListing>(`/packages/shared/${encodeURIComponent(token)}`, {
    params: { path },
  });
  return data;
}

export function downloadSharedUrl(token: string, path = ''): string {
  return `/api/packages/shared/${encodeURIComponent(token)}/download?path=${encodeURIComponent(path)}`;
}

export async function downloadSharedFileDirect(token: string, filename: string, path = ''): Promise<void> {
  const response = await http.get(`/packages/shared/${encodeURIComponent(token)}/download`, {
    params: { path },
    responseType: 'blob',
  });
  const blob = new Blob([response.data]);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function importFromShare(token: string, targetPath = ''): Promise<StorageItem> {
  const { data } = await http.post<StorageItem>(`/packages/shared/${encodeURIComponent(token)}/import`, {
    target_path: targetPath,
  });
  return data;
}


export async function createPackageGrant(payload: {
  path: string;
  grantee_type: 'user' | 'team';
  grantee_id: string;
  permission: 'viewer' | 'operator';
}): Promise<PackageGrant> {
  const { data } = await http.post<PackageGrant>('/packages/grants', payload);
  return data;
}

export async function listPackageGrants(path: string): Promise<PackageGrant[]> {
  const { data } = await http.get<PackageGrant[]>('/packages/grants', {
    params: { path },
  });
  return data;
}

export async function revokePackageGrant(grantId: string): Promise<{ success: boolean }> {
  const { data } = await http.delete<{ success: boolean }>(`/packages/grants/${encodeURIComponent(grantId)}`);
  return data;
}





export async function getPackageStats(path = ''): Promise<StorageStats> {
  const { data } = await http.get<StorageStats>('/packages/stats', {
    params: { path },
  });
  return data;
}



