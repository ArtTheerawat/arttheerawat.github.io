"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dataUrl, thDate, thDayIdx } from "@/lib/data";
import { MAKEUP, SCHEDULE, courseDef } from "@/lib/schedule-data";

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

function fmt12(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? "PM" : "AM";
  const hr = ((hh + 11) % 12) + 1;
  return `${hr}:${String(mm).padStart(2, "0")} ${ap}`;
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
}

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [assignByCourse, setAssignByCourse] = useState<Record<string, AssignInfo[]>>({});
  const [detail, setDetail] = useState<{ code: string; name: string } | null>(null);
  const [synced, setSynced] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
  const weekNow = useCallback(() => setWeekStart(mondayOf(new Date())), []);

  const isThisWeek = useMemo(() => {
    const m = mondayOf(new Date());
    const mStart = m.getTime();
    const mEnd = mStart + 7 * 86400000;
    const ws = mondayOf(weekStart).getTime();
    return ws >= mStart && ws < mEnd;
  }, [weekStart]);

  const jd = thDayIdx(new Date()); // 1=Mon..7=Sun
  const showNow = isThisWeek;

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

  const openCourse = (code: string, name: string) => setDetail({ code, name });
  const closeDetail = () => setDetail(null);

  const course = detail ? courseDef(detail.code) : null;
  const assignments = detail ? assignByCourse[detail.code] || null : null;

  return (
    <div className="wrap">
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
        {synced && <div className="live" style={{ fontSize: 12, color: "var(--muted)" }}>ซิงก์ {synced}</div>}
      </header>

      {err && <div className="err">⚠ {err}</div>}

      <div className="legend">
        <span>
          <span className="sw" style={{ background: "var(--accent2)" }} />
          คาบประจำ
        </span>
        <span>
          <span className="sw" style={{ background: "#d946ef" }} />
          วิชาชดเชย / สอบ (จาก Calendar)
        </span>
      </div>

      <div className="weekbar">
        <button className="wbtn" onClick={() => shiftWeek(-1)} title="สัปดาห์ก่อนหน้า">◀</button>
        <div className="wlabel">{fmtWeekRange(weekStart)}</div>
        <button className="wbtn" onClick={() => shiftWeek(1)} title="สัปดาห์ถัดไป">▶</button>
        <button className="wbtn wnow" onClick={weekNow}>สัปดาห์นี้</button>
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
                      <td
                        key={si}
                        colSpan={span}
                        className="cl overlay"
                        style={{ borderLeftColor: "#d946ef", background: shade("#d946ef") }}
                        onClick={() => openCourse(code, cd.name)}
                      >
                        <div className="nm">{cd.name}</div>
                        <div className="rm">
                          {s.room} · {s.group} ({s.kind})
                        </div>
                        <div className="tm">
                          {fmt12(s.start || 0)}–{fmt12(s.end || 0)}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={si}
                      colSpan={span}
                      className="cl"
                      style={{ borderLeftColor: cd.color, background: shade(cd.color) }}
                      onClick={() => openCourse(code, cd.name)}
                    >
                      <div className="nm">{cd.name}</div>
                      <div className="rm">{s.room}</div>
                      <div className="tm">
                        {fmt12(s.start || 0)}–{fmt12(s.end || 0)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && course && (
        <div className="detail-modal open" onClick={(e) => e.target === e.currentTarget && closeDetail()}>
          <div className="sheet">
            <div className="hh">
              <div>
                <h2 style={{ color: course.color }}>{detail.name}</h2>
                <div className="when">รหัส {detail.code}</div>
              </div>
              <button className="close" onClick={closeDetail}>✕</button>
            </div>
            {assignments && assignments.length ? (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 6px" }}>
                  งานที่ต้องส่ง ({assignments.length} รายการ)
                </div>
                {assignments.map((a, i) => {
                  const overdue = a.overdue ?? 0;
                  const bd = overdue > 0 ? "b-over" : overdue === 0 ? "b-today" : "b-soon";
                  const bl =
                    overdue > 0
                      ? "เลยกำหนด " + overdue + " วัน"
                      : overdue === 0
                        ? "ครบวันนี้"
                        : "ครบใน " + overdue + " วัน";
                  return (
                    <div className="assign" key={i}>
                      <div className="ttl">{a.title}</div>
                      <div className="meta">
                        ครบ <b>{a.due}</b> · <span className={"badge " + bd}>{bl}</span>
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
    </div>
  );
}