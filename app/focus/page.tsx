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
// No new task system, no new priority algorithm, no AI — just a reading of
// existing data + one existing write.
//
// TWO TIMER MODES (both wall-clock accurate, both survive refresh):
//
//   STOPWATCH (original behaviour, kept): a continuous elapsed counter.
//     Persists { running, startedAt, accumulated } per task key. Displayed
//     elapsed = accumulated + (now - startedAt) while running. Never a
//     decrementing counter, so it cannot drift under an inactive tab and is
//     rebuilt from localStorage after a refresh.
//
//   POMODORO (added): fixed focus/break intervals in rounds.
//     Persists { phase: "focus"|"break", round, focusMin, breakMin, running,
//     phaseEndsAt } per task key. There is no ticking counter: phaseEndsAt is a
//     wall-clock Date.now() stamp and the countdown is recomputed as
//     phaseEndsAt - now on every render. The tab may throttle its JS clock, but
//     `now` is always real time, so the countdown never drifts, and after a
//     refresh the phase + remaining time are rebuilt from localStorage.
//
// Timer/wall-clock notes hold for BOTH modes: we never rely on an incrementing
// number of interval ticks.

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Play, Pause, Check, ArrowLeft, Timer, Clock,
  Coffee, Moon, Sparkles, RotateCcw,
} from "lucide-react";
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

/* ── Stopwatch state (original) ─────────────────────────────────────── */

const LS_PREFIX = "theedeck.focus."; // + taskKey -> JSON state (stopwatch)
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

/** Elapsed ms for a persisted stopwatch state evaluated "right now". Wall-clock
    safe: while running it's accumulated + (now - startedAt); paused it's just
    the accumulated. Callers must call this on every render/tick. */
function elapsedOf(s: FocusState, now: number): number {
  return s.running ? s.accumulated + (now - s.startedAt) : s.accumulated;
}

/* ── Pomodoro state (added) ─────────────────────────────────────────── */

const PM_PREFIX = "theedeck.focus.pomo."; // + taskKey -> JSON state
interface PomoState {
  phase: "focus" | "break";
  round: number; // current focus round number (1-based)
  totalRounds: number; // rounds in this set (user-chosen; default 4)
  focusMin: number;
  breakMin: number;
  running: boolean; // is the current phase actively counting down
  phaseEndsAt: number; // wall-clock Date.now() when the current phase finishes
  // When PAUSED: the frozen ms remaining of the current phase. Stored explicitly
  // because while paused `phaseEndsAt` must NOT be moved and `now` keeps ticking —
  // without this field the countdown would keep draining on a paused timer.
  pausedRemaining?: number;
  // Non-persisted transient: when a phase's time finishes we flip a flag so the
  // UI can show "รอบที่ N เสร็จแล้ว" + [พัก]/[ทำต่อเลย] instead of auto-flipping.
  freshRoundComplete?: boolean;
}

const PRESETS = [
  { label: "25/5", focus: 25, brk: 5, rounds: 4 },
  { label: "50/10", focus: 50, brk: 10, rounds: 4 },
  { label: "90/15", focus: 90, brk: 15, rounds: 4 },
] as const;

function loadPomo(key: string): PomoState | null {
  try {
    const raw = window.localStorage.getItem(PM_PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw) as PomoState;
    if (
      s && (s.phase === "focus" || s.phase === "break")
      && typeof s.round === "number"
      && typeof s.focusMin === "number"
      && typeof s.breakMin === "number"
      && typeof s.phaseEndsAt === "number"
    ) {
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

function persistPomo(key: string, s: PomoState) {
  try {
    const { freshRoundComplete, ...toStore } = s;
    window.localStorage.setItem(PM_PREFIX + key, JSON.stringify(toStore));
  } catch {
    /* private mode — still works for this tab */
  }
}

/** Remaining ms of the current phase evaluated at `now`. Wall-clock safe:
    while running it decays off `phaseEndsAt`; while paused it returns the
    FROZEN value stored in `pausedRemaining` (falls back to the legacy
    `phaseEndsAt - now` for old persisted states) so a paused timer never
    keeps draining. Callers pass `now` on every render/tick. */
function pomoRemainingMs(s: PomoState, now: number): number {
  if (s.running) {
    return Math.max(0, s.phaseEndsAt - now);
  }
  return Math.max(0, typeof s.pausedRemaining === "number" ? s.pausedRemaining : s.phaseEndsAt - now);
}

/* ── Formatting helpers ─────────────────────────────────────────────── */

function fmtHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Countdown format MM:SS (or H:MM:SS for >60 min) for Pomodoro. */
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
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

/* ── Notification helper (graceful, optional) ───────────────────────── */

let notifSupported = false;
function notify(title: string, body: string) {
  try {
    if (!("Notification" in window)) return;
    notifSupported = true;
    if (Notification.permission === "granted") {
      new Notification(title, { body: body, silent: true });
    }
    // Do NOT ask for permission unprompted — that would be intrusive. We only
    // fire when the user has already granted it. Otherwise the in-page toast +
    // document.title flash carries the signal (graceful fallback).
  } catch {
    /* never let a notification error crash focus mode */
  }
}

/* ── The page ───────────────────────────────────────────────────────── */

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

  // ── active engine: "stopwatch" (original) or "pomodoro" ──
  const [mode, setMode] = useState<"stopwatch" | "pomodoro">("stopwatch");

  // ── Stopwatch run state ──
  const [focus1, setFocus1] = useState<FocusState | null>(null);
  // ── Pomodoro run state ──
  const [pomo, setPomo] = useState<PomoState | null>(null);

  // ticking `now` so the displayed time stays live; stored values never tick.
  const [now, setNow] = useState<number>(() => Date.now());

  // Restore persisted engine + states once the URL key is known.
  useEffect(() => {
    if (!key) return;
    setFocus1(loadState(key));
    setPomo(loadPomo(key));
    try {
      const m = window.localStorage.getItem("theedeck.focus.mode");
      if (m === "pomodoro" || m === "stopwatch") setMode(m);
    } catch { /* ignore */ }
  }, [key]);

  // 30 Hz tick while on this page so the timer display stays live.
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

  // Is this task already hidden (= already completed / submitted)?
  const alreadyDone = useMemo(() => {
    if (!task) return false;
    return hiddenList.some((h) => h.key === taskKey(task));
  }, [task, hiddenList]);

  // ── Engine switch (persisted per device) ──
  const switchMode = (m: "stopwatch" | "pomodoro") => {
    setMode(m);
    try { window.localStorage.setItem("theedeck.focus.mode", m); } catch { /* ignore */ }
  };

  /* ────────────── STOPWATCH actions (original) ────────────── */

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

  /* ────────────── POMODORO actions (added) ────────────────── */

  /** Start a fresh Pomodoro set with the given preset / custom durations. */
  const pmNew = useCallback((focusMin: number, breakMin: number, totalRounds: number) => {
    if (!key) return;
    const s: PomoState = {
      phase: "focus",
      round: 1,
      totalRounds,
      focusMin,
      breakMin,
      running: true,
      phaseEndsAt: Date.now() + focusMin * 60000,
    };
    setPomo(s);
    persistPomo(key, s);
    setNow(Date.now());
    showToast(`เริ่มโฟกัส ${focusMin} นาที รอบที่ 1/${totalRounds}`);
  }, [key, showToast]);

  /** Begin a Pomodoro with a preset (25/5, 50/10, 90/15). */
  const pmStartPreset = (preset: { focus: number; brk: number; rounds: number }) => {
    pmNew(preset.focus, preset.brk, preset.rounds);
  };

  /** Pause / resume the countdown. */
  const pmToggleRun = useCallback(() => {
    if (!pomo) return;
    if (pomo.running) {
      // pause — freeze the remaining time in `pausedRemaining`. `now` keeps
      // ticking but pomoRemainingMs ignores it while paused, so the countdown
      // display is frozen exactly where it was.
      const remaining = pomoRemainingMs(pomo, Date.now());
      const s: PomoState = { ...pomo, running: false, pausedRemaining: remaining };
      persistPomo(key, s);
      setPomo(s);
    } else {
      // resume — re-anchor the end stamp on the wall clock so the countdown
      // decays off `phaseEndsAt` again, preserving the exact frozen remaining.
      const remaining = pomoRemainingMs(pomo, Date.now());
      const s: PomoState = {
        ...pomo,
        running: true,
        pausedRemaining: undefined,
        phaseEndsAt: Date.now() + remaining,
      };
      persistPomo(key, s);
      setPomo(s);
    }
    setNow(Date.now());
  }, [pomo, key]);

  /** Take the current break now (after a focus round finished). */
  const pmBreak = useCallback(() => {
    if (!pomo) return;
    const s: PomoState = {
      ...pomo,
      phase: "break",
      running: true,
      phaseEndsAt: Date.now() + pomo.breakMin * 60000,
      pausedRemaining: undefined,
      freshRoundComplete: false,
    };
    persistPomo(key, s);
    setPomo(s);
    setNow(Date.now());
    notify("☕ พักเบรก", "พัก " + pomo.breakMin + " นาที แล้วกลับมาโฟกัสรอบถัดไป");
  }, [pomo, key]);

  /** Skip the break and jump straight into the next focus round. */
  const pmNextFocus = useCallback(() => {
    if (!pomo) return;
    const nextRound = (pomo.round % pomo.totalRounds) + 1; // cycles for custom
    const s: PomoState = {
      phase: "focus",
      round: nextRound,
      totalRounds: pomo.totalRounds,
      focusMin: pomo.focusMin,
      breakMin: pomo.breakMin,
      running: true,
      phaseEndsAt: Date.now() + pomo.focusMin * 60000,
      pausedRemaining: undefined,
      freshRoundComplete: false,
    };
    persistPomo(key, s);
    setPomo(s);
    setNow(Date.now());
    notify("🎯 โฟกัสรอบถัดไป", "รอบที่ " + nextRound + "/" + pomo.totalRounds);
  }, [pomo, key]);

  /** Reset the whole Pomodoro set back to round 1 / paused. */
  const pmReset = useCallback(() => {
    if (!pomo) return;
    const s: PomoState = {
      phase: "focus",
      round: 1,
      totalRounds: pomo.totalRounds,
      focusMin: pomo.focusMin,
      breakMin: pomo.breakMin,
      running: false,
      phaseEndsAt: Date.now() + pomo.focusMin * 60000,
      freshRoundComplete: false,
    };
    persistPomo(key, s);
    setPomo(s);
    setNow(Date.now());
  }, [pomo, key]);

  // What happens once a RUNNING focus phase's time hits zero (checked every
  // render): round finishes → offer break. We never auto-forge into a break;
  // the user chooses [พัก] / [ทำต่อเลย] (the spec explicitly says not to force).
  useEffect(() => {
    if (!pomo || !pomo.running) return;
    if (pomo.phase === "focus" && now >= pomo.phaseEndsAt) {
      const s: PomoState = {
        ...pomo,
        running: false,
        freshRoundComplete: true, // show "รอบเสร็จแล้ว" + [พัก]/[ทำต่อ]
      };
      // phaseEndsAt kept so we can show the finished round; user picks next step.
      persistPomo(key, s);
      setPomo(s);
      notify("✅ รอบที่ " + pomo.round + " เสร็จแล้ว", "ตัดสินใจต่อ: พักเบรก หรือทำต่อเลย");
    } else if (pomo.phase === "break" && pomo.running && now >= pomo.phaseEndsAt) {
      // Break over → roll straight into the next focus round automatically
      // (breaks are short; continuing to work is the default expectation).
      const nextRound = (pomo.round % pomo.totalRounds) + 1;
      const s: PomoState = {
        ...pomo,
        phase: "focus",
        round: nextRound,
        running: true,
        phaseEndsAt: Date.now() + pomo.focusMin * 60000,
        pausedRemaining: undefined,
        freshRoundComplete: false,
      };
      persistPomo(key, s);
      setPomo(s);
      notify("🎯 พักครบแล้ว", "เข้าโฟกัสรอบที่ " + nextRound);
    }
  }, [pomo, now, key]);

  // ── Complete = reuse the existing hide() flow (option A) ──
  const complete = useCallback(async () => {
    if (!task) return;
    const res = await hide(task, "already-submitted");
    if (res.ok) {
      showToast(`✅ ทำเสร็จแล้ว — "${task.title}"`);
    } else {
      showToast(res.error || "Complete ไม่สำเร็จ (ต้องการบัญชีเจ้าของ)", true);
    }
  }, [task, hide, showToast]);

  const elapsed = focus1 ? elapsedOf(focus1, now) : 0;
  const doing = task && !alreadyDone;

  // Derived Pomodoro display values
  const pmRemaining = pomo ? pomoRemainingMs(pomo, now) : 0;
  const pmPhaseLabel = pomo
    ? (pomo.phase === "focus" ? (pomo.freshRoundComplete ? "รอบเสร็จแล้ว" : "โฟกัสงาน") : "พัก")
    : "—";
  const pmPhaseIndex = pomo
    ? pomo.phase === "focus"
      ? (pomo.freshRoundComplete ? Math.min(pomo.round, pomo.totalRounds) : pomo.round)
      : pomo.round
    : 1;
  // progress: elapsed fraction of the current phase (inverted for countdown)
  const pmPhaseDur = pomo ? (pomo.phase === "focus" ? pomo.focusMin : pomo.breakMin) * 60000 : 0;
  const pmPhasePct = pomo && pmPhaseDur > 0
    ? Math.max(0, Math.min(100, 100 - (pomoRemainingMs(pomo, now) / pmPhaseDur) * 100))
    : 0;

  return (
    <div className="wrap focus" id="main">
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

          {/* Mode switcher */}
          <div className="focus-modes" role="tablist" aria-label="โหมดตัวจับเวลา">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pomodoro"}
              className={"focus-mode " + (mode === "pomodoro" ? "active" : "")}
              onClick={() => switchMode("pomodoro")}
            >
              <Timer size={15} aria-hidden="true" /> Pomodoro
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "stopwatch"}
              className={"focus-mode " + (mode === "stopwatch" ? "active" : "")}
              onClick={() => switchMode("stopwatch")}
            >
              <Clock size={15} aria-hidden="true" /> Stopwatch
            </button>
          </div>

          {/* ─────────────────── POMODORO ─────────────────── */}
          {mode === "pomodoro" && (
            <section className="focus-timer-card" aria-label="ตัวจับเวลาโฟกัสแบบ Pomodoro">

              {/* Phase tag */}
              <div className="pm-phase">
                {pomo && pomo.phase === "focus" && !pomo.freshRoundComplete && (
                  <span className="pm-phase-tag focus"><Sparkles size={13} aria-hidden="true" /> โฟกัสงาน</span>
                )}
                {pomo && pomo.phase === "break" && (
                  <span className="pm-phase-tag break"><Coffee size={13} aria-hidden="true" /> พัก</span>
                )}
                {pomo && pomo.freshRoundComplete && (
                  <span className="pm-phase-tag focus">✅ รอบนี้เสร็จแล้ว</span>
                )}
                {!pomo && <span className="pm-phase-tag idle"><Moon size={13} aria-hidden="true" /> ยังไม่เริ่ม</span>}
              </div>

              {/* Countdown */}
              <div className="focus-elapsed" role="timer" aria-live="off">
                {pomo && !pomo.freshRoundComplete
                  ? fmtCountdown(pmRemaining)
                  : (pomo && pomo.freshRoundComplete
                    ? "00:00"
                    : fmtCountdown(pomo ? (pomo.phase === "focus" ? pomo.focusMin : pomo.breakMin) * 60000 : 25 * 60000))
                }
              </div>

              <div className="focus-sub">
                {pomo
                  ? (pomo.freshRoundComplete
                    ? `รอบที่ ${pomo.round} เสร็จแล้ว — ทำต่อได้เลย`
                    : (pomo.running
                      ? (pomo.phase === "focus" ? "กำลังโฟกัส…" : "พักเบรก…")
                      : "หยุดชั่วคราว"))
                  : "เลือก preset แล้วเริ่มได้เลย"}
              </div>

              {/* Round indicator */}
              {pomo && (
                <div className="pm-rounds" title={`รอบที่ ${pmPhaseIndex} / ${pomo.totalRounds}`}>
                  {Array.from({ length: Math.max(1, pomo.totalRounds) }).map((_, i) => (
                    <span
                      key={i}
                      className={"pm-dot " + (i + 1 <= pomo.round ? (pomo.phase === "break" && i + 1 === pomo.round ? " done" : "fill") : "")}
                    />
                  ))}
                  <span className="pm-rounds-txt">รอบที่ {Math.min(pomo.round, pomo.totalRounds)} / {pomo.totalRounds}</span>
                </div>
              )}

              {/* Progress bar */}
              {pomo && (
                <div className="pm-progress" aria-hidden="true">
                  <div className={"pm-progress-bar " + (pomo.phase === "break" ? "break" : "focus")} style={{ width: pmPhasePct + "%" }} />
                </div>
              )}

              {/* Fresh-round-complete actions (DO NOT force a stop) */}
              {pomo && pomo.freshRoundComplete && (
                <div className="focus-ctrl">
                  <button type="button" className="focus-btn" onClick={pmBreak}>
                    <Coffee size={18} aria-hidden="true" /> พัก {pomo.breakMin} นาที
                  </button>
                  <button type="button" className="focus-btn primary" onClick={pmNextFocus}>
                    <Play size={18} aria-hidden="true" /> ทำต่อเลย
                  </button>
                </div>
              )}

              {/* Primary start / pause / reset (hidden while waiting after a round) */}
              {(!pomo || !pomo.freshRoundComplete) && (
                <>
                  {/* Presets when idle */}
                  {!pomo && (
                    <div className="pm-presets">
                      {PRESETS.map((p) => (
                        <button type="button" key={p.label} className="pm-preset" onClick={() => pmStartPreset(p)}>
                          {p.label}
                          <span className="pm-preset-min">{p.focus}โฟกัส/{p.brk}พัก</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="focus-ctrl">
                    {pomo && !pomo.running ? (
                      <button type="button" className="focus-btn primary" onClick={pmToggleRun}>
                        <Play size={18} aria-hidden="true" /> เริ่ม / ต่อ
                      </button>
                    ) : pomo && pomo.running ? (
                      <button type="button" className="focus-btn" onClick={pmToggleRun}>
                        <Pause size={18} aria-hidden="true" /> หยุดชั่วคราว
                      </button>
                    ) : null}

                    {pomo && (
                      <button type="button" className="focus-btn ghost" onClick={pmReset} aria-label="รีเซ็ตโพโมโดร่า">
                        <RotateCcw size={16} aria-hidden="true" /> เริ่มใหม่
                      </button>
                    )}
                  </div>

                  {/* Presets while paused (change durations) */}
                  {pomo && !pomo.running && !pomo.freshRoundComplete && (
                    <div className="pm-presets small">
                      {PRESETS.map((p) => (
                        <button type="button" key={p.label} className="pm-preset" onClick={() => pmNew(p.focus, p.brk, p.rounds)}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* ─────────────────── STOPWATCH (original) ─────────────────── */}
          {mode === "stopwatch" && (
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
          )}

          {/* Complete */}
          <section className="focus-done">
            <button
              type="button"
              className="focus-btn complete"
              onClick={complete}
              disabled={!canEdit}
              title={canEdit ? "ทำเสร็จแล้ว → ซ่อนจากรายการ" : "ต้องล็อกอินเป็นเจ้าของก่อน complete ได้"}
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