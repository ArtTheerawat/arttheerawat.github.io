// lib/priority.ts
// ───────────────────────────────────────────────────────────────────────────
// Priority / Next-Action Engine — deterministic RULE ENGINE (no AI).
//
// Unlike the old approach (LLM-generated next_action.json, or a crude
// "nearest deadline" fallback), this module computes a normalized 0–100
// priority score for every task in *pure code*, then ranks them and selects
// THE next action: "the task most worth doing right now".
//
// Design goals (see the gpt brief this was built from):
//   • Deterministic + token-efficient — zero LLM calls per task.
//   • Reusable service, NOT bound to any single page (Home + /today both use it).
//   • Reuses every existing utility in lib/data.ts (BKK time, dueDiffDays,
//     classifyAssignment) and existing data (assignments.json todo,
//     schedule.json quizzes, lib/schedule-data.ts weekly schedule).
//   • Handles the required edge cases (no due, bad due, overdue, due-today,
//     huge task lists, empty schedule) without throwing or fabricating.
//
// Frontend renders score → HIGH / MEDIUM / LOW + short reasons ONLY; the raw
// 0-100 number is computed internally and never shown as a cluttered math dump.
// ───────────────────────────────────────────────────────────────────────────
import {
  dueDiffDays,
  parseIsoDateLocal,
  todayIdxBKK,
  nowBKK,
} from "@/lib/data";

/* ── Public types (single contract Home + /today + any future page share) ── */

export type PriorityLevel = "HIGH" | "MEDIUM" | "LOW";

export interface PriorityTask {
  source: "assignment" | "quiz";
  title: string;
  course: string; // course code, e.g. "88622065"
  courseName: string;
  due?: string; // YYYY-MM-DD
  dueLabel?: string; // human Thai label ("เลย 4 วัน" / "ครบวันนี้" / …)
  bucket?: string; // over | today | soon | later | no_due (mirrors lib/data)
  points?: number | null;
  workType?: string;
  score: number; // normalized 0–100 (never rendered raw)
  level: PriorityLevel;
  reasons: string[]; // short Thai reasons (≤ a few words each)
  effortHr?: string; // estimated effort — set ONLY when a real signal exists
  recommendedStart?: string; // Thai "เริ่มได้ตอน xx:xx" when computable
  actionTarget: string; // where to click for detail
  key: string; // course|title|due — matches hidden-tasks taskKey
}

export type EngineState = "action" | "idle";

export interface NextActionResult {
  state: EngineState;
  next: PriorityTask | null;
  ranked: PriorityTask[]; // best-first (already hidden-filtered by caller)
  brief?: string; // one-line Thai summary of WHY the top pick is #1
}

/* ── Light input shapes (compatible with the JSON on disk) ── */

export interface AssignmentLike {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string | null;
  workType?: string;
  points?: number | null;
}

export interface QuizLike {
  date?: string;
  summary?: string;
}

/** Generic weekly session (SHALLOW type of lib/schedule-data Session/Makeup). */
export interface SessionLike {
  day?: number; // 1=Mon..7=Sun (weekly)
  date?: string; // YYYY-MM-DD (makeup / one-off)
  start?: number; // float hour e.g. 10.0 / 11.84
  end?: number;
  code?: string;
}

/* ── Tunable-but-not-hardcoded rule constants ──
   These encode the scoring policy from the brief. They live here as named
   weights so the policy is readable and adjustable in ONE place. None of them
   are per-assignment "magic" data — they are pure rules. */

const W_DEADLINE = 40; // Deadline proximity (incl. overdue)
const W_OVERDUE_BONUS = 10; // clear push-up for anything late
const W_IMPORTANCE = 15; // points / importance
const W_EFFORT = 10; // estimated effort (soft — only when a proxy exists)
const W_EXAM_IMPACT = 5; // course tied to an upcoming exam/quiz
const W_CONTEXT = 10; // imminent class → context boost / availability
const W_AVAIL_NOW = 10; // time availability right now (cap for busy periods)

const OVERDUE_DAYS = 30; // cap on how late a task can be for the story text

const NEAR_EXAM_DAYS = 7; // exams within this window raise their course's tasks
const CONTEXT_WINDOW_MIN = 20; // class starting within this → context boost
const FOCUS_CAP_DURING_CLASS = 8; // max availability weight while class is on

/** Whole-day diff (due - today). Wraps lib/data. Negative=overdue, 0=today.
 *  Returns null for missing/malformed due (never a fabricated number). */
function daysUntil(due?: string | null): number | null {
  return dueDiffDays(due ?? null);
}

/** Thai "due" label mirroring lib/data dueLabel (kept local so lib/priority is
 *  self-contained and shareable by any page without importing DOM helpers). */
function makeDueLabel(bucket: string, diff: number | null): string {
  switch (bucket) {
    case "no_due":
      return "ยังไม่ระบุกำหนดส่ง";
    case "over":
      return `เลย ${diff === null ? "" : Math.min(-diff, OVERDUE_DAYS)} วัน`.trim();
    case "today":
      return "ครบวันนี้";
    case "soon":
    case "later":
      return `ครบใน ${diff === null ? "—" : diff} วัน`;
    default:
      return "ยังไม่ระบุกำหนดส่ง";
  }
}

/* ── Factor 1 + 7 (deadline proximity + overdue penalty) → 0..45 ── */
function deadlineScore(diff: number | null): { base: number; overdue: boolean; lateDays: number } {
  if (diff === null) return { base: 0, overdue: false, lateDays: 0 };
  let base = 0;
  if (diff < 0) {
    base = W_DEADLINE; // overdue = max deadline weight
  } else if (diff === 0) {
    base = 36; // due today
  } else if (diff === 1) {
    base = 30; // due tomorrow
  } else if (diff <= 3) {
    base = 24; // 2–3 days
  } else if (diff <= 5) {
    base = 16; // 4–5 days
  } else {
    base = 10; // >5 days
  }
  const overdue = diff < 0;
  return { base, overdue, lateDays: overdue ? Math.min(-diff, OVERDUE_DAYS) : 0 };
}

/* ── Factor 3 (importance / points) → 0..15 ── */
function importanceScore(points?: number | null): { s: number; raw: boolean } {
  if (points === null || points === undefined) return { s: W_IMPORTANCE / 2, raw: false }; // unknown → neutral
  const p = Number.isFinite(points) ? Math.max(0, points) : 0;
  // points are usually 0–100; cap so a huge number can't dominate the score.
  const clamped = Math.min(p, 100) / 100;
  return { s: clamped * W_IMPORTANCE, raw: true };
}

/* ── Factor 4 (estimated effort) → 0..10 ──
   No real `duration` field exists in assignments.json, so we use two honest
   proxies when present: (a) assignment type — CLASSWORK/QUIZ imply more/focus,
   (b) high point-value signals a longer task. This stays a SOFT multiplier —
   we never fabricate a specific hour count we can't justify. */
function effortProxy(a: AssignmentLike): {
  bonus: number;
  effortHr?: string;
} {
  let level = 0;
  const wt = (a.workType || "").toUpperCase();
  const pts = a.points;
  if (wt === "ASSIGNMENT" || wt === "QUIZ" || wt === "HOMEWORK") level += 1;
  if (wt === "PROJECT" || wt === "ESSAY") level += 2;
  const p = Number.isFinite(Number(pts)) ? Number(pts) : 0;
  if (p >= 90) level += 1; // big-points task is usually meaty
  // Map to a small bonus (bigger effort only helps when it's near-deadline —
  // handled by caller via the nearDeadline coefficient). Here just raw.
  return { bonus: Math.min(level, 3) * 2.5, effortHr: undefined };
}

/* ── Factor 5 (course / exam impact) → 0..5 ──
   Boosts a task ONLY when an upcoming quiz genuinely concerns the same course.
   schedule.json quizzes carry `{date, summary}` with no explicit course code, so
   we match the quiz summary against the task's course code OR its course-name
   text. If no reliable link exists, we give nothing — never a blanket boost. */
function examImpact(course: string, courseName: string, quizzes: QuizLike[]): number {
  if (!quizzes?.length) return 0;
  for (const q of quizzes) {
    const d = daysUntil(q.date);
    if (d === null || d < 0 || d > NEAR_EXAM_DAYS) continue;
    const summary = (q.summary || "").toLowerCase();
    if (!summary) continue;
    // Link the quiz to this task only on a concrete match (code or name).
    if (course && summary.includes(course.toLowerCase())) return W_EXAM_IMPACT;
    if (courseName && summary.includes(courseName.toLowerCase())) return W_EXAM_IMPACT;
  }
  return 0;
}

/* ── Factors 6 + 5 availability / context (time-aware) ──
   Uses today's weekly SCHEDULE + MAKEUP to know whether "right now" is blocked
   by an ongoing/imminent class, and to derive a recommended start window. */

interface NowInfo {
  hour: number; // float, current BKK time
  dayIdx: number; // 1=Mon..7=Sun
}

function isDateOnToday(date?: string): boolean {
  if (!date || !parseIsoDateLocal(date)) return false;
  return date === todayStrSafe();
}
function todayStrSafe(): string {
  const d = nowBKK();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

function blockNow(
  sessions: SessionLike[],
  now: NowInfo
): { busy: boolean; nextFree: string } {
  // A weekly session counts "today" only on its matching weekday.
  const todaySessions = (sessions || []).filter((s) => {
    if (s.date) return isDateOnToday(s.date); // one-off makeup on this date
    return s.day === now.dayIdx;
  });
  const h = now.hour;
  for (const s of todaySessions) {
    const start = s.start ?? 0;
    const end = s.end ?? start;
    if (h >= start && h < end) {
      // In class right now — availability is capped on the busy side.
      return { busy: true, nextFree: fmtStart(end) };
    }
    // Class starting within the context window → context boost, and block.
    const minsTo = (start - h) * 60;
    if (minsTo > 0 && minsTo <= CONTEXT_WINDOW_MIN) {
      return { busy: true, nextFree: fmtStart(end) };
    }
  }
  return { busy: false, nextFree: "" };
}

/** Format a float hour as a Thai HH:MM-ish string ("16:50" for 16.84 / "18:00"). */
function fmtStart(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Lay a concise Thai "start window" label. Only produced when we genuinely
 *  know the next free slot is today (else we fall back to "เช้า" generically
 *  — never a made-up absolute time). */
function recommendStart(
  block: { busy: boolean; nextFree: string }
): string | undefined {
  if (block.busy && block.nextFree) return `หลังเรียน ${block.nextFree}`;
  return undefined;
}

/* ── Candy wrapper: turn an assignment input into a full PriorityTask ── */

function scoreAssignment(
  a: AssignmentLike,
  quizzes: QuizLike[],
  sessions: SessionLike[],
  now: NowInfo
): PriorityTask | null {
  const course = (a.course || "").trim();
  const title = (a.title || "").trim();
  const courseName = (a.courseName || "").trim() || course;
  if (!title && !course) return null; // nothing to act on — skip

  const diff = daysUntil(a.due);
  const dl = deadlineScore(diff);
  const imp = importanceScore(a.points);
  const eff = effortProxy(a);
  const exam = examImpact(course, courseName, quizzes);
  const block = blockNow(sessions, now);

  // ---- Combine into a 0-100 total ----
  let score = 0;
  score += dl.base; // 0..40 (deadline incl. overdue)
  if (dl.overdue) score += W_OVERDUE_BONUS; // overdue pump (+10)
  score += imp.s; // 0..15
  score += eff.bonus; // 0..7.5
  score += exam; // 0..5
  // Availability: if currently busy with/imminent class, the task can't be
  // done *right now* → cap availability weight; else full.
  score += block.busy ? FOCUS_CAP_DURING_CLASS : W_AVAIL_NOW; // 0..10
  // Context boost: if we're moments before that course's own class, nudge the
  // matching course's task up (the "class in 20min" case in the brief).
  score += block.busy && courseMatchesNow(course, sessions, now) ? W_CONTEXT : 0;

  score = Math.max(0, Math.min(100, Math.round(score)));

  // ---- Level mapping (raw number stays internal) ----
  const level: PriorityLevel = score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";

  // ---- Short Thai reasons (concise, ≤ a phrase each) ----
  const reasons: string[] = [];
  if (dl.overdue) reasons.push(`เลยกำหนด ${dl.lateDays} วัน`);
  else if (diff === 0) reasons.push("ครบวันนี้");
  else if (diff === 1) reasons.push("ใกล้ส่ง พรุ่งนี้");
  else if (diff !== null && diff <= 3) reasons.push(`อีก ${diff} วัน`);
  else if (diff !== null && diff <= 5) reasons.push(`อีก ${diff} วัน`);
  else if (diff !== null) reasons.push(`อีก ${diff} วัน`);
  if (diff === 0 || (diff !== null && diff <= 1)) {
    // near-deadline meaty task — surface the effort signal honestly
    if (imp.raw && (a.points ?? 0) >= 60) reasons.push("คะแนนเยอะ");
  } else if (imp.raw && (a.points ?? 0) >= 90) {
    reasons.push("คะแนนสูงมาก");
  }
  if (exam > 0) reasons.push("ใกล้สอบที่เกี่ยวข้อง");

  // ---- Effort: only surfaced when a real signal exists (never fabricated) ----
  const effortHr = eff.effortHr;

  // ---- Recommended start time ----
  const recommendedStart = recommendStart(block);

  const bucket =
    diff === null
      ? "no_due"
      : diff < 0
      ? "over"
      : diff === 0
      ? "today"
      : diff <= 5
      ? "soon"
      : "later";

  const dueLabel = makeDueLabel(bucket, diff);

  return {
    source: "assignment",
    title,
    course,
    courseName,
    due: a.due ?? undefined,
    bucket,
    dueLabel,
    points: a.points ?? undefined,
    workType: a.workType,
    score,
    level,
    reasons: reasons.length ? reasons : ["ไม่มีกำหนดส่งด่วน"],
    effortHr,
    recommendedStart,
    actionTarget: "/today",
    key: `${course}|${title}|${(a.due || "").trim()}`,
  };
}

/** Does the current imminent class belong to the SAME course as this task?
 *  (factor 6: "event ใกล้เริ่ม -> contextual priority bump") */
function courseMatchesNow(
  course: string,
  sessions: SessionLike[],
  now: NowInfo
): boolean {
  if (!course) return false;
  const h = now.hour;
  for (const s of sessions || []) {
    const onToday = s.date ? isDateOnToday(s.date) : s.day === now.dayIdx;
    if (!onToday) continue;
    const start = s.start ?? 0;
    const end = s.end ?? start;
    if ((h >= start && h < end) || (start - h) * 60 <= CONTEXT_WINDOW_MIN) {
      if ((s.code || "").trim() === course) return true;
    }
  }
  return false;
}

/* ── Public entry points ── */

/**
 * Rank all assignments by priority (best first). Pure + deterministic.
 *
 * @param todo    assignments.json `todo[]`
 * @param quizzes schedule.json `quizzes[]` (exams/activities, optional)
 * @param sessions weekly SCHEDULE + MAKEUP merged (for time-availability)
 * @param hiddenKeys set of already-visible-filter keys to exclude (optional)
 */
export function rankAssignments(
  todo: AssignmentLike[],
  quizzes: QuizLike[],
  sessions: SessionLike[],
  hiddenKeys?: Set<string> | ((key: string) => boolean),
  now?: NowInfo
): PriorityTask[] {
  const n: NowInfo = now ?? { hour: hourOfDayBKK(), dayIdx: todayIdxBKK() };
  const results: PriorityTask[] = [];
  for (const a of todo || []) {
    const t = scoreAssignment(a, quizzes, sessions, n);
    if (!t) continue;
    if (hiddenKeys) {
      const hit = typeof hiddenKeys === "function" ? hiddenKeys(t.key) : hiddenKeys.has(t.key);
      if (hit) continue;
    }
    results.push(t);
  }
  // Deterministic sort: score desc, then overdue/soon first, then due ascending.
  return results.sort((p, q) => {
    if (q.score !== p.score) return q.score - p.score;
    const dp = daysUntil(p.due);
    const dq = daysUntil(q.due);
    return (dp === null ? 1 : dp) - (dq === null ? 1 : dq);
  });
}

/** Number-of-days for the top task — helper for "when to start" summary. */
function hourOfDayBKK(): number {
  const d = nowBKK();
  const mm = d.getMinutes() / 60;
  return d.getHours() + mm;
}

/**
 * Compute THE next action + short brief. This is the reusable service both
 * Home and /today call. Returns `state:"idle"` with `next:null` when nothing
 * is worth doing right now (=> render "No urgent action right now", never a
 * fake recommendation).
 *
 * @param todo assignments.json `todo[]`
 * @param quizzes schedule.json `quizzes[]`
 * @param sessions weekly SCHEDULE + MAKEUP merged
 * @param hiddenKeys optional exclude-by-key set/function
 */
export function computeNextAction(
  todo: AssignmentLike[],
  quizzes: QuizLike[],
  sessions: SessionLike[],
  hiddenKeys?: Set<string> | ((key: string) => boolean),
  now?: NowInfo
): NextActionResult {
  const ranked = rankAssignments(todo, quizzes, sessions, hiddenKeys, now);
  // No urgent / no actionable task at all → idle (honest empty state).
  if (!ranked.length || ranked[0].score < 30) {
    return { state: "idle", next: null, ranked };
  }
  const next = ranked[0];
  let brief = `จัดอันดับจาก ${ranked.length} งาน · อันดับ 1 "${next.title}" (${scoreWord(next.score)})`;
  const reasons = next.reasons.slice(0, 2).join(" + ");
  if (reasons) brief += ` ·${reasons}`;
  return { state: "action", next, ranked, brief };
}

/** Human word for the (internal) score band — never the raw number. */
function scoreWord(score: number): string {
  return score >= 70 ? "สูงสุด" : score >= 40 ? "กลาง ๆ" : "ต่ำ";
}

/* Re-export the weekly SCHEDULE type so call sites can build `sessions`. */
export default computeNextAction;