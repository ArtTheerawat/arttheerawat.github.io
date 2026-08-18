// Database registry — the SINGLE place that selects which backend adapter the
// app uses. Pages and Services never name a backend directly; they call
// getDb() and use the DatabaseAdapter interface. To migrate storage
// (e.g. Supabase → Cloudflare D1), implement a new adapter and return it here.
// No page or service code changes.

import type { DatabaseAdapter } from "./adapter";
import { SupabaseAdapter } from "./supabase/adapter";

let instance: DatabaseAdapter | null = null;

/** Returns the active database adapter. Supabase is currently the only backend. */
export function getDb(): DatabaseAdapter {
  if (!instance) {
    instance = new SupabaseAdapter();
  }
  return instance;
}

/** True when the configured backend is available (env present). Intended for
 *  feature-gating (e.g. hiding a login button when no backend is wired). */
export function isBackendAvailable(): boolean {
  // Supabase is the only backend; availability == its env is configured.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anon);
}