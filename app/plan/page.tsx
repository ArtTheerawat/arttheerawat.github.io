"use client";

// app/plan/page.tsx — SYSTEM 10: Daily Planning / Time Blocking.
// ─────────────────────────────────────────────────────────────────────────────
// Helps decide "งานนี้ควรเอาไปทำช่วงเวลาไหนของวันนี้?" by combining REAL data:
//   • FIXED   — today's classes + makeup (SCHEDULE + MAKEUP)
//   • PLANNED — work blocks the user has accepted (localStorage per date)
//   • UNSCHEDULED — active tasks still needing a slot
// Priority (WHICH task first) is reused from lib/priority.ts (deterministic).
// Available time comes from the complement of fixed events (lib/plan.ts
// computeFreeSlots) — never an invented schedule. Durations are chosen from the
// existing /focus Pomodoro presets (25/50/90); the system never fabricates a
// task's duration and never auto-starts a timer.
//
// Persistence = localStorage (td_plan_blocks), the smallest compatible
// mechanism the repo ships (mirrors how /focus persists per-task state). No
// new DB table, no AI.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  classifyAssignment,
  dataUrl,
  fmtDate,
  todayLabelBKK,
  type Bucket,
} from "@/lib/data";
import { COURSES, MAKEUP, SCHEDULE } from "@/lib/schedule-data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import {
  buildDailyPlan,
  fmtHour,
  isFree,
  loadPlan,
  occupiedRanges,
  PLAN_DURATIONS,
  planTodayStr,
  proposeBlock,
  roundUp15,
  savePlan,
  upsertPlanBlock,
  type PlannedBlock,
  type PlannedEvent,
} from "@/lib/plan";
import type { PriorityTask, AssignmentLike, QuizLike } from "@/lib/priority";

const ICONS: Record<string, string> = {
  "88622065": "🗂️",
  "88624065": "🗄️",
  "88624165": "🎨",
  "88634065": "💻",
  "89520664": "🇬🇧",
  "89520864": "🗣️",
  "73101469": "❤️",
};

function taskIcon(code: string): string {
  return ICONS[code] || "📘";
}

export default function PlanPage() {
  const [all, setAll] = useState<Assignment[]>([]);
  const [quizzes, setQuizzes] = useState<QuizLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const { hiddenList } = useHiddenTasks();
  const hiddenKeys = useMemo(
    () => new Set(hiddenList.map((h) => h.key)),
    [hiddenList]
  );

  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  // Recompute clock every 30s so past/now shading stays fresh.
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const today = planTodayStr();

  const inFlight = useRef(false);

  // ── Load tasks + quizzes (same as /today) — extracted as a callback so the
  //    error "ลองใหม่" button can retry JUST this module without reloading the
  //    whole page. The inFlight guard prevents double-clicks stacking requests.
  const load = useCallback(async () => {
    if (inFlight.current) return; // no overlap while a request is pending
    inFlight.current = true;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j: { todo?: Assignment[]; updated?: string } = await r.json();
      const todo = (j.todo || []).map((a) => ({ ...a }));
      todo.forEach(classifyAssignment);
      setAll(todo);
    } catch (e) {
      setErr("โหลดข้อมูลงานไม่ได้: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
    try {
      const q = await fetch(dataUrl("/data/schedule.json"), { cache: "no-store" });
      if (q.ok) {
        const qj: { quizzes?: { date?: string; summary?: string }[] } = await q.json();
        setQuizzes(qj.quizzes || []);
      }
    } catch {
      /* quizzes optional */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showToast = useCallback((msg: string, isError = false) => {
    setToast(msg);
    setToastError(isError);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const sessions = useMemo(
    () =>
      [...SCHEDULE, ...MAKEUP] as {
        day?: number;
        date?: string;
        start?: number;
        end?: number;
        code?: string;
      }[],
    []
  );

  const nowHour = useMemo(() => {
    const d = nowTick;
    return d.getHours() + d.getMinutes() / 60;
  }, [nowTick]);

  // ── Build the deterministic daily plan ──
  const plan = useMemo(
    () => buildDailyPlan(all, quizzes, sessions, hiddenKeys, nowHour, today),
    [all, quizzes, sessions, hiddenKeys, nowHour, today, buildDailyPlan]
  );

  // ── Local grid state: accepted blocks for today (editable copy) ──
  const [blocks, setBlocks] = useState<PlannedBlock[]>(() => loadPlan(today));
  // Keep blocks in sync when 'today' changes (midnight rollover).
  useEffect(() => {
    setBlocks(loadPlan(today));
  }, [today]);

  // ── Scheduling modal state ──
  const [scheduling, setScheduling] = useState<PriorityTask | null>(null);
  const [chosenSlotStart, setChosenSlotStart] = useState<number | null>(null);
  const [chosenDur, setChosenDur] = useState<number>(50);
  const modalRef = useRef<HTMLDivElement | null>(null);

  const occupied = useMemo(() => occupiedRanges(plan.fixed), [plan.fixed]);

  const acceptBlock = useCallback(
    (t: PriorityTask, start: number, durMin: number) => {
      const end = start + durMin / 60;
      if (end > 24) {
        showToast("ช่วงนี้เลยเที่ยงคืน เลือกช่วงเวลาอื่นก่อน", true);
        return;
      }
      if (!isFree(start, end, occupied)) {
        showToast("ทับเวลาที่มีเรียนอยู่แล้ว เลือกช่วงเวลาอื่นก่อน", true);
        return;
      }
      const block: PlannedBlock = {
        key: t.key,
        title: t.title,
        course: t.course,
        courseName: t.courseName,
        start,
        end,
        dur: durMin,
        color: COURSES[t.course]?.color || "#22d3ee",
      };
      const merged = upsertPlanBlock(today, block);
      setBlocks(merged);
      setScheduling(null);
      showToast(`วางแผนแล้ว: ${fmtHour(start)}–${fmtHour(end)} (${durMin} นาที)`);
    },
    [today, occupied, showToast]
  );

  const removeBlock = useCallback(
    (key: string) => {
      const next = loadPlan(today).filter((b) => b.key !== key);
      savePlan(today, next);
      setBlocks(next);
      showToast("ถอนออกจากแผนแล้ว");
    },
    [today, showToast]
  );

  const openPicker = (t: PriorityTask) => {
    // Default slot = earliest free window, duration = 50 (a /focus preset).
    const prop = proposeBlock(t, plan.free, 50);
    setScheduling(t);
    setChosenDur(50);
    setChosenSlotStart(prop ? roundUp15(prop.start) : plan.free[0]?.start ?? null);
  };

  // Escape closes the modal.
  useEffect(() => {
    if (!scheduling) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setScheduling(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [scheduling]);

  const freeNow = useMemo(
    () => plan.free.filter((s) => s.end > nowHour + 5 / 60),
    [plan.free, nowHour]
  );

  const tlState = (e: PlannedEvent): "past" | "now" | "upcoming" =>
    nowHour >= e.end ? "past" : nowHour >= e.start ? "now" : "upcoming";

  return (
    <div className="wrap" id="main">
      <header className="today-head">
        <div>
          <h1>
            วาง<span className="dot">แผน</span>วันนี้
          </h1>
          <div className="dayhead">
            <div className="sub">
              วันที่ {todayLabelBKK()} · {today}
            </div>
            <div className="live-clock" role="timer" aria-live="off">
              <span className="lc-ico">🕐</span>
              <b>{fmtHour(nowHour)}</b>
              <span className="lc-tz">BKK</span>
            </div>
          </div>
        </div>
      </header>

      {loading && (
        <div className="src" role="status" aria-live="polite">
          กำลังโหลดแผน…
        </div>
      )}
      {err && (
  <div className="err">
    {err}{" "}
    <button
      type="button"
      className="retry-btn"
      onClick={() => void load()}
      disabled={loading}
    >
      {loading ? "กำลังลองใหม่…" : "ลองใหม่"}
    </button>
  </div>
)}

      {!loading && !err && (
        <>
          {/* Overview counts */}
          <div className="counts">
            <div className="c"><b style={{ color: "var(--accent2)" }}>{plan.fixed.length}</b>เรียน (FIXED)</div>
            <div className="c"><b style={{ color: "var(--up)" }}>{plan.scheduled.length}</b>วางแผนแล้ว (PLANNED)</div>
            <div className="c"><b style={{ color: "var(--warn)" }}>{plan.unscheduled.length}</b>ยังไม่ได้จัด (UNSCHEDULED)</div>
          </div>

          {/* ── FIXED timeline ── */}
          <section className="today-tl">
            <div className="sec-title">📚 ตารางวันนี้ (FIXED)</div>
            {plan.fixed.length === 0 ? (
              <div className="tl-empty">วันนี้ไม่มีคาบเรียน</div>
            ) : (
              <div className="tl-list">
                {plan.fixed.map((e, i) => {
                  const st = tlState(e);
                  return (
                    <div
                      className={"tl-row " + st + (e.kind === "makeup" ? " makeup" : "")}
                      key={i}
                      data-state={st}
                      style={{ "--tl-c": e.color } as React.CSSProperties}
                    >
                      <div className="tl-time">
                        <div className="tl-h">{fmtHour(e.start)}</div>
                        <div className="tl-end">–{fmtHour(e.end)}</div>
                      </div>
                      <div className="tl-axis"><span className="tl-dot" /></div>
                      <div className="tl-body">
                        <div className="tl-act">
                          <span className="tl-emoji">{e.icon}</span>
                          <span className="tl-name">{e.label}</span>
                          {e.kind === "makeup" && <span className="tl-tag">ชดเชย</span>}
                          {st === "now" && <span className="tl-badge-now">กำลังเรียน</span>}
                        </div>
                        <div className="tl-meta">
                          <span className="tl-code">{e.code}</span>
                          {e.room && <span className="tl-room">📍 {e.room}</span>}
                          <span className="tl-tag fixed-tag">เรียน</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── PLANNED blocks ── */}
          <section className="today-tl plan-block-sec">
            <div className="sec-title">⚡ บล็อกที่วางแผนแล้ว (PLANNED)</div>
            {plan.scheduled.length === 0 ? (
              <div className="tl-empty">ยังไม่มีบล็อกที่วางแผน — กด "จัดเวลา" ด้านล่าง</div>
            ) : (
              <div className="tl-list">
                {plan.scheduled.map((b, i) => {
                  const st = tlState({ start: b.start, end: b.end, label: b.title, code: b.course, color: b.color, kind: "planned", icon: "⚡" });
                  return (
                    <div
                      className={"tl-row " + st + " planned" + (st === "now" ? " now" : "")}
                      key={i}
                      data-state={st}
                      style={{ "--tl-c": b.color } as React.CSSProperties}
                    >
                      <div className="tl-time">
                        <div className="tl-h">{fmtHour(b.start)}</div>
                        <div className="tl-end">–{fmtHour(b.end)}</div>
                      </div>
                      <div className="tl-axis"><span className="tl-dot" /></div>
                      <div className="tl-body">
                        <div className="tl-act">
                          <span className="tl-emoji">⚡</span>
                          <span className="tl-name">{b.title}</span>
                          <span className="tl-tag plan-dur">{b.dur} นาที</span>
                        </div>
                        <div className="tl-meta">
                          <span className="tl-code">{b.course}</span>
                          {b.courseName && <span className="tl-room">{b.courseName}</span>}
                          <button className="plan-remove" onClick={() => removeBlock(b.key)}>ถอน</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Free windows hint */}
            <div className="free-hint">
              {freeNow.length > 0 ? (
                <>
                  ช่วงว่างจากเวลาเรียนวันนี้ (หลังตอนนี้):{" "}
                  {freeNow.map((s, i) => (
                    <span key={i} className="free-chip">
                      {fmtHour(s.start)}–{fmtHour(s.end)}
                    </span>
                  ))}
                </>
              ) : (
                <span>ตอนนี้ไม่มีช่วงว่างเหลือแล้วหลังเวลาปัจจุบัน</span>
              )}
            </div>
          </section>

          {/* ── UNSCHEDULED tasks ── */}
          <section className="plan-unsched">
            <div className="sec-title">งานที่ยังไม่ได้จัดเวลา (UNSCHEDULED)</div>
            {plan.unscheduled.length === 0 ? (
              <div className="plan-empty">
                🎉 ไม่มีงานค้างที่ต้องจัด — พักสบาย ๆ ได้เลย หรืองานทั้งหมดวางแผนแล้ว
              </div>
            ) : (
              <div className="unsched-list">
                {plan.unscheduled.map((t) => {
                  const prop = proposeBlock(t, plan.free, 50); // default 50-min probe for hints
                  return (
                    <div className="unsched-item" key={t.key}>
                      <div className="unsched-head">
                        <span className="unsched-ico">{taskIcon(t.course)}</span>
                        <span className="unsched-title">{t.title}</span>
                      </div>
                      <div className="unsched-meta">
                        <span className="tl-code">{t.course}</span>
                        <span className="badge b-soon">{t.dueLabel || "ยังไม่ระบุกำหนดส่ง"}</span>
                        <span className={"prio-dot " + (t.level === "HIGH" ? "prio-high" : t.level === "MEDIUM" ? "prio-med" : "prio-low")} />
                        <span className="prio-lvl">{t.level === "HIGH" ? "เร่งด่วน" : t.level === "MEDIUM" ? "ปานกลาง" : "เบา"}</span>
                      </div>
                      <div className="unsched-card">
                        {prop ? (
                          <span className="suggest-line">
                            เสนอ: เริ่มได้ตอน <b>{fmtHour(prop.start)}</b> (Focus {50} นาที)
                          </span>
                        ) : (
                          <span className="suggest-line none">ยังหาช่วงว่างที่พอดีไม่ได้ (หลังเวลาปัจจุบัน)</span>
                        )}
                        <button className="next-go-btn build-plan-btn" onClick={() => openPicker(t)}>
                          จัดเวลา ✏️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* ── Scheduling modal ── */}
      {scheduling && plan.free.length > 0 && (
        <div
          ref={modalRef}
          className="detail-modal open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="plan-modal-title"
          onClick={(e) => e.target === e.currentTarget && setScheduling(null)}
        >
          <div className="sheet plan-sheet">
            <div className="hh">
              <div>
                <h2 id="plan-modal-title">จัดเวลา: {scheduling.title}</h2>
                <div className="when">{scheduling.courseName || scheduling.course}</div>
              </div>
              <button className="close" onClick={() => setScheduling(null)} aria-label="ปิดหน้าต่าง">✕</button>
            </div>

            <div className="assign">
              <div className="meta"><b>กำหนดส่ง:</b> {fmtDate(scheduling.due)} · {scheduling.dueLabel || ""}</div>
            </div>

            {/* Choose start slot */}
            <div className="plan-field">
              <label className="plan-label">ช่วงเวลาเริ่ม</label>
              <div className="slot-options">
                {plan.free.map((s, i) => {
                  const sel = chosenSlotStart !== null && i === 0 && Math.abs(chosenSlotStart - roundUp15(s.start)) < 0.01;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={"slot-chip" + (sel ? " on" : "")}
                      onClick={() => setChosenSlotStart(roundUp15(s.start))}
                    >
                      {fmtHour(roundUp15(s.start))}–{fmtHour(s.end)}
                    </button>
                  );
                })}
              </div>
              {chosenSlotStart === null && (
                <div className="plan-note">เลือกช่วงว่างข้างต้นก่อน</div>
              )}
            </div>

            {/* Choose duration (Pomodoro presets reused from /focus) */}
            <div className="plan-field">
              <label className="plan-label">ระยะเวลา (โฟกัส)</label>
              <div className="slot-options">
                {PLAN_DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={"slot-chip" + (chosenDur === d ? " on" : "")}
                    onClick={() => setChosenDur(d)}
                  >
                    Focus {d} นาที
                  </button>
                ))}
              </div>
            </div>

            <div className="plan-preview">
              {chosenSlotStart !== null ? (
                <>บล็อกใหม่: <b>{fmtHour(chosenSlotStart)}</b> – <b>{fmtHour(chosenSlotStart + chosenDur / 60)}</b> · {chosenDur} นาที</>
              ) : (
                <span className="plan-note">ยังไม่เลือกช่วงเวลา</span>
              )}
            </div>

            <div className="hide-actions">
              <button
                className="btn"
                disabled={chosenSlotStart === null}
                onClick={() => chosenSlotStart !== null && acceptBlock(scheduling, chosenSlotStart, chosenDur)}
              >
                ✅ ใช้ช่วงนี้
              </button>
              <button className="btn" onClick={() => setScheduling(null)}>ยกเลิก</button>
            </div>
            <p className="plan-tip">แผนจะบันทึกไว้เฉพาะเครื่องนี้ (ไม่ย้ายตารางของคุณ) — กดเสร็จแล้วเปิดโฟกัสจาก /today</p>
          </div>
        </div>
      )}
      {scheduling && plan.free.length === 0 && (
        <div className="err">วันนี้ไม่มีช่วงว่างเหลือหลังเวลาปัจจุบัน — เลือกจัดวันอื่นหรือใช้ /today ดูงานค้าง</div>
      )}

      {toast && (
        <div className={toastError ? "hide-toast err-toast" : "hide-toast"} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}

/* Raw assignment shape from assignments.json `todo[]` — mirrors /today's
   local Assignment so classifyAssignment + buildDailyPlan agree on it. This is
   the SOURCE for planning (via AssignmentLike), not a new data model. */
interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string | null;
  workType?: string;
  points?: number | null;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}