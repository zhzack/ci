/**
 * Types for the packages API surface.
 *
 * Single source of truth: api/packages.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/packages'.
 */

export type StorageItem = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mime_type?: string | null;
  updated_at?: string | null;
  extension: string;
  is_editable: boolean;
  is_plugin_candidate: boolean;
};

export type DirectoryListing = {
  driver: string;
  current_path: string;
  parent_path?: string | null;
  items: StorageItem[];
};

export type FilePreview = {
  name: string;
  path: string;
  size: number;
  mime_type: string;
  is_text: boolean;
  content?: string | null;
  line_count: number;
  is_editable: boolean;
  updated_at?: string | null;
};

export type ImportRemoteRequest = {
  url: string;
  target_dir?: string;
  filename?: string;
  credential_id?: string;
};

export type PackageShareLink = {
  id: string;
  token: string;
  owner_id: string;
  source_path: string;
  share_type: 'live' | 'snapshot';
  description: string;
  expires_at?: string | null;
  created_at: string;
};

export type PackageGrant = {
  id: string;
  resource_id: string;
  grantee_type: 'user' | 'team';
  grantee_id: string;
  permission: 'viewer' | 'operator';
  granted_by?: string | null;
  created_at: string;
};

export type ZoneUsage = {
  zone: string;
  name: string;
  size_bytes: number;
  file_count: number;
  dir_count: number;
  percentage: number;
};

export type TypeUsage = {
  category: string;
  label: string;
  color: string;
  size_bytes: number;
  file_count: number;
  percentage: number;
};

export type StorageLeaderboardItem = {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  updated_at?: string | null;
};

export type StorageStats = {
  scope_path: string;
  total_size_bytes: number;
  total_files: number;
  total_dirs: number;
  zones: ZoneUsage[];
  types: TypeUsage[];
  top_largest: StorageLeaderboardItem[];
};
