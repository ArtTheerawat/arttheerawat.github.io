"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTodo, CalendarDays, CandlestickChart, Headphones, Zap, type LucideIcon } from "lucide-react";
import { classifyAssignment, dataUrl, dueDiffDays, fmtMoney, nowBKKHour, todayIdxBKK, todayLabelBKK, todayStr, type Bucket } from "@/lib/data";
import { SCHEDULE, COURSES, MAKEUP } from "@/lib/schedule-data";
import { filterVisibleBriefItems, useHiddenTasks } from "@/lib/hidden-tasks";
import { HideButton } from "@/components/HiddenTasks";
import NextActionCard from "@/components/NextActionCard";
import { computeNextAction, type PriorityTask } from "@/lib/priority";

/* ── Quick-access tiles ──
   Split into PRIMARY (study-critical: tasks + schedule — surface first and
   more prominent) and SECONDARY (support tools: trading + dictation — grouped
   below as plain "quick access"). Keeps task priority readable. */
type Tile = { href: string; Icon: LucideIcon; t: string; d: string };
const PRIMARY_TILES: Tile[] = [
  { href: "/today", Icon: ListTodo, t: "งานวันนี้", d: "ทุกวิชา · กำหนดส่ง · แจ้งเตือนสอบ" },
  { href: "/schedule", Icon: CalendarDays, t: "ตารางเรียน", d: "คาบเรียนรายสัปดาห์ + วิชาชดเชย" },
];
const SECONDARY_TILES: Tile[] = [
  { href: "/trading", Icon: CandlestickChart, t: "Trading Dashboard", d: "XAUUSD / BTC · Performance · P&L" },
  { href: "/dictation", Icon: Headphones, t: "Dictation Trainer", d: "ฝึกฟัง + ตรวจเสียง -s/-ed" },
];

/* ── Usage data types (unchanged) ── */
interface OpenRouterUsage {
  status?: string;
  usage?: number;
  remaining?: number;
  total_credits?: number;
  usage_daily?: number;
  usage_weekly?: number;
  usage_monthly?: number;
  is_free_tier?: boolean;
  error?: string;
  updated_at?: string;
}
interface NineArmModel {
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  calls?: number;
  last_used?: string;
}
interface NineArmUsage {
  status?: string;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  calls?: number;
  last_model?: string;
  by_model?: Record<string, NineArmModel>;
  error?: string;
  updated_at?: string;
}
interface UsageData {
  openrouter?: OpenRouterUsage;
  "9arm"?: NineArmUsage;
  updated_at?: string;
}

interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}

/* AI-generated NEXT ACTION brief (from generate_next_action.py). */
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

/** 2 fixed 9arm model slots shown on the card (keep even if a model is unused). */
const NINE_MODELS: { id: string; label: string }[] = [
  { id: "qwen3.8-27b-fp8", label: "qwen3.8-27b-fp8" },
  { id: "deepseek-v4-flash-0731", label: "deepseek-v4-flash-0731" },
];

/** Classify an assignment into a deadline bucket (logic lives in lib/data). */
function classify(a: Assignment): Bucket {
  return classifyAssignment(a);
}

function fmt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return new Intl.NumberFormat("th-TH").format(Math.round(n));
}
function orPercent(or: OpenRouterUsage | undefined): string {
  if (!or || or.total_credits === undefined || or.usage === undefined) return "—";
  return ((or.usage / or.total_credits) * 100).toFixed(1) + "%";
}
function orPctCls(or: OpenRouterUsage | undefined): string {
  if (!or || or.usage === undefined || !or.total_credits) return "";
  const pct = (or.usage / or.total_credits) * 100;
  if (pct >= 85) return "u-high";
  if (pct >= 60) return "u-mid";
  return "";
}
function timeAgoOr(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  return `${Math.floor(mins / 60)} ชม.ที่แล้ว`;
}
/** Convert a PriorityTask into the Home page's Assignment shape so the shared
 *  HideButton can act on the deterministic next-action pick. */
function asHideAssignment(p: PriorityTask): Assignment {
  const daysAway = p.due ? dueDiffDays(p.due) : null;
  return {
    title: p.title,
    course: p.course,
    courseName: p.courseName,
    due: p.due,
    bucket: (p.bucket || "no_due") as Bucket,
    overdue: p.bucket === "over" ? 1 : 0,
    daysAway: daysAway !== null && daysAway >= 0 ? daysAway : undefined,
  };
}

export default function HomePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState<boolean>(true); // true until first result
  const [assign, setAssign] = useState<Assignment[]>([]);
        const [quizzes, setQuizzes] = useState<{ date?: string; summary?: string }[]>([]);
        const [aiBrief, setAiBrief] = useState<NextActionBrief | null>(null);
      const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | null>(null);
    const { hiddenList, hide, canEdit } = useHiddenTasks();

  const showToast = (msg: string) => {
      setToast(msg);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), 2600);
    };

    /* Resolve the effective "ไปที่ Classroom" URL for the open task: manual
       override (localStorage) wins, then deep-link to the assignment, then
       course-level link. */
    const taskClassroomLink = (): { href: string; editable: boolean } => {
      if (!detailTask) return { href: "", editable: false };
      const manual = linkOverrides[detailTask.key];
      if (manual) return { href: manual, editable: true };
      const nameKey =
        (detailTask.courseName || "").trim() + "\u0001" + (detailTask.title || "").trim();
      const cw = courseWorkMap[nameKey];
      const gid = courseMap[detailTask.course];
      if (cw && gid) {
        return {
          href: `https://classroom.google.com/u/0/c/${gid}/a/${cw.workId}`,
          editable: true,
        };
      }
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
    useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  /* Next-action detail modal (same affordance as /today) — "ดูรายละเอียด →"
     used to navigate to /today; now it opens an in-page task sheet instead. */
  const [detailTask, setDetailTask] = useState<PriorityTask | null>(null);
      const detailModalRef = useRef<HTMLDivElement | null>(null);
      const [courseMap, setCourseMap] = useState<Record<string, string>>({});
      const [courseWorkMap, setCourseWorkMap] = useState<Record<string, { courseId: string; workId: string }>>({});
      const [linkOverrides, setLinkOverrides] = useState<Record<string, string>>({});
      const [editingLink, setEditingLink] = useState<string | null>(null);
  useEffect(() => {
    if (!detailTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetailTask(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailTask]);

  // Course-id map for the "ไป classroom" deep link (code -> Google courseId).
    useEffect(() => {
      (async () => {
        try {
          const r = await fetch(dataUrl("/data/course_id_map.json", { cache: true }), { cache: "force-cache" });
          if (r.ok) {
            const m: Record<string, string> = await r.json();
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
          /* optional */
        }
      })();
      try {
        const saved = window.localStorage.getItem("td_link_overrides");
        if (saved) setLinkOverrides(JSON.parse(saved));
      } catch {
        /* ignore */
      }
    }, []);

  /* Today's date + weekday (Bangkok time — single source of truth) */
    const todayIso = todayStr();
    const dayIdx = todayIdxBKK(); // 1=Mon..7=Sun
    const dayLabel = todayLabelBKK();
    const hourBKK = nowBKKHour();

  /* Today's classes from the weekly schedule */
  const todayClasses = useMemo(() => {
    return SCHEDULE.filter((s) => s.day === dayIdx).map((s) => ({
      code: s.code,
      name: COURSES[s.code]?.name || s.code,
      color: COURSES[s.code]?.color || "#22d3ee",
      start: s.start,
      end: s.end,
      room: s.room,
    }));
  }, [dayIdx]);

  /* Load usage (openrouter proxy + 9arm from data.json) */
    const load = useCallback(async () => {
      setUsageErr(null);
      setUsageLoading(true);
      try {
        const [orRes, hubRes] = await Promise.all([
          fetch("/api/usage", { cache: "no-store" }),
          fetch(dataUrl("/data.json"), { cache: "no-store" }),
        ]);
        let orJson: OpenRouterUsage | null = null;
        if (orRes.ok) {
          orJson = await orRes.json();
        }
        const hubJson = hubRes.ok ? await hubRes.json() : null;
        const n9 = hubJson?.usage?.["9arm"] ?? null;
        if (orJson || n9) {
          // At least one source succeeded → show what we have. A failed source
          // keeps its card in an "unavailable" state (never an endless loader).
          setUsage({ openrouter: orJson ?? undefined, "9arm": n9 ?? undefined, updated_at: new Date().toISOString() });
        } else {
          // Harden toast/error messaging: distinguish "not configured" from an
          // auth gate (401/403) from a real outage.
          const bothDown = !orRes.ok && !hubRes.ok;
          setUsageErr(
            orRes.status === 401 || orRes.status === 403
              ? "เข้าสู่ระบบเพื่อดูข้อมูล AI usage หรือคุณไม่มีสิทธิ์ดูข้อมูลนี้"
              : bothDown
              ? `ไม่สามารถโหลดข้อมูล usage ได้ (OpenRouter ${orRes.status}/สัญญาณ, data ${hubRes.status}/สัญญาณ)`
              : "ยังไม่มีการตั้งค่าข้อมูล usage — ไม่พบข้อมูลจากทั้งสองแหล่ง"
          );
        }
      } catch (e) {
        setUsageErr("โหลดข้อมูล usage ล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setUsageLoading(false);
      }
    }, []);

  /* Load today's assignments + schedule quizzes (for the priority engine) */
      const loadAssign = useCallback(async () => {
        try {
          const [r, s] = await Promise.all([
            fetch(dataUrl("/data/assignments.json"), { cache: "no-store" }),
            fetch(dataUrl("/data/schedule.json"), { cache: "no-store" }),
          ]);
          if (r.ok) {
            const j = await r.json();
            setAssign((j.todo || []).map((a: Assignment) => ({ ...a })));
          }
          if (s.ok) {
            const sj = await s.json();
            setQuizzes((sj.quizzes || []).map((q: { date?: string; summary?: string }) => ({ ...q })));
          }
        } catch {
          /* assignments optional on home — don't break hero */
        }
      }, []);

    /* Load the AI NEXT-ACTION brief. Optional — the page falls back to the
       client-side heuristic (stats.next) when the file is absent or stale. A brief
       is considered fresh for ~36h (so a Monday briefer shows through the weekend). */
    const loadAiBrief = useCallback(async () => {
      try {
        const r = await fetch(dataUrl("/data/next_action.json"), { cache: "no-store" });
        if (!r.ok) return;
        const j: NextActionBrief = await r.json();
        if (!j.items || j.items.length === 0) return;
        const t = j.generated_at ? new Date(j.generated_at).getTime() : 0;
        if (isNaN(t) || Date.now() - t > 36 * 3600 * 1000) return; // stale
        setAiBrief(j);
      } catch {
        /* keep heuristic fallback */
      }
    }, []);

  useEffect(() => {
        load();
        loadAssign();
        loadAiBrief();
        // Usage is secondary data — poll every 5 min instead of every 60s to cut
        // needless OpenRouter calls from the dashboard (primary info is schedule/
        // assignments, which load on page open).
        const t = setInterval(load, 5 * 60 * 1000);
        return () => clearInterval(t);
      }, [load, loadAssign, loadAiBrief]);

  /* Deadline stats from today's perspective (classify writes bucket back so
         the "what's next" card colours/flag correctly). */
    /* Hidden assignments are always excluded first — they must not count in
         the hero numbers or be picked as the next action. */
    const stats = useMemo(() => {
      const over: Assignment[] = [], tod: Assignment[] = [], soon: Assignment[] = [];
      assign.forEach((a) => {
              const k = (a.course || "").trim() + "|" + (a.title || "").trim() + "|" + (a.due || "").trim();
              if (hiddenList.some((h) => h.key === k)) return;
        const b = classify(a);
        if (b === "over") over.push(a);
        else if (b === "today") tod.push(a);
        else if (b === "soon") soon.push(a);
      });
      // "What to do next": due-today first (beatable deadline), then overdue (longest-overdue first), else nearest.
      const next =
        tod[0] ||
        over.slice().sort((p, q) => ((q.due || "") < (p.due || "") ? -1 : 1))[0] ||
        soon.slice().sort((p, q) => ((p.due || "") < (q.due || "") ? -1 : 1))[0] ||
        ([...over, ...tod, ...soon][0] || null);
      return { over, tod, soon, next };
                }, [assign, hiddenList]);

            /* Deterministic Priority / Next-Action engine (lib/priority.ts).
               Replaces the crude "nearest deadline" heuristic as the source of truth
               for the next-action card (Home + /today share this exact computation).
               Time-availability uses today's weekly classes + makeup sessions. */
            const sessions = useMemo(
              () => [...SCHEDULE, ...MAKEUP] as { day?: number; date?: string; start?: number; end?: number; code?: string }[],
              []
            );
            const hiddenFilter = useMemo<(k: string) => boolean>(
              () => (k: string) => hiddenList.some((h) => h.key === k),
              [hiddenList]
            );
            const engine = useMemo(
                    () => computeNextAction(assign, quizzes, sessions, hiddenFilter),
                    [assign, quizzes, sessions, hiddenFilter]
                  );

          /* Filter hidden tasks out of the AI next-brief. The brief (next_action.json)
             is written by a morning cron that has no knowledge of the hidden_tasks set,
             so we must cross-check its items against hiddenList here. Match by title
             (the brief has no raw due; its course is "code + name" while the hidden
             key's course is the bare code), cross-checked that the course agrees. */
        const aiVisibleItems = useMemo(
            () => (aiBrief ? filterVisibleBriefItems(aiBrief.items, hiddenList) : []),
            [aiBrief, hiddenList]
          );

  const or = usage?.openrouter;
  const n9 = usage?.["9arm"];

  const heroCount = stats.over.length + stats.tod.length;
    const hasUrgent = heroCount > 0;
    const timeGreet = hourBKK < 12 ? "สวัสดีตอนเช้า" : hourBKK < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";

  return (
    <div className="wrap">
      {/* ── Hero: personal command center ── */}
      <div className="hero">
        <div className="logo">🎛️</div>
        <div>
          <h1>
            Thee<span className="dot">Deck</span>
          </h1>
          <div className="sub">ศูนย์บัญชาการส่วนตัวของธีรวัฒน์</div>
        </div>
      </div>

      {/* ── Today strip ── */}
      <section className="today-strip">
        <div className="today-greet">
          <div className="today-who">{timeGreet}, ธีรวัฒน์ 👋</div>
          <div className="today-date">
            {dayLabel} · {todayIso.split("-").reverse().join("/")} · เรียน {todayClasses.length} วิชา
          </div>
        </div>
        <div className="today-stats">
          <Link href="/today" className={`ts ts-red ${stats.over.length ? "live" : ""}`}>
            <b>{stats.over.length}</b>
            <span>เลยกำหนด</span>
          </Link>
          <Link href="/today" className={`ts ts-warn ${stats.tod.length ? "live" : ""}`}>
            <b>{stats.tod.length}</b>
            <span>ครบวันนี้</span>
          </Link>
          <Link href="/today" className={`ts ts-blue ${stats.soon.length ? "live" : ""}`}>
            <b>{stats.soon.length}</b>
            <span>ใกล้ถึง (5 วัน)</span>
          </Link>
          <Link href="/schedule" className="ts ts-cyan">
            <b>{todayClasses.length}</b>
            <span>วิชาเรียนวันนี้</span>
          </Link>
        </div>
      </section>

      {/* ── Next action (most important piece) ──
                Source of truth = deterministic Priority Engine (lib/priority.ts),
                computed in code, no AI. The old AI morning brief (when present &
                fresh) is kept as a thin additive summary strip on top — it never
                decides priority anymore. */}
            {aiBrief && aiVisibleItems.length > 0 && (
              <div className="next-brief-line" style={{ marginBottom: 6 }}>
                🧠 {aiBrief.brief || "สรุปวันนี้"}{aiBrief.model ? ` · (${aiBrief.model})` : ""}
              </div>
            )}
            <NextActionCard
                          result={engine}
                          detailHref="/today"
                          detailLabel="ดูรายละเอียด →"
                          onDetail={() => engine.next && setDetailTask(engine.next)}
                        />
            {engine.state === "action" && engine.ranked.length > 1 && (
              <div style={{ marginTop: -6 }}>
                {engine.ranked.slice(0, 3).map((p, i) => (
                  <div className="prio-rank" key={p.key}>
                    <div className="prio-rank-head">
                      <span className={"prio-dot " + (p.level === "HIGH" ? "prio-high" : p.level === "MEDIUM" ? "prio-med" : "prio-low")} />
                      <span className="prio-rank-num">{i === 0 ? "ตอนนี้" : `ถัดไป ${i + 1}`}</span>
                      <span className="prio-rank-title">{p.title}</span>
                      {i === 0 ? (
                        <HideButton
                          compact
                          canEdit={canEdit}
                          assignment={asHideAssignment(p)}
                          onHide={async (r, c) => {
                            const ok = await hide(asHideAssignment(p), r, c);
                            if (ok) showToast(`ซ่อน "${p.title}" แล้ว 🙈`);
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="prio-rank-meta">
                      <span className="prio-course">{p.courseName || p.course}</span>
                      {p.dueLabel && <span>⏰ {p.dueLabel}</span>}
                      {p.recommendedStart && <span>🕐 {p.recommendedStart}</span>}
                    </div>
                    {p.reasons.length > 0 && <div className="prio-reasons">💡 {p.reasons.join(" · ")}</div>}
                  </div>
                ))}
              </div>
            )}

      {/* ── Today's classes preview ── */}
      {todayClasses.length > 0 && (
        <section className="today-classes">
          <h2 className="sec-title">
            📅 เรียนวันนี้ <span className="cnt">{todayClasses.length} คาบ</span>
          </h2>
          <div className="cls-list">
            {todayClasses
              .slice()
              .sort((a, b) => a.start - b.start)
              .map((c, i) => (
                <div className="cls" key={i} style={{ borderLeftColor: c.color }}>
                  <div className="cls-time">
                    {String(Math.floor(c.start)).padStart(2, "0")}:{c.start % 1 ? "30" : "00"}–{String(Math.floor(c.end)).padStart(2, "0")}:{c.end % 1 ? "30" : "00"}
                  </div>
                  <div className="cls-info">
                    <div className="cls-name">{c.name}</div>
                    <div className="cls-room">{c.room}</div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ── Primary: study-critical quick actions ── */}
                  <div className="cards primary-first">
                    {PRIMARY_TILES.map((tl) => {
                      const Icon = tl.Icon;
                      return (
                        <Link key={tl.href} href={tl.href} className="tile primary">
                          <div className="ico"><Icon aria-hidden="true" /></div>
                          <div className="t">{tl.t}</div>
                          <div className="d">{tl.d}</div>
                          <div className="go">เปิด →</div>
                        </Link>
                      );
                    })}
                  </div>

                  {/* ── Secondary tools ── */}
                  <h2 className="sec-title quick"><Zap aria-hidden="true" /> เข้าถึงด่วน</h2>
                  <div className="cards">
                    {SECONDARY_TILES.map((tl) => {
                      const Icon = tl.Icon;
                      return (
                        <Link key={tl.href} href={tl.href} className="tile">
                          <div className="ico"><Icon aria-hidden="true" /></div>
                          <div className="t">{tl.t}</div>
                          <div className="d">{tl.d}</div>
                          <div className="go">เปิด →</div>
                        </Link>
                      );
                    })}
                  </div>

      {/* ── AI Token Usage (kept, moved below quick access) ── */}
      <section className="cards-sec usage-sec">
        <h2>
                  <Zap aria-hidden="true" /> AI Token Usage
                  <span className="tag">อัปเดต {timeAgoOr(usage?.updated_at) || usage?.updated_at || "—"}</span>
                </h2>

        {usageErr && (
                  <div role="alert" className="err">
                    {usageErr}{" "}
                    <button
                      type="button"
                      className="retry-btn"
                      onClick={load}
                      disabled={usageLoading}
                    >
                      {usageLoading ? "กำลังลองใหม่…" : "ลองใหม่"}
                    </button>
                  </div>
                )}

                {usageLoading && !usage && (
                  <div className="src" role="status" aria-live="polite">
                    กำลังโหลดข้อมูล usage…
                  </div>
                )}

                {!usage && !usageLoading && !usageErr && (
                  <div className="src" role="status">
                    ยังไม่มีการตั้งค่าข้อมูล usage — ลองรีเฟรชหรือกดปุ่มด้านบน
                  </div>
                )}

                {usage && (
                  <>
                    {usageLoading && (
                      <div className="src stale" role="status" aria-live="polite">
                        กำลังอัปเดตข้อมูล… (ยังแสดงข้อมูลล่าสุด)
                      </div>
                    )}
                    <div className="usage-grid">
            <div className="u-card or">
              <div className="u-prov">
                <span className="u-dot" />
                <span className="u-name">OpenRouter</span>
                <span className={`u-state ${or?.status === "ok" ? "on" : ""}`}>
                  {or?.status === "ok" ? "ออนไลน์" : or?.status ?? "—"}
                </span>
              </div>
              {or?.usage === undefined || or.total_credits === undefined ? (
                              <div className="u-empty">
                                {or?.status === "unconfigured"
                                  ? "ยังไม่ได้ตั้งค่า OpenRouter (OPENROUTER_API_KEY)"
                                  : or?.error || or?.status === "error"
                                  ? "เชื่อม API ไม่ได้ — ลองอีกครั้ง"
                                  : "ยังไม่มีข้อมูล"}
                              </div>
                            ) : (
                <>
                  <div className="u-big">${fmtMoney(or.usage)}</div>
                  <div className="u-sub">ใช้ไปจาก ${fmtMoney(or.total_credits)}</div>
                  <div className="u-meter">
                    <div className={`u-meter-fill ${orPctCls(or)}`} style={{ width: `${Math.min(100, (or.usage / or.total_credits) * 100)}%` }} />
                  </div>
                  <div className="u-meter-row">
                    <span className={`u-pct ${orPctCls(or)}`}>{orPercent(or)}</span>
                    <span className="u-remain">เหลือ ${fmtMoney(or.remaining ?? 0)}</span>
                  </div>
                  {or.usage_daily !== undefined && (
                    <div className="u-stats">
                      <span>วันนี้ ${fmtMoney(or.usage_daily)}</span>
                      <span>สัปดาห์ ${fmtMoney(or.usage_weekly ?? 0)}</span>
                      <span>เดือน ${fmtMoney(or.usage_monthly ?? 0)}</span>
                    </div>
                  )}
                  <div className="u-note">บัญชีเติมเงิน (credit) — ไม่มีรอบ reset อัตโนมัติ · เติมเงินเมื่อใกล้หมด</div>
                </>
              )}
            </div>

            <div className="u-card n9">
                          <div className="u-prov">
                            <span className="u-dot" />
                            <span className="u-name">9arm</span>
                            <span className={`u-state ${(n9?.status === "ok" || (n9 && (n9.calls ?? 0) > 0)) ? "on" : ""}`}>
                              {n9?.status === "error" ? "error" : (n9?.calls ?? 0) > 0 ? "ใช้งานอยู่" : "ยังไม่ใช้"}
                            </span>
                          </div>
                          {n9?.status === "error" || (n9?.calls ?? 0) === 0 ? (
                            <div className="u-empty">{n9?.error || "ยังไม่มีข้อมูล — เรียก 9arm แล้วจะสะสมตรงนี้"}</div>
                          ) : (
                            <>
                              <div className="u-big">{fmt(n9?.tokens_total)}</div>
                              <div className="u-sub">tokens รวม · {fmt(n9?.calls)} calls</div>
                              <div className="u-stats">
                                <span>input {fmt(n9?.tokens_in)}</span>
                                <span>output {fmt(n9?.tokens_out)}</span>
                              </div>
                              {/* per-model breakdown: 2 fixed slots (qwen + deepseek) */}
                                                            <div className="n9-models">
                                                              {NINE_MODELS.map((mDef) => {
                                                                const m = n9?.by_model?.[mDef.id];
                                                                return (
                                                                  <div className={`n9-model ${m ? "live" : ""}`} key={mDef.id}>
                                                                    <div className="n9m-head">
                                                                      <span className="n9m-name">{mDef.label}</span>
                                                                      <span className="n9m-calls">
                                                                        {m ? `${fmt(m.calls)} calls` : "ยังไม่ใช้"}
                                                                      </span>
                                                                    </div>
                                                                    {m ? (
                                                                      <>
                                                                        <div className="n9m-tok">{fmt(m.tokens_total)} tokens</div>
                                                                        <div className="n9m-io">in {fmt(m.tokens_in)} · out {fmt(m.tokens_out)}</div>
                                                                      </>
                                                                    ) : (
                                                                      <div className="n9m-tok empty">—</div>
                                                                    )}
                                                                  </div>
                                                                );
                                                              })}
                                                            </div>
                                                            <div className="u-note">
                                                              {n9?.last_model ? `รุ่นล่าสุด: ${n9.last_model} · ` : ""}สะสมจากสคริปต์ 9arm_qwen.py
                                                            </div>
                            </>
                          )}
                        </div>
                                </div>
                                  </>
                                )}
                              </section>

      <footer>Auto-generated · ข้อมูลเรียนเชื่อม Google Classroom + Calendar</footer>
            {toast && <div className="hide-toast">{toast}</div>}

                        {detailTask && (
                          <div
                            ref={detailModalRef}
                            className="detail-modal open"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="home-detail-title"
                            onClick={(e) => e.target === e.currentTarget && setDetailTask(null)}
                          >
                            <div className="sheet">
                              <div className="hh">
                                <div>
                                  <h2 id="home-detail-title">{detailTask.title}</h2>
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
                                {detailTask.effortHr && (
                                  <span className="badge b-soon">⏱ {detailTask.effortHr}</span>
                                )}
                                {detailTask.recommendedStart && (
                                                      <span className="badge b-soon">🕐 {detailTask.recommendedStart}</span>
                                                    )}
                                                  </div>
                                                  {(() => {
                                                                                                    const { href, editable } = taskClassroomLink();
                                                                                                    const editing = editingLink === detailTask.key;
                                                                                                    const inputId = `link-input-${detailTask.key}`;
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
                                                                                                              id={inputId}
                                                                                                            />
                                                                                                            <button type="button" className="next-go-btn" onClick={() => saveOverride((document.getElementById(inputId) as HTMLInputElement)?.value || "")}>
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
                      </div>
                    );
                  }