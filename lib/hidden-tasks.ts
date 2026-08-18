// Hidden-task data layer for the hub — backed by Supabase (cloud) so the
// hidden set stays in sync across devices. Hides are GLOBAL: the set is a
// single shared list that everyone who opens the site (signed in or not) sees,
// like "editing the website". Only the approved owner(s) can mutate it, per
// the RLS policies in the 0002 migration.
//
// Google-Classroom-synced source data (public/data/assignments.json) is NEVER
// touched: hiding lives entirely in the `hidden_tasks` table (RLS-scoped to
// its global read/write model).
//
// Stable task key = course + title + due. Because `due` is part of the key, if
// a professor CHANGES the due date the key changes too, so the task re-appears
// as a "new" task (guard against genuinely missing a real deadline).

import { useEffect, useRef, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "./supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface HiddenTask {
  key: string;
  course: string;
  title: string;
  due?: string;
  reason: string; // e.g. "wrong-due" | "already-submitted" | "cancelled" | "other"
  custom?: string; // free text when reason === "other"
  hiddenAt: string; // ISO timestamp
}

export interface Hiddenable {
  course?: string;
  title?: string;
  due?: string;
}

/** Build a stable key for an assignment (course + normalized title + due). */
export function taskKey(a: Hiddenable): string {
  const course = (a.course || "").trim();
  const title = (a.title || "").trim();
  const due = (a.due || "").trim();
  return [course, title, due].join("|");
}

/** REASON_LABELS: stable labels + ids shown in the hide modal. */
export const HIDE_REASONS: { id: string; label: string }[] = [
  { id: "wrong-due", label: "อาจารย์ตั้งกำหนดส่งผิด" },
  { id: "already-submitted", label: "ส่งแล้ว แต่ระบบยังไม่อัปเดต" },
  { id: "cancelled", label: "ยกเลิกงาน" },
  { id: "other", label: "อื่น ๆ" },
];

export function reasonLabel(id: string): string {
  const hit = HIDE_REASONS.find((r) => r.id === id);
  return hit ? hit.label : id;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Row mapping helpers (Supabase row <-> HiddenTask)
 * ────────────────────────────────────────────────────────────────────────── */
interface HiddenTaskRow {
  id: string;
  user_id: string | null; // nullable now — kept for back-compat with pre-global rows
  task_key: string;
  course: string;
  title: string;
  due: string | null;
  reason: string;
  custom_reason: string | null;
  hidden_at: string;
}

function rowToHiddenTask(r: HiddenTaskRow): HiddenTask {
  return {
    key: r.task_key,
    course: r.course || "",
    title: r.title || "",
    due: r.due || undefined,
    reason: r.reason,
    custom: r.custom_reason || undefined,
    hiddenAt: r.hidden_at,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Low-level Supabase calls (all async). Used by the hook below and directly
 * by the tables when an explicit imperative call is needed.
 * ────────────────────────────────────────────────────────────────────────── */

/** Load the GLOBAL hidden-task set. Everyone (signed in or not) can read it,
 *  so no auth check is required here. Returns [] when Supabase isn't set up. */
export async function loadHiddenTasks(): Promise<HiddenTask[]> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from("hidden_tasks")
    .select("*")
    .order("hidden_at", { ascending: false });
  if (error || !data) {
    console.warn("loadHiddenTasks:", error?.message);
    return [];
  }
  return (data as HiddenTaskRow[]).map(rowToHiddenTask);
}

/** Hide an assignment globally. RLS enforces owner-only writes server-side.
 *  Returns the real Supabase error message on failure so the UI can show the
 *  exact reason (RLS, missing grant, or conflict) instead of a generic toast.
 *
 *  `user_id` is deliberately included: the live table still has `user_id`
 *  NOT NULL (migrations 0002/0003 that try to `drop not null` were never fully
 *  applied), so an upsert without it fails with a not-null violation. Setting it
 *  to the logged-in user's id satisfies the constraint and is harmless to the
 *  global model (reads are global via select_public; writes are owner-gated by
 *  email). If the migration is applied later, the column is merely populated. */
export async function hideTask(
  a: Hiddenable,
  reason: string,
  custom?: string
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง (ไม่พบ env)" };
  const key = taskKey(a);
  // Read the current user id so we can satisfy the NOT NULL user_id column.
  const { data: sess } = await sb.auth.getSession();
  const uid = sess?.session?.user?.id ?? null;
  const payload = {
    task_key: key,
    user_id: uid,
    course: (a.course || "").trim(),
    title: (a.title || "").trim(),
    due: (a.due || "").trim() || null,
    reason,
    custom_reason: reason === "other" ? (custom || "").trim() : null,
  };
  // Upsert keyed on task_key — idempotent re-hide (global, so unique).
  const { error } = await sb.from("hidden_tasks").upsert(payload, { onConflict: "task_key" });
  if (error) {
    console.warn("hideTask:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Un-hide (restore) an assignment globally. Owner-only via RLS. */
export async function unhideTask(key: string): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง (ไม่พบ env)" };
  const { error } = await sb.from("hidden_tasks").delete().eq("task_key", key);
  if (error) {
    console.warn("unhideTask:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Remove every hidden entry (global). Owner-only via RLS. */
export async function clearHiddenTasks(): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง (ไม่พบ env)" };
  const { error } = await sb.from("hidden_tasks").delete();
  if (error) {
    console.warn("clearHiddenTasks:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Is the given assignment currently hidden? (pure — call with the live list) */
export function isTaskHidden(a: Hiddenable, list: HiddenTask[]): boolean {
  const k = taskKey(a);
  return list.some((h) => h.key === k);
}

/** Filter an assignment draft for strictly canonical fields (no bucket noise). */
export function canonicalAssignment(a: Hiddenable, list: HiddenTask[]): {
  a: Hiddenable;
  hidden: boolean;
} {
  return { a, hidden: isTaskHidden(a, list) };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Brief-item filtering for AI "next action" cards (Home /today).
 *
 * next_action.json is written by a morning cron that has NO knowledge of the
 * hidden_tasks set, so its items must be cross-checked against hiddenList or a
 * user-hidden task would still surface as "should do now". We match by title
 * (the brief carries no raw `due`, and its course is "code + name" while the
 * hidden key's course is the bare code), cross-checked that the course agrees
 * so a same-named task in a different class is not wrongly dropped.
 * ────────────────────────────────────────────────────────────────────────── */
export interface BriefItem {
  title?: string;
  course?: string;
  dueLabel?: string;
  effort_hr?: string;
  why?: string;
}

export function filterVisibleBriefItems(items: BriefItem[] | null | undefined, hiddenList: HiddenTask[]): BriefItem[] {
  if (!items) return [];
  return items.filter((it) => {
    const t = (it.title || "").trim();
    if (!t) return false;
    const hidden = hiddenList.find((h) => {
      const hTitle = (h.title || "").trim();
      if (hTitle && hTitle !== t) return false;
      const hCourse = (h.course || "").trim();
      const iCourse = (it.course || "").trim();
      if (hCourse && iCourse && !(iCourse.startsWith(hCourse) || hCourse === iCourse)) return false;
      return true;
    });
    return !hidden;
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * useHiddenTasks — the hook every page uses (GLOBAL model).
 *
 * Returns { user, status, hiddenList, canEdit, isHidden, hide, unhide,
 *           clearAll, refresh, signInWithGoogle }.
 *
 *  - The hidden set is GLOBAL: it loads immediately for everyone (signed in
 *    or not) and is the same on every device. Reads need no auth.
 *  - Writes (hide/unhide/clear) are OWNER-ONLY, enforced by RLS server-side.
 *    `canEdit` tells the UI whether the current signed-in user is the owner.
 *  - Subscribes to Supabase realtime on hidden_tasks (all rows), so a hide on
 *    the phone updates the open tab on the computer immediately, and multiple
 *    tabs on the same device stay in sync (cross-tab).
 *  - Every mutation returns a Promise<boolean> so callers can show feedback
 *    only on real success.
 * ────────────────────────────────────────────────────────────────────────── */

/** Owner emails for mutating the hidden set (client-safe, matches RLS allow-list in
 *  migrations 0002/0003). Must be set via NEXT_PUBLIC_HIDDEN_ALLOWED_EMAILS so the
 *  client gate agrees with Supabase RLS. If it is unset we deliberately LOCK writes
 *  (button hidden) rather than fall back to "any signed-in user" — falling back is
 *  exactly the bug that let a non-owner see the hide button but get rejected by RLS. */
const OWNER_EMAILS =
  (process.env.NEXT_PUBLIC_HIDDEN_ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

function isOwnerEmail(email?: string): boolean {
  if (!email) return false;
  // No configured owner list → nobody can write (fail-closed).
  if (OWNER_EMAILS.length === 0) return false;
  return OWNER_EMAILS.includes(email.toLowerCase());
}

export function useHiddenTasks() {
  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hiddenList, setHiddenList] = useState<HiddenTask[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const canEdit = !!user && isOwnerEmail(user.email);

  // (Re)build the sorted list from rows whenever payloads tick in.
  const applyRows = useCallback((rows: HiddenTaskRow[] | null) => {
    setHiddenList(
      (rows || [])
        .map(rowToHiddenTask)
        .sort((a, b) => (a.hiddenAt < b.hiddenAt ? 1 : -1))
    );
  }, []);

  const refresh = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setUser(null);
      setHiddenList([]);
      setStatus("ready");
      return;
    }
    try {
      const {
        data: { user: u },
      } = await sb.auth.getUser();
      // Track the signed-in user (for owner detection + login UI), but the
      // hidden list itself is global and loads regardless.
      setUser(u ? { id: u.id, email: u.email ?? undefined, name: u.user_metadata?.full_name ?? undefined } : null);
      if (u) {
        // Signed in — full read via authed client.
        const { data, error } = await sb
          .from("hidden_tasks")
          .select("*")
          .order("hidden_at", { ascending: false });
        if (error) {
          setStatus("error");
          return;
        }
        applyRows((data as HiddenTaskRow[]) || []);
      } else {
        // Guest — still read the global set (SELECT is open to anon).
        const { data, error } = await sb
          .from("hidden_tasks")
          .select("*")
          .order("hidden_at", { ascending: false });
        if (error) {
          setStatus("error");
          return;
        }
        applyRows((data as HiddenTaskRow[]) || []);
      }
      setStatus("ready");
    } catch (e) {
      setStatus("error");
    }
  }, [applyRows]);

  // Realtime + auth-change wiring (no per-user filter — global set).
  useEffect(() => {
    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setUser(null);
      setHiddenList([]);
      setStatus("ready");
      return;
    }

    const setupChannel = async () => {
      // Clear any previous channel.
      if (channelRef.current) {
        await sb.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      channelRef.current = sb
        .channel("hidden-tasks-realtime")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "hidden_tasks",
          },
          async () => {
            // Refetch the full list on any change (simplest correct sync).
            await refresh();
          }
        )
        .subscribe();
    };

    refresh();
    setupChannel();

    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        refresh();
        setupChannel();
      }
    });

    // Cross-tab safety net: also refetch when the tab is focused again.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      if (channelRef.current) sb.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [refresh]);

  const hide = useCallback(
    async (a: Hiddenable, reason: string, custom?: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await hideTask(a, reason, custom);
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const unhide = useCallback(
    async (key: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await unhideTask(key);
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const clearAll = useCallback(
    async (): Promise<{ ok: boolean; error?: string }> => {
      const res = await clearHiddenTasks();
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const signInWithGoogle = useCallback(async () => {
    const sb = getSupabaseBrowserClient();
    if (!sb) return;
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`,
      },
    });
    if (error) console.warn("signInWithGoogle:", error.message);
  }, []);

  return {
    user,
    status,
    hiddenList,
    canEdit,
    isHidden: (a: Hiddenable) => isTaskHidden(a, hiddenList),
    hide,
    unhide,
    clearAll,
    refresh,
    signInWithGoogle,
  };
}