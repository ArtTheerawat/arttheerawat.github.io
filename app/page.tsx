"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTodo, CalendarDays, CandlestickChart, Headphones, Zap, type LucideIcon } from "lucide-react";
import { classifyAssignment, dataUrl, fmtDate, fmtMoney, nowBKKHour, todayIdxBKK, todayLabelBKK, todayStr, type Bucket } from "@/lib/data";
import { SCHEDULE, COURSES } from "@/lib/schedule-data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import { HideButton } from "@/components/HiddenTasks";

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
function fmtDue(iso?: string): string {
  return fmtDate(iso);
}

export default function HomePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageErr, setUsageErr] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState<boolean>(true); // true until first result
  const [assign, setAssign] = useState<Assignment[]>([]);
      const [aiBrief, setAiBrief] = useState<NextActionBrief | null>(null);
      const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | null>(null);
    const { hiddenList, hide, canEdit } = useHiddenTasks();

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

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

  /* Load today's assignments */
    const loadAssign = useCallback(async () => {
      try {
        const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          setAssign((j.todo || []).map((a: Assignment) => ({ ...a })));
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

      {/* ── Next action (most important piece) ── */}
            {aiBrief ? (
              <section className={`next-card ${aiBrief.items![0]?.why?.includes("เลย") ? "is-over" : aiBrief.items![0]?.dueLabel?.includes("วันนี้") ? "is-today" : "is-soon"}`}>
                <div>
                                  <div className="next-badge">⚡ ควรทำตอนนี้</div>
                                  <div className="next-brief-sub">{aiBrief.day_label || "ประจำวันนี้"} · {aiBrief.items!.length} อันดับ{aiBrief.model ? ` · ${aiBrief.model}` : ""}</div>
                                </div>
                <div className="next-body">
                  {aiBrief.brief && <div className="next-brief-line">{aiBrief.brief}</div>}
                  <ol className="next-ai-list">
                    {aiBrief.items!.map((it, i) => (
                      <li key={i} className={i === 0 ? "top" : ""}>
                        <div className="nai-head">
                          <span className="nai-rank">{i === 0 ? "ตอนนี้" : `ถัดไป ${i}`}</span>
                          <span className="nai-title">{it.title}</span>
                          <span className="nai-go">
                            <Link href="/today">→</Link>
                          </span>
                        </div>
                        <div className="nai-meta">
                          {it.course && <span className="nai-course">{it.course}</span>}
                          {it.dueLabel && <span>⏰ {it.dueLabel}</span>}
                          {it.effort_hr && <span>⏱ {it.effort_hr}</span>}
                        </div>
                        {it.why && <div className="nai-why">💡 {it.why}</div>}
                      </li>
                    ))}
                  </ol>
                  <div className="next-meta">
                    <span className="next-go"><Link href="/today">ดูรายละเอียด →</Link></span>
                  </div>
                </div>
              </section>
            ) : stats.next ? (
        <section className={`next-card ${stats.next.bucket === "over" ? "is-over" : stats.next.bucket === "today" ? "is-today" : "is-soon"}`}>
          <div className="next-badge">
                      {stats.next.bucket === "over"
                        ? "เลยกำหนด"
                        : stats.next.bucket === "today"
                        ? "ครบวันนี้"
                        : "ต่อไป"}
          </div>
          <div className="next-body">
                        <div className="next-subj">{stats.next.courseName || stats.next.course || ""}</div>
                        <div className="next-ttl" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ minWidth: 0 }}>{stats.next.title || "งาน"}</span>
                          <HideButton
                                                                              compact
                                                                              canEdit={canEdit}
                                                                              assignment={stats.next}
                                                                              onHide={async (r, c) => {
                                                                                    const ok = await hide(stats.next, r, c);
                                                                                    if (ok) showToast(`ซ่อน "${stats.next.title}" แล้ว 🙈`);
                                                                                  }}
                                                    />
                        </div>
                        <div className="next-meta">
                          {stats.next.due && <span>⏰ {fmtDue(stats.next.due)}</span>}
                          <span className="next-go">
                            <Link href="/today">ดูรายละเอียด →</Link>
                          </span>
                        </div>
                      </div>
        </section>
      ) : (
        <section className="next-card empty">
          <div className="next-badge">ชิล ๆ</div>
          <div className="next-body">
            <div className="next-ttl" style={{ fontSize: 15 }}>วันนี้ไม่มีงานค้าง / ครบส่ง</div>
            <div className="next-meta">
              <span className="next-go">
                <Link href="/today">ดูงานหน้าต่อไป →</Link>
              </span>
            </div>
          </div>
        </section>
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
          </div>
        );
      }