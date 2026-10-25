import { http } from './http';



import type { ReadinessCheck, VersionInfo } from '@/types/health';
export type { ReadinessCheck, VersionInfo };

/** GET /health/ready — lives outside the /api prefix by design. */
export async function getReadiness(): Promise<ReadinessCheck> {
  const { data } = await http.get<ReadinessCheck>('/health/ready', {
    baseURL: '/',
  });
  return data;
}

/** GET /health/version — lives outside the /api prefix by design. */
export async function getVersion(): Promise<VersionInfo> {
  const { data } = await http.get<VersionInfo>('/health/version', {
    baseURL: '/',
  });
  return data;
}
