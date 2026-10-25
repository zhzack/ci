import { http } from './http';












import type { GpuMetric, SystemOverview, ProcessInfo, NetworkInterfaceInfo, NetworkConnectionInfo, NetworkDiagnostics, DirectoryEntry, DriveInfo, FileContentResult, CommandExecRequest, CommandExecResult } from '@/types/diagnostics';
export type { GpuMetric, SystemOverview, ProcessInfo, NetworkInterfaceInfo, NetworkConnectionInfo, NetworkDiagnostics, DirectoryEntry, DriveInfo, FileContentResult, CommandExecRequest, CommandExecResult };

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
