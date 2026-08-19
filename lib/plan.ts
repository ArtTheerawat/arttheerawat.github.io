// lib/plan.ts — SYSTEM 10: Daily Planning / Time Blocking engine.
// ─────────────────────────────────────────────────────────────────────────────
// A PURE, deterministic planning engine (ZERO AI calls). Its job is to answer
//   "งานนี้ควรเอาไปทำช่วงเวลาไหนของวันนี้?" by combining REAL data only:
//     • fixed events (weekly SCHEDULE + dated MAKEUP classes)
//     • current BKK time
//     • tasks + deadline buckets + priority (reused from lib/priority.ts)
//     • user-chosen Pomodoro-compatible durations (25/50/90, from /focus)
// It NEVER fabricates task durations, never assumes "no class = free time",
// and never schedules over a fixed event. It only proposes free WINDOWS (the
// complement of fixed events within a neutral working day) — the user decides
// what goes where.
//
// Persistence uses the SMALLEST compatible mechanism the repo already ships:
// localStorage keyed by date, mirroring how /focus persists per-task state.
// No new DB table / migration is introduced (the repo has no time-block model).
// ─────────────────────────────────────────────────────────────────────────────

import {
  COURSES,
  MAKEUP,
  SCHEDULE,
} from "@/lib/schedule-data";
import { rankAssignments, type PriorityTask } from "@/lib/priority";

/* ── Public types ─────────────────────────────────────────────────────── */

/** A single row on the day timeline. `kind` distils STATE: FIXED (class /
 *  makeup) vs PLANNED (user-accepted work block). UNSCHEDULED tasks stay out
 *  of the timeline entirely and live in their own list. */
export interface PlannedEvent {
  start: number; // float-hour start
  end: number; // float-hour end
  label: string;
  code: string;
  room?: string;
  color: string;
  kind: "class" | "makeup" | "planned";
  icon: string;
}

/** A contiguous window with no fixed event, treatable as available. It is the
 *  complement of fixed classes within the working day — never an invented slot. */
export interface FreeSlot {
  start: number;
  end: number;
}

/** A FIXED event occupying time (for overlap checks). */
export interface OccupiedRange {
  start: number;
  end: number;
}

/** A user-accepted planned work block, persisted per date. */
export interface PlannedBlock {
  key: string; // taskKey (course|title|due) — matches hidden-tasks / focus
  title: string;
  course: string;
  courseName?: string;
  start: number; // float-hour
  end: number; // float-hour
  dur: number; // minutes (Pomodoro-compatible: 25 / 50 / 90)
  color: string;
}

/** The full per-day planning view the UI renders. */
export interface DailyPlan {
  date: string; // YYYY-MM-DD
  fixed: PlannedEvent[]; // FIXED: classes + makeup
  free: FreeSlot[]; // candidate windows (after now, within working day)
  ranked: PriorityTask[]; // hidden-filtered, priority-sorted tasks
  scheduled: PlannedBlock[]; // accepted blocks for this date
  unscheduled: PriorityTask[]; // active tasks still needing a slot
}

/* ── Tunable rule constants (not per-assignment magic data) ── */
const MIN_SLOT_H = 20 / 60; // drop gaps shorter than ~20 min (too tight to use)
/** Neutral working-day window when NO class bounds the day. These are generic
 *  defaults, NOT the user's personal schedule: if the day has a class, the
 *  actual class start/end bound the window instead. */
const DEFAULT_DAY_START = 9.0;
const DEFAULT_DAY_END = 21.0;

/* ── BKK helpers (self-contained; mirrors lib/data so the page needn't know) */
function bkkNow(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) =>
    parseInt((parts.find((p) => p.type === t) || { value: "0" }).value, 10);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Current BKK hour as a float (e.g. 14.37). */
export function nowHourBKK(): number {
  const d = bkkNow();
  return d.getHours() + d.getMinutes() / 60;
}

/** Today's ISO date (YYYY-MM-DD) in Bangkok time. */
export function planTodayStr(): string {
  const d = bkkNow();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Today's weekday index 1=Mon..7=Sun (Bangkok). */
export function planTodayIdx(): number {
  return (bkkNow().getDay() + 6) % 7 + 1;
}

/** Format a float hour as "HH:MM" (15-min-ish start labels). */
export function fmtHour(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/* ── 1) FIXED events for a day ────────────────────────────────────────── */

/** Today's fixed events (weekly classes + dated makeup), time-ordered. */
export function mergeDayEvents(dayIdx: number, isoToday: string): PlannedEvent[] {
  const rows: PlannedEvent[] = [];
  SCHEDULE.filter((s) => s.day === dayIdx).forEach((s) => {
    rows.push({
      start: s.start,
      end: s.end,
      label: COURSES[s.code]?.name || s.code,
      code: s.code,
      room: s.room,
      color: COURSES[s.code]?.color || "#22d3ee",
      kind: "class",
      icon: "📚",
    });
  });
  MAKEUP.filter((m) => m.date === isoToday).forEach((m) => {
    rows.push({
      start: m.start,
      end: m.end,
      label: COURSES[m.code]?.name || m.code,
      code: m.code,
      room: m.room,
      color: COURSES[m.code]?.color || "#22d3ee",
      kind: "makeup",
      icon: "⚡",
    });
  });
  return rows.sort((a, b) => a.start - b.start);
}

/** Occupied intervals from fixed events (for overlap checks). */
export function occupiedRanges(fixed: PlannedEvent[]): OccupiedRange[] {
  return fixed.map((f) => ({ start: f.start, end: f.end }));
}

/* ── 2) Available time ────────────────────────────────────────────────── */

/** Working-day window: bounded by the day's real earliest class start and
 *  latest class end when any class(mak) exists, else a neutral default.
 *  This bounds where free slots may be considered — it never claims a gap is
 *  "usable", only that no FIXED event occupies it. */
export function dayWindow(fixed: PlannedEvent[]): { start: number; end: number } {
  if (!fixed.length) return { start: DEFAULT_DAY_START, end: DEFAULT_DAY_END };
  const starts = fixed.map((f) => f.start);
  const ends = fixed.map((f) => f.end);
  // The working window spans the day the REAL fixed events occupy, but is never
  // truncated to the last class's end: the neutral default day-end (21:00) also
  // applies to a school day, so the evening AFTER the final class genuinely
  // counts as available free time (same NEUTRAL_DAY reschedule.ts re-uses). A
  // "gap" after the last class is only ever surfaced when no fixed event is
  // actually occupying it — never invented.
  return {
    start: Math.min(...starts),
    end: Math.max(DEFAULT_DAY_END, ...ends),
  };
}

/** Free windows = complement of fixed events within the working day, dropping
 *  windows that start before `fromHour`. Returns windows that are genuinely
 *  unoccupied by a fixed event and long enough to be usable. */
export function computeFreeSlots(
  fixed: PlannedEvent[],
  fromHour: number
): FreeSlot[] {
  const { start: ws, end: we } = dayWindow(fixed);
  const occupied = occupiedRanges(fixed)
    .sort((a, b) => a.start - b.start);

  const slots: FreeSlot[] = [];
  let cursor = Math.max(ws, fromHour);
  for (const o of occupied) {
    if (o.end <= cursor) continue; // occupied wholly before cursor
    if (o.start > cursor + MIN_SLOT_H) {
      // gap between cursor and this class is free
      slots.push({ start: cursor, end: Math.min(o.start, we) });
    }
    cursor = Math.max(cursor, o.end);
  }
  // tail gap after the last class
  if (we > cursor + MIN_SLOT_H) {
    slots.push({ start: cursor, end: we });
  }
  // clamp slots to >= MIN_SLOT_H after rounding is applied downstream
  return slots.filter((s) => s.end - s.start >= MIN_SLOT_H);
}

/** Is [start,end) free given the day's occupied ranges? Used to validate an
 *  accepted block does not overlap a fixed event (defensive, deterministic). */
export function isFree(start: number, end: number, occupied: OccupiedRange[]): boolean {
  for (const o of occupied) {
    if (start < o.end && end > o.start) return false;
  }
  return true;
}

/* ── 3) Suggested placement ───────────────────────────────────────────── */

/** Round a float hour UP to the nearest :15 (cleaner visual start). This is a
 *  *suggestion* only — presented with a clear "เสนอ" label and user-adjustable. */
export function roundUp15(h: number): number {
  const totalMin = Math.ceil(h * 60 / 15) * 15;
  return totalMin / 60;
}

/** Propose placing `task` into the earliest free slot that can hold
 *  `durationMin`. Returns a concrete start/end or null when no slot fits.
 *  The returned time is derived from the free slot's REAL boundary (class end
 *  or `now`), rounded up for readability as a clearly-labeled suggestion. */
export function proposeBlock(
  task: PriorityTask,
  free: FreeSlot[],
  durationMin: number
): { start: number; end: number } | null {
  const dur = durationMin / 60;
  for (const s of free) {
    if (s.end - s.start >= dur - 0.001) {
      const start = roundUp15(s.start);
      if (start + dur <= s.end + 0.001) {
        return { start, end: start + dur };
      }
      // not enough room after rounding → try from the raw boundary
      return { start: s.start, end: s.start + dur };
    }
  }
  return null;
}

/* ── Persistence (localStorage, smallest compatible mechanism) ────────── */

const LS_KEY = "td_plan_blocks"; // { [date]: PlannedBlock[] }

function readAll(): Record<string, PlannedBlock[]> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PlannedBlock[]>) : {};
  } catch {
    return {};
  }
}

/** Load accepted planned blocks for a date. */
export function loadPlan(date: string): PlannedBlock[] {
  return readAll()[date] || [];
}

/** Save accepted planned blocks for a date (overwrites that date only). */
export function savePlan(date: string, blocks: PlannedBlock[]): void {
  try {
    const all = readAll();
    all[date] = blocks;
    window.localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* storage full / private mode — plan still works for this tab */
  }
}

/** Append one block for a date (or remove by key when `block` null). */
export function upsertPlanBlock(date: string, block: PlannedBlock | null): PlannedBlock[] {
  const blocks = loadPlan(date).filter((b) => b.key !== block?.key);
  if (block) blocks.push(block);
  const sorted = blocks.sort((a, b) => a.start - b.start);
  savePlan(date, sorted);
  return sorted;
}

/* ── 4) Build the daily plan ──────────────────────────────────────────── */

/**
 * Compose the full DailyPlan for a given date's weekday + ISO, from real data.
 *
 * @param tasks        assignments.json `todo[]` (already classified)
 * @param quizzes      schedule.json `quizzes[]`
 * @param sessions     weekly SCHEDULE + MAKEUP merged (matches priority callers)
 * @param hiddenKeys   keys to exclude (completed/hidden tasks) — function or Set
 * @param nowHour      current BKK hour (float); pass to override for tests
 */
export function buildDailyPlan(
  tasks: Parameters<typeof rankAssignments>[0],
  quizzes: Parameters<typeof rankAssignments>[1],
  sessions: Parameters<typeof rankAssignments>[2],
  hiddenKeys?: Set<string> | ((key: string) => boolean),
  nowHour?: number,
  date?: string
): DailyPlan {
  const d = date ?? planTodayStr();
  const dayIdx = planTodayIdx();
  const now = nowHour ?? nowHourBKK();

  const fixed = mergeDayEvents(dayIdx, d);
  const free = computeFreeSlots(fixed, now);

  // Reuse the deterministic Priority engine (lib/priority.ts) to decide WHICH
  // tasks to place first. Planning never re-implements priority.
  const ranked = rankAssignments(tasks, quizzes, sessions, hiddenKeys);

  const scheduled = loadPlan(d);
  // Drop accepted blocks whose task is now completed/hidden so the plan doesn't
  // keep treating a finished task as active (reuses the hidden-tasks source of
  // truth — same set /today and Home use for "doneness").
  const hiddenSet =
    typeof hiddenKeys === "function" ? undefined : hiddenKeys;
  const isHidden =
    typeof hiddenKeys === "function"
      ? hiddenKeys
      : (k: string) => !!(hiddenSet && hiddenSet.has(k));
  const scheduledActive = scheduled.filter((b) => !isHidden(b.key));

  // UNSCHEDULED = hidden-filtered tasks not already present in scheduled blocks.
  const scheduledKeys = new Set(scheduledActive.map((b) => b.key));
  const unscheduled = ranked.filter((p) => !scheduledKeys.has(p.key));

  return { date: d, fixed, free, ranked, scheduled: scheduledActive, unscheduled };
}

/** Pomodoro-compatible durations reused from /focus (never a bespoke timer). */
export const PLAN_DURATIONS = [25, 50, 90] as const;