import { http } from './http';



import type { CurrentUser, AuthMode } from '@/types/auth';
export type { CurrentUser, AuthMode };

export async function getAuthMode(): Promise<AuthMode> {
  const { data } = await http.get<AuthMode>('/auth/mode');
  return data;
}

export async function login(
  username: string,
  password: string
): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/login',
    { username, password }
  );
  return data;
}

export async function register(
  username: string,
  password: string,
  displayName: string,
  email?: string
): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/register',
    { username, password, display_name: displayName, email }
  );
  return data;
}

export async function sendEmailCode(
  email: string,
  purpose: 'register' | 'login' | 'reset_password' | 'bind_email' | 'test'
): Promise<{ message: string; email: string; expires_in: number }> {
  const { data } = await http.post<{ message: string; email: string; expires_in: number }>(
    '/auth/send-code',
    { email, purpose }
  );
  return data;
}

export async function loginWithOtp(
  email: string,
  code: string
): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/login-otp',
    { email, code }
  );
  return data;
}

export async function registerWithOtp(payload: {
  username: string;
  password: string;
  email: string;
  code: string;
  displayName?: string;
}): Promise<{ token: string; user: CurrentUser }> {
  const { data } = await http.post<{ token: string; user: CurrentUser }>(
    '/auth/register-otp',
    {
      username: payload.username,
      password: payload.password,
      email: payload.email,
      code: payload.code,
      display_name: payload.displayName || '',
    }
  );
  return data;
}

export async function resetPasswordWithOtp(payload: {
  email: string;
  code: string;
  new_password: string;
}): Promise<{ message: string }> {
  const { data } = await http.post<{ message: string }>(
    '/auth/reset-password-otp',
    payload
  );
  return data;
}

export async function bindEmailWithOtp(payload: {
  email: string;
  code: string;
}): Promise<CurrentUser> {
  const { data } = await http.post<CurrentUser>(
    '/auth/bind-email-otp',
    payload
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
