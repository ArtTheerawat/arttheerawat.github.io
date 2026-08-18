// Link-overrides service — data access for the per-assignment "ไปที่ Classroom"
// URL overrides (cross-device sync). All reads/writes go through the
// DatabaseAdapter (via getDb()), keeping Supabase out of the hook/UI layer.
//
// Cross-device model mirrors hidden_tasks: the override set is GLOBAL (everyone
// reads it, the same on every device); only the owner can write (RLS-gated via
// is_hidden_tasks_owner()). So an override set on the computer appears on the
// phone when it loads the same task's modal.

import { getDb } from "../db";
import type { LinkOverride } from "../db/types";

export interface LinkOverrideResult {
  ok: boolean;
  overrides: LinkOverride[];
  error?: string;
}

/** Load the GLOBAL link-override set. Soft-fails to [] when the backend is
 *  unset or the migration isn't applied yet (callers mirror to localStorage). */
export async function loadLinkOverrides(): Promise<LinkOverride[]> {
  const res = await getDb().loadLinkOverrides();
  // Treat non-ok as "no backend source" → return [] so the hook keeps whatever
  // it already has in memory/localStorage rather than wiping it on a hiccup.
  if (!res.ok) return [];
  return res.overrides || [];
}

/** Set (or clear, url="") a manual override globally. Owner-only via RLS.
 *  Returns the real backend error so the UI can surface RLS/grant problems. */
export async function upsertLinkOverride(
  input: { key: string; url: string }
): Promise<{ ok: boolean; error?: string }> {
  return getDb().upsertLinkOverride(input);
}

/** Remove a manual override globally. Owner-only via RLS. */
export async function deleteLinkOverride(key: string): Promise<{ ok: boolean; error?: string }> {
  return getDb().deleteLinkOverride(key);
}