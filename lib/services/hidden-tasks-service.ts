// Hidden-tasks service — data access for the global hide set. All reads/writes
// go through the DatabaseAdapter (via getDb()), keeping Supabase out of the
// hook/UI layer. Logics (taskKey, filtering, etc.) stay in lib/hidden-tasks.ts;
// this module only owns "how hidden tasks are persisted/loaded".

import { getDb } from "../db";
import type { HiddenTask } from "../db/types";

/** Load the GLOBAL hidden-task set. Returns [] when the backend is unavailable. */
export async function loadHiddenTasks(): Promise<HiddenTask[]> {
  return getDb().loadHiddenTasks();
}

/** Hide an assignment globally. RLS enforces owner-only writes server-side.
 *  Returns the real backend error message on failure so the UI can show the
 *  exact reason instead of a generic toast. */
export async function hideTask(
  input: { course?: string; title?: string; due?: string; key: string },
  reason: string,
  custom?: string
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  let userId: string | null = null;
  try {
    userId = await db.getSessionUserId();
  } catch {
    userId = null;
  }
  return db.upsertHiddenTask({
    key: input.key,
    userId,
    course: (input.course || "").trim(),
    title: (input.title || "").trim(),
    due: (input.due || "").trim() || null,
    reason,
    customReason: reason === "other" ? (custom || "").trim() : null,
  });
}

/** Un-hide (restore) an assignment globally. Owner-only via RLS. */
export async function unhideTask(key: string): Promise<{ ok: boolean; error?: string }> {
  return getDb().deleteHiddenTask(key);
}

/** Remove every hidden entry (global). Owner-only via RLS. */
export async function clearHiddenTasks(): Promise<{ ok: boolean; error?: string }> {
  return getDb().clearHiddenTasks();
}

/** Subscribe to hidden-task changes (realtime). Returns an unsubscribe fn. */
export function subscribeHiddenTasks(onChange: () => void | Promise<void>): () => void {
  const db = getDb();
  return db.subscribeHiddenTasks?.(onChange) ?? (() => {});
}

/** Subscribe to auth state changes. Returns an unsubscribe fn. */
export function subscribeAuthState(handler: () => void | Promise<void>): () => void {
  const db = getDb();
  return db.subscribeAuthState?.(handler) ?? (() => {});
}

/** Current signed-in user, or null. */
export async function getCurrentUser() {
  return getDb().getUser();
}

/** Sign in with Google. */
export async function signInWithGoogle(redirectTo: string): Promise<{ ok: boolean; error?: string }> {
  return getDb().signInWithGoogle(redirectTo);
}