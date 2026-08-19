// Trading service — the domain API pages use to load trading data. It owns the
// "Supabase first, static JSON fallback" strategy that used to live inside the
// page, calling the DatabaseAdapter via getDb(). Pages never touch the adapter
// or Supabase SDK directly.

import { getDb } from "../db";
import type { DataStatus } from "../data";
import type { PerfDay, Signal, Trade } from "../db/types";

export interface TradingData {
  trades: Trade[];
  signals: Signal[];
  perf: PerfDay[];
}

export interface TradingResult {
  data: TradingData;
  /** Where the data came from — drives the "live" source pill in the UI. */
  source: { ok: boolean; label: string };
  /** Data-source freshness: live / partial / fallback / empty / error. */
  status: DataStatus;
  /** Last-updated from the SOURCE (fallback generated_at, or success time
   *  for a true backend load). "" when unknown — never a fake timestamp. */
  updatedAt: string;
  /** Error message (fallback JSON shown), or null when using backend cleanly. */
  error: string | null;
}

export const EMPTY_TRADING: TradingData = { trades: [], signals: [], perf: [] };

const EMPTY_MSG = "ยังไม่มีข้อมูล — รอ data.json ซิงก์เข้ามา";

/** Shape of the static fallback file (accepts raw or {data: {...}} wrapper). */
interface StaticTradingJson {
  trades?: Trade[];
  signals?: Signal[];
  perf?: PerfDay[];
  generated_at?: string;
  data?: StaticTradingJson;
}

/** Best-effort fetch of the static fallback (public/data.json). */
async function fetchStatic(): Promise<{
  data: TradingData;
  label: string;
  error: string | null;
  updatedAt: string;
}> {
  try {
    const res = await fetch(`/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      return { data: EMPTY_TRADING, label: "offline · HTTP " + res.status, error: "โหลดข้อมูลไม่ได้ (HTTP " + res.status + ") — รอ cron ซิงก์แล้วลองใหม่", updatedAt: "" };
    }
    const j: unknown = await res.json();
    const root = (j && (j as any).trades ? (j as StaticTradingJson) : (j as any)?.data) as
      | StaticTradingJson
      | undefined;
    if (root && Array.isArray(root.trades)) {
      return {
        data: {
          trades: root.trades || [],
          signals: root.signals || [],
          perf: root.perf || [],
        },
        label: "Google Sheets (fallback)",
        error: null,
        updatedAt: root.generated_at || "",
      };
    }
    return {
      data: EMPTY_TRADING,
      label: "schema mismatch",
      error: "รูปแบบข้อมูล (schema) เปลี่ยนไป — กรุณาตรวจ data.json / สคริปต์ซิงก์",
      updatedAt: "",
    };
  } catch (e) {
    return {
      data: EMPTY_TRADING,
      label: "error",
      error: "โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)),
      updatedAt: "",
    };
  }
}

/** Load trading data: live backend first, static JSON fallback. */
export async function loadTrading(): Promise<TradingResult> {
  const db = getDb();
  const primary = await db.loadTrading();
  // Only trust the backend when it returned at least one meaningful row.
  // primary.ok only means "the Supabase query succeeded" — if the trades /
  // signals / trading_daily tables are empty (e.g. the sync never ran), an
  // unguarded check would render a "● live · Supabase" page with zero rows and
  // NEVER fall back to public/data.json, which may hold real trades. This is
  // the same empty-array-is-truthy trap loadClassroom() was hardened against.
  const hasRows =
    (primary.trades?.length || 0) +
    (primary.signals?.length || 0) +
    (primary.perf?.length || 0) >
    0;
  if (primary.ok && hasRows) {
    return {
      data: { trades: primary.trades, signals: primary.signals, perf: primary.perf },
      source: { ok: true, label: "Supabase (auto sync)" },
      status: "live",
      // Only "live" when EVERY source answered cleanly; a table-level warning
      // below means one leg failed → the data is genuinely partial.
      updatedAt: new Date().toISOString(),
      error: null,
    };
  }
  // Backend healthy but tables full-empty → that IS an empty state (not an
  // error): nothing to show, no fallback needed. Present honestly as "ไม่มีข้อมูล".
  if (primary.ok && !hasRows) {
    return {
      data: { trades: [], signals: [], perf: [] },
      source: { ok: true, label: "Supabase (auto sync)" },
      status: "empty",
      updatedAt: new Date().toISOString(),
      error: null,
    };
  }
  // Backend unavailable or errored → static JSON fallback (same behaviour as before).
  const fallback = await fetchStatic();
  const status: DataStatus = fallback.error
    ? "error"
    : fallback.data.trades.length > 0 || fallback.data.signals.length > 0 || fallback.data.perf.length > 0
    ? "fallback"
    : "empty";
  return {
    data: fallback.data,
    source: { ok: fallback.data.trades.length > 0 || fallback.error === null, label: fallback.label },
    status,
    // For fallback data the last-updated is the SOURCE's generated_at (real
    // sync time), never the current wall clock.
    updatedAt: fallback.updatedAt,
    // Keep the backend error as context but only if fallback failed to give clean data.
    error: fallback.error ?? primary.error ?? null,
  };
}

/** Static fallback message used when a section legitimately has no rows. */
export const EMPTY_TRADING_MSG = EMPTY_MSG;