// lib/reschedule.ts — SYSTEM 12: SMART RESCHEDULE engine.
// ─────────────────────────────────────────────────────────────────────────────
// A PURE, deterministic engine (ZERO AI calls). Its job is to answer
//   "งานนี้วางแผนไว้แล้วแต่พลาดช่วงเวลา — ควรย้ายไปช่วงไหน?"
// built only from REAL data the repo already reads:
//   • planned time blocks                    (lib/plan.ts localStorage `td_plan_blocks`)
//   • fixed events                          (lib/schedule-data SCHEDULE + MAKEUP via mergeDayEvents)
//   • free windows                          (lib/plan.computeFreeSlots — the SAME complement-of-fixed
//                                            windows /plan uses to plan, never an invented gap)
//   • task completion / hidden set          (hidden_tasks — reuse of the app's "done" marker)
//   • task deadline buckets                 (lib/data.classifyAssignment)
//   • task priority order                   (lib/priority.rankAssignments, reused verbatim)
//
// KEY CONCEPT — MISSED BLOCK ≠ OVERDUE TASK:
//   A planned block whose end passes while the task is still active is "missed".
//   The task only becomes "overdue" when its real deadline bucket is `over`.
//   These two states are kept separate and surfaced separately.
//
// It only ever SUGGESTS. It never moves/deletes/overwrites anything — the caller
// (the page) writes back through the EXISTING `upsertPlanBlock` / `savePlan`
// source of truth after the user explicitly picks an action. No second hidden
// schedule entry is ever created.
//
// It deliberately NEVER fabricates a duration: it reuses the block's own `dur`
// (a Pomodoro-compatible 25/50/90 chosen by the user in /plan). If a block has
// no usable duration it reports "needs manual scheduling" instead of inventing one.
// ─────────────────────────────────────────────────────────────────────────────

import {
  dueDiffDays,
  type Bucket,
} from "@/lib/data";
import {
  dayWindow,
  fmtHour,
  isFree,
  mergeDayEvents,
  occupiedRanges,
  roundUp15,
  type PlannedBlock,
  type PlannedEvent,
} from "@/lib/plan";

/* ── Working-day window for rescheduling ────────────────────────────────
   `/plan`'s dayWindow bounds a class day to [earliest class start, latest
   class end], so it never surfaces free time AFTER the last class. Reschedule
   is specifically about finding a NEW time when a block lapsed — including in
   the evening after classes (the canonical case: 19:00 block passed → 20:30).
   So we model free time over the SAME neutral working day plan.ts already uses
   on a classless day (dayWindow([]) → 09:00–21:00), treating today's REAL
   classes/makeup as occupied ranges. Free = complement of FIXED events,
   unchanged — the only relaxation is the day-end boundary, which re-uses the
   platform's own constant, never an invented slot. */
const NEUTRAL_DAY = (() => {
  const w = dayWindow([]); // classless day → {start:9, end:21} (DEFAULT_* constants)
  return { start: w.start, end: w.end };
})();

/** Free windows = complement of `occupied` within the neutral working day,
 *  starting at `fromHour`. Identical gap-walking to plan.computeFreeSlots but
 *  over the neutral (non-class-truncated) window so the evening after the last
 *  class is honestly surfaced when no fixed event occupies it. */
function freeInWindow(
  occupied: { start: number; end: number }[],
  fromHour: number
): { start: number; end: number }[] {
  const occ = [...occupied].sort((a, b) => a.start - b.start);
  const slots: { start: number; end: number }[] = [];
  let cursor = Math.max(NEUTRAL_DAY.start, fromHour);
  const MIN_H = 20 / 60; // same minimum usable gap as plan
  for (const o of occ) {
    if (o.end <= cursor) continue;
    if (o.start > cursor + MIN_H) slots.push({ start: cursor, end: o.end > cursor ? o.start : cursor });
    cursor = Math.max(cursor, o.end);
  }
  if (NEUTRAL_DAY.end > cursor + MIN_H) slots.push({ start: cursor, end: NEUTRAL_DAY.end });
  return slots.filter((s) => s.end - s.start >= MIN_H);
}

/** Why a planned block is being offered for reschedule. Kept distinct from the
 *  task's own overdue state (see module header). */
export type MissedKind = "missed" | "overdue";

/** A planned block that passed with its task still active. */
export interface MissedBlock {
  block: PlannedBlock;
  kind: MissedKind; // "missed" = block passed (task NOT overdue) | "overdue" = task deadline also passed
}

/** A concrete reschedule suggestion derived from real windows + the block's own
 *  duration. `nothingFits` flags states where no safe suggestion can be made. */
export interface RescheduleSuggestion {
  hasSuggestion: boolean; // a valid new [start,end) was computed
  start: number; // float-hour (only meaningful when hasSuggestion)
  end: number; // float-hour
  noDuration: boolean; // block has no usable duration → manual scheduling needed
  noSlotToday: boolean; // no free window fits today → "วันนี้ไม่เหลือช่วงเวลาที่เหมาะสม"
  deadlineWarning: boolean; // moving here may conflict with the task's deadline
}

/** Full result for one missed block: the block + today suggestion + whether a
 *  tomorrow slot exists (also conflict-free, from tomorrow's real schedule). */
export interface RescheduleOffer {
  missed: MissedBlock;
  suggestion: RescheduleSuggestion;
  tomorrowStart?: number; // valid tomorrow window start (conflict-free) when found
  tomorrowEnd?: number;
  reason: string; // short Thai human reason (e.g. "เดิม 19:00–19:50 พลาด", "เลยกำหนดส่งแล้ว")
}

/* ── Missed-block detection ────────────────────────────────────────────── */

/**
 * Which accepted plan blocks have passed (end ≤ now) but whose task is still
 * active (not in the completed/hidden set)? Each is labelled with whether the
 * task itself is ALSO overdue, keeping the two states distinct.
 *
 * @param blocks     today's accepted planned blocks (lib/plan.loadPlan(date))
 * @param hiddenKeys set of taskKey values that are completed/hidden (app's "done" marker)
 * @param nowHour    current BKK hour (float); pass explicitly for deterministic tests
 * @param classify   classifyAssignment instance for a task (or reused classified assignment) — optional
 */
export function findMissedBlocks(
  blocks: PlannedBlock[],
  hiddenKeys: Set<string>,
  nowHour: number,
  bucketOf?: (key: string) => Bucket | undefined
): MissedBlock[] {
  const missed: MissedBlock[] = [];
  for (const b of blocks || []) {
    if (!b || typeof b.start !== "number" || typeof b.end !== "number") continue;
    // Only a FIXED-block boundary that has ALREADY passed can be "missed".
    if (b.end > nowHour + 1 / 60) continue; // still running → not missed
    // Completed/hidden tasks are never offered — the plan already drops them.
    if (hiddenKeys && hiddenKeys.has(b.key)) continue;
    const bucket = bucketOf ? bucketOf(b.key) : undefined;
    const kind: MissedKind = bucket === "over" ? "overdue" : "missed";
    missed.push({ block: b, kind });
  }
  // Deterministic order, earliest-planned first (stable display).
  missed.sort((a, b) => a.block.start - b.block.start);
  return missed;
}

/* ── Suggestion computation ────────────────────────────────────────────── */

/**
 * Compute a conflict-free reschedule suggestion for a missed block TONIGHT,
 * using the exact same free-window engine /plan uses.
 *
 * The free windows are the complement of today's fixed classes/makeup (so a
 * suggestion is never placed on top of a fixed event by construction). We only
 * look at windows that start at-or-after `nowHour` and that can fit the block's
 * own duration. The block's own `dur` is authoritative — never invented.
 *
 * @param block    missed planned block (its `dur` = real user-chosen duration)
 * @param fixed    today's fixed events (mergeDayEvents result)
 * @param nowHour  current BKK hour (float)
 * @param deadline the task's due "YYYY-MM-DD" (to warn when moving may not leave enough time)
 * @returns a RescheduleSuggestion — possibly with no valid slot (never fabricated)
 */
export function computeRescheduleSuggestion(
  block: PlannedBlock,
  fixed: PlannedEvent[],
  nowHour: number,
  deadline?: string
): RescheduleSuggestion {
  const durMin = block.dur;
  const base: RescheduleSuggestion = {
    hasSuggestion: false,
    start: 0,
    end: 0,
    noDuration: !(typeof durMin === "number" && durMin > 0),
    noSlotToday: false,
    deadlineWarning: false,
  };
  // 1) No usable duration → honest "manual scheduling" state, never a fake slot.
  if (base.noDuration) return base;

  const durH = durMin / 60;
  // Free windows STARTING at-or-after now (a suggestion in the past is useless),
  // over the neutral working day with today's REAL classes as occupied → a
  // suggestion can never land on a fixed event (we also assert it defensively).
  const occupied = occupiedRanges(fixed);
  const free = freeInWindow(occupied, nowHour);
  if (!free.length) {
    base.noSlotToday = true;
    return base;
  }
  // Earliest window that can fit the duration (same greedy pick /plan's
  // proposeBlock uses), rounded up to a clean :15 start, never on a class.
  for (const s of free) {
    if (s.end - s.start >= durH - 0.001) {
      const start = roundUp15(s.start);
      let candStart = start;
      let candEnd = start + durH;
      if (!isFree(candStart, candEnd, occupied)) {
        // rounded-up start collides with a class → fall back to raw boundary
        candStart = s.start;
        candEnd = s.start + durH;
      }
      if (!isFree(candStart, candEnd, occupied)) continue; // still not free → try next window
      base.hasSuggestion = true;
      base.start = candStart;
      base.end = candEnd;
      break;
    }
  }
  if (!base.hasSuggestion) {
    base.noSlotToday = true;
    return base;
  }
  // 2) Deadline-too-close warning: only when we can read a real deadline and it
  //    falls on/before this BKK day (so completion can't be guaranteed before it).
  if (deadline) {
    const diff = dueDiffDays(deadline);
    if (diff !== null && diff <= 0) {
      base.deadlineWarning = true;
    }
  }
  return base;
}

/**
 * Compute a conflict-free tomor­row placement for a missed block, using
 * tomorrow's real fixed schedule. Returns undefined when no safe window fits.
 * (Used for the honest "ลองจัดไว้พรุ่งนี้" action.)
 */
export function computeTomorrowSlot(
  block: PlannedBlock,
  tomorrowDayIdx: number,
  tomorrowIso: string
): { start: number; end: number } | undefined {
  const durMin = block.dur;
  if (!(typeof durMin === "number" && durMin > 0)) return undefined;
  const fixed = mergeDayEvents(tomorrowDayIdx, tomorrowIso);
  const free = freeInWindow(occupiedRanges(fixed), 0); // whole working day, not after-now
  const durH = durMin / 60;
  for (const s of free) {
    if (s.end - s.start >= durH - 0.001) {
      const start = roundUp15(s.start);
      if (isFree(start, start + durH, occupiedRanges(fixed))) return { start, end: start + durH };
      return { start: s.start, end: s.start + durH };
    }
  }
  return undefined;
}

/* ── Composite offer ───────────────────────────────────────────────────── */

/**
 * Build the full reschedule OFFER for one missed block (today suggestion +
 * tomorrow fallback + a short honest Thai reason). Pure and deterministic.
 */
export function computeRescheduleOffer(
  missed: MissedBlock,
  fixed: PlannedEvent[],
  nowHour: number,
  tomorrowDayIdx: number,
  tomorrowIso: string,
  deadline?: string
): RescheduleOffer {
  const suggestion = computeRescheduleSuggestion(missed.block, fixed, nowHour, deadline);
  const tomorrow = suggestion.noDuration
    ? undefined
    : computeTomorrowSlot(missed.block, tomorrowDayIdx, tomorrowIso);

  let reason: string;
  if (missed.kind === "overdue") {
    reason = "เลยกำหนดส่งแล้ว ควรทำโดยด่วน";
  } else if (suggestion.noDuration) {
    reason = "พลาดช่วงเวลาที่วางไว้ (ยังไม่ระบุระยะเวลา)";
  } else {
    reason = `เดิม ${fmtHour(missed.block.start)}–${fmtHour(missed.block.end)} พลาด`;
  }

  return {
    missed,
    suggestion,
    tomorrowStart: tomorrow?.start,
    tomorrowEnd: tomorrow?.end,
    reason,
  };
}

/* ── Tomorrow metadata ────────────────────────────────────────────────── */

/** Compute tomorrow's ISO + weekday in Bangkok (helpers pages need). */
export function tomorrowMeta(): { iso: string; dayIdx: number } {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) =>
    parseInt((parts.find((p) => p.type === t) || { value: "0" }).value, 10);
  const now = new Date(get("year"), get("month") - 1, get("day"), 12, 0, 0); // noon avoids DST edge
  now.setDate(now.getDate() + 1);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const iso = `${now.getFullYear()}-${m}-${day}`;
  return { iso, dayIdx: (now.getDay() + 6) % 7 + 1 };
}