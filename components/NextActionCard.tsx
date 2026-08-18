"use client";

// components/NextActionCard.tsx — REUSABLE "Next Action" surface for Home + /today.
//
// Renders the deterministic result of lib/priority.ts as a clean card:
//   • state action → the top task with a HIGH/MEDIUM/LOW badge, short reasons,
//     effort (when real signal exists) + recommended start time.
//   • state idle   → an honest "No urgent action right now" empty state
//                    (NEVER a fabricated recommendation).
//
// The raw 0–100 score is deliberately not shown — the UI exposes HIGH/MEDIUM/LOW
// + short reasons, per the product brief ("อย่าให้ frontend แสดง mathematical
// score แบบรกเกินไป").

import Link from "next/link";
import type { NextActionResult, PriorityTask } from "@/lib/priority";

function levelClass(level: PriorityTask["level"]): string {
  if (level === "HIGH") return "prio-high";
  if (level === "MEDIUM") return "prio-med";
  return "prio-low";
}

const LEVEL_LABEL: Record<PriorityTask["level"], string> = {
  HIGH: "สูงสุด",
  MEDIUM: "กลาง",
  LOW: "ต่ำ",
};

const BADGE_EMOJI: Record<PriorityTask["level"], string> = {
  HIGH: "🔥",
  MEDIUM: "⚡",
  LOW: "🕒",
};

function actionBadge(p: PriorityTask): JSX.Element {
  return (
    <span className={"prio-badge " + levelClass(p.level)}>
      {BADGE_EMOJI[p.level]} ควรทำตอนนี้ · {LEVEL_LABEL[p.level]}
    </span>
  );
}

/** A compact list item for the "top N" roster shown below the #1 pick. */
function RankItem({ p, rank }: { p: PriorityTask; rank: number }) {
  return (
    <li key={p.key} className={"prio-rank" + (rank === 0 ? " top" : "")}>
      <div className="prio-rank-head">
        <span className={"prio-dot " + levelClass(p.level)} />
        <span className="prio-rank-num">{rank === 0 ? "ตอนนี้" : `ถัดไป ${rank + 1}`}</span>
        <span className="prio-rank-title">{p.title}</span>
      </div>
      <div className="prio-rank-meta">
        <span className="prio-course">{p.courseName || p.course}</span>
        {p.dueLabel && <span>⏰ {p.dueLabel}</span>}
        {p.recommendedStart && <span>🕐 {p.recommendedStart}</span>}
      </div>
      {p.reasons.length > 0 && (
        <div className="prio-reasons">💡 {p.reasons.join(" · ")}</div>
      )}
    </li>
  );
}

interface NextActionCardProps {
  result: NextActionResult;
  /** Optional extra tail action (e.g. "ดูรายละเอียด →" rendered by the page). */
  detailHref?: string;
  detailLabel?: string;
  /** When provided, renders the tail action as a button that opens an
    in-page detail affordance (e.g. a modal) instead of navigating. Takes
    precedence over detailHref. */
  onDetail?: () => void;
  /** When provided on an actionable card, renders a "Start Focus" button that
    deep-links the chosen task into Focus Mode (/focus?key=<stable taskKey>).
    Only shown when there is a task to focus (action state). */
  focusHref?: string;
}

/** Tail action renderer: button (opens detail modal) if onDetail provided,
    otherwise a plain <Link> (existing navigation fallback). */
function DetailAction({
  href,
  label,
  onDetail,
}: {
  href?: string;
  label: string;
  onDetail?: () => void;
}) {
  if (onDetail) {
    return (
      <button
        type="button"
        className="next-go-btn"
        onClick={onDetail}
        aria-label={label}
      >
        {label}
      </button>
    );
  }
  if (href) {
    return <Link href={href}>{label}</Link>;
  }
  return null;
}

export default function NextActionCard({
  result,
  detailHref = "/today",
  detailLabel = "ดูรายละเอียด →",
  onDetail,
  focusHref,
}: NextActionCardProps) {
  if (result.state === "idle" || !result.next) {
    return (
      <section className="next-card empty">
        <div className="next-badge">ชิล ๆ</div>
        <div className="next-body">
          <div className="next-ttl" style={{ fontSize: 15 }}>
            ไม่มีงานด่วนที่ต้องทำตอนนี้
          </div>
          <div className="next-meta">
            {result.ranked.length > 0 && (
              <span>หางานล่าสุด {result.ranked.length} รายการ · ยังไม่มีกำหนดส่งกดดัน</span>
            )}
            {detailLabel && (
              <span className="next-go">
                <DetailAction href={detailHref} label={detailLabel} onDetail={onDetail} />
              </span>
            )}
          </div>
        </div>
      </section>
    );
  }

  const p = result.next;
  return (
    <section className={"next-card " + (p.bucket === "over" ? "is-over" : p.bucket === "today" ? "is-today" : "is-soon")}>
      <div>
        {actionBadge(p)}
        {result.brief && <div className="next-brief-sub">{result.brief}</div>}
      </div>
      <div className="next-body">
        {p.courseName && <div className="next-subj">{p.courseName}</div>}
        <div className="next-ttl">{p.title}</div>
        <div className="next-meta">
          {p.dueLabel && <span>⏰ {p.dueLabel}</span>}
          {p.effortHr && <span>⏱ {p.effortHr}</span>}
          {p.recommendedStart && <span>🕐 {p.recommendedStart}</span>}
        </div>
        {p.reasons.length > 0 && (
          <div className="prio-reasons">💡 {p.reasons.join(" · ")}</div>
        )}
        {detailLabel && (
          <div className="next-meta" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className="next-go">
              <DetailAction href={detailHref} label={detailLabel} onDetail={onDetail} />
            </span>
            {focusHref && (
              <span className="next-go">
                <Link href={focusHref} className="focus-chip" aria-label="เปิดโฟกัสโมดสำหรับงานนี้">
                  🎯 Start Focus
                </Link>
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}