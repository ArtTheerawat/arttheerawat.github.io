"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyAssignment, dataUrl, dueLabel, fmt24, fmtDate, nowBKK, thDate, thDayIdx, type Bucket } from "@/lib/data";
import { MAKEUP, SCHEDULE, courseDef } from "@/lib/schedule-data";
import { taskKey, useHiddenTasks } from "@/lib/hidden-tasks";
import { HideButton, useModalFocusTrap } from "@/components/HiddenTasks";

const DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const HH0 = 8;
const HH1 = 19; // range 08:00–19:00

// A session cell in the schedule (regular class or makeup). Loose shape so both
// SCHEDULE (Session) and MAKEUP (Makeup) entries fit through the same renderer.
interface SessionLike {
  code?: string;
  room?: string;
  start?: number;
  end?: number;
  group?: string;
  kind?: string;
}

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  m.setHours(0, 0, 0, 0);
  return m;
}

function fmtWeekRange(weekStart: Date): string {
  const a = weekStart;
  const b = new Date(a);
  b.setDate(a.getDate() + 6);
  const da = thDate(a);
  const db = thDate(b);
  if (da.m === db.m) return `${da.d}/${da.m}/${da.y} - ${db.d}/${db.m}/${db.y}`;
  return `${da.d}/${da.m} - ${db.d}/${db.m}/${db.y}`;
}

function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},.14)`;
}

function halfIndex(h: number) {
  return h - HH0;
}
function spanHours(start: number, end: number) {
  return Math.max(1, Math.round(end - start));
}

interface AssignInfo {
  title?: string;
  due?: string;
  overdue?: number;
  bucket?: Bucket;
  daysAway?: number;
}

// Calendar overlay items (from /data/schedule.json, written by school_sync).
interface CalEvent {
  date: string;
  summary?: string;
  start?: number;
  end?: number;
}

// A Calendar event/quizzes entry that falls inside the viewed week.
interface WeekEvent {
  key: string;
  date: string;
  dayIdx: number; // 1=Mon..7=Sun
  label: string;
  time?: string;
  kind: "quiz" | "event";
  startH?: number;
  endH?: number;
}

// Calendar events may cross midnight (end > 24). Split into per-day segments so
// the time label stays human ("23:58–00:58" instead of "23:58–24:58").
function eventSegments(ev: CalEvent): Array<{ date: string; startH: number; endH: number }> {
  const s = Math.max(0, ev.start ?? 0);
  const rawEnd = ev.end ?? s + 1;
  if (rawEnd <= 24) return [{ date: ev.date, startH: s, endH: rawEnd }];
  const firstEnd = Math.min(rawEnd, 24);
  const segs = [{ date: ev.date, startH: s, endH: firstEnd }];
  if (rawEnd > 24) segs.push({ date: nextIsoDay(ev.date), startH: 0, endH: rawEnd - 24 });
  return segs;
}

function nextIsoDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(nowBKK()));
  const [assignByCourse, setAssignByCourse] = useState<Record<string, AssignInfo[]>>({});
  const [detail, setDetail] = useState<{ code: string; name: string } | null>(null);
  const [synced, setSynced] = useState("");
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [quizzes, setQuizzes] = useState<Array<{ date: string; summary?: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [mobileDay, setMobileDay] = useState<number>(() => thDayIdx(nowBKK()));
  const mobDaysRef = useRef<HTMLDivElement | null>(null);
  const [mobDaysMore, setMobDaysMore] = useState(false);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);
    const detailModalRef = useRef<HTMLDivElement | null>(null);
    const detailTrapKeyDown = useModalFocusTrap(detailModalRef);
  const [toast, setToast] = useState<string | null>(null);
    const { hiddenList, hide, canEdit } = useHiddenTasks();

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  };

  const openCourse = useCallback((code: string, name: string) => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    setDetail({ code, name });
  }, []);

  const closeDetail = useCallback(() => {
    setDetail(null);
    // Return focus to whichever element opened the modal.
    requestAnimationFrame(() => lastFocusedRef.current?.focus?.());
  }, []);

  // Modal keyboard handling: Esc closes, focus moves into the dialog, and is restored on close.
  useEffect(() => {
    if (!detail) return;
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail, closeDetail]);

  useEffect(() => {
    (async () => {
      try {
        const ev = await fetch(dataUrl("/data/schedule.json"), { cache: "no-store" });
        if (ev.ok) {
          const d = await ev.json();
          if (d.updated) {
            const dt = new Date(d.updated);
            setSynced(
              dt.toLocaleString("th-TH", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            );
          }
          setCalEvents(Array.isArray(d.events) ? d.events : []);
          setQuizzes(Array.isArray(d.quizzes) ? d.quizzes : []);
        }
      } catch (e) {
        setErr("overlay Calendar ใช้ไม่ได้: " + (e instanceof Error ? e.message : String(e)));
      }
      try {
        const ap = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
        if (ap.ok) {
          const j = await ap.json();
          setAssignByCourse(j.byCourse || {});
        }
      } catch {
        /* optional */
      }
    })();
  }, []);

  const shiftWeek = useCallback(
    (dir: number) => setWeekStart((w) => mondayOf(new Date(w.getTime() + dir * 7 * 86400000))),
    []
  );
  const weekNow = useCallback(() => setWeekStart(mondayOf(nowBKK())), []);

  // Mobile day-chips: show a right-edge fade only while the row overflows.
  const measureMobDays = useCallback(() => {
    const el = mobDaysRef.current;
    if (!el) return;
    setMobDaysMore(el.scrollWidth > el.clientWidth + 4);
  }, []);
  useEffect(() => {
    measureMobDays();
    window.addEventListener("resize", measureMobDays);
    return () => window.removeEventListener("resize", measureMobDays);
  }, [measureMobDays]);

  const isThisWeek = useMemo(() => {
      const m = mondayOf(nowBKK());
      const mStart = m.getTime();
      const mEnd = mStart + 7 * 86400000;
      const ws = mondayOf(weekStart).getTime();
      return ws >= mStart && ws < mEnd;
    }, [weekStart]);

    const jd = thDayIdx(nowBKK()); // 1=Mon..7=Sun
  const showNow = isThisWeek;

  // Calendar items (events + quizzes) that fall inside the viewed week —
  // deterministic filter, no AI. Cross-midnight events are split per day.
  const weekEvents = useMemo<WeekEvent[]>(() => {
    const wStart = mondayOf(weekStart).getTime();
    const wEnd = wStart + 7 * 86400000;
    const out: WeekEvent[] = [];
    const pushSeg = (date: string, label: string, kind: WeekEvent["kind"], startH?: number, endH?: number) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      if (!m) return;
      const dn = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
      if (dn < wStart || dn >= wEnd) return;
      const dayIdx = (new Date(dn).getDay() + 6) % 7 + 1;
      out.push({
        key: `${kind}|${date}|${label}|${startH ?? ""}`,
        date,
        dayIdx,
        label,
        time: startH !== undefined && endH !== undefined ? `${fmt24(startH)}–${fmt24(endH)}` : undefined,
        kind,
        startH,
        endH,
      });
    };
    quizzes.forEach((q) => pushSeg(q.date, q.summary || "สอบ", "quiz"));
    calEvents.forEach((ev) =>
      eventSegments(ev).forEach((seg) => pushSeg(seg.date, ev.summary || "กิจกรรม", "event", seg.startH, seg.endH))
    );
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.startH ?? 0) - (b.startH ?? 0)));
  }, [weekStart, calEvents, quizzes]);
  const hasWeekEvents = weekEvents.length > 0;

  const rows = useMemo(() => {
    const totalHalf = HH1 - HH0; // 11
    return DAYS.map((dn, i) => {
      const day = i + 1;
      const isToday = showNow && day === jd;
      const cells = new Array(totalHalf).fill(null) as Array<{
        startH: number;
        span: number;
        s: SessionLike;
        isMakeup?: boolean;
      } | null>;

      SCHEDULE.filter((s) => s.day === day)
        .sort((a, b) => a.start - b.start)
        .forEach((s) => {
          const startH = halfIndex(s.start);
          const span = spanHours(s.start, s.end);
          cells[startH] = { startH, span, s };
        });

      MAKEUP.forEach((m) => {
        const dm = new Date(m.date + "T00:00:00");
        const md = thDayIdx(dm);
        const wStart = mondayOf(weekStart);
        const wEnd = new Date(wStart.getTime() + 7 * 86400000);
        const dn2 = new Date(dm.getFullYear(), dm.getMonth(), dm.getDate()).getTime();
        const ws = mondayOf(weekStart).getTime();
        if (md === day && dn2 >= ws && dn2 < wEnd.getTime()) {
          const startH = halfIndex(m.start);
          const span = spanHours(m.start, m.end);
          if (startH >= 0 && startH + span <= totalHalf)
            cells[startH] = { startH, span, s: m as SessionLike, isMakeup: true };
        }
      });

      const segs: Array<{
        type: "gap" | "mk" | "cl";
        it?: { startH: number; span: number; s: SessionLike; isMakeup?: boolean };
      }> = [];
      for (let c = 0; c < totalHalf; c++) {
        const it = cells[c];
        if (it) {
          segs.push({ type: it.isMakeup ? "mk" : "cl", it });
          c += it.span - 1;
        } else {
          segs.push({ type: "gap" });
        }
      }

      return { day, dn, isToday, segs };
    });
  }, [weekStart, showNow, jd]);

  const course = detail ? courseDef(detail.code) : null;
  const assignments = detail
        ? (assignByCourse[detail.code] || null)?.filter(
            (a) => !hiddenList.some((h) => h.key === taskKey({ course: detail.code, title: a.title, due: a.due }))
          )
        : null;

  return (
    <div className="wrap" id="main">
      <header>
        <div>
          <h1>
            ตาราง<span className="dot">เรียน</span>
          </h1>
          <div className="sub" id="sub" style={{ marginTop: 8 }}>
            {(() => {
              const tc = SCHEDULE.filter((s) => s.day === jd);
              if (tc.length) {
                return `วันนี้ (${DAYS[jd - 1]}) มี ${tc.length} คาบ: ${tc
                  .map((s) => courseDef(s.code).name)
                  .join(" · ")}`;
              }
              return `วันนี้ (${DAYS[jd - 1]}) ไม่มีคาบเรียน`;
            })()}
          </div>
        </div>
        {synced && <div className="live" style={{ fontSize: 12, color: "var(--muted)" }}>ข้อมูลล่าสุด {synced}</div>}
      </header>

      {err && <div className="err">⚠ {err}</div>}

      <div className="legend">
        <span>
          <span className="sw" style={{ background: "var(--accent2)" }} />
          คาบประจำ
        </span>
        <span>
          <span className="sw" style={{ background: "#d946ef" }} />
          คาบชดเชย (ตาราง MAKEUP) · สอบ/กิจกรรม (จาก Calendar)
        </span>
      </div>

      <div className="weekbar">
        <button className="wbtn" onClick={() => shiftWeek(-1)} title="สัปดาห์ก่อนหน้า">◀</button>
        <div className="wlabel">{fmtWeekRange(weekStart)}</div>
        <button className="wbtn" onClick={() => shiftWeek(1)} title="สัปดาห์ถัดไป">▶</button>
        <button className="wbtn wnow" onClick={weekNow}>สัปดาห์นี้</button>
      </div>

      {hasWeekEvents && (
        <div className="calev-card" role="list" aria-label="สอบและกิจกรรมของสัปดาห์นี้">
          <div className="calev-head">🗓 สอบ/กิจกรรมของสัปดาห์นี้ (จาก Calendar)</div>
          {weekEvents.map((ev) => (
            <div className="calev-item" key={ev.key} role="listitem">
              <span className={"calev-badge" + (ev.kind === "quiz" ? " calev-quiz" : "")}>
                {ev.kind === "quiz" ? "สอบ" : ev.label.startsWith("Assignment") ? "งานส่ง" : "กิจกรรม"}
              </span>
              <span className="calev-date">{fmtDate(ev.date)}</span>
              {ev.time && <span className="calev-time">{ev.time}</span>}
              <span className="calev-label">{ev.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Mobile: pick a day, show that day's periods as stacked cards ── */}
      <div className="mob-container">
        <div className={"mob-days" + (mobDaysMore ? " has-more" : "")} ref={mobDaysRef} role="tablist" aria-label="เลือกวัน">
          {rows.map((r) => {
            const has = r.segs.some((s) => s.type !== "gap");
            return (
              <button
                key={r.day}
                type="button"
                role="tab"
                aria-selected={mobileDay === r.day}
                className={"mob-day" + (mobileDay === r.day ? " active" : "") + (r.isToday ? " today" : "")}
                onClick={() => setMobileDay(r.day)}
              >
                {r.dn.slice(0, 3)}
                {r.isToday && <span className="dot2" />}
                {!has && <span className="none">–</span>}
              </button>
            );
          })}
        </div>
        <div className="mob-list">
          {(() => {
            const row = rows.find((r) => r.day === mobileDay) || rows[0];
            const items = row.segs.filter((s) => s.type !== "gap");
            if (!items.length) {
              return <div className="empty">{mobileDay === jd ? "วันนี้" : DAYS[mobileDay - 1]}ไม่มีคาบเรียน 🎉</div>;
            }
            return items.map((seg, i2) => {
              const s = (seg.it?.s || {}) as SessionLike;
              const code = s.code || "";
              const cd = courseDef(code);
              const isMk = seg.type === "mk";
              return (
                <button
                  key={i2}
                  type="button"
                  className="mob-card"
                  onClick={() => openCourse(code, cd.name)}
                  style={{ borderLeftColor: isMk ? "#d946ef" : cd.color }}
                >
                  <div className="mob-time">{fmt24(s.start || 0)}–{fmt24(s.end || 0)}</div>
                  <div className="mob-nm" style={{ color: isMk ? "#d946ef" : cd.color }}>{cd.name}</div>
                  <div className="mob-rm">
                    {s.room}
                    {s.group ? ` · ${s.group}` : ""}
                    {isMk ? ` · ${s.kind || "ชดเชย"}` : ""}
                  </div>
                </button>
              );
            });
          })()}
        </div>
      </div>

      <div className="tblwrap">
        <table className="sched">
          <thead>
            <tr>
              <th className="dayh">Day/Time</th>
              {Array.from({ length: HH1 - HH0 }, (_, h) => (
                <th className="hh" key={h}>
                  {String(HH0 + h).padStart(2, "0")}:00-{String(HH0 + h + 1).padStart(2, "0")}:00
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td className={"dname" + (r.isToday ? " today" : "")}>{r.dn}</td>
                {r.segs.map((seg, si) => {
                  if (seg.type === "gap") return <td className="cell" key={si} />;
                  const s = (seg.it?.s || {}) as SessionLike;
                  const code = s.code || "";
                  const cd = courseDef(code);
                  const span = seg.it?.span || 1;
                  if (seg.type === "mk") {
                    return (
                      <td key={si} colSpan={span} className="cl overlay" style={{ borderLeftColor: "#d946ef", background: shade("#d946ef") }}>
                        <button
                          type="button"
                          className="cl-btn"
                          onClick={() => openCourse(code, cd.name)}
                          aria-label={`เปิดรายละเอียด ${cd.name}${s.room ? " ห้อง " + s.room : ""}`}
                        >
                          <span className="nm">{cd.name}</span>
                          <span className="rm">
                            {s.room} · {s.group} ({s.kind})
                          </span>
                          <span className="tm">
                            {fmt24(s.start || 0)}–{fmt24(s.end || 0)}
                          </span>
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={si} colSpan={span} className="cl" style={{ borderLeftColor: cd.color, background: shade(cd.color) }}>
                      <button
                        type="button"
                        className="cl-btn"
                        onClick={() => openCourse(code, cd.name)}
                        aria-label={`เปิดรายละเอียด ${cd.name}${s.room ? " ห้อง " + s.room : ""}`}
                      >
                        <span className="nm">{cd.name}</span>
                        <span className="rm">{s.room}</span>
                        <span className="tm">
                          {fmt24(s.start || 0)}–{fmt24(s.end || 0)}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && course && (
              <div
                ref={detailModalRef}
                onKeyDown={detailTrapKeyDown}
                className="detail-modal open"
                role="dialog"
                aria-modal="true"
                aria-labelledby="sched-detail-title"
                onClick={(e) => e.target === e.currentTarget && closeDetail()}
              >
          <div className="sheet">
            <div className="hh">
              <div>
                <h2 id="sched-detail-title" style={{ color: course.color }}>{detail.name}</h2>
                <div className="when">รหัส {detail.code}</div>
              </div>
              <button className="close" ref={closeBtnRef} onClick={closeDetail} aria-label="ปิดหน้าต่าง">✕</button>
            </div>
            {assignments && assignments.length ? (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 6px" }}>
                  งานที่ต้องส่ง ({assignments.length} รายการ)
                </div>
                {assignments.map((a, i) => {
                  classifyAssignment(a);
                  const b = dueLabel(a);
                  return (
                    <div className="assign" key={i}>
                      <div className="ttl">{a.title}</div>
                      <div className="meta">
                                              ครบ <b>{a.due ? fmtDate(a.due) : "—"}</b> · <span className={"badge " + b.cls}>{b.txt}</span>
                                            </div>
                      <div style={{ marginTop: 8 }}>
                        <HideButton
                                                  assignment={a}
                                                  canEdit={canEdit}
                                                  onHide={async (r, c) => {
                                                                                                      const ok = await hide(a, r, c);
                                                                                                      if (ok) showToast(`ซ่อน "${a.title}" แล้ว 🙈`);
                                                                                                      else showToast("ซ่อนงานไม่สำเร็จ — ล็อกอินอยู่ไหม? ลองอีกครั้ง");
                                                                                                    }}
                                                />
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="empty">ไม่มีงานค้างในวิชานี้ เก่งมาก 👍</div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="hide-toast">{toast}</div>}
    </div>
  );
}