/**
 * Types for the store API surface.
 *
 * Single source of truth: api/store.ts re-exports these for backwards
 * compatibility; new code should import from '@/types/store'.
 */

export type PublishRequestPayload = { plugin_id: string };
