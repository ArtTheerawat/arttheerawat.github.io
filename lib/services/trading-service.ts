// Trading service — the domain API pages use to load trading data. It owns the
// "Supabase first, static JSON fallback" strategy that used to live inside the
// page, calling the DatabaseAdapter via getDb(). Pages never touch the adapter
// or Supabase SDK directly.

import { getDb } from "../db";
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
}

/** Best-effort fetch of the static fallback (public/data.json). */
async function fetchStatic(): Promise<{ data: TradingData; label: string; error: string | null }> {
  try {
    const res = await fetch(`/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      return { data: EMPTY_TRADING, label: "offline · HTTP " + res.status, error: "โหลดข้อมูลไม่ได้ (HTTP " + res.status + ") — รอ cron ซิงก์แล้วลองใหม่" };
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
      };
    }
    return {
      data: EMPTY_TRADING,
      label: "schema mismatch",
      error: "รูปแบบข้อมูล (schema) เปลี่ยนไป — กรุณาตรวจ data.json / สคริปต์ซิงก์",
    };
  } catch (e) {
    return {
      data: EMPTY_TRADING,
      label: "error",
      error: "โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)),
    };
  }
}

/** Load trading data: live backend first, static JSON fallback. */
export async function loadTrading(): Promise<TradingResult> {
  const db = getDb();
  const primary = await db.loadTrading();
  if (primary.ok) {
    return {
      data: { trades: primary.trades, signals: primary.signals, perf: primary.perf },
      source: { ok: true, label: "Supabase (auto sync)" },
      error: null,
    };
  }
  // Backend unavailable or errored → static JSON fallback (same behaviour as before).
  const fallback = await fetchStatic();
  return {
    data: fallback.data,
    source: { ok: fallback.data.trades.length > 0 || fallback.error === null, label: fallback.label },
    // Keep the backend error as context but only if fallback failed to give clean data.
    error: fallback.error ?? primary.error ?? null,
  };
}

/** Static fallback message used when a section legitimately has no rows. */
export const EMPTY_TRADING_MSG = EMPTY_MSG;