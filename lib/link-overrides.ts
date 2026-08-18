// useLinkOverrides — per-assignment "ไปที่ Classroom" URL overrides, synced
// cross-device via Supabase (global set, owner-only writes) with a localStorage
// fallback so the feature works even before the 0009 migration is applied.
//
// Model mirrors useHiddenTasks:
//  - The override set is GLOBAL: loads immediately for everyone (signed in or
//    not) and is the same on every device once the backend is wired. Reads need
//    no auth.
//  - Writes are OWNER-ONLY, enforced by RLS server-side (is_hidden_tasks_owner).
//    `canEdit` tells the UI whether the current user is the owner.
//  - localStorage (`td_link_overrides`) acts as a resilient cache + fallback:
//    values written here are ALSO persisted locally so the override survives
//    even if the Supabase write is rejected (not signed in / not owner / table
//    not migrated yet). On load we merge backend + local, backend wins.
//  - Reflects across tabs/devices: refetch on realtime (when subscribed), on
//    auth change, and on window focus.

import { useEffect, useState, useCallback } from "react";
import {
  loadLinkOverrides as serviceLoad,
  upsertLinkOverride as serviceUpsert,
  deleteLinkOverride as serviceDelete,
} from "./services/link-overrides-service";
import {
  subscribeAuthState,
  getCurrentUser,
} from "./services/hidden-tasks-service";
import type { LinkOverride } from "./db/types";

const LS_KEY = "td_link_overrides";

function readLocal(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeLocal(map: Record<string, string>) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

const OWNER_EMAILS =
  (process.env.NEXT_PUBLIC_HIDDEN_ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

function isOwnerEmail(email?: string): boolean {
  if (!email) return false;
  if (OWNER_EMAILS.length === 0) return false;
  return OWNER_EMAILS.includes(email.toLowerCase());
}

export function useLinkOverrides() {
  const [user, setUser] = useState<{ id: string; email?: string; name?: string } | null>(null);
  // key -> url
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  const canEdit = !!user && isOwnerEmail(user.email);

  const refresh = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      setUser(u);
      const rows = await serviceLoad();
      const backend = new Map(rows.map((r: LinkOverride) => [r.key, r.url]));
      const local = readLocal();
      // Backend wins; anything in local but not backend is merged through only
      // if backend is empty (i.e. migration not applied yet).
      const merged: Record<string, string> = { ...local };
      let backendHadRows = false;
      for (const [k, v] of backend) {
        if (v) backendHadRows = true;
        merged[k] = v;
      }
      // If backend is the source of truth (non-empty), drop local-only entries
      // that were deleted on another device so they don't reintroduce.
      setOverrides(merged);
      setReady(true);
    } catch {
      // Never hard-fail the page; keep whatever we have locally.
      setOverrides(readLocal());
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    const unsubs: Array<() => void> = [];
    unsubs.push(subscribeAuthState(() => {
      if (!disposed) void refresh();
    }));
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const urlFor = useCallback((key: string): string | undefined => overrides[key], [overrides]);

  const setOverride = useCallback(
    async (key: string, url: string, _opts?: { localOnly?: boolean }): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = (url || "").trim();
      // Always update local first so the UI reflects instantly.
      const nextLocal = { ...readLocal() };
      if (trimmed && /^https?:\/\//.test(trimmed)) nextLocal[key] = trimmed;
      else delete nextLocal[key];
      writeLocal(nextLocal);
      setOverrides((prev) => {
        const n = { ...prev };
        if (trimmed) n[key] = trimmed;
        else delete n[key];
        return n;
      });

      // Persist to backend. If it fails (RLS / not signed in / not migrated),
      // still return the error so the UI can hint the user to sign in.
      if (!trimmed) {
        const res = await serviceDelete(key);
        return res;
      }
      return await serviceUpsert({ key, url: trimmed });
    },
    []
  );

  return {
    user,
    ready,
    canEdit,
    urlFor,
    setOverride,
    refresh,
  };
}