import { http } from './http';

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

export async function getMachineOverview(machineId: string): Promise<SystemOverview> {
  const { data } = await http.get<SystemOverview>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/overview`
  );
  return data;
}

export async function getMachineProcesses(machineId: string): Promise<ProcessInfo[]> {
  const { data } = await http.get<ProcessInfo[]>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/processes`
  );
  return data;
}

export async function getMachineNetwork(machineId: string): Promise<NetworkDiagnostics> {
  const { data } = await http.get<NetworkDiagnostics>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/network`
  );
  return data;
}

export async function getMachineDrives(machineId: string): Promise<DriveInfo[]> {
  const { data } = await http.get<DriveInfo[]>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/drives`
  );
  return data;
}

export async function listMachineDirectory(
  machineId: string,
  path = '/'
): Promise<DirectoryEntry[]> {
  const { data } = await http.get<DirectoryEntry[]>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files`,
    { params: { path } }
  );
  return data;
}

export async function readMachineFile(
  machineId: string,
  path: string
): Promise<FileContentResult> {
  const { data } = await http.get<FileContentResult>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/content`,
    { params: { path } }
  );
  return data;
}

export async function saveMachineFile(
  machineId: string,
  path: string,
  content: string
): Promise<{ message: string }> {
  const { data } = await http.put<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/content`,
    { path, content }
  );
  return data;
}

export async function uploadMachineFile(
  machineId: string,
  targetDir: string,
  file: File
): Promise<{ message: string }> {
  const formData = new FormData();
  formData.append('target_dir', targetDir);
  formData.append('file', file);
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/upload`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data;
}

export function getDownloadFilesUrl(machineId: string, paths: string[]): string {
  const query = paths.map((p) => `paths=${encodeURIComponent(p)}`).join('&');
  return `/api/machines/${encodeURIComponent(machineId)}/diagnostics/files/download?${query}`;
}

export async function batchDeleteMachineFiles(
  machineId: string,
  paths: string[]
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/batch-delete`,
    { paths }
  );
  return data;
}

export async function execMachineCommand(
  machineId: string,
  payload: CommandExecRequest
): Promise<CommandExecResult> {
  const { data } = await http.post<CommandExecResult>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/exec`,
    payload
  );
  return data;
}

export async function createMachineDirectory(
  machineId: string,
  path: string
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/mkdir`,
    { path }
  );
  return data;
}

export async function createMachineFile(
  machineId: string,
  path: string
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/touch`,
    { path }
  );
  return data;
}

export async function renameMachinePath(
  machineId: string,
  oldPath: string,
  newPath: string
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/rename`,
    { old_path: oldPath, new_path: newPath }
  );
  return data;
}

export async function chmodMachinePath(
  machineId: string,
  path: string,
  mode: string
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/machines/${encodeURIComponent(machineId)}/diagnostics/files/chmod`,
    { path, mode }
  );
  return data;
}
