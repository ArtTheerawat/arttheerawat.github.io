"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { classifyAssignment, dataUrl, dueLabel, fmtDate, nowBKK, todayLabelBKK, todayStr, type Bucket } from "@/lib/data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import {
  ConfirmClear,
  HideButton,
  hiddenReasonText,
} from "@/components/HiddenTasks";

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

export default function TodayPage() {
  const [all, setAll] = useState<Assignment[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [synced, setSynced] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [quizError, setQuizError] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
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
      })();
    }, []);

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

      {toast && (
        <div className={toastError ? "hide-toast err-toast" : "hide-toast"} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}