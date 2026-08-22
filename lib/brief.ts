// lib/brief.ts
// ───────────────────────────────────────────────────────────────────────────
// Morning-Brief — shared data contract for the AI "Morning Brief" card.
//
// EVERYTHING that renders the AI brief (Home, /today, components/MorningBriefCard)
// reads these types so the JSON produced by generate_next_action.py and the
// client cannot drift apart. Keep this the single source of truth for the
// shape of public/data/next_action.json.
//
// Design rule (from the product brief): this is an AI *summary* layer ONLY.
// Priority/ranking comes from the deterministic rule engine (lib/priority.ts);
// the fields here are the natural-language explanation + metadata, never the
// decider. "Warning" is a synthetic, data-derived flag line — the AI may phrase
// it but must derive it from the same pre-computed inputs (it must not invent
// deadlines or events).
// ───────────────────────────────────────────────────────────────────────────

/** One line of a morning-brief item — what/why, no computed deadline. */
export interface BriefItem {
  title: string;
  /** course code + name (as produced by generate_next_action.py) */
  course: string;
  /** Thai due phrase, pre-computed by the script (e.g. "เลยกำหนด 4 วันแล้ว"). */
  dueLabel: string;
  /** Subjective effort estimate ONLY when a signal exists (never fabricated). */
  effort_hr?: string;
  /** Short Thai reason — why now (deadline proximity / effort / difficulty). */
  why?: string;
}

/** A data-derivable caution line (overdue wave, exam near, missing info…). */
export interface BriefWarning {
  /** Thai, short. e.g. "มีงานเลยกำหนด 2 รายการที่ยังไม่ได้รองรับ" */
  text: string;
  /** severity hint: "warn" | "danger" | "info" */
  level?: "warn" | "danger" | "info";
  /** canonical kind for filtering: overdue_count|due_tomorrow|overdue_detail|exam_near */
  kind?: string;
}

/**
 * The full morning-brief document (write shape of generate_next_action.py,
 * read shape of the client). Mirror any change here with the script.
 */
export interface MorningBrief {
  /** ISO timestamp of generation (client uses it for the "generated" line). */
  generated_at: string;
  /** ISO date this brief is "for" (often same day as generated_at). */
  date: string;
  /** Human Thai day label, e.g. "ประจำวัน 18 ส.ค." */
  day_label: string;
  /** model id actually used for this generation. */
  model?: string;
  /** Stable hash of the source data inputs used (assignments/schedule), so we
   *  can tell when a brief was built from stale inputs. */
  source_version?: string;
  /** One-line natural summary of "today's overview + what matters most". */
  brief: string;
  /** Optional explicit warning lines (safe/honest: only when data supports it). */
  warnings?: BriefWarning[];
  /** Top relevant items (1–3). items[0] should be what to do first. */
  items: BriefItem[];
}