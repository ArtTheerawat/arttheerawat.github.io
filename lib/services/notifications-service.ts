// Notification read-state service — data access for the Notification Center.
// All reads/writes go through the DatabaseAdapter (via getDb()), keeping
// Supabase out of the hook/UI layer. The deterministic rule that DERIVES the
// notification items themselves lives in lib/notifications.ts (pure functions);
// this module only owns "how read-state is persisted/loaded".

import { getDb } from "../db";
import type { NotificationRead } from "../db/types";

export const NOTIF_READS_STORAGE_KEY = "theedeck:notification-reads";

/** Read-state persisted locally (fallback when Supabase is down or the user is
 *  not the owner). Shape: Record<notif_key, ISO-readAt-or-true>. */
export function loadLocalReads(): Map<string, boolean> {
  try {
    const raw = window.localStorage.getItem(NOTIF_READS_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, boolean | string>;
    const m = new Map<string, boolean>();
    for (const [k, v] of Object.entries(parsed)) {
      // any prior value (timestamp string or true) means "already read"
      m.set(k, Boolean(v));
    }
    return m;
  } catch {
    return new Map();
  }
}

function saveLocalReads(m: Map<string, boolean>): void {
  try {
    const obj: Record<string, true> = {};
    m.forEach((_, k) => {
      obj[k] = true;
    });
    window.localStorage.setItem(NOTIF_READS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* storage may be unavailable (private mode) — ignore, read-state is best-effort */
  }
}

/** Load the merged read-state: Supabase first (owner), localStorage fallback.
 *  The UI always needs SOME read-state, so this never fails — it returns a map
 *  of { key: isRead } and a boolean telling whether the source was Supabase
 *  (so writes target the same source). */
export async function loadNotificationReads(): Promise<{
  reads: Map<string, boolean>;
  source: "supabase" | "local";
}> {
  try {
    const res = await getDb().loadNotificationReads();
    if (res.ok && res.reads.length > 0) {
      const m = new Map<string, boolean>();
      for (const r of res.reads) m.set(r.key, r.read);
      return { reads: m, source: "supabase" };
    }
    // If Supabase is available but empty (fresh install), prefer Supabase as the
    // write target but seed from any local data so state isn't lost on upgrade.
    const db = getDb();
    const available = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const local = loadLocalReads();
    return { reads: local, source: available ? "supabase" : "local" };
  } catch {
    return { reads: loadLocalReads(), source: "local" };
  }
}

/** Mark a single key read/unread, mirrored to the active source. */
export async function upsertNotificationRead(
  key: string,
  read: boolean,
  source: "supabase" | "local"
): Promise<{ ok: boolean; error?: string }> {
  if (source === "local") {
    const m = loadLocalReads();
    if (read) m.set(key, true);
    else m.delete(key);
    saveLocalReads(m);
    return { ok: true };
  }
  try {
    const res = await getDb().upsertNotificationRead(key, read);
    if (!res.ok) {
      // backend rejected (e.g. not-owner / table missing) → fall back to local
      const m = loadLocalReads();
      if (read) m.set(key, true);
      else m.delete(key);
      saveLocalReads(m);
      return { ok: true, error: res.error };
    }
    return res;
  } catch {
    const m = loadLocalReads();
    if (read) m.set(key, true);
    else m.delete(key);
    saveLocalReads(m);
    return { ok: true };
  }
}

/** Mark many keys read at once against the active source. */
export async function markAllNotificationsRead(
  keys: string[],
  source: "supabase" | "local"
): Promise<{ ok: boolean; error?: string }> {
  if (source === "local") {
    const m = loadLocalReads();
    keys.forEach((k) => m.set(k, true));
    saveLocalReads(m);
    return { ok: true };
  }
  try {
    const res = await getDb().markAllNotificationsRead(keys);
    if (!res.ok) {
      const m = loadLocalReads();
      keys.forEach((k) => m.set(k, true));
      saveLocalReads(m);
      return { ok: true, error: res.error };
    }
    return res;
  } catch {
    const m = loadLocalReads();
    keys.forEach((k) => m.set(k, true));
    saveLocalReads(m);
    return { ok: true };
  }
}