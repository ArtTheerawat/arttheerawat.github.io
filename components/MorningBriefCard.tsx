"use client";

// components/MorningBriefCard.tsx — REUSABLE "Morning Brief" surface for Home + /today.
//
// Combines the two layers the product brief wants shown as one coherent card:
//   1. AI summary strip (brief + warnings) from public/data/next_action.json
//      (lib/brief.ts types). This is the natural-language layer ONLY.
//   2. The DETERMINISTIC next action from lib/priority.ts (computeNextAction),
//      shown as "สิ่งที่ควรทำตอนนี้" — code decides priority, never the AI.
//
// Along with a footer showing when it was generated (plus the model + source
// version, so it's clear the brief reflects a specific data snapshot). When the
// AI layer is absent/stale, callers simply don't render the card (data-driven),
// so the page never shows a hallucinated or empty brief.

import type { MorningBrief } from "@/lib/brief";
import type { NextActionResult } from "@/lib/priority";
import { useMemo } from "react";

function levelClass(l?: string): string {
  if (l === "danger") return "mb-danger";
  if (l === "info") return "mb-info";
  return "mb-warn";
}

function warnIcon(l?: string): string {
  if (l === "danger") return "⛔";
  if (l === "info") return "ℹ️";
  return "⚠️";
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  if (mins < 1440) return `${Math.floor(mins / 60)} ชม.ที่แล้ว`;
  return `${Math.floor(mins / 1440)} วันก่อน`;
}

interface MorningBriefCardProps {
  brief: MorningBrief;
  /** Deterministic priority result (computeNextAction) — code decides "do now". */
  engine: NextActionResult;
  /** When provided, the tail action opens an in-page detail modal. */
  onDetail?: () => void;
}

export default function MorningBriefCard({ brief, engine, onDetail }: MorningBriefCardProps) {
  const warnings = useMemo(
    () => (Array.isArray(brief.warnings) ? brief.warnings : []),
    [brief.warnings]
  );
  const hasWarn = warnings.length > 0;

  const top = engine.state === "action" && engine.next ? engine.next : null;
  const generatedLine = relTime(brief.generated_at);
  const showTime = brief.generated_at ? ` · สร้าง ${generatedLine}` : "";

  return (
    <section className="mb-card">
      <header className="mb-head">
        <span className="mb-title">🌅 Morning Brief</span>
        <span className="mb-day">{brief.day_label}</span>
      </header>

      {brief.brief && <p className="mb-brief">{brief.brief}</p>}

      {hasWarn && (
        <ul className="mb-warns">
          {warnings.map((w, i) => (
            <li key={i} className={"mb-warn-row " + levelClass(w.level)}>
              <span className="mb-warn-ico">{warnIcon(w.level)}</span>
              <span>{w.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-next">
        <div className="mb-next-label">สิ่งที่ควรทำตอนนี้</div>
        {top ? (
          <div className="mb-next-body">
            <div className="mb-next-ttl">{top.title}</div>
            <div className="mb-next-meta">
              {top.courseName && <span className="mb-course">{top.courseName}</span>}
              {top.dueLabel && <span>⏰ {top.dueLabel}</span>}
              {top.effortHr && <span>⏱ {top.effortHr}</span>}
            </div>
            {top.reasons.length > 0 && (
              <div className="mb-reasons">💡 {top.reasons.join(" · ")}</div>
            )}
            {onDetail && (
              <button type="button" className="next-go-btn mb-go" onClick={onDetail}>
                ดูรายละเอียด →
              </button>
            )}
          </div>
        ) : (
          <div className="mb-next-idle">ไม่มีงานด่วนที่ต้องทำตอนนี้</div>
        )}
      </div>

      <footer className="mb-foot">
        <span>
          {brief.model ? `AI: ${brief.model}` : "AI"}
          {showTime}
        </span>
        {brief.source_version && <span className="mb-src">srcdb {brief.source_version}</span>}
      </footer>
    </section>
  );
}