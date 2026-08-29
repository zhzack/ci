import { http } from './http';

export type ReadinessCheck = {
  status: string;
  checks: Record<string, string>;
};

export type VersionInfo = {
  name: string;
  version: string;
  api: string;
};

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
