"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  classifyAssignment,
  dueLabel,
  fmtDate,
  todayLabelBKK,
  todayStr,
  type Bucket,
} from "@/lib/data";
import type { Coursework, Announcement } from "@/lib/db/types";
import { loadClassroom } from "@/lib/services/classroom-service";
import { useHiddenTasks, taskKey, type Hiddenable } from "@/lib/hidden-tasks";
import { HideButton } from "@/components/HiddenTasks";

interface Course {
  name?: string;
  id?: string;
  coursework?: Coursework[];
  announcements?: Announcement[];
}

interface FlatTask extends Coursework {
  courseName: string;
  /** Course code/name used as the hide-task key (matches Hiddenable.course). */
  course?: string;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}

function fmtSync(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ClassroomPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [synced, setSynced] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgErr, setMsgErr] = useState(false);

  // Global hidden-task set (shared with Home//today//schedule). Gives the page
  // the "ซ่อนงานนี้?" button (teacher set wrong due / already submitted, etc.)
  // and cross-device persistence via Supabase.
  const { hiddenList, hide, canEdit } = useHiddenTasks();

  const handleHide = (a: Hiddenable, reason: string, custom?: string) => {
    hide(a, reason, custom).then((res) => {
      setMsgErr(!res.ok);
      setMsg(
        res.ok
          ? `ซ่อน "${a.title}" แล้ว 🙈`
          : `ซ่อนไม่สำเร็จ — ${res.error || "ยังไม่มีสิทธิ์ (ต้องการบัญชีเจ้าของ theerawat.numtang@gmail.com)"}`
      );
      window.setTimeout(() => setMsg(null), 2600);
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const result = await loadClassroom();
      setCourses((result.courses as Course[]) || []);
      setSynced(result.synced);
      setErr(result.error);
    } catch (e) {
      // loadClassroom already catches its own errors, but guard anyway.
      setCourses([]);
      setSynced("");
      setErr("โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every min
    return () => clearInterval(t);
  }, [load]);

  // Flatten all coursework into assignments, attach course name + classify.
  const all = useMemo(() => {
    const out: FlatTask[] = [];
    for (const c of courses) {
      const cname = c.name || c.id || "";
      for (const cw of c.coursework || []) {
        const t: FlatTask = { ...cw, courseName: cname, course: cname, courseId: c.id };
        classifyAssignment(t);
        out.push(t);
      }
    }
    return out;
  }, [courses]);

  // Drop un-published, tasks the user already hidden, and tasks already turned
  // in (a completed assignment is not something to remind about — before this
  // the page showed "ส่งแล้ว" work as still pending because classroom_sync.py
  // never fetched submission state).
  const visible = useMemo(
    () =>
      all.filter((a) => {
        if (a.state === "DRAFT") return false;
        const key = taskKey(a);
        if (hiddenList.some((h) => h.key === key)) return false;
        return !a.submitted; // hide already-turned-in work from pending buckets
      }),
    [all, hiddenList]
  );

  const buckets = useMemo(() => {
    const map: Record<string, FlatTask[]> = { over: [], today: [], soon: [], later: [], no_due: [] };
    for (const a of visible) if (a.bucket) map[a.bucket].push(a);
    for (const k of Object.keys(map)) map[k].sort((a, b) => (a.due || "").localeCompare(b.due || ""));
    return map;
  }, [visible]);

  const now = todayStr();
  const dayLabel = todayLabelBKK();

  const Section = ({
    label,
    items,
    tone,
  }: {
    label: string;
    items: FlatTask[];
    tone?: string;
  }) =>
    items.length ? (
      <div className="grp" style={{ marginTop: 8 }}>
        <h2>
          {label} <span className="cnt">{items.length}</span>
        </h2>
        {items.map((a, i) => {
          const b = dueLabel(a);
          return (
            <div className="item" key={a.id || i} style={{ borderLeftColor: tone }}>
              <div className="pd">
                <span className={"badge " + b.cls}>{b.txt}</span>
                <span>⏰ {fmtDate(a.due)}</span>
                {a.dueTime && <span>· {a.dueTime}</span>}
              </div>
              <div className="ttl" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ minWidth: 0 }}>{a.title}</span>
                <HideButton
                  assignment={a}
                  canEdit={canEdit}
                  onHide={(r, c) => handleHide(a, r, c)}
                />
              </div>
              <div className="subj">{a.courseName}</div>
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="wrap" id="main">
      <header>
        <div>
          <h1>
            คลาส<span className="dot">รูม</span>
          </h1>
          <div className="sub">
            งานมอบหมาย + ประกาศ จาก Google Classroom · {dayLabel} {now}
          </div>
        </div>
        {synced && <div style={{ fontSize: 12, color: "var(--muted)" }}>ซิงก์ {fmtSync(synced)}</div>}
      </header>

      {msg && (
        <div className={msgErr ? "hide-toast err-toast" : "hide-toast"} role="status" aria-live="polite">
          {msg}
        </div>
      )}

      {err && <div className="err">⚠ {err}</div>}
      {loading && !err && (
        <div className="src" role="status" aria-live="polite">
          กำลังโหลดข้อมูลคลาสรูม…
        </div>
      )}

      {!loading && !err && (
        <div className="counts">
          <div className="c">
            <b className="down" style={{ color: "var(--down)" }}>{buckets.over.length}</b>
            เลยกำหนด
          </div>
          <div className="c">
            <b style={{ color: "var(--warn)" }}>{buckets.today.length}</b>
            ครบวันนี้
          </div>
          <div className="c">
            <b style={{ color: "var(--accent2)" }}>{buckets.soon.length}</b>
            ใกล้ถึง (5 วัน)
          </div>
        </div>
      )}

      {!loading && !err && (
        <>
          <Section label="🔴 เลยกำหนด ต้องรีบทำ" items={buckets.over} tone="var(--down)" />
          <Section label="⏳ ครบกำหนดวันนี้" items={buckets.today} tone="var(--warn)" />
          <Section label="🟣 ใกล้ถึง (5 วัน)" items={buckets.soon} tone="var(--accent2)" />

          {buckets.later.length > 0 && (
            <div className="grp" style={{ marginTop: 8 }}>
              <h2>
                📅 อีกไกล <span className="cnt">{buckets.later.length}</span>
              </h2>
              <button className="togglenext" onClick={() => setShowLater((s) => !s)}>
                {showLater ? "ซ่อนงานที่ยังอีกไกล ▲" : `แสดงงานที่ยังอีกไกล (${buckets.later.length}) ▼`}
              </button>
              {showLater && (
                <div>
                  {buckets.later.map((a, i) => {
                    const d = Math.round(
                      (new Date((a.due || "") + "T00:00:00").getTime() -
                        new Date(now + "T00:00:00").getTime()) /
                        86400000
                    );
                    return (
                      <div className="item" key={a.id || i}>
                        <div className="pd">
                          <span className="badge b-soon">ครบใน {d} วัน</span>
                          <span>⏰ {fmtDate(a.due)}</span>
                        </div>
                        <div className="ttl" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                          <span style={{ minWidth: 0 }}>{a.title}</span>
                          <HideButton
                            assignment={a}
                            canEdit={canEdit}
                            onHide={(r, c) => handleHide(a, r, c)}
                          />
                        </div>
                        <div className="subj">{a.courseName}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {!err && !buckets.over.length && !buckets.today.length && !buckets.soon.length && (
            <div className="cards-sec" style={{ textAlign: "center", padding: 34 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
              <div style={{ color: "var(--muted)" }}>ไม่มีงานที่ใกล้ถึงกำหนดส่งในตอนนี้</div>
            </div>
          )}

          {courses.map((c) =>
            (c.announcements?.length || 0) > 0 ? (
              <div className="grp" style={{ marginTop: 12 }} key={c.id || c.name}>
                <h2>
                  📢 {c.name} <span className="cnt">{c.announcements?.length}</span>
                </h2>
                {(c.announcements || []).map((a, i) => (
                  <div className="item" key={a.id || i} style={{ borderLeftColor: "var(--accent)" }}>
                    <div className="pd">{a.time && <span>🕒 {a.time}</span>}</div>
                    <div className="ttl" style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>
                      {a.text}
                    </div>
                  </div>
                ))}
              </div>
            ) : null
          )}
        </>
      )}
    </div>
  );
}