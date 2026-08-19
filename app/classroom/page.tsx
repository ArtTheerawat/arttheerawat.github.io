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
  const { hiddenList, hide, unhide, canEdit } = useHiddenTasks();

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

  // Whole-course hides are stored in the same hidden_tasks table under a
  // reserved title "*ทั้งวิชา*" + reason "whole-course" (a distinct key from
  // any real task/announcement). Collect the set of hidden course NAMES so both
  // tasks and announcements of those courses drop out together.
  const hiddenCourses = useMemo(() => {
    const s = new Set<string>();
    for (const h of hiddenList)
      if (h.reason === "whole-course" && h.course) s.add(h.course);
    return s;
  }, [hiddenList]);

  // Announcement hide key = course name + announcement text (no due), same
  // trim/canonicalisation as taskKey so it round-trips with hide().
  const isAnnouncementHidden = (cname: string, text: string): boolean =>
    hiddenList.some((h) => h.key === taskKey({ course: cname, title: text }));

  // Which of THIS page's courses/announcements are currently hidden — drives
  // the "คืนค่า" banner so a mistake is reversible from this page.
  const hiddenHere = useMemo(() => {
    const hiddenCourseNames: string[] = [];
    const hiddenAnnKeys: string[] = [];
    for (const c of courses || []) {
      if (c.name && hiddenCourses.has(c.name)) hiddenCourseNames.push(c.name);
      for (const a of c.announcements || [])
        if (isAnnouncementHidden(c.name || "", a.text || ""))
          hiddenAnnKeys.push(taskKey({ course: c.name || "", title: a.text || "" }));
    }
    return { hiddenCourseNames, hiddenAnnKeys };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses, hiddenList, hiddenCourses]);

  const restoreHiddens = () => {
    const keys = [...hiddenHere.hiddenAnnKeys];
    for (const cn of hiddenHere.hiddenCourseNames)
      keys.push(taskKey({ course: cn, title: "*ทั้งวิชา*" }));
    let n = 0;
    Promise.all(keys.map((k) => unhide(k))).then((res) => {
      n = res.filter((r) => r.ok).length;
      setMsgErr(n !== keys.length);
      setMsg(n > 0 ? `คืนค่าแล้ว ${n} รายการ ✅` : `คืนค่าไม่สำเร็จ — ${res.find((r) => !r.ok)?.error || ""}`);
      window.setTimeout(() => setMsg(null), 2600);
    });
  };

  const toast = (ok: boolean, label: string, err?: string) => {
    setMsgErr(!ok);
    setMsg(
      ok
        ? `ซ่อน "${label}" แล้ว 🙈`
        : `ซ่อนไม่สำเร็จ — ${err || "ยังไม่มีสิทธิ์ (ต้องการบัญชีเจ้าของ theerawat.numtang@gmail.com)"}`
    );
    window.setTimeout(() => setMsg(null), 2600);
  };

  const handleHideCourse = (cname: string) => {
    if (!window.confirm(`ซ่อนทั้งวิชา "${cname}"? งานและประกาศของวิชานี้จะหายจากหน้า`)) return;
    hide({ course: cname, title: "*ทั้งวิชา*" }, "whole-course").then((res) =>
      toast(res.ok, cname, res.error)
    );
  };

  const handleHideAnnouncement = (cname: string, text: string) => {
    hide({ course: cname, title: text }, "cancelled").then((res) =>
      toast(res.ok, `${cname} · ${text.slice(0, 24)}`, res.error)
    );
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
        if (a.course && hiddenCourses.has(a.course)) return false; // whole-course hidden
        const key = taskKey(a);
        if (hiddenList.some((h) => h.key === key)) return false;
        return !a.submitted; // hide already-turned-in work from pending buckets
      }),
    [all, hiddenList, hiddenCourses]
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
          {hiddenHere.hiddenCourseNames.length + hiddenHere.hiddenAnnKeys.length > 0 && (
            <div className="restore-banner">
              <span>
                🙈 ซ่อนไว้: {hiddenHere.hiddenCourseNames.length || ""}
                {hiddenHere.hiddenCourseNames.length > 0 && " วิชา"}
                {hiddenHere.hiddenCourseNames.length > 0 && hiddenHere.hiddenAnnKeys.length > 0 && " · "}
                {hiddenHere.hiddenAnnKeys.length > 0 && `ประกาศ ${hiddenHere.hiddenAnnKeys.length} รายการ`}
              </span>
              <button onClick={restoreHiddens}>คืนค่า</button>
            </div>
          )}
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
            (c.announcements?.length || 0) > 0 && !hiddenCourses.has(c.name || "") ? (
              <div className="grp" style={{ marginTop: 12 }} key={c.id || c.name}>
                <h2>
                  📢 {c.name} <span className="cnt">{c.announcements?.length}</span>
                  {canEdit && (
                    <button
                      type="button"
                      className="hide-ann-course"
                      onClick={() => handleHideCourse(c.name || "")}
                      title="ซ่อนงานและประกาศของวิชานี้"
                    >
                      🙈 ซ่อนวิชานี้
                    </button>
                  )}
                </h2>
                {(c.announcements || [])
                  .filter((a) => !isAnnouncementHidden(c.name || "", a.text || ""))
                  .map((a, i) => (
                    <div className="item" key={a.id || i} style={{ borderLeftColor: "var(--accent)" }}>
                      <div className="pd">{a.time && <span>🕒 {a.time}</span>}</div>
                      <div className="ttl" style={{ fontWeight: 500, whiteSpace: "pre-wrap" }}>
                        {a.text}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          className="hide-ann-item"
                          onClick={() => handleHideAnnouncement(c.name || "", a.text || "")}
                          title="ซ่อนประกาศนี้"
                        >
                          🙈 ซ่อน
                        </button>
                      )}
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