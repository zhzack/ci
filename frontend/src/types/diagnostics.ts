/**
 * Types for the diagnostics API surface.
 *
 * Single source of truth: api/diagnostics.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/diagnostics'.
 */

export interface GpuMetric {
  name: string;
  index: number;
  utilization_percent: number;
  memory_total_mb: number;
  memory_used_mb: number;
  temperature_c?: number | null;
}

export interface SystemOverview {
  hostname: string;
  platform: string;
  os_release: string;
  arch: string;
  cpu_count: number;
  cpu_percent: number;
  memory_total_mb: number;
  memory_used_mb: number;
  memory_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  uptime_seconds: number;
  network_sent_mb?: number;
  network_recv_mb?: number;
  gpus: GpuMetric[];
  online?: boolean;
  last_heartbeat?: string | null;
  collected_at: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpu_percent: number;
  memory_percent: number;
  status: string;
  started_at: string;
  command: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  ipv4: string;
  ipv6: string;
  mac: string;
  status: string;
  rx_mb: number;
  tx_mb: number;
}

export interface NetworkConnectionInfo {
  proto: string;
  local_addr: string;
  remote_addr: string;
  state: string;
  pid?: number | null;
  process_name?: string;
}

export interface NetworkDiagnostics {
  sent_total_mb: number;
  recv_total_mb: number;
  interfaces: NetworkInterfaceInfo[];
  connections: NetworkConnectionInfo[];
}

export interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  modified_at: string;
  permissions: string;
}

export interface DriveInfo {
  device_id: string;
  mount_point: string;
  volume_name?: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
  fs_type?: string;
}

export interface FileContentResult {
  path: string;
  content: string;
  size_bytes: number;
  is_text: boolean;
  encoding: string;
  error?: string | null;
}

export interface CommandExecRequest {
  command: string;
  working_dir?: string;
  timeout_seconds?: number;
}

export interface CommandExecResult {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  new_working_dir?: string | null;
}
