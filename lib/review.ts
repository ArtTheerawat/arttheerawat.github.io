// lib/review.ts — SYSTEM 11: EVENING REVIEW engine.
// ─────────────────────────────────────────────────────────────────────────────
// A PURE, deterministic summary of what REALLY happened in a single day.
// It never calls AI, never invents numbers, and derives everything from the
// same durable sources the rest of the hub reads:
//   • hidden_tasks (via useHiddenTasks on the page) = the app's completion
//     record. reason === "already-submitted" is "งานเสร็จ/ส่งแล้ว"; `hiddenAt`
//     is a real ISO timestamp so we can bucket completions by Bangkok day.
//   • public/data/assignments.json todo[] (live current task state), with each
//     assignment classified via lib/data.classifyAssignment.
//   • lib/plan.loadPlan(date) = today's accepted time blocks (localStorage).
//     A block is "done" when its task key is in the hidden set; there is NO
//     completed_at on blocks, so blocks can only be split into completed /
//     still-active — never "on time vs late".
//   • lib/priority.computeNextAction = the deterministic Next-Action engine,
//     reused verbatim for the "พรุ่งนี้ควรเริ่ม" section.
//
// FOCUS / POMODORO / STOPWATCH: the Focus page stores ONLY live per-task timer
// state, not a session log (see lib/analytics.ts). No persisted round history
// exists, so focus-time / pomodoro-round / stopwatch metrics are honestly
// reported as unavailable here — NOT fabricated as "0 ชม.".
// ─────────────────────────────────────────────────────────────────────────────

import { classifyAssignment, parseIsoDateLocal, todayStr, type Bucket } from "@/lib/data";
import { computeNextAction, type PriorityTask } from "@/lib/priority";
import { loadPlan, type PlannedBlock } from "@/lib/plan";

/* ── Input shapes (SHALLOW, matching the JSON on disk / other pages) ── */

/** A hidden_tasks row (the fields review actually consumes). */
export interface ReviewHiddenRow {
  key?: string;
  title?: string;
  course?: string;
  due?: string;
  reason?: string;
  hiddenAt?: string;
}

/** A current assignment row from assignments.json todo[]. */
export interface ReviewAssignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  bucket?: Bucket; // over | today | soon | later | no_due
}

export interface ReviewQuiz {
  date?: string;
  summary?: string;
}

/** Generic weekly/one-off session (matches lib/schedule-data shallow type). */
export interface ReviewSession {
  day?: number;
  date?: string;
  start?: number;
  end?: number;
  code?: string;
}

/* ── Bangkok day helpers (self-contained; mirrors lib/analytics) ────── */

const BKK_OFFSET_MS = 7 * 3600 * 1000;

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

/* ── Output model ───────────────────────────────────────────────────── */

/** A single completed task surfaced in "งานที่เสร็จ". */
export interface CompletedItem {
  key: string;
  title: string;
  course: string;
  courseName: string;
  due?: string;
}

/** A single active/before-done task surfaced in "งานที่ยังค้าง/overdue". */
export interface RemainingItem {
  key: string;
  title: string;
  course: string;
  courseName: string;
  due?: string;
  overdue: boolean;
  dueLabel?: string;
}

/** Plan-block comparison (planned vs already-done vs still-active). */
export interface PlanComparison {
  planned: number; // accepted blocks today
  completed: number; // blocks whose task is already hidden/completed
  remaining: number; // blocks still active
  hasData: boolean; // false when loadPlan yielded nothing at all
}

export interface ReviewFact {
  /** Bangkok "YYYY-MM-DD" this review describes. */
  date: string;
  /** How many distinct tasks marked completed (reason already-submitted) today. */
  completedToday: number;
  completed: CompletedItem[];
  remaining: RemainingItem[];
  overdueCount: number;
  plan: PlanComparison;
  /** Reused Next-Action engine result (already hidden-filtered). */
  nextActionState: "action" | "idle";
  next: PriorityTask | null;
  /** Honest focus metrics — always "unavailable" because no history exists. */
  focusAvailable: false;
}

/* ── Metric formatting helpers (Thai) ───────────────────────────────── */

/** Format a non-negative integer minutes as "X ชม. Y นาที" (or pure minutes). */
export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} นาที`;
  return `${h} ชม. ${m} นาที`;
}

/** Join a list of Thai "reasons" for the Next Action card. */
export function joinReasons(reasons: string[]): string {
  return reasons.slice(0, 2).join(" + ");
}

/* ── The review computation ─────────────────────────────────────────── */

/**
 * Compute the Evening Review for "today" (Bangkok) from REAL data only.
 *
 * Pure + deterministic. The date is always supplied by the caller (the page
 * passes `todayStr()`) so a midnight rollover between render and hydrate can
 * never leak yesterday's data into today's review.
 *
 * @param hiddenRows hidden_tasks rows (already loaded by the page).
 * @param assignments current assignments.json todo[] (classified on the page).
 * @param quizzes    schedule.json quizzes[] (for Next Action, optional).
 * @param sessions   weekly SCHEDULE + MAKEUP merged (for Next Action).
 * @param date       Bangkok "YYYY-MM-DD" to summarise (default = today).
 */
export function computeReview(
  hiddenRows: ReviewHiddenRow[],
  assignments: ReviewAssignment[],
  quizzes: ReviewQuiz[] = [],
  sessions: ReviewSession[] = [],
  date: string = todayStr()
): ReviewFact {
  const list = hiddenRows || [];

  // 1) Completed today = rows marked "already-submitted" whose hiddenAt falls
  //    on this Bangkok day. (reason is the app's completion marker.)
  const completed: CompletedItem[] = [];
  const seenKeys = new Set<string>();
  for (const h of list) {
    if (h.reason !== "already-submitted") continue;
    if (isoToBkkDay(h.hiddenAt) !== date) continue;
    if (!h.title) continue;
    const key = h.key || `${(h.course || "").trim()}|${(h.title || "").trim()}|${(h.due || "").trim()}`;
    if (seenKeys.has(key)) continue; // dedupe (a key can appear once anyway)
    seenKeys.add(key);
    completed.push({
      key,
      title: h.title,
      course: (h.course || "").trim(),
      courseName: (h.course || "").trim(),
      due: h.due || undefined,
    });
  }
  completed.sort((a, b) => a.title.localeCompare(b.title, "th"));

  // 2) Remaining = current assignments that are NOT hidden (still active).
  //    Each is classified so we know whether it's overdue today.
  const hiddenKeys = new Set<string>(list.map((h) => h.key).filter((k): k is string => !!k));
  const remaining: RemainingItem[] = [];
  (assignments || []).forEach((a) => {
    const title = (a.title || "").trim();
    const course = (a.course || "").trim();
    const due = a.due || undefined;
    if (!title && !course) return;
    const key = `${course}|${title}|${(due || "").trim()}`;
    if (hiddenKeys.has(key)) return; // done → not "remaining"
    const bucket = a.bucket || classifyAssignment(a);
    remaining.push({
      key,
      title,
      course,
      courseName: (a.courseName || "").trim() || course,
      due,
      overdue: bucket === "over",
      dueLabel: bucket === "over" ? `เลยกำหนดแล้ว` : bucket === "today" ? "ครบวันนี้" : undefined,
    });
  });
  remaining.sort((p, q) => (p.overdue === q.overdue ? p.title.localeCompare(q.title, "th") : p.overdue ? -1 : 1));

  const overdueCount = remaining.filter((r) => r.overdue).length;

  // 3) Plan-vs-actual. loadPlan(date) gives today's accepted blocks. A block
  //    counts as "ทำเสร็จแล้ว" only when its task key is already hidden (the
  //    same source /today + /plan use to drop a finished task). There is NO
  //    completed_at on a block, so we deliberately never claim a block was
  //    done on time / late — only completed vs still-active.
  const blocks: PlannedBlock[] = loadPlan(date);
  const planned = blocks.length;
  const planCompleted = blocks.filter((b) => hiddenKeys.has(b.key)).length;
  const plan: PlanComparison = {
    planned,
    completed: planCompleted,
    remaining: planned - planCompleted,
    hasData: planned > 0,
  };

  // 4) Next Action — reuse the deterministic engine exactly as Home + /today
  //    do. Passed the hidden set so a completed task is never recommended.
  const na = computeNextAction(
    assignments as Parameters<typeof computeNextAction>[0],
    quizzes,
    sessions,
    hiddenKeys
  );

  return {
    date,
    completedToday: completed.length,
    completed,
    remaining,
    overdueCount,
    plan,
    nextActionState: na.state,
    next: na.next,
    focusAvailable: false,
  };
}