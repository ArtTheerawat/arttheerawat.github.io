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

  // what_first must be WORK-anchored. A bare "ก่อน" (e.g. "เกิดก่อนกัน") is NOT
  // a priority question — only treat it as "which task first" when paired with
  // a task/priority word (งาน/ทำ/อันไหน/เรื่องไหน/ควร/เริ่ม/ก่อนดี/งานไหน).
  const workAnchors = ["งานไหน", "ทำก่อน", "ต้องทำก่อน", "ทำอะไรก่อน", "อันไหน", "เรื่องไหน", "ควรทำ", "เริ่ม", "ก่อนดี", "งานก่อน", "ทำอันดับแรก", "สอบก่อน", "ส่งก่อน"];
  const hasBefore = has("ก่อน");
  const anchoredBefore =
    has("ทำงาน") || has("งาน") || has("ทำ") || has("อันไหน") || has("เรื่องไหน") ||
    has("ควร") || has("เริ่ม") || workAnchors.some((w) => s.includes(w));
  if (hasBefore && anchoredBefore) {
    return { intent: "what_first" };
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

/* ──────────────────────────────────────────────────────────────────────────
 * Deterministic natural-language answers (no AI, 0 tokens).
 *
 * These compose a friendly Thai reply straight from the REAL data the app
 * already computed (classes, counts, priority top task). They back the
 * route's /api/assistant deterministic fast-path so the assistant still
 * answers common study questions even with no AI key configured. Never
 * fabricates: classes/tasks/dates are pulled only from loaded data.
 * ────────────────────────────────────────────────────────────────────────── */

/** "HH:MM" from a class start (e.g. 8 -> "08:00", 13.5 -> "13:30"). */
function fmtHour(h: number): string {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Deterministic Thai answer for "ช่องวางแผนวันนี้" (plan_day). */
function planDayAnswer(data: AssistantData): string {
  const dayIdx = todayIdxBKK();
  const classes = todayClasses(dayIdx);
  const counts = taskCounts(data.todo);
  const top = topTaskText(data.todo, data.quizzes);

  const lines: string[] = [`วัน${DAY[dayIdx - 1]} (${todayStr()}) แล้วครับ`];

  // Classes with their time windows.
  if (classes.length) {
    const cl = classes.map(
      (c) => `${fmtHour(c.start)}–${fmtHour(c.end)} ${c.name}${c.room ? ` (${c.room})` : ""}`
    );
    lines.push("คาบเรียนวันนี้:");
    lines.push(cl.map((s) => `- ${s}`).join("\n"));
  } else {
    lines.push("วันนี้ไม่มีคาบเรียนตามตาราง");
  }

  // Workload overview.
  const workBits: string[] = [];
  if (counts.over > 0) workBits.push(`${counts.over} งานเลยกำหนด`);
  if (counts.today > 0) workBits.push(`${counts.today} งานครบวันนี้`);
  if (counts.soon > 0) workBits.push(`${counts.soon} งานใกล้ถึง (5 วัน)`);
  if (workBits.length) {
    lines.push("ภาระงานวันนี้: " + workBits.join(" · "));
  } else {
    lines.push("วันนี้ไม่มีการบ้านเร่งด่วน (ตามกำหนดส่ง)");
  }

  // Priority suggestion (deterministic engine).
  if (top) {
    lines.push(
      `ถ้าจะเริ่มเลย แนะนำงาน ${top.title} [${top.courseName}] (${top.dueLabel}) เพราะ ${top.reasons.join(" และ ") || "เป็นงานที่ระบบจัดลำดับความสำคัญไว้ก่อน"}`
    );
  } else if (counts.over === 0) {
    lines.push("ไม่มีงานเร่งด่วน — ถ้าอยาก productive ก็เก็บงานที่ครบกำหนดไกลออกไปก่อนได้ครับ");
  }

  return lines.join("\n");
}

/** Deterministic Thai answer for "วันนี้มีอะไร" (what_today). */
function whatTodayAnswer(data: AssistantData): string {
  const dayIdx = todayIdxBKK();
  const classes = todayClasses(dayIdx);
  const counts = taskCounts(data.todo);
  const top = topTaskText(data.todo, data.quizzes);

  const lines: string[] = [`วัน${DAY[dayIdx - 1]} (${todayStr()}) ครับ`];

  if (classes.length) {
    lines.push("คาบเรียน: " + classes.map((c) => `${c.name} (${fmtHour(c.start)})`).join(" | "));
  } else {
    lines.push("คาบเรียน: ไม่มีคาบในตารางวันนี้");
  }

  lines.push(`งาน: เลยกำหนด ${counts.over} · ครบวันนี้ ${counts.today} · ใกล้ถึง (5 วัน) ${counts.soon}`);
  if (top) {
    lines.push(`ที่ควรทำก่อน: "${top.title}" [${top.courseName}] — ${top.dueLabel}`);
  } else {
    lines.push("ไม่มีงานเร่งด่วนที่ต้องทำตอนนี้");
  }
  return lines.join("\n");
}

/** Deterministic Thai answer for "งานไหนควรทำก่อน" (what_first). */
function whatFirstAnswer(data: AssistantData): string {
  const top = topTaskText(data.todo, data.quizzes);
  if (!top) {
    return "ตอนนี้ไม่มีงานเร่งด่วนที่ระบบจัดลำดับไว้เป็นอันดับหนึ่งครับ (เลขกำหนดส่ง/คะแนนยังไม่สูงพอ หรืองานครบทั้งหมดแล้ว)";
  }
  return `งานที่ควรทำก่อนที่สุดคือ "${top.title}" [${top.courseName}] (${top.dueLabel}) เพราะ ${top.reasons.join(" และ ") || "ระบบจัดลำดับความสำคัญไว้ก่อน"}`;
}

/** Deterministic Thai answer for a greeting (e.g. "สวัสดี", "hi", "ทักทาย"). */
function greetingAnswer(data: AssistantData): string {
  const dayIdx = todayIdxBKK();
  const counts = taskCounts(data.todo);
  const lines: string[] = [
    `สวัสดีครับหัวหน้า 🙏 วันนี้วัน${DAY[dayIdx - 1]} (${todayStr()}) เป็นยังไงบ้างครับ`,
  ];
  if (counts.over > 0) {
    lines.push(`มีงานเลยกำหนด ${counts.over} งานนะครับ แนะนำให้เคลียร์ก่อน 🫡`);
  } else if (counts.today > 0) {
    lines.push(`วันนี้มีงานครบกำหนด ${counts.today} งานครับ ลองถาม "งานไหนควรทำก่อน?"`);
  } else if (counts.soon > 0) {
    lines.push(`มีงานใกล้ถึง (5 วัน) ${counts.soon} งาน ลองถาม "ช่วยวางแผนวันนี้" ได้เลยครับ`);
  } else {
    lines.push("วันนี้ดูว่างไม่มีงานเร่งด่วนครับ อยากให้ช่วยอะไร เช่น วางแผนวันนี้ หรือดูงานที่จะถึง?");
  }
  lines.push("ฉันตอบได้เกี่ยวกับงาน กำหนดส่ง ตารางเรียน และลำดับความสำคัญจากข้อมูลจริงเท่านั้นนะครับ");
  return lines.join("\n");
}

/** Deterministic Thai answer for an unclassifiable question (unknown intent). */
function unknownAnswer(data: AssistantData): string {
  const counts = taskCounts(data.todo);
  const bits: string[] = [];
  if (counts.over > 0) bits.push(`เลยกำหนด ${counts.over}`);
  if (counts.today > 0) bits.push(`ครบวันนี้ ${counts.today}`);
  if (counts.soon > 0) bits.push(`ใกล้ถึง (5 วัน) ${counts.soon}`);
  const load = bits.length ? " ภาระงาน: " + bits.join(" · ") : " ไม่มีงานเร่งด่วน";
  return (
    "ขอโทษครับ ผมตอบได้เฉพาะเรื่องงาน/ตาราง/ลำดับความสำคัญใน TheeDeck นะครับ (ตอบจากข้อมูลจริงเท่านั้น)" +
    load +
    "\nลองถามแบบนี้: \"งานไหนควรทำก่อน?\", \"วันนี้มีอะไร?\", \"ช่วยวางแผนวันนี้\", หรือระบุชื่องาน เช่น \"Lab 5\""
  );
}

/** Compose a deterministic answer for the given intent, or null when the
 *  intent is not deterministically answerable (wants AI). */
export function buildDeterministicAnswer(
  intent: Intent,
  term: string | undefined,
  data: AssistantData
): string | null {
  switch (intent) {
    case "what_today":
      return whatTodayAnswer(data);
    case "what_first":
      return whatFirstAnswer(data);
    case "plan_day":
      return planDayAnswer(data);
    case "task_detail":
      // Only answer deterministically when a concrete term is given; without
      // one we can't know what they mean, so prompt for a term (no AI needed).
      return term
        ? buildContext("task_detail", term, data).replace(/^วันนี้[^\n]*\n/, "").trim()
        : "ขอระบุชื่องาน/คำค้นหน่อยนะครับ เช่น \"Lab 5\" หรือ \"ใบงานที่ 6\"";
    case "unknown":
      return greetingAnswer(data);
    default:
      return unknownAnswer(data);
  }
}