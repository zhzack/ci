/**
 * Types for the auth API surface.
 *
 * Single source of truth: api/auth.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/auth'.
 */

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
