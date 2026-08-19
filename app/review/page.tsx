"use client";

// app/review/page.tsx — SYSTEM 11: EVENING REVIEW.
//
// A calm, concise end-of-day recap of what really happened today, built
// deterministically from the SAME durable sources the rest of the hub reads:
//   • hidden_tasks (completion record, hiddenAt bucketed by Bangkok day)
//   • assignments.json todo[] (live task state, classified)
//   • lib/plan.loadPlan(today) (accepted time blocks)
//   • lib/priority.computeNextAction (reused verbatim for "พรุ่งนี้ควรเริ่ม")
//
// Focus / Pomodoro / Stopwatch have NO persisted session history (the Focus
// page stores only live timer state), so those metrics are honestly presented
// as "ยังไม่มีข้อมูล" rather than fabricated as zero. No AI call at all.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Moon, CheckCircle2, Clock, ListTodo, Sparkles } from "lucide-react";
import { classifyAssignment, dataUrl, fmtDate, nowBKKHour, todayStr, type Bucket } from "@/lib/data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import { loadPlan } from "@/lib/plan";
import { computeReview, type ReviewAssignment, type ReviewFact } from "@/lib/review";
import { findMissedBlocks } from "@/lib/reschedule";

interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  workType?: string;
  points?: number | null;
  bucket?: Bucket;
}
interface Quiz { date?: string; summary?: string }
interface SchedData { events?: unknown[]; quizzes?: Quiz[]; updated?: string }

export default function ReviewPage() {
  const { hiddenList, status: hiddenStatus } = useHiddenTasks();
  const [assign, setAssign] = useState<ReviewAssignment[] | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Anchor the review to TODAY in Bangkok time. Recomputing on render keeps a
  // midnight/pass-day transition from ever showing yesterday as today.
  const today = todayStr();

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j: { todo?: Assignment[]; updated?: string } = await r.json();
      const todo = (j.todo || []).map((a) => ({ ...a }));
      todo.forEach(classifyAssignment);
      setAssign(todo);
    } catch (e) {
      setErr("โหลดข้อมูลงานไม่ได้: " + (e instanceof Error ? e.message : String(e)));
    }
    try {
      const q = await fetch(dataUrl("/data/schedule.json"), { cache: "no-store" });
      if (q.ok) {
        const qj: SchedData = await q.json();
        setQuizzes(qj.quizzes || []);
      }
    } catch {
      /* quizzes optional — Next Action still works without them */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const fact: ReviewFact | null = useMemo(() => {
    if (!assign) return null;
    return computeReview(hiddenList, assign, quizzes, [], today);
  }, [assign, hiddenList, quizzes, today]);

  // Smart Reschedule (SYSTEM 12): how many of today's accepted plan blocks have
  // ALREADY PASSED but whose task is still active. Missed ≠ overdue here too —
  // this is only the plan-vs-actual note, and it never labels a lapsed or
  // rescheduled block as "failed" (see lib/review.ts plan logic).
  const missedToday = useMemo(() => {
    const hiddenKeys = new Set(hiddenList.map((h) => h.key));
    return findMissedBlocks(loadPlan(today), hiddenKeys, nowBKKHour()).length;
  }, [hiddenList, today]);

  const loadingReview = loading || hiddenStatus === "loading";

  return (
    <main className="app-main">
      <div className="page-wrap">
        <header className="today-head">
          <div>
            <h1>
              สรุป<span className="dot">วันนี้</span> 🌙
            </h1>
            <div className="dayhead">
              <div className="sub">วันที่ {fmtDate(today)} · สรุปตอนเย็น</div>
            </div>
          </div>
        </header>

        {loadingReview && (
          <div className="src" role="status" aria-live="polite">
            กำลังสรุปวันนี้…
          </div>
        )}

        {err && (
          <div className="err">
            {err}
            <button className="retry-btn" onClick={() => void loadData()}>ลองใหม่</button>
          </div>
        )}

        {!loadingReview && !err && fact && (
          <>
            {/* ── 1. Today summary (headline metrics) ── */}
            <section className="cards-sec" aria-label="สรุปวันนี้">
              <h2>
                <Moon aria-hidden="true" /> ภาพรวมวันนี้
              </h2>
              <div className="counts">
                <div className="c">
                  <b style={{ color: "var(--up)" }}>{fact.completedToday}</b> งานที่เสร็จ
                </div>
                <div className="c">
                  <b style={{ color: "var(--accent2)" }}>{fact.remaining.length}</b> งานที่ยังค้าง
                </div>
                <div className="c">
                  <b style={{ color: "var(--down)" }}>{fact.overdueCount}</b> งาน overdue
                </div>
              </div>
              {fact.plan.hasData && (
                <p className="review-note">
                  มีช่วงเวลาที่วางแผนไว้ {fact.plan.planned} ช่วง · ทำเสร็จแล้ว {fact.plan.completed} ช่วง ·
                  ยังค้าง {fact.plan.remaining} ช่วง
                </p>
              )}
              {missedToday > 0 && (
                <p className="review-note warn">
                  มีช่วงเวลาที่พลาดไป {missedToday} ช่วง —{" "}
                  <Link href="/today" className="rn-link" style={{ display: "inline", marginTop: 0 }}>
                    จัดเวลาใหม่ใน /today
                  </Link>
                </p>
              )}
            </section>

            {/* ── 2. What was completed ── */}
            <section className="cards-sec" aria-label="งานที่เสร็จ">
              <h2>
                <CheckCircle2 aria-hidden="true" /> งานที่เสร็จ
                <span className="tag">{fact.completedToday}</span>
              </h2>
              {fact.completedToday === 0 ? (
                <div className="review-empty">วันนี้ยังไม่มีงานที่บันทึกว่าเสร็จ</div>
              ) : (
                <ul className="review-list">
                  {fact.completed.map((c) => (
                    <li key={c.key} className="review-li done">
                      <span className="rl-ico">✅</span>
                      <span className="rl-txt">
                        <b>{c.title}</b>
                        <span className="rl-sub">{c.courseName}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── 3. What remains (incl. overdue) ── */}
            <section className="cards-sec" aria-label="งานที่ยังเหลือ">
              <h2>
                <ListTodo aria-hidden="true" /> งานที่ยังเหลือ
                <span className="tag">{fact.remaining.length}</span>
              </h2>
              {fact.remaining.length === 0 ? (
                <div className="review-empty">วันนี้ไม่มีงานค้าง</div>
              ) : (
                <ul className="review-list">
                  {fact.remaining.map((r) => (
                    <li key={r.key} className={"review-li" + (r.overdue ? " over" : "")}>
                      <span className="rl-ico">{r.overdue ? "⚠️" : "⏳"}</span>
                      <span className="rl-txt">
                        <b>{r.title}</b>
                        <span className="rl-sub">
                          {r.courseName}
                          {r.overdue ? " · เลยกำหนดส่งแล้ว" : r.due ? ` · ส่ง ${fmtDate(r.due)}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {fact.overdueCount > 0 && (
                <p className="review-note warn">
                  มีงานที่เลยกำหนดส่งอยู่ {fact.overdueCount} งาน ควรจัดลำดับทำก่อน
                </p>
              )}
            </section>

            {/* ── 4. Focus / Pomodoro: honestly unavailable ── */}
            <section className="cards-sec" aria-label="เวลาโฟกัส">
              <h2>
                <Clock aria-hidden="true" /> เวลาโฟกัส
              </h2>
              <div className="review-empty">
                ยังไม่มีข้อมูลเวลาโฟกัสสำหรับวันนี้
                <br />
                <span className="review-hint">
                  Focus Mode จัดเก็บเฉพาะสถานะตัวจับเวลาปัจจุบัน ยังไม่ได้บันทึกประวัติช่วงโฟกัส /
                Pomodoro รอบ จนกว่าจะมีข้อมูลจริงจึงจะแสดงผล
                </span>
              </div>
            </section>

            {/* ── 5. Tomorrow / Next Action (reused deterministic engine) ── */}
            <section className="cards-sec" aria-label="พรุ่งนี้ควรเริ่ม">
              <h2>
                <ArrowRight aria-hidden="true" /> พรุ่งนี้ควรเริ่ม
              </h2>
              {fact.nextActionState === "idle" || !fact.next ? (
                <div className="review-empty">ยังไม่มีงานที่ต้องทำต่อในตอนนี้</div>
              ) : (
                <div className="review-next">
                  <div className="rn-head">
                    <b>{fact.next.title}</b>
                    {fact.next.dueLabel && <span className="rn-due">{fact.next.dueLabel}</span>}
                  </div>
                  <div className="rn-reasons">
                    {fact.next.reasons.slice(0, 3).map((r, i) => (
                      <span key={i} className="rn-reason">{r}</span>
                    ))}
                  </div>
                  <Link href="/today" className="rn-link">
                    ดูในงานวันนี้ <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── 6. Optional personal note ── */}
        <section className="cards-sec" aria-label="บันทึกวันนี้">
          <h2>
            <Sparkles aria-hidden="true" /> บันทึกวันนี้
          </h2>
          <p className="review-note">
            ระบบยังไม่ได้จัดเก็บโน้ตส่วนตัวรายวัน รออัปเดตในรุ่นถัดไป
          </p>
        </section>
      </div>
    </main>
  );
}