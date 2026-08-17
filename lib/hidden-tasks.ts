// Hidden-task data layer for the hub — now backed by Supabase (cloud) instead
// of localStorage so the hidden set stays in sync across devices (computer +
// phone) for the same signed-in user.
//
// Google-Classroom-synced source data (public/data/assignments.json) is NEVER
// touched: hiding is strictly a per-user preference stored in the
// `hidden_tasks` table (RLS-scoped to the owning user).
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
  user_id: string;
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

/** Load this user's hidden tasks from the cloud. Returns [] when not signed
 *  in or when Supabase isn't configured. */
export async function loadHiddenTasks(): Promise<HiddenTask[]> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return [];
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return [];
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

/** Hide an assignment in the cloud. Returns true on success. */
export async function hideTask(
  a: Hiddenable,
  reason: string,
  custom?: string
): Promise<boolean> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return false;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const key = taskKey(a);
  const payload = {
    user_id: user.id,
    task_key: key,
    course: (a.course || "").trim(),
    title: (a.title || "").trim(),
    due: (a.due || "").trim() || null,
    reason,
    custom_reason: reason === "other" ? (custom || "").trim() : null,
  };
  // Upsert keyed on (user_id, task_key) — idempotent re-hide.
  const { error } = await sb.from("hidden_tasks").upsert(payload, { onConflict: "user_id,task_key" });
  if (error) {
    console.warn("hideTask:", error.message);
    return false;
  }
  return true;
}

/** Un-hide (restore) an assignment in the cloud. Returns true on success. */
export async function unhideTask(key: string): Promise<boolean> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return false;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const { error } = await sb.from("hidden_tasks").delete().eq("user_id", user.id).eq("task_key", key);
  if (error) {
    console.warn("unhideTask:", error.message);
    return false;
  }
  return true;
}

/** Remove every hidden entry for this user. Returns true on success. */
export async function clearHiddenTasks(): Promise<boolean> {
  const sb = getSupabaseBrowserClient();
  if (!sb) return false;
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return false;
  const { error } = await sb.from("hidden_tasks").delete().eq("user_id", user.id);
  if (error) {
    console.warn("clearHiddenTasks:", error.message);
    return false;
  }
  return true;
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
 * useHiddenTasks — the hook every page uses.
 *
 * Returns { user, loading, hiddenList, isHidden, hide, unhide, clearAll,
 *           refresh, signInWithGoogle }.
 *
 *  - Loads on mount and whenever the auth user changes.
 *  - Subscribes to Supabase realtime on hidden_tasks for this user, so a hide
 *    on the phone updates the open tab on the computer immediately, and
 *    multiple tabs on the same device stay in sync (cross-tab).
 *  - A browser `storage`/visibility fallback also re-fetches when the tab gets
 *    focus, as an extra cross-tab safety net.
 *  - Every mutation returns a Promise<boolean> so callers can show feedback
 *    only on real success.
 * ────────────────────────────────────────────────────────────────────────── */
export function useHiddenTasks() {
  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [hiddenList, setHiddenList] = useState<HiddenTask[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // (Re)build the sorted list from rows whenever payloads tick in.
  const applyRows = useCallback((rows: HiddenTaskRow[]) => {
    setHiddenList(
      rows
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
      if (!u) {
        setUser(null);
        setHiddenList([]);
        setStatus("ready");
        return;
      }
      setUser({ id: u.id, email: u.email ?? undefined, name: u.user_metadata?.full_name ?? undefined });
      const { data, error } = await sb
        .from("hidden_tasks")
        .select("*")
        .order("hidden_at", { ascending: false });
      if (error) {
        setStatus("error");
        return;
      }
      applyRows((data as HiddenTaskRow[]) || []);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
    }
  }, [applyRows]);

  // Auth state change → reload + manage realtime channel.
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
      const {
        data: { user: u },
      } = await sb.auth.getUser();
      if (!u) return;
      channelRef.current = sb
        .channel("hidden-tasks-realtime")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "hidden_tasks",
            filter: `user_id=eq.${u.id}`,
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
    async (a: Hiddenable, reason: string, custom?: string): Promise<boolean> => {
      const ok = await hideTask(a, reason, custom);
      if (ok) await refresh();
      return ok;
    },
    [refresh]
  );

  const unhide = useCallback(
    async (key: string): Promise<boolean> => {
      const ok = await unhideTask(key);
      if (ok) await refresh();
      return ok;
    },
    [refresh]
  );

  const clearAll = useCallback(async (): Promise<boolean> => {
    const ok = await clearHiddenTasks();
    if (ok) await refresh();
    return ok;
  }, [refresh]);

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
    isHidden: (a: Hiddenable) => isTaskHidden(a, hiddenList),
    hide,
    unhide,
    clearAll,
    refresh,
    signInWithGoogle,
  };
}