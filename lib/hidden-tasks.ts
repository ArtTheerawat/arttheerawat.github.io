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

import { useEffect, useState, useCallback } from "react";
import type { BriefWarning } from "@/lib/brief";
import {
  loadHiddenTasks as serviceLoadHiddenTasks,
  hideTask as serviceHideTask,
  unhideTask as serviceUnhideTask,
  clearHiddenTasks as serviceClearHiddenTasks,
  subscribeHiddenTasks,
  subscribeAuthState,
  getCurrentUser,
  signInWithGoogle as serviceSignInWithGoogle,
} from "./services/hidden-tasks-service";

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
 * Data access — delegated to the hidden-tasks service (and through it, the
 * DatabaseAdapter). Kept as thin re-exports so callers / tables keep the same
 * signatures; the actual backend reads/writes live in the service layer.
 * ────────────────────────────────────────────────────────────────────────── */

/** Load the GLOBAL hidden-task set. Everyone (signed in or not) can read it,
 *  so no auth check is required here. Returns [] when the backend is unset. */
export const loadHiddenTasks = serviceLoadHiddenTasks;

/** Hide an assignment globally. RLS enforces owner-only writes server-side.
 *  Returns the real backend error message on failure so the UI can show the
 *  exact reason (RLS, missing grant, or conflict) instead of a generic toast. */
export async function hideTask(
  a: Hiddenable,
  reason: string,
  custom?: string
): Promise<{ ok: boolean; error?: string }> {
  return serviceHideTask({ key: taskKey(a), course: a.course, title: a.title, due: a.due }, reason, custom);
}

/** Un-hide (restore) an assignment globally. Owner-only via RLS. */
export const unhideTask = serviceUnhideTask;

/** Remove every hidden entry (global). Owner-only via RLS. */
export const clearHiddenTasks = serviceClearHiddenTasks;

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
  const norm = (s?: string) => (s || "").trim().toLowerCase();
  // count how many distinct hidden courses share a given title — if a title is
  // used by different classes we must not blanket-hide it.
  const titleCourseCounts = new Map<string, Set<string>>();
  hiddenList.forEach((h) => {
    const t = norm(h.title);
    if (!t) return;
    if (!titleCourseCounts.has(t)) titleCourseCounts.set(t, new Set());
    titleCourseCounts.get(t)!.add(norm(h.course));
  });
  const courseLooksAlike = (a?: string, b?: string) => {
    const A = norm(a), B = norm(b);
    if (!A || !B) return false;
    return A === B || A.includes(B) || B.includes(A);
  };
  return items.filter((it) => {
    const t = norm(it.title);
    if (!t) return false;
    // a hidden task matches if the title agrees AND the course is not a clear
    // different-class conflict.
    const hidden = hiddenList.find((h) => {
      if (norm(h.title) !== t) return false;
      // If this title occurs in multiple classes, require the courses to look
      // alike (same code, or code/name substring) to avoid hiding the wrong one.
      if ((titleCourseCounts.get(t) || new Set()).size > 1) {
        if (!courseLooksAlike(h.course, it.course)) return false;
      }
      return true;
    });
    return !hidden;
  });
}

/** Filter AI warnings that mention a hidden task — so a hidden overdue task
 *  never re-appears as \"⛔ มีงานเลยกำหนด... (ยืนยัน..., วิดีโอ Week5...)\".
 *  Match is substring (case-insensitive) on the warning text vs each hidden
 *  title; if ANY hidden title appears in the text, the whole warning is dropped.
 *  Generic count warnings without titles (e.g. \"มีงานเลยกำหนด 3 รายการ\") are kept
 *  — they will be naturally suppressed when all overdue items are hidden because
 *  the caller falls back to the deterministic card (aiVisibleItems.length === 0). */
export function filterVisibleWarnings(
  warnings: BriefWarning[] | null | undefined,
  hiddenList: HiddenTask[]
): BriefWarning[] {
  if (!warnings || warnings.length === 0) return [];
  if (hiddenList.length === 0) return warnings;
  const norm = (s?: string) => (s || "").trim().toLowerCase();
  const hiddenTitles = hiddenList.map((h) => norm(h.title)).filter(Boolean);
  return warnings.filter((w) => {
    const txt = norm(w.text);
    if (!txt) return false;
    // If any hidden title appears as substring in the warning, drop it
    for (const ht of hiddenTitles) {
      if (ht && txt.includes(ht)) return false;
    }
    return true;
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

  const canEdit = !!user && isOwnerEmail(user.email);

  const refresh = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      // Track the signed-in user (for owner detection + login UI), but the
      // hidden list itself is global and loads regardless.
      setUser(u);
      const rows = await serviceLoadHiddenTasks();
      setHiddenList(rows.slice().sort((a, b) => (a.hiddenAt < b.hiddenAt ? 1 : -1)));
      setStatus("ready");
    } catch (e) {
      setStatus("error");
    }
  }, []);

  // Realtime + auth-change wiring (no per-user filter — global set).
  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];

    // Refetch the full list on any change (simplest correct sync).
    unsubs.push(subscribeHiddenTasks(() => {
      if (!disposed) void refresh();
    }));
    // Re-trigger refresh on auth change too.
    unsubs.push(subscribeAuthState(() => {
      if (!disposed) void refresh();
    }));

    void refresh();

    // Cross-tab safety net: also refetch when the tab is focused again.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const hide = useCallback(
    async (a: Hiddenable, reason: string, custom?: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await serviceHideTask(
        { key: taskKey(a), course: a.course, title: a.title, due: a.due },
        reason,
        custom
      );
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const unhide = useCallback(
    async (key: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await serviceUnhideTask(key);
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const clearAll = useCallback(
    async (): Promise<{ ok: boolean; error?: string }> => {
      const res = await serviceClearHiddenTasks();
      if (res.ok) await refresh();
      return res;
    },
    [refresh]
  );

  const signInWithGoogle = useCallback(async () => {
    await serviceSignInWithGoogle(
      `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname)}`
    );
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