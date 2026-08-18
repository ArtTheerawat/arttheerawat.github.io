// ─────────────────────────────────────────────────────────────────────────────
// DatabaseAdapter — the contract between the Service layer and any storage
// backend. UI and Services depend ONLY on this interface (plus the domain
// models in lib/db/types.ts). To migrate the storage (e.g. Supabase → D1),
// write a new adapter that `implements DatabaseAdapter` and swap it in
// lib/db/index.ts — no page or service code changes.
//
// NOTE: realtime / auth primitives that are inherently provider-specific are
// deliberately NOT part of this interface. `subscribeHiddenTasks` is exposed as
// an optional, adapter-supplied capability so callers that need live updates
// can still get them without the UI knowing which backend it is.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CourseGroup,
  DbUser,
  HiddenTask,
  LinkOverride,
  PerfDay,
  Signal,
  Trade,
} from "./types";

/** A change callback used for realtime subscription (optional capability). */
export type HiddenChangeHandler = () => void | Promise<void>;

export interface DatabaseAdapter {
  readonly kind: string; // e.g. "supabase" — for diagnostics/source labels

  // ── Trading ────────────────────────────────────────────────────────────────
  /** Loads trades + signals + perf in one shot. `ok: false` + `error` when the
   *  backend is unset or errored, so services can fall back to static JSON. */
  loadTrading(): Promise<{
    ok: boolean;
    trades: Trade[];
    signals: Signal[];
    perf: PerfDay[];
    error?: string;
  }>;

  // ── Classroom ──────────────────────────────────────────────────────────────
  /** Load classroom tasks grouped by course. `ok: false` + `error` when the
   *  backend is unset or errored, so services can fall back to static JSON. */
  loadClassroom(): Promise<{
    ok: boolean;
    courses: CourseGroup[];
    error?: string;
  }>;

  // ── Hidden tasks ───────────────────────────────────────────────────────────
  loadHiddenTasks(): Promise<HiddenTask[]>;
  upsertHiddenTask(input: {
    key: string;
    userId?: string | null;
    course: string;
    title: string;
    due?: string | null;
    reason: string;
    customReason?: string | null;
  }): Promise<{ ok: boolean; error?: string }>;
  deleteHiddenTask(key: string): Promise<{ ok: boolean; error?: string }>;
  clearHiddenTasks(): Promise<{ ok: boolean; error?: string }>;

  /** Subscribes to hidden-task changes. Returns an unsubscribe function. */
  subscribeHiddenTasks?(onChange: HiddenChangeHandler): () => void;

  // ── Classroom link overrides ──────────────────────────────────────────────
  /** Load the GLOBAL per-assignment link overrides (supabase + localStorage
   *  fallback merged by the hook; this reads the backend source). */
  loadLinkOverrides(): Promise<{ ok: boolean; overrides: LinkOverride[]; error?: string }>;
  /** Record a manual override (owner-only via RLS). Pass url="" to delete. */
  upsertLinkOverride(input: { key: string; url: string }): Promise<{ ok: boolean; error?: string }>;
  deleteLinkOverride(key: string): Promise<{ ok: boolean; error?: string }>;

  /** Current signed-in session's user id, or null. (Used to satisfy the
   *  NOT NULL user_id column in hidden_tasks; not for identity checks.) */
  getSessionUserId(): Promise<string | null>;

  /** Subscribe to auth state changes. Returns an unsubscribe function.
   *  `handler` fires whenever the sign-in state changes (signed in/out/update). */
  subscribeAuthState?(handler: () => void | Promise<void>): () => void;

  // ── Auth ───────────────────────────────────────────────────────────────────
  /** Current signed-in user, or null. */
  getUser(): Promise<DbUser | null>;

  /** Sign in with Google (provider-specific). Used by UI log-in button. */
  signInWithGoogle(redirectTo: string): Promise<{ ok: boolean; error?: string }>;
}