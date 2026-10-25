/**
 * Shared display formatters. Two byte-formatting families exist on purpose:
 * `formatSize` (binary KiB/MiB units, upload/storage surfaces) and
 * `formatBytes` (KB/MB units, machine console surfaces) — do not merge them.
 */

/** 1024-based, KiB/MiB/GiB units with variable decimals (uploads, storage). */
export function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** 1024-based, KB/MB/GB units trimmed to 2 decimals (machine console). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
