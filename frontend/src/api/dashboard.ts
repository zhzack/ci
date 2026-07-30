import { http } from './http';
import type { DashboardSummary } from '@/types/dashboard';

export async function dashboardSummary(): Promise<DashboardSummary> {
  const { data } = await http.get<DashboardSummary>('/dashboard/summary');
  return data;
}
