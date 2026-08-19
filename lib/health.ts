// System Health — deterministic status derivation from REAL data telemetry.
//
// The TheeDeck site is statically exported to GitHub Pages (`out/`), so the
// browser can only read `public/data/*.json` — it has NO access to the
// service-role-only Supabase tables (sync_state / heartbeat / system_logs) and
// server API routes don't run on static hosting.
//
// Therefore System Health derives each service's status from the real
// last-success *sync timestamps written into the static JSON files the cron
// scripts produce and commit. These are genuine freshness evidence (when a
// sync last succeeded), not "the page loads" or "the cron exists".
//
// Threshold logic is deterministic and documented per service below. No AI.

export type HealthStatus = "healthy" | "stale" | "error" | "unknown";

export interface HealthService {
  id: string;
  name: string;         // Thai label
  icon: string;         // emoji (visual, not color-only)
  status: HealthStatus;
  /** Human-readable Thai one-liner explaining the status. */
  detail: string;
  /** Safe, human-readable field values (never secrets). */
  lastSuccess?: string;
  lastAttempt?: string;
  lastError?: string;
  dataAge?: string;     // e.g. "4 นาทีที่แล้ว" / "ล่าช้า 3 ชั่วโมง"
  /** Optional deep link to the page holding the source data. */
  href?: string;
}

// ── Freshness helpers ─────────────────────────────────────────────────────

/** Parse an ISO timestamp to epoch ms, or null if missing/invalid. */
export function parseTs(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** "x นาที/ชั่วโมง/วัน ที่แล้ว" for an age in ms. Null if no age. */
export function ageLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "สักครู่";
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  return `${day} วันที่แล้ว`;
}

/** Thai-locale timestamp for "สำเร็จล่าสุด: <when>". */
export function fmtTs(iso?: string | null): string | null {
  const t = parseTs(iso);
  if (t === null) return null;
  return new Date(t).toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Classify an age against healthy/stale thresholds (deterministic). */
function classifyAge(
  last: number | null,
  healthyMs: number,
  staleMs: number
): { status: HealthStatus; detail: string; ageMin: number | null } {
  if (last === null) {
    return {
      status: "unknown",
      detail: "ยังไม่มีการซิงก์ครั้งนี้",
      ageMin: null,
    };
  }
  const age = Date.now() - last;
  const min = Math.floor(age / 60_000);
  if (age <= healthyMs) return { status: "healthy", detail: "ทำงานปกติ", ageMin: min };
  if (age <= staleMs) return { status: "stale", detail: "ข้อมูลล่าช้า", ageMin: min };
  return { status: "error", detail: "เกิดข้อผิดพลาด / ข้อมูลเก่า", ageMin: min };
}

// ── Service thresholds ────────────────────────────────────────────────────
//
// Each threshold is anchored to the ACTUAL cron cadence in the repo, with a
// generous safety factor so a single missed tick degrades to STALE (not ERROR):
//
//  - school / trading syncs run every 15–30m → healthy < 2h, stale < 24h.
//  - AI Morning Brief runs daily ~06:00 → healthy < 24h, stale < 36h
//    (the 36h stale bound matches the existing freshness rule used in
//    /today and Home for next_action.json).

const SCHOOL_H = 2 * 3600_000; // healthy if last sync < 2h old
const SCHOOL_S = 24 * 3600_000; // stale if < 24h, else error
const TRADE_H = 2 * 3600_000;
const TRADE_S = 24 * 3600_000;
const BRIEF_H = 24 * 3600_000;
const BRIEF_S = 36 * 3600_000;

// ── Data loaders ──────────────────────────────────────────────────────────

export interface HealthData {
  service: string;
  updated?: string | null;
  generated_at?: string | null;
  usage?: { updated_at?: string | null };
}

/** Fetch a static data file (cache-busted) and return its JSON or null. */
async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Build the health report for every monitored service. Each service maps to a
 * real static data file whose timestamp is the last successful sync write —
 * loading/HTTP failure becomes UNKNOWN (we never fabricate a healthy result).
 */
export async function getSystemHealth(): Promise<{
  services: HealthService[];
  generatedAt: string;
}> {
  const [school, hub, brief, classroom] = await Promise.all([
    fetchJson<HealthData>("/data/assignments.json"),
    fetchJson<{ generated_at?: string; usage?: { updated_at?: string } }>("/data.json"),
    fetchJson<HealthData>("/data/next_action.json"),
    fetchJson<HealthData>("/data/classroom.json"),
  ]);

  const services: HealthService[] = [];

  // Google Classroom — freshness from assignments.json.updated (school_sync).
  {
    const last = parseTs(school?.updated);
    const c = classifyAge(last, SCHOOL_H, SCHOOL_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "classroom",
      name: "Google Classroom",
      icon: "📘",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(school?.updated) ?? undefined,
      lastAttempt: fmtTs(school?.updated) ?? undefined,
      dataAge: age ?? undefined,
      href: "/classroom",
    });
  }

  // Google Calendar — freshness from schedule.json.updated (school_sync).
  {
    const last = parseTs(school?.updated);
    const c = classifyAge(last, SCHOOL_H, SCHOOL_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "calendar",
      name: "Google Calendar",
      icon: "🗓️",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(school?.updated) ?? undefined,
      lastAttempt: fmtTs(school?.updated) ?? undefined,
      dataAge: age ?? undefined,
      href: "/schedule",
    });
  }

  // Trading Sync — freshness from data.json.generated_at (auto_sync / supabase sync).
  {
    const last = parseTs(hub?.generated_at);
    const c = classifyAge(last, TRADE_H, TRADE_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "trading",
      name: "ซิงก์เทรด (MT5 → Supabase)",
      icon: "📈",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(hub?.generated_at) ?? undefined,
      lastAttempt: fmtTs(hub?.generated_at) ?? undefined,
      dataAge: age ?? undefined,
      href: "/trading",
    });
  }

  // AI Usage — freshness from data.json.usage.updated_at.
  {
    const last = parseTs(hub?.usage?.updated_at);
    const c = classifyAge(last, TRADE_H, TRADE_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "ai_usage",
      name: "AI Usage (9arm)",
      icon: "🤖",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(hub?.usage?.updated_at) ?? undefined,
      lastAttempt: fmtTs(hub?.usage?.updated_at) ?? undefined,
      dataAge: age ?? undefined,
      href: "/",
    });
  }

  // AI Morning Brief — fresh-ish daily; matches the existing 36h stale rule.
  {
    const last = parseTs(brief?.generated_at);
    const c = classifyAge(last, BRIEF_H, BRIEF_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "morning_brief",
      name: "AI Morning Brief",
      icon: "🌅",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(brief?.generated_at) ?? undefined,
      lastAttempt: fmtTs(brief?.generated_at) ?? undefined,
      dataAge: age ?? undefined,
      href: "/today",
    });
  }

  // Classroom deep-sync (classroom_sync.py → classroom.json, cron 2feab1ac8796 every 30m).
  // Freshness from classroom.json.generated_at — same cadence/thresholds as school/trade.
  {
    const last = parseTs(classroom?.generated_at);
    const c = classifyAge(last, SCHOOL_H, SCHOOL_S);
    const age = c.ageMin !== null ? ageLabel(c.ageMin * 60_000) : null;
    services.push({
      id: "classroom_sync",
      name: "Classroom Sync",
      icon: "🔍",
      status: c.status,
      detail: c.detail,
      lastSuccess: fmtTs(classroom?.generated_at) ?? undefined,
      lastAttempt: fmtTs(classroom?.generated_at) ?? undefined,
      dataAge: age ?? undefined,
      href: "/classroom",
    });
  }

  return { services, generatedAt: new Date().toISOString() };
}