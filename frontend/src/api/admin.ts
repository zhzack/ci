import { http } from './http';
import type { CurrentUser } from './auth';

export type AdminUser = CurrentUser & {
  email?: string | null;
  must_change_password?: boolean;
};

export async function adminListUsers(): Promise<AdminUser[]> {
  const { data } = await http.get<AdminUser[]>('/admin/users');
  return data;
}

export async function adminCreateUser(payload: {
  username: string;
  password: string;
  display_name?: string;
  email?: string;
  role?: 'admin' | 'user';
  must_change_password?: boolean;
}): Promise<AdminUser> {
  const { data } = await http.post<AdminUser>('/admin/users', payload);
  return data;
}

export async function adminResetPassword(
  userId: string,
  payload: { new_password: string; must_change_password?: boolean },
): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    payload,
  );
  return data;
}

export async function adminSetRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  await http.patch(`/admin/users/${encodeURIComponent(userId)}/role`, { role });
}

export async function adminSetStatus(
  userId: string,
  status: 'active' | 'disabled',
): Promise<void> {
  await http.patch(`/admin/users/${encodeURIComponent(userId)}/status`, { status });
}

export type AdminTeam = { id: string; name: string; member_ids: string[] };

export async function adminListTeams(): Promise<AdminTeam[]> {
  const { data } = await http.get<AdminTeam[]>('/admin/teams');
  return data;
}

export async function adminCreateTeam(name: string): Promise<AdminTeam> {
  const { data } = await http.post<AdminTeam>('/admin/teams', { name });
  return data;
}

export async function adminAddTeamMember(teamId: string, userId: string): Promise<void> {
  await http.post(`/admin/teams/${encodeURIComponent(teamId)}/members`, { user_id: userId });
}

export async function adminRemoveTeamMember(teamId: string, userId: string): Promise<void> {
  await http.delete(`/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
}

export type AuditEntry = {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown>;
  request_id: string | null;
  created_at: string;
};

export async function adminAudit(limit = 100): Promise<AuditEntry[]> {
  const { data } = await http.get<AuditEntry[]>('/admin/audit', { params: { limit } });
  return data;
}
