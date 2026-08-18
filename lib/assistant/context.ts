// lib/assistant/context.ts
// ───────────────────────────────────────────────────────────────────────────
// AI Study Assistant — CONTEXT PIPELINE (SYSTEM 8).
//
// Design rule (matches the product brief): AI is NOT the source of truth.
// This module is the ONLY place that decides WHICH real data a question needs,
// then builds a COMPACT Thai context string. It never sends the whole database
// to the model. Deterministic facts (priority, due-diff, today) are precomputed
// here in code; the model only explains/summarizes those facts.
//
// Sources reused from the existing app (no new data system):
//   - public/data/assignments.json (todo[] + courseNames)
//   - public/data/schedule.json   (quizzes[] + events[])
//   - public/data/classroom.json  (courses[].coursework — title/due/dueTime)
//   - lib/priority.ts             (deterministic "what to do first" — code decides)
//   - lib/schedule-data.ts        (weekly SCHEDULE + MAKEUP for "class today")
//
// Anti-hallucination: if a piece of information is not present in the loaded
// data, the builder simply omits it (or marks it "ไม่พบข้อมูล") — it never
// invents deadlines, classes, or status.
// ───────────────────────────────────────────────────────────────────────────

import { dueDiffDays, todayStr, todayIdxBKK, parseIsoDateLocal } from "@/lib/data";
import { SCHEDULE, MAKEUP, COURSES } from "@/lib/schedule-data";

/* ── Input shapes (subset of the real JSON on disk) ── */

export interface AssignmentInput {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string | null;
  workType?: string;
  points?: number | null;
  bucket?: string;
  overdue?: number;
  daysAway?: number;
}

export interface QuizInput {
  date?: string;
  summary?: string;
}

export interface CourseworkInput {
  title?: string;
  due?: string;
  dueTime?: string;
  state?: string;
}

export interface AssistantData {
  todo: AssignmentInput[];
  quizzes: QuizInput[];
  courseNames: Record<string, string>;
  // classroom[].coursework keyed to help "อธิบายงานนี้/แบ่งขั้นตอน"
  courseworkByCourse: Record<string, CourseworkInput[]>;
}

/* ── Small deterministic helpers (reuse lib/data where possible) ── */

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!p) return "—";
  const m = +p[2], d = +p[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return "—";
  return `${d} ${TH_MONTHS[m - 1]}`;
}

/** Whole-day Thai due label from a due date (code-computed, never AI-invented). */
function dueLabel(due?: string | null): string {
  const diff = dueDiffDays(due ?? null);
  if (diff === null) return "ยังไม่ระบุกำหนดส่ง";
  if (diff < 0) return `เลยกำหนด ${-diff} วัน`;
  if (diff === 0) return "ครบวันนี้";
  if (diff === 1) return "ครบพรุ่งนี้";
  return `ครบใน ${diff} วัน`;
}

/** Thai weekday name. */
const DAY = [
  "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์",
];

/* ── Question intent detection (deterministic, cheap, no AI) ── */

export type Intent =
  | "what_today"   // วันนี้มีอะไร / ภาพรวมวันนี้
  | "what_first"   // งานไหนควรทำก่อน
  | "plan_day"     // ช่วยวางแผนวันนี้
  | "task_detail"  // งาน/วิชาโดยเฉพาะ
  | "unknown";

// Thai keyword buckets. Keep small — broad enough to route, specific enough
// not to misroute. Order matters: task_detail is checked last (it needs a
// matchable term) and plan/what_today overlap is fine (both build day context).
export function detectIntent(q: string): { intent: Intent; term?: string } {
  const s = q.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => s.includes(k));

  if (has("ทำก่อน", "ก่อน", "อันไหน", "งานไหน", "เริ่ม", "เรื่องไหน", "ก่อนเลย")) {
    if (has("ทำก่อน", "ก่อน", "เริ่ม", "ก่อนเลย", "อันไหน", "งานไหน", "เรื่องไหน")) {
      return { intent: "what_first" };
    }
  }
  if (has("วางแผน", "แพลน", "ช่วยจัด", "จัดวัน", "กำหนดการ", "วางตาราง")) {
    return { intent: "plan_day" };
  }
  if (has("วันนี้", "มีอะไร", "วันนี้ต้องทำ", "วันนี้มี", "ตอนนี้", "อะไรต้องทำ")) {
    return { intent: "what_today" };
  }
  if (has("lab", "ใบงาน", "quiz", "ข้อสอบ", "สอบ", "project", "งาน")) {
    // A specific task/term was named — route to detail.
    const term = extractTerm(s);
    if (term) return { intent: "task_detail", term };
  }
  return { intent: "unknown" };
}

/** Pull a plausible search term out of a task-related question (e.g. "lab 5">
 *  -> "lab 5"). Returns the term or undefined if nothing looks addressable. */
function extractTerm(s: string): string | undefined {
  // Patterns like "lab 5", "ใบงานที่ 6", "ใบงาน 6", "quiz 3"
  const patterns = [
    /lab\s*\d+/i,
    /ใบงาน[^\d]{0,3}\d+/,
    /project\s*\d+/i,
    /quiz\s*\d+/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[0];
  }
  return undefined;
}

/* ── Compact context builders ── */

/** Today's classes (BKK weekday) — code-computed, only info present in data. */
function todayClasses(dayIdx: number): { code: string; name: string; start: number; end: number; room: string }[] {
  return SCHEDULE.filter((s) => s.day === dayIdx).map((s) => ({
    code: s.code,
    name: COURSES[s.code]?.name || s.code,
    start: s.start,
    end: s.end,
    room: s.room,
  }));
}

/** All relevant tasks (overdue / due today / soon) compacted for the model. */
function compactTasks(
  todo: AssignmentInput[],
  courseNames: Record<string, string>,
  upcoming: boolean
): string[] {
  const today = todayStr();
  const rows: string[] = [];
  for (const a of todo) {
    const diff = dueDiffDays(a.due ?? null);
    if (diff === null || (!upcoming && diff > 5)) continue;
    // Only include what the app actually knows — never fabricate.
    const cn = a.courseName || courseNames[a.course || ""] || a.course || "";
    const parts = [
      `- ${a.title || "ไม่ระบุชื่องาน"} [${cn}]`,
      `กำหนดส่ง ${fmtDate(a.due)} / ${dueLabel(a.due)}`,
    ];
    if (a.workType) parts.push(`ประเภท ${a.workType}`);
    if (a.points != null) parts.push(`${a.points} คะแนน`);
    rows.push(parts.join(" · "));
  }
  return rows;
}

/** Find the deterministic top task via the app's own priority engine. */
import { computeNextAction, type AssignmentLike } from "@/lib/priority";

function topTaskText(
  todo: AssignmentInput[],
  quizzes: QuizInput[]
): { title: string; courseName: string; dueLabel: string; reasons: string[] } | null {
  const asAssign: AssignmentLike[] = (todo || [])
    .filter((a) => a.title || a.course)
    .map((a) => ({
      title: a.title,
      course: a.course,
      courseName: a.courseName,
      due: a.due ?? null,
      workType: a.workType,
      points: a.points ?? null,
    }));
  const sessions = [...SCHEDULE, ...MAKEUP] as { day?: number; date?: string; start?: number; end?: number; code?: string }[];
  const res = computeNextAction(asAssign, quizzes || [], sessions);
  if (res.state !== "action" || !res.next) return null;
  return {
    title: res.next.title,
    courseName: res.next.courseName || res.next.course,
    dueLabel: res.next.dueLabel || "",
    reasons: res.next.reasons,
  };
}

/** Tallies of overdue / today / soon (deterministic, from real data). */
function taskCounts(todo: AssignmentInput[]): { over: number; today: number; soon: number } {
  const c = { over: 0, today: 0, soon: 0 };
  for (const a of todo) {
    const diff = dueDiffDays(a.due ?? null);
    if (diff === null) continue;
    if (diff < 0) c.over++;
    else if (diff === 0) c.today++;
    else if (diff <= 5) c.soon++;
  }
  return c;
}

/** Build the compact context string for an intent. Only includes what the
 *  question actually needs (token-optimized). Never a full DB dump. */
export function buildContext(intent: Intent, term: string | undefined, data: AssistantData): string {
  const todayIso = todayStr();
  const dayIdx = todayIdxBKK();
  const classes = todayClasses(dayIdx);
  const counts = taskCounts(data.todo);
  const top = topTaskText(data.todo, data.quizzes);

  const sections: string[] = [];
  sections.push(`วันนี้ (${todayIso}) วัน${DAY[dayIdx - 1]}`);

  if (intent === "what_today" || intent === "plan_day") {
    if (classes.length) {
      sections.push(
        "ชั้นเรียนวันนี้: " +
          classes
            .map((c) => ` ${c.name} (${String(Math.floor(c.start)).padStart(2, "0")}:${c.start % 1 ? "30" : "00"})`)
            .join(" | ")
      );
    } else {
      sections.push("ชั้นเรียนวันนี้: ไม่มีคาบเรียนใน data");
    }
    sections.push(`สรุปงาน: เลยกำหนด ${counts.over} · ครบวันนี้ ${counts.today} · ใกล้ถึง (5 วัน) ${counts.soon}`);
    if (top) {
      sections.push(
        `งานที่ควรทำก่อนที่สุด (จากระบบ priority): "${top.title}" [${top.courseName}] — ${top.dueLabel}` +
          (top.reasons.length ? ` (เหตุผล: ${top.reasons.join(", ")})` : "")
      );
    } else {
      sections.push("ไม่มีงานเร่งด่วนที่ต้องทำตอนนี้");
    }
  }

  if (intent === "what_first") {
    if (top) {
      sections.push(`งานที่ควรทำก่อนที่สุด (คำนวณจากระบบ priority, ไม่ได้มโน): "${top.title}" [${top.courseName}] — ${top.dueLabel}`);
      sections.push("เหตุผล: " + (top.reasons.join(", ") || "ไม่มีข้อมูลเพิ่มเติม"));
    } else {
      sections.push("ไม่มีงานเร่งด่วน — ระบบหาไม่มีงานที่คะแนนสูงพอจะแนะนำเป็นอันดับหนึ่ง");
    }
  }

  if (intent === "task_detail") {
    const rows: string[] = [];
    // 1) classroom.coursework is the richest source when we have a term.
    if (term) {
      for (const [course, cws] of Object.entries(data.courseworkByCourse)) {
        for (const cw of cws) {
          const t = (cw.title || "").trim();
          if (t && t.toLowerCase().includes(term.toLowerCase())) {
            rows.push(
              `- "${t}" (วิชา ${course}) — กำหนดส่ง ${fmtDate(cw.due)}${cw.dueTime ? " " + cw.dueTime : ""}${cw.state ? `, สถานะ ${cw.state}` : ""}`
            );
          }
        }
      }
    }
    // 2) also surface matching assignments.json entries.
    for (const a of data.todo) {
      const t = (a.title || "").trim();
      if (term && t && t.toLowerCase().includes(term.toLowerCase())) {
        const cn = a.courseName || data.courseNames[a.course || ""] || a.course || "";
        rows.push(`- "${t}" [${cn}] — ${dueLabel(a.due)} (${fmtDate(a.due)})`);
      }
    }
    sections.push(
      rows.length
        ? "งานที่ตรงคำถาม (จากข้อมูลจริง):\n" + rows.join("\n")
        : `ไม่พบงานที่ตรงคำว่า "${term}" ในข้อมูลปัจจุบัน`
    );
  }

  return sections.join("\n");
}