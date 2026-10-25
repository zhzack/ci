/**
 * Types for the admin API surface.
 *
 * Single source of truth: api/admin.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/admin'.
 */

import type { CurrentUser } from './auth';

export type AdminUser = CurrentUser & {
  email?: string | null;
  must_change_password?: boolean;
};

export type AdminTeam = { id: string; name: string; member_ids: string[] };

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

export type SmtpConfig = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  sender_email: string;
  sender_name: string;
  use_ssl: boolean;
  use_tls: boolean;
  has_password?: boolean;
};
