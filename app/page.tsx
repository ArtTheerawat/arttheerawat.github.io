"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { dataUrl, fmtMoney } from "@/lib/data";

const TILES = [
  {
    href: "/today",
    ico: "📚",
    t: "เช็คงานวันนี้",
    d: "การบ้าน / งานค้าง / ครบกำหนดวันนี้ + แจ้งเตือนสอบ",
  },
  {
    href: "/schedule",
    ico: "🗓️",
    t: "ตารางเรียน",
    d: "คาบเรียนรายสัปดาห์ + วิชาชดเชย · คลิกวิชาเห็นงานที่ต้องส่ง",
  },
  {
    href: "/trading",
    ico: "📊",
    t: "Trading Dashboard",
    d: "XAUUSD / BTC · Performance · P&L · Signals",
  },
  {
    href: "/dictation",
    ico: "🔊",
    t: "Dictation Trainer",
    d: "Experiential English 89520664 · ฝึกฟัง + ตรวจเสียงลงท้าย -s/-ed ก่อนสอบ",
  },
];

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

/** Format a big number with Thai thousand separators. */
function fmt(n: number | undefined): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return new Intl.NumberFormat("th-TH").format(Math.round(n));
}

function orPercent(or: OpenRouterUsage | undefined): string {
  if (!or || or.total_credits === undefined || or.usage === undefined) return "—";
  const pct = (or.usage / or.total_credits) * 100;
  return pct.toFixed(1) + "%";
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
  const h = Math.floor(mins / 60);
  return `${h} ชม.ที่แล้ว`;
}

export default function HomePage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      // OpenRouter usage: live from the serverless proxy (key stays server-side).
      // 9arm usage: read from the synced data.json (no public API exists).
      const [orRes, hubRes] = await Promise.all([
        fetch("/api/usage", { cache: "no-store" }),
        fetch(dataUrl("/data.json"), { cache: "no-store" }),
      ]);
      const orJson = orRes.ok ? await orRes.json() : null;
      const hubJson = hubRes.ok ? await hubRes.json() : null;
      const n9 = hubJson?.usage?.["9arm"] ?? null;
      if (orJson || n9) {
        setUsage({
          openrouter: orJson ?? undefined,
          "9arm": n9 ?? undefined,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      setErr("โหลดข้อมูล usage ล้มเหลว: " + (e instanceof Error ? e.message : String(e)));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // refresh every min
    return () => clearInterval(t);
  }, [load]);

  const or = usage?.openrouter;
  const n9 = usage?.["9arm"];

  return (
    <div className="wrap">
      <div className="hero">
        <div className="logo">🎛️</div>
        <div>
          <h1>
            Thee<span className="dot">Deck</span>
          </h1>
          <div className="sub">ศูนย์บัญชาการส่วนตัวของธีรวัฒน์</div>
        </div>
      </div>

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
            {/* ── OpenRouter card ── */}
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

                  <div className="u-note">
                    บัญชีเติมเงิน (credit) — ไม่มีรอบ reset อัตโนมัติ · เติมเงินเมื่อใกล้หมด
                  </div>
                </>
              )}
            </div>

            {/* ── 9arm card ── */}
            <div className="u-card n9">
              <div className="u-prov">
                <span className="u-dot" />
                <span className="u-name">9arm</span>
                <span className={`u-state ${(n9?.status === "ok" || (n9 && (n9.calls ?? 0) > 0)) ? "on" : ""}`}>
                  {n9?.status === "error" ? "error" : (n9?.calls ?? 0) > 0 ? "ใช้งานอยู่" : "ยังไม่ใช้"}
                </span>
              </div>

              {n9?.status === "error" || (n9?.calls ?? 0) === 0 ? (
                <div className="u-empty">
                  {n9?.error || "ยังไม่มีข้อมูล — เรียก 9arm แล้วจะสะสมตรงนี้"}
                </div>
              ) : (
                <>
                  <div className="u-big">{fmt(n9?.tokens_total)}</div>
                  <div className="u-sub">tokens รวม · {fmt(n9?.calls)} calls</div>

                  <div className="u-stats">
                    <span>input {fmt(n9?.tokens_in)}</span>
                    <span>output {fmt(n9?.tokens_out)}</span>
                  </div>

                  <div className="u-note">
                    {n9?.last_model ? `รุ่น: ${n9.last_model} · ` : ""}
                    สะสมจากสคริปต์ 9arm_qwen.py
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