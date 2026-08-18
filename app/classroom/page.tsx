"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  classifyAssignment,
  dataUrl,
  dueLabel,
  fmtDate,
  todayLabelBKK,
  todayStr,
  type Bucket,
} from "@/lib/data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Coursework {
  title?: string;
  due?: string;
  dueTime?: string;
  state?: string;
  id?: string;
}
interface Announcement {
  text?: string;
  time?: string;
  id?: string;
}
interface Course {
  name?: string;
  id?: string;
  coursework?: Coursework[];
  announcements?: Announcement[];
}
interface ClassroomData {
  generated_at?: string;
  courses?: Course[];
}

interface FlatTask extends Coursework {
  courseName: string;
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

/** Map a Supabase classroom_tasks row → component coursework shape. */
function sbTaskToCoursework(r: any): Coursework {
  return {
    title: r.title || undefined,
    due: r.due || undefined,
    dueTime: r.due_time || undefined,
    state: r.state || undefined,
    id: r.task_key || undefined,
  };
}

export default function ClassroomPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [synced, setSynced] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      // ── Primary source: Supabase ─────────────────────────────────────────
      const sb = getSupabaseBrowserClient();
      if (sb) {
        try {
          const [tRes, aRes] = await Promise.all([
            sb.from("classroom_tasks").select("*").order("due", { ascending: true }),
            sb.from("classroom_announcements").select("*").order("time", { ascending: false }),
          ]);
          if (!tRes.error && Array.isArray(tRes.data)) {
            // Group tasks + announcements per course.
            const byCourse = new Map<string, { name: string; coursework: Coursework[]; announcements: Announcement[] }>();
            const getCourse = (id?: string, name?: string) => {
              const key = id || name || "unknown";
              if (!byCourse.has(key))
                byCourse.set(key, { name: name || id || "unknown", coursework: [], announcements: [] });
              return byCourse.get(key)!;
            };
            for (const r of (tRes.data as any[])) {
              getCourse(r.course_id, r.course_name).coursework.push(sbTaskToCoursework(r));
            }
            for (const r of (aRes.data as any[])) {
              const row: Announcement = {
                text: r.text || undefined,
                time: r.time || undefined,
                id: r.ann_key || undefined,
              };
              getCourse(r.course_id, r.course_name).announcements.push(row);
            }
            setCourses(Array.from(byCourse.values()));
            setSynced("");
            setLoading(false);
            return;
          }
          if (tRes.error) {
            setErr("Supabase: " + (tRes.error.message || "query failed") + " — แสดงจาก classroom.json แทน");
          }
        } catch (e) {
          setErr("Supabase error: " + (e instanceof Error ? e.message : String(e)) + " — แสดงจาก classroom.json แทน");
        }
      }
      // ── Fallback: classroom.json ─────────────────────────────────────────
      const res = await fetch(dataUrl("/data/classroom.json"), { cache: "no-store" });
      if (res.ok) {
        const j: ClassroomData = await res.json();
        setCourses(j.courses || []);
        setSynced(j.generated_at || "");
      } else {
        setErr("โหลดข้อมูลคลาสรูมไม่ได้ (HTTP " + res.status + ") — รอ cron ซิงก์แล้วลองใหม่");
      }
    } catch (e) {
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
        const t: FlatTask = { ...cw, courseName: cname };
        classifyAssignment(t);
        out.push(t);
      }
    }
    return out;
  }, [courses]);

  const visible = useMemo(() => all.filter((a) => a.state !== "DRAFT"), [all]);

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
              <div className="ttl">{a.title}</div>
              <div className="subj">{a.courseName}</div>
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="wrap">
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
                        <div className="ttl">{a.title}</div>
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