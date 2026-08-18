"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { classifyAssignment, dataUrl, dueLabel, fmtDate, nowBKK, todayIdxBKK, todayLabelBKK, todayStr, type Bucket } from "@/lib/data";
import { COURSES, MAKEUP, SCHEDULE } from "@/lib/schedule-data";
import { filterVisibleBriefItems, useHiddenTasks } from "@/lib/hidden-tasks";
import {
  ConfirmClear,
  HideButton,
  hiddenReasonText,
} from "@/components/HiddenTasks";
import NextActionCard from "@/components/NextActionCard";
import { computeNextAction, type PriorityTask } from "@/lib/priority";

interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}

interface Quiz {
  date?: string;
  summary?: string;
}

interface AssignData {
  todo?: Assignment[];
  courseNames?: Record<string, string>;
  updated?: string;
}
interface SchedData {
  events?: unknown[];
  quizzes?: Quiz[];
  updated?: string;
}

/* AI-generated NEXT ACTION brief (from generate_next_action.py). Same shape
   as Home reads — the Today page surfaces it under the timeline. */
interface NextActionItem {
  title?: string;
  course?: string;
  dueLabel?: string;
  effort_hr?: string;
  why?: string;
}
interface NextActionBrief {
  generated_at?: string;
  day_label?: string;
  model?: string;
  brief?: string;
  items?: NextActionItem[];
}

/* A single row on the Today timeline. Sources are merged in time order:
   recurring weekly classes (SCHEDULE) + one-off makeup sessions (MAKEUP). */
interface TimelineRow {
  time: number;       // start hour, e.g. 10.0 / 11.84
  end: number;
  label: string;      // course name / session name
  code: string;
  room?: string;
  color: string;      // course accent color
  kind: "class" | "makeup";
  icon: string;       // emoji for the row
}

// (classify + badge logic live in lib/data so every page agrees.)

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

/* ── Today timeline helpers ──
   Merge the day's recurring classes (SCHEDULE) + one-off makeup sessions
   (MAKEUP) into a single time-ordered list. Repeated weekly sessions share the
   same course → same accent color + a study emoji; makeup sessions get a
   distinct lookup cue. This turns a wall of deadline buckets into a real
   "เวลา → กิจกรรม" view. */
function fmtH(h: number): string {
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = h % 1 ? "30" : "00";
  return `${hh}:${mm}`;
}

function buildTimeline(dayIdx: number, isoToday: string): TimelineRow[] {
  const rows: TimelineRow[] = [];

  // 1) Recurring weekly classes for today.
  SCHEDULE.filter((s) => s.day === dayIdx).forEach((s) => {
    rows.push({
      time: s.start,
      end: s.end,
      label: COURSES[s.code]?.name || s.code,
      code: s.code,
      room: s.room,
      color: COURSES[s.code]?.color || "#22d3ee",
      kind: "class",
      icon: "📚",
    });
  });

  // 2) One-off makeup / compensation classes dated today.
  MAKEUP.filter((m) => m.date === isoToday).forEach((m) => {
    rows.push({
      time: m.start,
      end: m.end,
      label: COURSES[m.code]?.name || m.code,
      code: m.code,
      room: m.room,
      color: COURSES[m.code]?.color || "#22d3ee",
      kind: "makeup",
      icon: "⚡",
    });
  });

  return rows.sort((a, b) => a.time - b.time);
}

const CLASS_ICONS: Record<string, string> = {
  "88622065": "🗂️", // Data Structures
  "88624065": "🗄️", // Relational Database
  "88624165": "🎨", // UI Design
  "88634065": "💻", // Software Dev
  "89520664": "🇬🇧", // Experiential English
  "89520864": "🗣️", // Thai Language
  "73101469": "❤️", // Sexual Literacy
};

export default function TodayPage() {
  const [all, setAll] = useState<Assignment[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [synced, setSynced] = useState("");
  const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [quizError, setQuizError] = useState<string | null>(null);
    const [aiBrief, setAiBrief] = useState<NextActionBrief | null>(null);
  const [showLater, setShowLater] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [detailTask, setDetailTask] = useState<PriorityTask | null>(null);
    const detailModalRef = useRef<HTMLDivElement | null>(null);
    const [courseMap, setCourseMap] = useState<Record<string, string>>({});
    // courseName+title key -> {courseId, workId} so we can deep-link straight to
    // the assignment (/c/{courseId}/a/{workId}) instead of the course stream page
    // (which is what "กดเข้าแล้วหมุน" was — the stream never settles fast enough).
    const [courseWorkMap, setCourseWorkMap] = useState<Record<string, { courseId: string; workId: string }>>({});
    // Manual per-task URL override, persisted to localStorage (no DB needed to
    // work immediately; Supabase migration 0009 is a later nicety).
    const [linkOverrides, setLinkOverrides] = useState<Record<string, string>>({});
    const [editingLink, setEditingLink] = useState<string | null>(null); // task key being edited
    const [toast, setToast] = useState<string | null>(null);
        const [toastError, setToastError] = useState(false);
        const toastTimer = useRef<number | null>(null);
        const { hiddenList, hide, unhide, clearAll, canEdit } = useHiddenTasks();

      const showToast = (msg: string, isError = false) => {
        setToast(msg);
        setToastError(isError);
        if (toastTimer.current) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2600);
      };

  /* Resolve the effective "ไปที่ Classroom" URL for the open task:
       1. manual override (editable by the owner, saved to localStorage) wins,
       2. else a deterministic deep-link to the assignment when we know the
          google courseId + workId (courseName + title match from classroom.json),
       3. else the course-level link from course_id_map.json. */
  const taskClassroomLink = (): { href: string; editable: boolean } => {
    if (!detailTask) return { href: "", editable: false };
    const manual = linkOverrides[detailTask.key];
    if (manual) return { href: manual, editable: true };
    const nameKey =
      (detailTask.courseName || "").trim() + "\u0001" + (detailTask.title || "").trim();
    const cw = courseWorkMap[nameKey];
    if (cw && courseMap[detailTask.course]) {
      // Prefer the authoritative google courseId from classroom.json.
      const gid = courseMap[detailTask.course];
      return {
        href: `https://classroom.google.com/u/0/c/${gid}/a/${cw.workId}`,
        editable: true,
      };
    }
    const gid = courseMap[detailTask.course];
    if (gid) return { href: `https://classroom.google.com/u/0/c/${gid}`, editable: true };
    return { href: "", editable: false };
  };
  const saveOverride = (url: string) => {
    if (!detailTask) return;
    const trimmed = (url || "").trim();
    const next = { ...linkOverrides };
    if (trimmed && /^https?:\/\//.test(trimmed)) {
      next[detailTask.key] = trimmed;
    } else {
      delete next[detailTask.key];
    }
    setLinkOverrides(next);
    try {
      window.localStorage.setItem("td_link_overrides", JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setEditingLink(null);
    showToast(trimmed ? "บันทึกลิงก์แล้ว" : "คืนค่าเริ่มต้นแล้ว");
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
      (async () => {
        setLoading(true);
        try {
          const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const j: AssignData = await r.json();
          const todo = (j.todo || []).map((a) => ({ ...a }));
          todo.forEach(classifyAssignment);
          setAll(todo);
          setSynced(j.updated || "");
        } catch (e) {
          setErr("โหลดข้อมูลไม่ได้: " + (e instanceof Error ? e.message : String(e)) + " (รัน cron ซิงก์แล้วลองใหม่)");
        } finally {
          setLoading(false);
        }
        // Quizzes are optional — surface their failure separately so a schedule
        // feed outage doesn't take down the whole Today page.
        try {
          const q = await fetch(dataUrl("/data/schedule.json"), { cache: "no-store" });
          if (!q.ok) throw new Error("HTTP " + q.status);
          const qj: SchedData = await q.json();
          setQuizzes(qj.quizzes || []);
        } catch (e) {
                  setQuizError("โหลดรายการสอบ/กิจกรรมไม่ได้: " + (e instanceof Error ? e.message : String(e)));
                }
                // AI NEXT-ACTION brief is optional — the page keeps its heuristic next
                // card when the file is absent or older than ~36h (same freshness rule as Home).
                try {
                  const b = await fetch(dataUrl("/data/next_action.json"), { cache: "no-store" });
                  if (b.ok) {
                    const bj: NextActionBrief = await b.json();
                    if (bj.items && bj.items.length) {
                      const t = bj.generated_at ? new Date(bj.generated_at).getTime() : 0;
                      if (!isNaN(t) && Date.now() - t <= 36 * 3600 * 1000) {
                        setAiBrief(bj);
                      }
                    }
                  }
                } catch {
                  /* keep the deadline-bucket "next" heuristic below as fallback */
                }
              })();
            }, []);

  // Course-id map for the "ไป classroom" deep link (code -> Google courseId).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(dataUrl("/data/course_id_map.json", { cache: true }), { cache: "force-cache" });
        if (r.ok) {
          const m: Record<string, string> = await r.json();
          // file shape: { googleCourseId: courseCode } — invert to code -> googleId
          const inv: Record<string, string> = {};
          for (const [gid, code] of Object.entries(m)) inv[code] = gid;
          setCourseMap(inv);
        }
      } catch {
        /* optional — button simply won't show for unknown courses */
      }
    })();
    (async () => {
      try {
        const r = await fetch(dataUrl("/data/classroom.json", { cache: true }), { cache: "force-cache" });
        if (r.ok) {
          const j: { courses?: { id?: string; name?: string; coursework?: { id?: string; title?: string }[] }[] } = await r.json();
          const m: Record<string, { courseId: string; workId: string }> = {};
          for (const c of j.courses || []) {
            const cid = c.id;
            if (!cid) continue;
            for (const w of c.coursework || []) {
              if (!w.id || !w.title) continue;
              const courseName = (c.name || "").trim();
              const t = (w.title || "").trim();
              if (courseName) m[courseName + "\u0001" + t] = { courseId: cid, workId: w.id };
            }
          }
          setCourseWorkMap(m);
        }
      } catch {
        /* optional — deep link falls back to course-level link */
      }
    })();
    // Restore any manual link overrides saved locally for this task.
    try {
      const saved = window.localStorage.getItem("td_link_overrides");
      if (saved) setLinkOverrides(JSON.parse(saved));
    } catch {
      /* ignore — private mode etc. */
    }
  }, []);
  useEffect(() => {
    if (!detailTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailTask(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailTask]);

  // Always filter hidden assignments out of every bucket BEFORE computing stats.
    const visible = useMemo(() => {
      return all.filter(
        (a) =>
          !hiddenList.some(
            (h) =>
              h.key ===
              (a.course || "").trim() + "|" + (a.title || "").trim() + "|" + (a.due || "").trim()
          )
      );
    }, [all, hiddenList]);

  const { over, tod, soon, later, no_due } = useMemo(() => {
      return {
        over: visible.filter((a) => a.bucket === "over"),
        tod: visible.filter((a) => a.bucket === "today"),
        soon: visible.filter((a) => a.bucket === "soon"),
        later: visible.filter((a) => a.bucket === "later"),
        no_due: visible.filter((a) => a.bucket === "no_due"),
      };
    }, [visible]);

  const now = nowBKK();
      const today = todayStr();
      const dayLabel = todayLabelBKK();

    /* Today's timeline: recurring classes + makeup sessions, merged in time order. */
    const timelineRows = useMemo(() => buildTimeline(todayIdxBKK(), todayStr()), [today]);

    /* Deterministic Priority / Next-Action engine (lib/priority.ts) — the source
             of truth for "what to do right now", computed in code with NO AI (replaces
             the old deadline-bucket heuristic). Time-availability reads today's weekly
             classes + makeup. `visible` is already hidden-filtered, so we don't
             re-filter here. */
          const engineSessions = useMemo(
            () => [...SCHEDULE, ...MAKEUP] as { day?: number; date?: string; start?: number; end?: number; code?: string }[],
            []
          );
          const engine = useMemo(
            () => computeNextAction(visible, quizzes, engineSessions, undefined),
            [visible, quizzes, engineSessions]
          );

          /* Filter hidden tasks out of the AI brief (shared logic — see
              filterVisibleBriefItems in lib/hidden-tasks.ts). */
        const aiVisibleItems = useMemo(
          () => (aiBrief ? filterVisibleBriefItems(aiBrief.items, hiddenList) : []),
          [aiBrief, hiddenList]
        );

  const handleHide = (a: Assignment, reason: string, custom?: string) => {
        hide(a, reason, custom).then((res) => {
          if (res.ok) showToast(`ซ่อน "${a.title}" แล้ว 🙈`);
          else showToast(`ซ่อนงานไม่สำเร็จ — ${res.error || "ยังไม่มีสิทธิ์ซ่อน (ต้องการบัญชีเจ้าของ theerawat.numtang@gmail.com)"}`, true);
        });
        };

        const handleRestore = (key: string, title?: string) => {
          unhide(key).then((res) => {
            if (res.ok) showToast(`นำ "${title}" กลับมาแล้ว`);
            else showToast(`นำงานกลับมาไม่สำเร็จ — ${res.error || "ยังไม่มีสิทธิ์แก้ (ต้องการบัญชีเจ้าของ)"}`, true);
          });
        };

        const handleClear = () => {
          clearAll().then((res) => {
            if (res.ok) showToast("ล้างงานที่ซ่อนทั้งหมดแล้ว");
            else showToast(`ล้างงานที่ซ่อนไม่สำเร็จ — ${res.error || "ยังไม่มีสิทธิ์แก้ (ต้องการบัญชีเจ้าของ)"}`, true);
          });
          setConfirmClear(false);
        };

  const Item = ({ a, overCl }: { a: Assignment; overCl?: boolean }) => {
    const b = dueLabel(a);
    return (
      <div className={"item" + (overCl ? " over" : "")}>
        <div className="pd">
          <span className={"badge " + b.cls}>{b.txt}</span>
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
        <div className="subj">{a.courseName || a.course || ""}</div>
      </div>
    );
  };

  const Section = ({
    label,
    items,
  }: {
    label: string;
    items: Assignment[];
  }) =>
    items.length ? (
      <div className="grp" style={{ marginTop: 8 }}>
        <h2>
          {label} <span className="cnt">{items.length}</span>
        </h2>
        {items.map((a, i) => (
          <Item key={i} a={a} overCl={a.bucket === "over"} />
        ))}
      </div>
    ) : null;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            เช็ค<span className="dot">งาน</span>วันนี้
          </h1>
          <div className="dayhead">
            <div className="sub">
              วันนี้ {dayLabel} · {today}
            </div>
          </div>
        </div>
        {synced && <div style={{ fontSize: 12, color: "var(--muted)" }}>ซิงก์ {fmtSync(synced)}</div>}
      </header>

      {err && <div className="err">⚠ {err}</div>}

            {loading && !err && (
              <div className="src" role="status" aria-live="polite">
                กำลังโหลดงานเรียน…
              </div>
            )}

            {!loading && quizError && (
                          <div className="err" role="alert">
                            ⚠ {quizError}
                          </div>
                        )}

                  {/* ── TODAY TIMELINE ──
                      Real time-ordered view of today: recurring classes + makeup sessions.
                      This is the "เวลา → กิจกรรม" spine gpt proposed — wraps the schedule
                      data (from lib/schedule-data.ts) filtered to the current weekday. */}
                  <section className="today-tl">
                    <h2 className="sec-title">
                      🕐 Timeline วันนี้ <span className="cnt">{timelineRows.length} คาบ</span>
                    </h2>
                    {timelineRows.length === 0 ? (
                      <div className="tl-empty">วันนี้ไม่มีคาบเรียน — เวลาว่าง 🎉</div>
                    ) : (
                      <div className="tl-list">
                        {timelineRows.map((r, i) => {
                          const icon = CLASS_ICONS[r.code] || r.icon;
                          return (
                            <div
                              className={"tl-row" + (r.kind === "makeup" ? " makeup" : "")}
                              key={i}
                              style={{ "--tl-c": r.color } as CSSProperties}
                            >
                              <div className="tl-time">
                                <div className="tl-h">{fmtH(r.time)}</div>
                                <div className="tl-end">–{fmtH(r.end)}</div>
                              </div>
                              <div className="tl-axis">
                                <span className="tl-dot" />
                              </div>
                              <div className="tl-body">
                                <div className="tl-act">
                                  <span className="tl-emoji">{icon}</span>
                                  <span className="tl-name">{r.label}</span>
                                  {r.kind === "makeup" && <span className="tl-tag">ชดเชย</span>}
                                </div>
                                <div className="tl-meta">
                                  <span className="tl-code">{r.code}</span>
                                  {r.room && <span className="tl-room">📍 {r.room}</span>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* ── NEXT ACTION (deterministic Priority Engine — no AI) ──
                        The old AI morning brief (when fresh) is kept as a thin
                        additive summary strip — it no longer decides priority. */}
                      {aiBrief && aiVisibleItems.length > 0 && (
                        <div className="next-brief-line" style={{ marginBottom: 6 }}>
                          🧠 {aiBrief.brief || "สรุปวันนี้"}{aiBrief.model ? ` · (${aiBrief.model})` : ""}
                        </div>
                      )}
                      <NextActionCard result={engine} detailLabel="ดูรายละเอียด →" onDetail={() => engine.next && setDetailTask(engine.next)} />

                        {/* Counts only make sense once data arrived — during load they
                                       would show a misleading 0 for everything (false affordance). */}
                        {!loading && (
                        <div className="counts">
                          <div className="c">
                            <b className="down" style={{ color: "var(--down)" }}>
                              {over.length}
                            </b>
                            เลยกำหนด
                          </div>
                          <div className="c">
                            <b style={{ color: "var(--warn)" }}>{tod.length}</b>
                            ครบวันนี้
                          </div>
                          <div className="c">
                            <b style={{ color: "var(--accent2)" }}>{soon.length}</b>
                            ใกล้ถึง (5 วัน)
                          </div>
                          <div className="c">
                            <b>{quizzes.length}</b>
                            สอบ/กิจกรรม
                          </div>
                        </div>
                        )}

      {quizzes.length > 0 && (
        <div className="quizban">
          <h3>🔔 แจ้งเตือนสอบ / กิจกรรมใกล้ถึง</h3>
          {quizzes.map((q, i) => {
            const diff = Math.round(
              (new Date((q.date || "") + "T00:00:00").getTime() -
                new Date(today + "T00:00:00").getTime()) /
                86400000
            );
            const when =
              diff < 0 ? `ผ่านมา ${-diff} วัน` : diff === 0 ? "วันนี้!" : `ใน ${diff} วัน`;
            return (
              <div className="q" key={i}>
                <span>{q.summary}</span>
                <span className={"badge " + (diff <= 3 ? "b-quiz" : "b-soon")}>
                  {fmtDate(q.date)} · {when}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Section label="🔴 เลยกำหนด ต้องรีบทำ" items={over} />
            <Section label="⏳ ครบกำหนดวันนี้" items={tod} />
            <Section label="🟣 ใกล้ถึง (5 วัน)" items={soon} />

            {no_due.length > 0 && (
              <div className="grp" style={{ marginTop: 8 }}>
                <h2>
                  ⚪ ยังไม่ระบุกำหนดส่ง <span className="cnt">{no_due.length}</span>
                </h2>
                {no_due.map((a, i) => (
                  <div className="item" key={i}>
                    <div className="pd">
                      <span className="badge b-done">ยังไม่ระบุกำหนดส่ง</span>
                      <span>⏰ —</span>
                    </div>
                    <div className="ttl" style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span style={{ minWidth: 0 }}>{a.title}</span>
                      <HideButton
                        assignment={a}
                        canEdit={canEdit}
                        onHide={(r, c) => handleHide(a, r, c)}
                      />
                    </div>
                    <div className="subj">{a.courseName || a.course || ""}</div>
                  </div>
                ))}
              </div>
            )}

      {later.length > 0 && (
        <div className="grp" style={{ marginTop: 8 }}>
          <h2>
            📅 อีกไกล <span className="cnt">{later.length}</span>
          </h2>
          <button className="togglenext" onClick={() => setShowLater((s) => !s)}>
            {showLater ? "ซ่อนงานที่ยังอีกไกล ▲" : `แสดงงานที่ยังอีกไกล (${later.length}) ▼`}
          </button>
          {showLater && (
            <div>
              {later.map((a, i) => {
                const d = Math.round(
                  (new Date((a.due || "") + "T00:00:00").getTime() -
                    new Date(today + "T00:00:00").getTime()) /
                    86400000
                );
                return (
                  <div className="item" key={i}>
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
                    <div className="subj">{a.courseName || a.course || ""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!loading && !err && !over.length && !tod.length && !soon.length && (
              <div className="cards-sec" style={{ textAlign: "center", padding: 34 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
                <div style={{ color: "var(--muted)" }}>วันนี้ไม่มีงานค้าง / ครบส่ง ค่อยๆ ผ่อนได้</div>
              </div>
            )}

      {/* Hidden tasks management (collapsible, at the bottom) */}
      {hiddenList.length > 0 && (
        <div className="grp" style={{ marginTop: 10 }}>
          <button className="htoggle" onClick={() => setShowHidden((s) => !s)} aria-expanded={showHidden}>
            🗂️ งานที่ซ่อนแล้ว <span className="cnt">({hiddenList.length})</span>
            {showHidden ? " ▲" : " ▼"}
          </button>
          {showHidden && (
            <div className="hidden-wrap">
              {hiddenList.map((h) => (
                <div className="hidden-card" key={h.key}>
                  <div className="hid-ttl">{h.title || "งาน"}</div>
                  <div className="hid-meta">
                    {h.course} · กำหนดส่งเดิม {h.due || "—"}
                  </div>
                  <div className="hid-reason">เหตุผล: {hiddenReasonText(h)}</div>
                  <div className="hid-foot">
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {new Date(h.hiddenAt).toLocaleString("th-TH", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <button className="restore-btn" onClick={() => handleRestore(h.key, h.title)}>
                      นำกลับมา
                    </button>
                  </div>
                </div>
              ))}
              <button className="clear-hidden-btn" onClick={() => setConfirmClear(true)}>
                ล้างรายการทั้งหมด
              </button>
            </div>
          )}
        </div>
      )}

      {confirmClear && (
        <ConfirmClear onConfirm={handleClear} onClose={() => setConfirmClear(false)} />
      )}

      {detailTask && (
        <div
          ref={detailModalRef}
          className="detail-modal open"
          role="dialog"
          aria-modal="true"
          aria-labelledby="today-detail-title"
          onClick={(e) => e.target === e.currentTarget && setDetailTask(null)}
        >
          <div className="sheet">
            <div className="hh">
              <div>
                <h2 id="today-detail-title">{detailTask.title}</h2>
                <div className="when">
                  {detailTask.courseName || detailTask.course || ""}
                </div>
              </div>
              <button
                className="close"
                onClick={() => setDetailTask(null)}
                aria-label="ปิดหน้าต่าง"
              >
                ✕
              </button>
            </div>
            <div className="prio-reasons" style={{ marginTop: 10 }}>
              💡 {detailTask.reasons.join(" · ") || "ไม่มีกำหนดส่งด่วน"}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {detailTask.dueLabel && (
                <span className="badge b-soon">⏰ {detailTask.dueLabel}</span>
              )}
              {detailTask.effortHr && <span className="badge b-soon">⏱ {detailTask.effortHr}</span>}
              {detailTask.recommendedStart && (
                <span className="badge b-soon">🕐 {detailTask.recommendedStart}</span>
              )}
            </div>
            {(() => {
              const { href, editable } = taskClassroomLink();
              const editing = editingLink === detailTask.key;
              if (!href) return null;
              return (
                <div style={{ marginTop: 16 }} className="classroom-link-block">
                  {!editing ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <a
                        className="next-go-btn"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                      >
                        📚 ไปที่ Classroom ({detailTask.courseName || detailTask.course})
                      </a>
                      {editable && (
                        <button
                          type="button"
                          className="next-go-btn"
                          style={{ textDecoration: "underline" }}
                          onClick={() => setEditingLink(detailTask.key)}
                        >
                          ✏️ แก้ลิงก์เอง
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        defaultValue={linkOverrides[detailTask.key] || href}
                        key={href}
                        placeholder="https://classroom.google.com/..."
                        style={{
                          flex: 1,
                          minWidth: 220,
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border, #444)",
                          background: "transparent",
                          color: "inherit",
                          fontSize: 14,
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveOverride((e.target as HTMLInputElement).value);
                          if (e.key === "Escape") setEditingLink(null);
                        }}
                        id={`link-input-${detailTask.key}`}
                      />
                      <button type="button" className="next-go-btn" onClick={() => saveOverride((document.getElementById(`link-input-${detailTask.key}`) as HTMLInputElement)?.value || "")}>
                        บันทึก
                      </button>
                      <button type="button" className="next-go-btn" onClick={() => setEditingLink(null)}>
                        ยกเลิก
                      </button>
                      {linkOverrides[detailTask.key] && (
                        <button
                          type="button"
                          className="next-go-btn"
                          style={{ textDecoration: "underline" }}
                          onClick={() => saveOverride("")}
                        >
                          คืนค่าเริ่มต้น
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {toast && (
        <div className={toastError ? "hide-toast err-toast" : "hide-toast"} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}