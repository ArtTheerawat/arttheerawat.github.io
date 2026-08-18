// Supabase implementation of DatabaseAdapter. This is the ONLY place in the
// app (outside middleware + auth route handlers) that talks to the Supabase
// SDK. It maps Supabase snake_case rows -> the domain models in lib/db/types.ts.
// To use a different backend later, write a new adapter implementing
// lib/db/adapter.ts and swap it in lib/db/index.ts — nothing else changes.

import { getSupabaseBrowserClient } from "../../supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { DatabaseAdapter } from "../adapter";
import type {
  Announcement,
  CourseGroup,
  Coursework,
  DbUser,
  HiddenTask,
  LinkOverride,
  NotificationRead,
  PerfDay,
  Signal,
  Trade,
} from "../types";

interface HiddenTaskRow {
  id: string;
  user_id: string | null;
  task_key: string;
  course: string;
  title: string;
  due: string | null;
  reason: string;
  custom_reason: string | null;
  hidden_at: string;
}

interface ClassroomTaskRow {
  task_key: string;
  course_name: string | null;
  course_id: string | null;
  title: string | null;
  due: string | null;
  due_time: string | null;
  state: string | null;
}

interface AnnouncementRow {
  ann_key: string;
  course_name: string | null;
  course_id: string | null;
  text: string | null;
  time: string | null;
}

type Client = NonNullable<ReturnType<typeof getSupabaseBrowserClient>>;

/**
 * Module-level singleton realtime subscription for hidden_tasks.
 *
 * Keyed by the SAME underlying supabase client object (NOT by adapter instance).
 * `useHiddenTasks()` is mounted by several components on one page (the nav
 * layout's AuthStatus + the page body + ...). Each call creates a fresh
 * SupabaseAdapter via getDb(), so keying on `this` would never share. supabase-js
 * CACHES a realtime channel by topic name — if a 2nd caller opens the same
 * channel and calls .on() AFTER .subscribe(), realtime-js throws
 * "cannot add `postgres_changes` callbacks ... after `subscribe()`", which is a
 * client-side exception that crashes the whole Next app. This map guarantees ONE
 * channel per client, callbacks registered BEFORE subscribe, ref-counted.
 */
const subscribeCache = new WeakMap<
  Client,
  {
    sb: Client;
    listeners: Set<() => void | Promise<void>>;
    channel: RealtimeChannel | null;
  }
>();
const REALTIME_CHANNEL = "hidden-tasks-realtime-realtime-singleton";

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

interface LinkOverrideRow {
  task_key: string;
  url: string;
  updated_at: string;
}

function rowToLinkOverride(r: LinkOverrideRow): LinkOverride {
  return { key: r.task_key, url: r.url, updatedAt: r.updated_at };
}

interface NotificationReadRow {
  notif_key: string;
  read: boolean;
  read_at: string;
}

function rowToNotificationRead(r: NotificationReadRow): NotificationRead {
  return { key: r.notif_key, read: r.read, readAt: r.read_at };
}

function rowToTrade(r: any): Trade {
  return {
    timestamp: r.timestamp,
    symbol: r.symbol,
    direction: r.direction,
    volume: r.volume,
    entry: r.entry != null ? String(r.entry) : undefined,
    tp: r.tp != null ? String(r.tp) : undefined,
    sl: r.sl != null ? String(r.sl) : undefined,
    netPnl: r.net_pnl,
    status: r.status,
  };
}

function rowToSignal(r: any): Signal {
  return {
    timestamp: r.timestamp,
    symbol: r.symbol,
    signal: r.signal,
    direction: r.direction,
    confidence: r.confidence,
    d1Trend: r.d1_trend,
    h1Trend: r.h1_trend,
    entryZone: r.entry_zone,
    status: r.status,
  };
}

function rowToPerfDay(r: any): PerfDay {
  return {
    date: r.date,
    totalTrades: r.total_trades,
    wins: r.wins,
    losses: r.losses,
    winrate: r.winrate,
    netPnl: r.net_pnl,
    balance: r.balance,
  };
}

function rowToCoursework(r: ClassroomTaskRow): Coursework {
  return {
    title: r.title || undefined,
    due: r.due || undefined,
    dueTime: r.due_time || undefined,
    state: r.state || undefined,
    id: r.task_key || undefined,
    courseName: r.course_name || undefined,
    courseId: r.course_id || undefined,
  };
}

function rowToAnnouncement(r: AnnouncementRow): Announcement {
  return {
    text: r.text || undefined,
    time: r.time || undefined,
    id: r.ann_key || undefined,
    courseName: r.course_name || undefined,
    courseId: r.course_id || undefined,
  };
}

export class SupabaseAdapter implements DatabaseAdapter {
  readonly kind = "supabase";

  /** Returns the browser client, or null when env isn't configured. */
  private client(): Client | null {
    const c = getSupabaseBrowserClient();
    // getSupabaseBrowserClient already returns null when env missing.
    return (c as Client | null) ?? null;
  }

  async listTrades(limit: number): Promise<Trade[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb
      .from("trades")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.listTrades:", error.message);
      return [];
    }
    return (data as any[]).map(rowToTrade);
  }

  async listSignals(limit: number): Promise<Signal[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb
      .from("signals")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.listSignals:", error.message);
      return [];
    }
    return (data as any[]).map(rowToSignal);
  }

  async listPerfDays(limit: number): Promise<PerfDay[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb
      .from("trading_daily")
      .select("*")
      .order("date", { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.listPerfDays:", error.message);
      return [];
    }
    return (data as any[]).map(rowToPerfDay);
  }

  /** Returns { ok, error? } — error is undefined on success. Returns error when
   *  Supabase isn't configured (so services can fall back to static JSON). */
  async loadTrading(): Promise<{
    ok: boolean;
    trades: Trade[];
    signals: Signal[];
    perf: PerfDay[];
    error?: string;
  }> {
    const sb = this.client();
    if (!sb) return { ok: false, trades: [], signals: [], perf: [], error: "Supabase ยังไม่ได้ติดตั้ง" };
    try {
      const [tRes, sRes, pRes] = await Promise.all([
        sb.from("trades").select("*").order("timestamp", { ascending: false }).limit(300),
        sb.from("signals").select("*").order("timestamp", { ascending: false }).limit(200),
        sb.from("trading_daily").select("*").order("date", { ascending: false }).limit(60),
      ]);
      if (tRes.error) {
        return {
          ok: false,
          trades: [],
          signals: [],
          perf: [],
          error: "Supabase: " + (tRes.error.message || "query failed"),
        };
      }
      return {
        ok: true,
        trades: (tRes.data || []).map(rowToTrade),
        signals: (sRes.data || []).map(rowToSignal),
        perf: (pRes.data || []).map(rowToPerfDay),
      };
    } catch (e) {
      return {
        ok: false,
        trades: [],
        signals: [],
        perf: [],
        error: "Supabase error: " + (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  async listClassroomTasks(): Promise<Coursework[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb
      .from("classroom_tasks")
      .select("*")
      .order("due", { ascending: true });
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.listClassroomTasks:", error.message);
      return [];
    }
    return (data as any[]).map(rowToCoursework);
  }

  async listAnnouncements(): Promise<Announcement[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb
      .from("classroom_announcements")
      .select("*")
      .order("time", { ascending: false });
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.listAnnouncements:", error.message);
      return [];
    }
    return (data as any[]).map(rowToAnnouncement);
  }

  /** Returns { ok, courses, error? } — error set when Supabase query failed
   *  (so services fall back to static JSON), ok:false without error when
   *  Supabase isn't configured. */
  async loadClassroom(): Promise<{
    ok: boolean;
    courses: CourseGroup[];
    error?: string;
  }> {
    const sb = this.client();
    if (!sb) return { ok: false, courses: [], error: "Supabase ยังไม่ได้ติดตั้ง" };
    try {
      const [tRes, aRes] = await Promise.all([
        sb.from("classroom_tasks").select("*").order("due", { ascending: true }),
        sb.from("classroom_announcements").select("*").order("time", { ascending: false }),
      ]);
      if (tRes.error || aRes.error) {
        return {
          ok: false,
          courses: [],
          error:
            "Supabase: " + ((tRes.error?.message || aRes.error?.message) || "query failed"),
        };
      }
      const tasks = (tRes.data || []).map(rowToCoursework);
      const anns = (aRes.data || []).map(rowToAnnouncement);
      const byCourse = new Map<string, { name?: string; id?: string; coursework: Coursework[]; announcements: Announcement[] }>();
      const getCourse = (id?: string, name?: string) => {
        const key = id || name || "unknown";
        if (!byCourse.has(key))
          byCourse.set(key, { name: name || id || "unknown", id: id || name || undefined, coursework: [], announcements: [] });
        return byCourse.get(key)!;
      };
      for (const t of tasks) {
        const g = getCourse(t.courseId, t.courseName);
        g.coursework.push({ ...t });
      }
      for (const a of anns) {
        const g = getCourse(a.courseId, a.courseName);
        g.announcements.push({ ...a });
      }
      return { ok: true, courses: Array.from(byCourse.values()) };
    } catch (e) {
      return {
        ok: false,
        courses: [],
        error: "Supabase error: " + (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  async loadHiddenTasks(): Promise<HiddenTask[]> {
    const sb = this.client();
    if (!sb) return [];
    const { data, error } = await sb.from("hidden_tasks").select("*").order("hidden_at", { ascending: false });
    if (error || !data) {
      if (error) console.warn("SupabaseAdapter.loadHiddenTasks:", error.message);
      return [];
    }
    return (data as HiddenTaskRow[]).map(rowToHiddenTask);
  }

  async upsertHiddenTask(input: {
    key: string;
    userId?: string | null;
    course: string;
    title: string;
    due?: string | null;
    reason: string;
    customReason?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const payload = {
      task_key: input.key,
      user_id: input.userId ?? null,
      course: input.course,
      title: input.title,
      due: input.due || null,
      reason: input.reason,
      custom_reason: input.reason === "other" ? input.customReason || null : null,
    };
    const { error } = await sb.from("hidden_tasks").upsert(payload, { onConflict: "task_key" });
    if (error) {
      console.warn("SupabaseAdapter.upsertHiddenTask:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async deleteHiddenTask(key: string): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await sb.from("hidden_tasks").delete().eq("task_key", key);
    if (error) {
      console.warn("SupabaseAdapter.deleteHiddenTask:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async clearHiddenTasks(): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await sb.from("hidden_tasks").delete();
    if (error) {
      console.warn("SupabaseAdapter.clearHiddenTasks:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async loadLinkOverrides(): Promise<{ ok: boolean; overrides: LinkOverride[]; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, overrides: [], error: "Supabase ยังไม่ได้ติดตั้ง" };
    // classroom_link_overrides isn't in the generated types (migration 0009
    // pasted via Dashboard), so treat the table as untyped.
    const { data, error } = await (sb.from("classroom_link_overrides") as any)
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      // The migration may not have been applied yet — this is a soft failure:
      // callers fall back to localStorage, so don't spam a hard error.
      console.warn("SupabaseAdapter.loadLinkOverrides:", error.message);
      return { ok: true, overrides: [], error: undefined };
    }
    return { ok: true, overrides: (data as any[] || []).map(rowToLinkOverride) };
  }

  async upsertLinkOverride(input: { key: string; url: string }): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await (sb.from("classroom_link_overrides") as any)
      .upsert(
        { task_key: input.key, url: input.url, updated_at: new Date().toISOString() },
        { onConflict: "task_key" }
      );
    if (error) {
      console.warn("SupabaseAdapter.upsertLinkOverride:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async deleteLinkOverride(key: string): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await (sb.from("classroom_link_overrides") as any).delete().eq("task_key", key);
    if (error) {
      console.warn("SupabaseAdapter.deleteLinkOverride:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  subscribeHiddenTasks(onChange: () => void | Promise<void>): () => void {
    const sb = this.client();
    if (!sb) return () => {};

    // Singleton realtime channel PER supabase client. Multiple components on a
    // single page all call useHiddenTasks() (the nav layout's AuthStatus + the
    // page body + ...). supabase-js CACHES a channel by topic name, so a 2nd
    // caller opening the same channel and calling .on() AFTER .subscribe()
    // throws "cannot add `postgres_changes` callbacks after `subscribe()`" — a
    // client-side exception that crashes the whole Next app. Instead: build the
    // channel exactly once, registering the callback BEFORE subscribe, then
    // share it. The returned unsub fn ref-counts the shared listener set and
    // tears down the channel when the last one leaves.
    let entry = subscribeCache.get(sb);
    if (!entry) {
      const listeners = new Set<() => void | Promise<void>>();
      const entryObj = { sb, listeners, channel: null as RealtimeChannel | null };
      try {
        entryObj.channel = sb
          .channel(REALTIME_CHANNEL)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "hidden_tasks" },
            () => {
              listeners.forEach((l) => {
                try {
                  void l();
                } catch {
                  /* one subscriber's error must not kill the channel */
                }
              });
            }
          )
          .subscribe();
      } catch {
        // If setup throws (realtime torn down etc.), never crash the app.
        return () => {};
      }
      entry = entryObj;
      subscribeCache.set(sb, entryObj);
    }
    const listeners = entry.listeners;
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
      if (listeners.size === 0) {
        if (entry!.channel) {
          try {
            void entry!.sb.removeChannel(entry!.channel);
          } catch {
            /* ignore */
          }
        }
        subscribeCache.delete(entry!.sb);
      }
    };
  }

  async getUser(): Promise<DbUser | null> {
    const sb = this.client();
    if (!sb) return null;
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return null;
    return { id: user.id, email: user.email ?? undefined, name: user.user_metadata?.full_name ?? undefined };
  }

  async getSessionUserId(): Promise<string | null> {
    const sb = this.client();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.user?.id ?? null;
  }

  subscribeAuthState(handler: () => void | Promise<void>): () => void {
    const sb = this.client();
    if (!sb) return () => {};
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        void handler();
      }
    });
    return () => data.subscription.unsubscribe();
  }

  async signInWithGoogle(redirectTo: string): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      console.warn("SupabaseAdapter.signInWithGoogle:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  // ── Notification read-state ────────────────────────────────────────────────

  /** Load persisted read-state. `notifications` may not exist yet (migration
   *  0010 pasted later), so a table-missing error is a SOFT failure: callers
   *  fall back to localStorage, exactly like link-overrides (0009). */
  async loadNotificationReads(): Promise<{
    ok: boolean;
    reads: NotificationRead[];
    error?: string;
  }> {
    const sb = this.client();
    if (!sb) return { ok: false, reads: [], error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { data, error } = await (sb.from("notifications") as any)
      .select("*")
      .order("read_at", { ascending: false });
    if (error) {
      console.warn("SupabaseAdapter.loadNotificationReads:", error.message);
      return { ok: true, reads: [], error: undefined };
    }
    return { ok: true, reads: (data as any[] || []).map(rowToNotificationRead) };
  }

  async upsertNotificationRead(key: string, read: boolean): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    const { error } = await (sb.from("notifications") as any).upsert(
      { notif_key: key, read, read_at: new Date().toISOString() },
      { onConflict: "notif_key" }
    );
    if (error) {
      console.warn("SupabaseAdapter.upsertNotificationRead:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  async markAllNotificationsRead(keys: string[]): Promise<{ ok: boolean; error?: string }> {
    const sb = this.client();
    if (!sb) return { ok: false, error: "Supabase ยังไม่ได้ติดตั้ง" };
    if (keys.length === 0) return { ok: true };
    const { error } = await (sb.from("notifications") as any).upsert(
      keys.map((k) => ({ notif_key: k, read: true, read_at: new Date().toISOString() })),
      { onConflict: "notif_key" }
    );
    if (error) {
      console.warn("SupabaseAdapter.markAllNotificationsRead:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  }
}