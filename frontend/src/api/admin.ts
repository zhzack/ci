import { http } from './http';


import type { AdminUser, AdminTeam, AuditEntry, SmtpConfig } from '@/types/admin';
export type { AdminUser, AdminTeam, AuditEntry, SmtpConfig };

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


export async function adminAudit(limit = 100): Promise<AuditEntry[]> {
  const { data } = await http.get<AuditEntry[]>('/admin/audit', { params: { limit } });
  return data;
}


export async function adminGetEmailConfig(): Promise<SmtpConfig> {
  const { data } = await http.get<SmtpConfig>('/admin/email-config');
  return data;
}

export async function adminUpdateEmailConfig(payload: SmtpConfig & { password?: string }): Promise<{ message: string }> {
  const { data } = await http.put<{ message: string }>('/admin/email-config', payload);
  return data;
}

export async function adminSendTestEmail(to_email: string): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>('/admin/test-email', { to_email });
  return data;
}
