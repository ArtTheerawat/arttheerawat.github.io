"use client";

// System Health — สถานะระบบ
//
// A compact view telling the owner whether the important parts of the personal
// TheeDeck system are actually working, derived from REAL sync telemetry
// (the last-success timestamps baked into the static data files) — NOT from
// "the page loads" or "the cron exists".
//
// Status is computed deterministically in lib/health.ts (no AI, no fabricated
// results). The page reads the same static JSON files Home / Today read, so it
// works on the static GitHub Pages export and degrades gracefully: a failure to
// load becomes UNKNOWN, never a made-up HEALTHY.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSystemHealth, type HealthService, type HealthStatus } from "@/lib/health";

const STATUS_UI: Record<HealthStatus, { dot: string; label: string; badge: string }> = {
  healthy: { dot: "🟢", label: "ทำงานปกติ", badge: "h-healthy" },
  stale: { dot: "🟡", label: "ข้อมูลล่าช้า", badge: "h-stale" },
  error: { dot: "🔴", label: "เกิดข้อผิดพลาด", badge: "h-error" },
  unknown: { dot: "⚪", label: "ไม่ทราบสถานะ", badge: "h-unknown" },
};

/** Aggregate the overall status from the per-service statuses (deterministic). */
function overall(services: HealthService[]): { dot: string; label: string; badge: string } {
  if (services.length === 0) return { dot: "⚪", label: "ไม่สามารถโหลดสถานะ", badge: "h-unknown" };
  if (services.some((s) => s.status === "error"))
    return { dot: "🔴", label: "มีระบบขัดข้อง", badge: "h-error" };
  if (services.some((s) => s.status === "stale"))
    return { dot: "🟡", label: "มีบางระบบล่าช้า", badge: "h-stale" };
  if (services.every((s) => s.status === "unknown"))
    return { dot: "⚪", label: "ยังไม่มีข้อมูล", badge: "h-unknown" };
  return { dot: "🟢", label: "ทำงานปกติ", badge: "h-healthy" };
}

function ServiceRow({ s }: { s: HealthService }) {
  const ui = STATUS_UI[s.status];
  return (
    <div className="h-row">
      <span className="h-ico" aria-hidden="true">{s.icon}</span>
      <div className="h-main">
        <div className="h-name">
          {s.name}
          {s.href && (
            <Link className="h-link" href={s.href} aria-label={`เปิด ${s.name}`}>
              ↗
            </Link>
          )}
        </div>
        <div className="h-detail">
          <span className={`h-badge ${ui.badge}`}>
            <span className="h-dot" aria-hidden="true">{ui.dot}</span>
            {ui.label}
          </span>
          {s.dataAge && <span className="h-fresh">ข้อมูลล่าสุด: {s.dataAge}</span>}
        </div>
        <div className="h-meta">
          {s.lastSuccess && <span>สำเร็จล่าสุด: {s.lastSuccess}</span>}
          {s.lastAttempt && <span>ลองครั้งล่าสุด: {s.lastAttempt}</span>}
        </div>
      </div>
    </div>
  );
}

export default function SystemHealthPage() {
  const [services, setServices] = useState<HealthService[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getSystemHealth()
      .then((h) => {
        setServices(h.services);
        setError(null);
      })
      .catch((e) => {
        setError("โหลดสถานะระบบไม่ได้: " + (e instanceof Error ? e.message : String(e)));
        setServices([]);
      })
      .finally(() => setReady(true));
  };

  useEffect(() => {
    load();
  }, []);

  const agg = useMemo(() => overall(services), [services]);
  const errCount = services.filter((s) => s.status === "error").length;
  const staleCount = services.filter((s) => s.status === "stale").length;
  const unknownCount = services.filter((s) => s.status === "unknown").length;

  return (
    <div className="wrap" id="main">
      <header className="today-head">
        <div>
          <h1>
            สถานะ<span className="dot">ระบบ</span>
          </h1>
          <div className="sub">ระบบส่วนตัวของธีรวัฒน์ทำงานปกติไหม (จากข้อมูลซิงก์จริง)</div>
        </div>
      </header>

      {!ready ? (
        <div className="src" role="status" aria-live="polite">
          กำลังตรวจสอบสถานะระบบ…
        </div>
      ) : error ? (
        <div className="err" role="alert">⚠ {error}</div>
      ) : (
        <>
          {/* Overall summary banner */}
          <section className="h-agg" aria-live="polite">
            <span className={`h-badge h-agg-badge ${agg.badge}`}>
              <span className="h-dot" aria-hidden="true">{agg.dot}</span>
              ภาพรวมระบบ: {agg.label}
            </span>
            <span className="h-agg-meta">
              {services.length} ระบบ · {staleCount} ล่าช้า · {errCount} ขัดข้อง · {unknownCount} ไม่ทราบ
            </span>
          </section>

          {/* Per-service list */}
          <section className="h-list" aria-label="สถานะแต่ละระบบ">
            {services.map((s) => (
              <ServiceRow key={s.id} s={s} />
            ))}
          </section>

          {/* Note on telemetry scope */}
          <div className="h-note">
            รายงานนี้ประเมินจากเวลาที่ระบบซิงก์ข้อมูลสำเร็จครั้งล่าสุดในไฟล์ข้อมูล
            (ระบบล่าช้า/ขัดข้อง = การซิงก์หยุดยาวกว่ารอบปกติ)
          </div>
        </>
      )}
    </div>
  );
}