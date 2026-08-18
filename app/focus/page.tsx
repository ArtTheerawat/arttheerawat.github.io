"use client";

// app/focus/page.tsx — Focus Mode for TheeDeck.
//
// A deliberately minimal, distraction-free working surface for ONE task:
//   • opened via "Start Focus" from the Next Action card (Home + /today)
//   • reads the chosen task by its stable key (course|title|due, the same
//     taskKey the hidden-tasks system uses) from the URL ?key=...
//   • renders a tab-inactive-safe focus timer (wall-clock elapsed — see below)
//   • "Complete" reuses the EXISTING status/ownership flow: it calls the same
//     hide() that Home + /today use, with the existing "already-submitted"
//     reason (งานเสร็จ/ส่งแล้ว). This is the app's single source of truth for
//     an assignment no longer being active, so the task disappears from Home
//     and /today automatically and Next Action recomputes.
//
// No new task system, no new priority algorithm, no notifications/search/
// analytics/AI — just a reading of existing data + one existing write.
//
// TIMER (why it survives an inactive tab / refresh):
//   We never tick a decrementing counter. Instead we persist the wall-clock
//   time the focus run STARTED (Date.now()) together with any elapsed already
//   accumulated before the last pause. The displayed elapsed is computed as
//   accumulated + (now - startedAt) while running. Tabs/browsers may throttle
//   the JS clock when the tab is hidden, but `now` comes from Date.now() each
//   render, so the number can never drift away from real time, and after a
//   refresh we rebuild the same total from localStorage.

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Play, Pause, Check, ArrowLeft } from "lucide-react";
import { classifyAssignment, dataUrl, fmtDate } from "@/lib/data";
import { useHiddenTasks, taskKey } from "@/lib/hidden-tasks";

interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  workType?: string;
  points?: number | null;
  bucket?: "over" | "today" | "soon" | "later" | "no_due";
}

interface AssignData {
  todo?: Assignment[];
  updated?: string;
}

/* ── localStorage-backed focus-run state (per task key) ─────────────── */

const LS_PREFIX = "theedeck.focus."; // + taskKey -> JSON state
interface FocusState {
  running: boolean;
  startedAt: number; // Date.now() when the current run started (or last resume)
  accumulated: number; // ms elapsed accumulated before the current run
  lastTickTs: number; // unused on load; kept for forward-compat
}

function loadState(key: string): FocusState | null {
  try {
    const raw = window.localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw) as FocusState;
    if (typeof s.accumulated !== "number" || typeof s.startedAt !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

function persistState(key: string, s: FocusState) {
  try {
    window.localStorage.setItem(LS_PREFIX + key, JSON.stringify(s));
  } catch {
    /* storage full / private mode — timer still works for this tab */
  }
}

/** Elapsed ms for a persisted state evaluated "right now". Wall-clock safe:
    while running it's accumulated + (now - startedAt); when paused it's just
    the accumulated. Callers must call this on every render/tick. */
function elapsedOf(s: FocusState, now: number): number {
  return s.running ? s.accumulated + (now - s.startedAt) : s.accumulated;
}

function fmtHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format elapsed as a friendly Thai duration (e.g. "2 ชม. 05 นาที"). */
function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m} นาที`;
  return `${Math.max(0, total)} วินาที`;
}

export default function FocusPage() {
  return (
    <Suspense
      fallback={
        <div className="wrap focus">
          <div className="src" role="status" aria-live="polite">กำลังโหลดโฟกัสโมด…</div>
        </div>
      }
    >
      <FocusPageInner />
    </Suspense>
  );
}

function FocusPageInner() {
  const params = useSearchParams();
  const key = params.get("key") || "";

  const [all, setAll] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const { hiddenList, hide, canEdit } = useHiddenTasks();

  // ── Focus-run state (wall-clock timer) ──
  const [focus1, setFocus1] = useState<FocusState | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  // Load persisted focus state once the URL key is known.
  useEffect(() => {
    if (!key) return;
    setFocus1(loadState(key));
  }, [key]);

  // 30 Hz tick while on this page so the timer display stays live; the stored
  // value itself never ticks — it only changes on start/pause/resume, and the
  // displayed number is recomputed from Date.now() in the render below.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = (msg: string, isError = false) => {
    setToast(msg);
    setToastError(isError);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  // ── Load assignments (same as Home + /today) ──
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
      } catch (e) {
        setErr("โหลดข้อมูลงานไม่ได้: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Resolve the chosen task from the URL key ──
  const task = useMemo<Assignment | null>(() => {
    if (!key) return null;
    return all.find((a) => taskKey(a) === key) || null;
  }, [key, all]);

  // Is this task already hidden (= already completed / submitted)? The hidden
  // set is the single source of truth — if it's hidden it's no longer active.
  const alreadyDone = useMemo(() => {
    if (!task) return false;
    return hiddenList.some((h) => h.key === taskKey(task));
  }, [task, hiddenList]);

  const start = useCallback(() => {
    if (!key) return;
    setFocus1((prev) => {
      const s: FocusState = {
        running: true,
        startedAt: Date.now(),
        accumulated: prev?.accumulated ?? 0,
        lastTickTs: 0,
      };
      persistState(key, s);
      setNow(Date.now());
      return s;
    });
  }, [key]);

  const pause = useCallback(() => {
    if (!key || !focus1?.running) return;
    setFocus1(() => {
      const s: FocusState = {
        running: false,
        startedAt: 0,
        accumulated: elapsedOf(focus1, Date.now()),
        lastTickTs: 0,
      };
      persistState(key, s);
      setNow(Date.now());
      return s;
    });
  }, [key, focus1]);

  const reset = useCallback(() => {
    if (!key) return;
    setFocus1(() => {
      const s: FocusState = { running: false, startedAt: 0, accumulated: 0, lastTickTs: 0 };
      persistState(key, s);
      setNow(Date.now());
      return s;
    });
  }, [key]);

  // ── Complete = reuse the existing hide() flow (option A) ──
  //    reason "already-submitted" already exists in HIDE_REASONS and means
  //    "ส่งแล้ว / ทำเสร็จ". This is the same write Home + /today use, so the
  //    task leaves their lists through the shared realtime sync.
  const complete = useCallback(async () => {
    if (!task) return;
    const res = await hide(task, "already-submitted");
    if (res.ok) {
      showToast(`✅ ทำเสร็จแล้ว — "${task.title}"`);
      // Task is now hidden: it will disappear from Home/today on their next
      // realtime refresh. Keep the focus page showing a calm finished state.
    } else {
      showToast(res.error || "Complete ไม่สำเร็จ (ต้องการบัญชีเจ้าของ)", true);
    }
  }, [task, hide]);

  const elapsed = focus1 ? elapsedOf(focus1, now) : 0;
  const doing = task && !alreadyDone;

  return (
    <div className="wrap focus">
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Link href="/today" className="next-go-btn" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} aria-label="กลับไปงานวันนี้">
          <ArrowLeft size={16} aria-hidden="true" /> กลับ
        </Link>
        <h1 style={{ fontSize: 20, margin: 0 }}>
          โฟกัส<span className="dot">งานเดียว</span>
        </h1>
      </header>

      {loading && (
        <div className="src" role="status" aria-live="polite">กำลังโหลดงานเรียน…</div>
      )}
      {err && <div className="err" role="alert">⚠ {err}</div>}

      {/* Empty/error state: no key, or key didn't match a live task */}
      {!loading && !err && !doing && (
        <section className="next-card empty focus-empty" role="status">
          <div className="next-body">
            <div className="next-ttl">
              {alreadyDone
                ? "งานนี้ทำเสร็จไปแล้ว 🎉"
                : key
                ? "ไม่พบงานนี้ (อาจเปลี่ยนกำหนดส่ง / ถูกซ่อนไปแล้ว)"
                : "ยังไม่เลือกงานให้โฟกัส"}
            </div>
            <div className="next-meta" style={{ marginTop: 6 }}>
              {alreadyDone ? (
                <span>ได้หายจากรายการงานแล้ว น่าจะเป็นที่ "งานซ่อนแล้ว" ในหน้า /today</span>
              ) : (
                <span>ไปเลือกงานจาก Next Action หรือ /today แล้วกด "Start Focus"</span>
              )}
            </div>
            <div className="next-meta" style={{ marginTop: 12 }}>
              <Link href="/today" className="next-go-btn" style={{ textDecoration: "none" }}>
                ← กลับไปงานวันนี้
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Active focus surface */}
      {doing && (
        <div className="focus-body">
          <section className={"next-card " + (task.bucket === "over" ? "is-over" : task.bucket === "today" ? "is-today" : "is-soon")} style={{ marginBottom: 16 }}>
            <div className="next-body">
              {task.courseName && <div className="next-subj">{task.courseName}</div>}
              <div className="next-ttl">{task.title}</div>
              <div className="next-meta">
                {task.due && <span>⏰ ครบ {fmtDate(task.due)}</span>}
                {task.workType && <span>📄 {task.workType}</span>}
                {typeof task.points === "number" && <span>⭐ {task.points} คะแนน</span>}
              </div>
            </div>
          </section>

          {/* Timer */}
          <section className="focus-timer-card" aria-label="ตัวจับเวลาโฟกัส">
            <div className="focus-elapsed" role="timer" aria-live="off">
              {fmtHMS(elapsed)}
            </div>
            <div className="focus-sub">
              {focus1?.running ? "⏳ กำลังโฟกัส…" : elapsed > 0 ? "⏸ หยุดไว้ชั่วคราว" : "ยังไม่เริ่ม"}
              {elapsed > 0 && !focus1?.running && <span className="focus-total"> · รวม {fmtDuration(elapsed)}</span>}
            </div>

            <div className="focus-ctrl">
              {!focus1?.running ? (
                <button type="button" className="focus-btn primary" onClick={start} disabled={!doing}>
                  <Play size={18} aria-hidden="true" /> {elapsed > 0 ? "เริ่มต่อ" : "Start Focus"}
                </button>
              ) : (
                <button type="button" className="focus-btn" onClick={pause}>
                  <Pause size={18} aria-hidden="true" /> หยุดชั่วคราว
                </button>
              )}
              {elapsed > 0 && (
                <button type="button" className="focus-btn ghost" onClick={reset} aria-label="ล้างเวลานับใหม่">
                  ล้างเวลา
                </button>
              )}
            </div>
          </section>

          {/* Complete */}
          <section className="focus-done">
            <button
              type="button"
              className="focus-btn complete"
              onClick={complete}
              disabled={!canEdit}
              title={canEdit ? "ทำเสร็จแล้ว → ซ่อนจากรายการ" : "ต้องล็อกอินเป็นเจ้าของก่อนจึง complete ได้"}
            >
              <Check size={18} aria-hidden="true" /> ทำงานเสร็จแล้ว
            </button>
            {!canEdit && (
              <p className="focus-done-hint">ต้องล็อกอินเป็นเจ้าของก่อน complete (แล้วจะซ่อนงานนี้ออกจาก Home + /today)</p>
            )}
          </section>
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