/**
 * Types for the http API surface.
 *
 * Single source of truth: api/http.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/http'.
 */

import type { CurrentUser } from './auth';

export type StoredAuth = {
  token: string;
  user: CurrentUser;
};
