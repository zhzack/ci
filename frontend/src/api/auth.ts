import { http } from './http';

export type CurrentUser = {
  id: string;
  username: string;
  display_name: string;
  email?: string | null;
  role: string;
  status: string;
  must_change_password?: boolean;
};

export type AuthMode = {
  enabled: boolean;
  registration_enabled: boolean;
};

export async function getAuthMode(): Promise<AuthMode> {
  const { data } = await http.get<AuthMode>('/auth/mode');
  return data;
}

export async function login(username: string, password: string): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/login',
    { username, password },
  );
  return data;
}

export async function register(
  username: string,
  password: string,
  displayName: string,
  email?: string,
): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/register',
    { username, password, display_name: displayName, email },
  );
  return data;
}

export async function me(): Promise<CurrentUser> {
  const { data } = await http.get<CurrentUser>('/auth/me');
  return data;
}

export async function updateProfile(payload: {
  display_name?: string;
  email?: string;
}): Promise<CurrentUser> {
  const { data } = await http.patch<CurrentUser>('/auth/me', payload);
  return data;
}

export async function changePassword(payload: {
  old_password?: string;
  new_password: string;
}): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>('/auth/change-password', payload);
  return data;
}

export async function logout(): Promise<void> {
  await http.post('/auth/logout');
}

