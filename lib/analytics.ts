// lib/analytics.ts — PRODUCTIVITY ANALYTICS (SYSTEM 9)
//
// Deterministic, pure calculation of personal productivity statistics from
// data the repo ALREADY stores. This module NEVER reads AI, never invents
// numbers, and never becomes a source of truth — it only READS and CALCULATES.
//
// DATA SOURCES (must match the pages):
//   • Task COMPLETION history  → hidden_tasks (the `hiddenList` from
//     useHiddenTasks). Each row: { key, title, due?, reason, hiddenAt }.
//     `hiddenAt` is an ISO timestamp (when the row was hidden / "completed"),
//     `due` is YYYY-MM-DD. A task marked with reason "already-submitted" IS the
//     app's record of "งานเสร็จ/ส่งแล้ว". This is the ONLY durable per-task
//     completion history the hub keeps.
//   • CURRENT task state       → public/data/assignments.json (`todo[]`), with
//     each assignment's bucket classified via lib/data.classifyAssignment.
//     Overdue = bucket "over" and not hidden.
//
// FOCUS / POMODORO / STOPWATCH:
// The Focus Mode stores ONLY current timer state in localStorage
// (theedeck.focus.<key>, theedeck.focus.pomo.<key>), per task key. There is NO
// persisted session log (no completed-round history, no stopwatch session
// history, no timestamps). Therefore focus-time / round-count / session-count
// metrics CANNOT be calculated from real data and are deliberately NOT
// fabricated here. The UI reports them as an unavailable metric.

import type { Bucket } from "./data";
import { parseIsoDateLocal } from "./data";

/* ──────────────────────────────────────────────────────────────────────────
 * Bangkok time helpers — the app anchors "now" to Asia/Bangkok everywhere
 * (lib/data.nowBKK comment). Bangkok is UTC+7 with no DST.
 * ────────────────────────────────────────────────────────────────────────── */

const BKK_OFFSET_MS = 7 * 3600 * 1000;

/** Bangkok "YYYY-MM-DD" string for the current moment. */
function bkkTodayStr(): string {
  const d = new Date(Date.now() + BKK_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Bangkok "YYYY-MM-DD" for an ISO timestamp, or null when invalid. */
function isoToBkkDay(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const b = new Date(d.getTime() + BKK_OFFSET_MS);
  const y = b.getUTCFullYear();
  const m = String(b.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(b.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Epoch-ms of a Bangkok-local "YYYY-MM-DD" at 00:00 Bangkok, or null. */
function bkkDayToMs(dayStr: string): number | null {
  // Reuse the strict YYYY-MM-DD validator (rejects impossible dates).
  const localMs = parseIsoDateLocal(dayStr);
  if (localMs === null) return null;
  // parseIsoDateLocal interprets the fields as the HOST's local midnight; the
  // Bangkok wall clock for that date is 7h behind UTC, so the true epoch is the
  // host-local-midnight minus the host-vs-Bangkok offset... Instead of chasing
  // TZ conversion subtleties, anchor directly: construct via a UTC Date then
  // subtract a full BKK offset, giving the exact Bangkok-midnight epoch.
  const [y, mo, dd] = dayStr.split("-").map(Number);
  const utcMidnight = Date.UTC(y, mo - 1, dd, 0, 0, 0, 0);
  return utcMidnight - BKK_OFFSET_MS;
}

/** Monday (as a Bangkok "YYYY-MM-DD") of the week containing `dayStr`. */
function mondayOfDay(dayStr: string): string | null {
  const ms = bkkDayToMs(dayStr);
  if (ms === null) return null;
  const bkk = new Date(ms + BKK_OFFSET_MS);
  const dow = (bkk.getUTCDay() + 6) % 7; // 0=Mon .. 6=Sun
  const mon = new Date(ms + BKK_OFFSET_MS - dow * 86400000);
  const y = mon.getUTCFullYear();
  const m = String(mon.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(mon.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** The current Bangkok day + the Monday of this week / previous week, as
 *  "YYYY-MM-DD" strings. Single source for all week bucketing. */
function currentWeekKeys(): { today: string; thisMonday: string; prevMonday: string; prevSunday: string } {
  const today = bkkTodayStr();
  const thisMonday = mondayOfDay(today) || today;
  // Previous week Monday = thisMonday - 7 days; previous week Sunday = - 1 day.
  const prevMonMs = (bkkDayToMs(thisMonday) ?? 0) - 7 * 86400000;
  const prevSunMs = prevMonMs + 6 * 86400000;
  const fmt = (ms: number) => {
    const b = new Date(ms + BKK_OFFSET_MS);
    return `${b.getUTCFullYear()}-${String(b.getUTCMonth() + 1).padStart(2, "0")}-${String(b.getUTCDate()).padStart(2, "0")}`;
  };
  return { today, thisMonday, prevMonday: fmt(prevMonMs), prevSunday: fmt(prevSunMs) };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Metrics model
 * ────────────────────────────────────────────────────────────────────────── */

export type TrendDir = "up" | "down" | "flat" | "none";

export interface Trend {
  dir: TrendDir;
  /** Percent change of this week vs previous week (null when not divide-safe). */
  pct: number | null;
  comparable: boolean;
}

export interface TaskAnalytics {
  completedToday: number;
  completedThisWeek: number;
  completedPrevWeek: number;
  onTimeBase: number;
  onTimeCount: number;
  onTimeRate: number | null;
  unmeasuredCompleted: number;
  overdueCount: number;
  completedTrend: Trend;
}

export interface AnalyticsOutput extends TaskAnalytics {
  /** Bangkok "YYYY-MM-DD" the numbers were computed for (display context). */
  asOfDay: string;
  computedAt: string;
}

/** The subset of a hidden row the analytics engine consumes. */
export interface AnalyticsHiddenRow {
  key?: string;
  due?: string;
  reason?: string;
  hiddenAt?: string;
}

export interface AnalyticsAssignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}

/** Inclusive string-compare helper for YYYY-MM-DD ranges (safe: fixed width). */
function inRangeInclusive(day: string, start: string, end: string): boolean {
  return day >= start && day <= end;
}

/** Compute the analytics. Pure + deterministic — no side effects, no AI.
 *
 *  completedToday / ThisWeek / PrevWeek count hidden rows with
 *  reason === "already-submitted" (the app's completion marker) whose hiddenAt
 *  Bangkok-day falls in the range. Week = Monday..Sunday (Bangkok).
 */
export function computeAnalytics(
  hiddenList: AnalyticsHiddenRow[],
  assignments: AnalyticsAssignment[]
): AnalyticsOutput {
  const { today, thisMonday, prevMonday, prevSunday } = currentWeekKeys();

  const completed = (hiddenList || []).filter((h) => h.reason === "already-submitted");

  const completedToday = completed.filter((h) => isoToBkkDay(h.hiddenAt) === today).length;

  const completedThisWeek = completed.filter((h) => {
    const day = isoToBkkDay(h.hiddenAt);
    return day !== null && day >= thisMonday && day <= today;
  }).length;

  const completedPrevWeek = completed.filter((h) => {
    const day = isoToBkkDay(h.hiddenAt);
    return day !== null && inRangeInclusive(day, prevMonday, prevSunday);
  }).length;

  // ── On-time rate ──
  // Only completed rows with BOTH a valid completion day AND a valid due date
  // enter the denominator. Anything unmeasurable is reported separately, never
  // silently counted as "late".
  let onTimeBase = 0;
  let onTimeCount = 0;
  let unmeasuredCompleted = 0;
  for (const h of completed) {
    const hidDay = isoToBkkDay(h.hiddenAt);
    const dueMs = parseIsoDateLocal(h.due);
    if (hidDay === null || dueMs === null) {
      unmeasuredCompleted += 1;
      continue;
    }
    onTimeBase += 1;
    const hidMs = bkkDayToMs(hidDay) ?? 0;
    if (hidMs <= dueMs) onTimeCount += 1;
  }
  const onTimeRate = onTimeBase > 0 ? Math.round((onTimeCount / onTimeBase) * 100) : null;

  // ── Current overdue (from live assignments that are NOT hidden) ──
  const hiddenKeys = new Set((hiddenList || []).map((h) => h.key));
  const overdueCount = (assignments || [])
    .filter((a) => a.bucket === "over")
    .filter((a) => {
      const k = `${(a.course || "").trim()}|${(a.title || "").trim()}|${(a.due || "").trim()}`;
      return !hiddenKeys.has(k);
    }).length;

  // ── Week-over-week trend for completed tasks ──
  const trend: Trend = { dir: "none", pct: null, comparable: false };
  if (completedPrevWeek === 0 && completedThisWeek === 0) {
    trend.dir = "none";
  } else if (completedPrevWeek === 0 && completedThisWeek > 0) {
    // Can't express % from a 0 base, but the direction is genuinely "up".
    trend.dir = "up";
    trend.pct = null;
    trend.comparable = true;
  } else if (completedThisWeek === 0 && completedPrevWeek > 0) {
    trend.dir = "down";
    trend.pct = -100;
    trend.comparable = true;
  } else if (completedPrevWeek > 0) {
    const pct = Math.round(((completedThisWeek - completedPrevWeek) / completedPrevWeek) * 100);
    trend.pct = pct;
    trend.comparable = true;
    trend.dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  }

  return {
    completedToday,
    completedThisWeek,
    completedPrevWeek,
    onTimeBase,
    onTimeCount,
    onTimeRate,
    unmeasuredCompleted,
    overdueCount,
    completedTrend: trend,
    asOfDay: today,
    computedAt: new Date().toISOString(),
  };
}

