/**
 * Types for the health API surface.
 *
 * Single source of truth: api/health.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/health'.
 */

export type ReadinessCheck = {
  status: string;
  checks: Record<string, string>;
};

export type VersionInfo = {
  name: string;
  version: string;
  api: string;
};
