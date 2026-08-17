"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DAYS, dataUrl, fmtMoney } from "@/lib/data";
import { SCHEDULE, COURSES } from "@/lib/schedule-data";

/* ── Quick-access tiles (keep as secondary nav, not the hero) ── */
const TILES = [
  { href: "/schedule", ico: "🗓️", t: "ตารางเรียน", d: "คาบเรียนรายสัปดาห์ + วิชาชดเชย" },
  { href: "/trading", ico: "📊", t: "Trading Dashboard", d: "XAUUSD / BTC · Performance · P&L" },
  { href: "/dictation", ico: "🔊", t: "Dictation Trainer", d: "ฝึกฟัง + ตรวจเสียง -s/-ed" },
  { href: "/today", ico: "📚", t: "ดูงานทั้งหมด", d: "ทุกวิชา · กำหนดส่ง · แจ้งเตือนสอบ" },
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
interface NineArmUsage {
  status?: string;
  tokens_in?: number;
  tokens_out?: number;
  tokens_total?: number;
  calls?: number;
  last_model?: string;
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
  bucket?: string;
  overdue?: number;
}

type Bucket = "over" | "today" | "soon" | "later";

/** Classify an assignment into a deadline bucket (same logic as /today). */
function classify(a: Assignment): Bucket {
  if (!a.due) return "soon";
  const t = new Date(a.due + "T00:00:00");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const diff = Math.round((t.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "over";
  if (diff === 0) return "today";
  if (diff <= 5) return "soon";
  return "later";
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
  if (!iso) return "";
  const p = iso.split("-");
  const m = +p[1], d = +p[2];
  const thM = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  return `${d} ${thM[m - 1]}`;
}

export default function HomePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [assign, setAssign] = useState<Assignment[]>([]);

  /* Today's date + weekday (local) */
  const now = new Date();
  const todayIso = new Date().toISOString().slice(0, 10);
  const dayIdx = (now.getDay() + 6) % 7 + 1; // 1=Mon..7=Sun
  const dayLabel = DAYS[(now.getDay() + 6) % 7];

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
    setErr(null);
    try {
      const [orRes, hubRes] = await Promise.all([
        fetch("/api/usage", { cache: "no-store" }),
        fetch(dataUrl("/data.json"), { cache: "no-store" }),
      ]);
      const orJson = orRes.ok ? await orRes.json() : null;
      const hubJson = hubRes.ok ? await hubRes.json() : null;
      const n9 = hubJson?.usage?.["9arm"] ?? null;
      if (orJson || n9) {
        setUsage({ openrouter: orJson ?? undefined, "9arm": n9 ?? undefined, updated_at: new Date().toISOString() });
      }
    } catch (e) {
      setErr("โหลดข้อมูล usage ล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
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

  useEffect(() => {
    load();
    loadAssign();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, loadAssign]);

  /* Deadline stats from today's perspective */
  const stats = useMemo(() => {
    const over: Assignment[] = [], tod: Assignment[] = [], soon: Assignment[] = [];
    assign.forEach((a) => {
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
  }, [assign]);

  const or = usage?.openrouter;
  const n9 = usage?.["9arm"];

  const heroCount = stats.over.length + stats.tod.length;
  const hasUrgent = heroCount > 0;
  const timeGreet = now.getHours() < 12 ? "สวัสดีตอนเช้า" : now.getHours() < 17 ? "สวัสดีตอนบ่าย" : "สวัสดีตอนเย็น";

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
      {stats.next ? (
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
            <div className="next-ttl">{stats.next.title || "งาน"}</div>
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

      {/* ── Quick access ── */}
      <h2 className="sec-title quick">⚡ เข้าถึงด่วน</h2>
      <div className="cards">
        {TILES.map((tl) => (
          <Link key={tl.href} href={tl.href} className="tile">
            <div className="ico">{tl.ico}</div>
            <div className="t">{tl.t}</div>
            <div className="d">{tl.d}</div>
            <div className="go">เปิด →</div>
          </Link>
        ))}
      </div>

      {/* ── AI Token Usage (kept, moved below quick access) ── */}
      <section className="cards-sec usage-sec">
        <h2>
          ⚡ AI Token Usage
          <span className="tag">อัปเดต {timeAgoOr(usage?.updated_at) || usage?.updated_at || "—"}</span>
        </h2>

        {err ? (
          <div className="err">{err}</div>
        ) : !usage ? (
          <div className="src">กำลังโหลดข้อมูล usage…</div>
        ) : (
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
                  {or?.error || or?.status === "error" ? "เชื่อม API ไม่ได้" : "ยังไม่มีข้อมูล"}
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
                  <div className="u-note">
                    {n9?.last_model ? `รุ่น: ${n9.last_model} · ` : ""}สะสมจากสคริปต์ 9arm_qwen.py
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </section>

      <footer>Auto-generated · ข้อมูลเรียนเชื่อม Google Classroom + Calendar</footer>
    </div>
  );
}