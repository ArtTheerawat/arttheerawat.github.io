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

  subscribeHiddenTasks(onChange: () => void | Promise<void>): () => void {
    const sb = this.client();
    if (!sb) return () => {};
    let channel: RealtimeChannel | null = null;
    let disposed = false;
    const setup = () => {
      if (disposed || !sb) return;
      const can = sb.channel("hidden-tasks-realtime").on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hidden_tasks" },
        () => {
          void onChange();
        }
      );
      channel = can;
      void can.subscribe();
    };
    setup();
    return () => {
      disposed = true;
      if (channel && sb) void sb.removeChannel(channel);
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
}