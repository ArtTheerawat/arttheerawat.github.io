"use client";

// app/analytics/page.tsx — PRODUCTIVITY ANALYTICS (SYSTEM 9)
//
// A personal statistics dashboard that READS existing data and CALCULATES
// deterministic numbers. It is NOT a source of truth and NEVER invents data
// or calls AI for metrics.
//
// Sources (identical to the rest of the hub):
//   • hiddenList (hidden_tasks) → durable task-completion history. reason
//     "already-submitted" = "งานเสร็จ/ส่งแล้ว" (the app's completion marker).
//   • public/data/assignments.json → current task state (overdue, buckets).
//
// Focus / Pomodoro / Stopwatch have NO persisted history (Focus Mode stores
// only current localStorage state), so those metrics are honestly reported as
// unavailable rather than fabricated as "0 hours".

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, Timer } from "lucide-react";
import { classifyAssignment, dataUrl, fmtDate, todayStr } from "@/lib/data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import { computeAnalytics, type AnalyticsAssignment } from "@/lib/analytics";

interface AssignmentData {
  todo?: AnalyticsAssignment[];
  updated?: string;
}

/** Format a friendly Thai duration-ish label for percent (e.g. 82%). */
function trendLabel(pct: number | null, dir: "up" | "down" | "flat" | "none"): string {
  if (dir === "none") return "ยังไม่มีข้อมูลเทียบสัปดาห์ก่อน";
  if (pct !== null) {
    const s = Math.abs(pct);
    return dir === "up" ? `↑ เพิ่มขึ้น ${s}%` : dir === "down" ? `↓ ลดลง ${s}%` : `→ ใกล้เคียงเดิม`;
  }
  // pct null but a real direction (e.g. 0 → N): no % but state a direction.
  return dir === "up" ? "↑ เพิ่มขึ้นจากสัปดาห์ก่อน" : "↓ ลดลงจากสัปดาห์ก่อน";
}

export default function AnalyticsPage() {
  const { hiddenList, status: hiddenStatus } = useHiddenTasks();
  const [assign, setAssign] = useState<AnalyticsAssignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Load current assignments (same fetch Home + /today use) so we can determine
  // the current overdue count from live data.
  const loadAssign = useCallback(async () => {
    try {
      const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j: AssignmentData = await r.json();
      const todo = (j.todo || []).map((a) => ({ ...a }));
      todo.forEach(classifyAssignment);
      setAssign(todo);
      setErr(null);
    } catch (e) {
      setErr("โหลดข้อมูลงานไม่ได้: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssign();
  }, [loadAssign]);

  // Recompute deterministic stats whenever either source changes. Pure + cheap.
  const stats = useMemo(() => {
    if (!assign) return null;
    return computeAnalytics(hiddenList, assign);
  }, [hiddenList, assign]);

  const pageLoading =
    loading || hiddenStatus === "loading" || (assign === null && !err);

  const hasCompletionHistory = (hiddenList || []).some((h) => h.reason === "already-submitted");

  return (
    <div className="wrap" id="main">
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
        <h1 className="sec-title" style={{ margin: 0 }}>
          <BarChart3 aria-hidden="true" /> สถิติการทำงาน
        </h1>
      </header>
      <p className="sub" style={{ marginBottom: 16 }}>
        คำนวณจากข้อมูลจริงของ TheeDeck · อัปเดตเมื่อ {fmtDate(todayStr())}
      </p>

      {/* ── Loading state ── */}
      {pageLoading && (
        <div className="src" role="status" aria-live="polite">
          กำลังโหลดสถิติ…
        </div>
      )}

      {/* ── Error state ── */}
      {!pageLoading && (err || hiddenStatus === "error") && (
        <div className="err" role="alert">
          ⚠{" "}
          {err ? `${err} — ` : ""}
          สถิติการทำงานโหลดข้อมูลไม่ครบ (
          {hiddenStatus === "error" ? "ไม่สามารถอ่านประวัติงานที่เสร็จได้" : "งานบางส่วนไม่พร้อมใช้งาน"}
          ) — ข้อมูลที่คำนวณได้อาจไม่สมบูรณ์
        </div>
      )}

      {/* ── Main dashboard ── */}
      {!pageLoading && stats && (
        <>
          {/* ── Stat cards (tasks) ── */}
          <section
            aria-label="สถิติงาน"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10,
              marginBottom: 18,
            }}
          >
            <div className="ts ts-blue">
              <b>{stats.completedThisWeek}</b>
              <span>งานที่เสร็จสัปดาห์นี้</span>
            </div>
            <div className="ts ts-cyan">
              <b>{stats.completedToday}</b>
              <span>เสร็จวันนี้</span>
            </div>
            <div className="ts" style={{ borderLeftColor: "var(--up)" }}>
              <b>{stats.onTimeRate !== null ? `${stats.onTimeRate}%` : "—"}</b>
              <span>ทำตรงเวลา</span>
            </div>
            <div className="ts ts-red">
              <b>{stats.overdueCount}</b>
              <span>งานค้าง (เลยกำหนด)</span>
            </div>
          </section>

          {/* ── Week comparison ── */}
          <section
            className="next-card"
            aria-label="เทียบสัปดาห์"
            style={{ display: "block" }}
          >
            <div className="next-ttl" style={{ fontSize: 15 }}>
              สัปดาห์นี้ vs สัปดาห์ก่อน
            </div>
            <div className="next-meta" style={{ marginTop: 8, gap: 10 }}>
              <span className="prio-rank-num" style={{ color: "var(--accent2)" }}>
                สัปดาห์นี้ {stats.completedThisWeek} งาน
              </span>
              <span className="prio-rank-num" style={{ color: "var(--muted)" }}>
                สัปดาห์ก่อน {stats.completedPrevWeek} งาน
              </span>
            </div>
            <div className="next-meta" style={{ marginTop: 10 }}>
              <span>
                {stats.completedTrend.comparable
                  ? trendLabel(stats.completedTrend.pct, stats.completedTrend.dir)
                  : "ยังไม่มีข้อมูลเพียงพอสำหรับเทียบสัปดาห์ก่อน"}
              </span>
            </div>
          </section>

          {/* ── Detail notes (data honesty) ── */}
          <section aria-label="รายละเอียดสถิติงาน">
            <h2 className="sec-title">รายละเอียดการคำนวณ</h2>
            <div className="next-card" style={{ display: "block", padding: "14px 18px" }}>
              <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: "var(--muted)", lineHeight: 1.8 }}>
                <li>
                  งานที่เสร็จ = งานที่คุณกด "ทำงานเสร็จแล้ว" (บันทึกในระบบ) นับตามวันที่ทำเสร็จในสัปดาห์นั้น
                </li>
                <li>
                  ทำตรงเวลา = ทำเสร็จภายในวันกำหนดส่ง ·{" "}
                  <b style={{ color: "var(--txt)" }}>
                    {stats.onTimeRate !== null
                      ? `${stats.onTimeCount}/${stats.onTimeBase} งาน`
                      : "ยังไม่มีข้อมูล"}
                  </b>
                </li>
                {stats.unmeasuredCompleted > 0 && (
                  <li style={{ color: "var(--warn)" }}>
                    อีก {stats.unmeasuredCompleted} งาน ไม่มีกำหนดส่งที่สมบูรณ์ จึงไม่นับในการคำนวณตรงเวลา
                  </li>
                )}
                <li>งานค้าง = งานที่เลยกำหนดส่งตามข้อมูลล่าสุดในคลาสรูม</li>
              </ul>
            </div>
          </section>

          {/* ── Focus / Pomodoro / Stopwatch (honest limitation) ── */}
          <section aria-label="เวลาโฟกัส">
            <h2 className="sec-title">
              <Timer aria-hidden="true" /> เวลาโฟกัส
            </h2>
            <div className="next-card empty focus-empty" style={{ display: "block", padding: "16px 18px" }}>
              <div className="next-ttl" style={{ fontSize: 15 }}>
                ยังไม่มีข้อมูลเวลาโฟกัสสะสม
              </div>
              <div className="next-meta" style={{ marginTop: 6, fontSize: 12.5 }}>
                Focus Mode จัดเก็บเฉพาะสถานะตัวจับเวลาปัจจุบัน (localStorage) ยังไม่ได้บันทึกประวัติช่วงโฟกัส /
                รอบ Pomodoro / เซสชัน Stopwatch ดังนั้นจึงไม่สามารถคำนวณเวลาโฟกัสย้อนหลังได้อย่างถูกต้อง
              </div>
              <div className="next-meta" style={{ marginTop: 10 }}>
                <Link href="/focus" className="next-go-btn" style={{ textDecoration: "none" }}>
                  → ไปโฟกัสงาน
                </Link>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── Empty / insufficient-data state (completed breakdowns with no history) ── */}
      {!pageLoading && assign && !hasCompletionHistory && stats && (
        <section className="src" role="status">
          ยังไม่มีข้อมูลงานที่ทำเสร็จในระบบ — เมื่องานแรกถูกบันทึกว่างานเสร็จ สถิติจะเริ่มสะสมที่นี่
        </section>
      )}
    </div>
  );
}