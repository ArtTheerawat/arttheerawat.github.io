// Client-side helpers for the hub pages.

export const DAYS = [
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัสบดี",
  "ศุกร์",
  "เสาร์",
  "อาทิตย์",
];

export const TH_MONTHS = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

/** Serial number (Excel/Google Sheets date) -> JS Date. */
const EPOCH_OFFSET = 25569; // days from 1899-12-30 to 1970-01-01
export const SERIAL_DAY_MS = 86400 * 1000;

export function serialToDate(n: number): Date {
  return new Date((n - EPOCH_OFFSET) * SERIAL_DAY_MS);
}

/** Parse "1,234.56" style numbers tolerant of $/₹/spaces. */
export function num(v: unknown): number {
  const n = parseFloat(String(v).replace(/[,$₹\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

export function fmtMoney(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

/**
 * Format a trade/signal timestamp. Accepts either a serial number (float that
 * looks like > 40000) or a literal date string. Returns Thai-locale string.
 */
export function fmtTimestamp(t: unknown): string | null {
  if (!t) return null;
  const n = num(t);
  if (n > 40000) {
    return serialToDate(n).toLocaleString("th-TH", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return String(t);
}

/** Today's ISO date string (YYYY-MM-DD) in local (not UTC) time. */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Whole-day date difference (due - today) in days, computed in LOCAL time.
 * Negative = overdue, 0 = today, positive = days remaining.
 * Parses "YYYY-MM-DD" dates only. Returns null when due is missing/invalid.
 */
export function dueDiffDays(due?: string | null): number | null {
  if (!due) return null;
  const p = due.split("-");
  if (p.length < 3 || p.some((s) => isNaN(+s))) return null;
  const t = new Date(+p[0], +p[1] - 1, +p[2]).getTime(); // local midnight
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - todayMid) / 86400000);
}

export type Bucket = "over" | "today" | "soon" | "later";

/**
 * Classify an assignment (fire-and-forget: also writes bucket/daysAway/overdue
 * back onto the object) into a deadline bucket, computed fresh in LOCAL time.
 *  - over  : overdue -> overdue = days late
 *  - today : due today
 *  - soon  : 1..5 days away -> daysAway = days remaining
 *  - later : >5 days away -> daysAway = days remaining
 * Missing due → "soon" with 999 days (matches existing behaviour).
 */
export function classifyAssignment(a: {
  due?: string | null;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}): Bucket {
  const diff = dueDiffDays(a.due);
  if (diff === null) {
    a.bucket = "soon";
    a.overdue = 0;
    a.daysAway = 999;
    return "soon";
  }
  if (diff < 0) {
    a.bucket = "over";
    a.overdue = -diff;
    a.daysAway = 0;
    return "over";
  }
  if (diff === 0) {
    a.bucket = "today";
    a.overdue = 0;
    a.daysAway = 0;
    return "today";
  }
  if (diff <= 5) {
    a.bucket = "soon";
    a.overdue = 0;
    a.daysAway = diff;
    return "soon";
  }
  a.bucket = "later";
  a.overdue = 0;
  a.daysAway = diff;
  return "later";
}

/** Human "due today"–style label for an assignment, given its computed bucket. */
export function dueLabel(a: { bucket?: Bucket; overdue?: number; daysAway?: number }): {
  txt: string;
  cls: string;
} {
  switch (a.bucket) {
    case "over":
      return { txt: "เลย " + (a.overdue ?? 0) + " วัน", cls: "b-over" };
    case "today":
      return { txt: "ครบวันนี้", cls: "b-today" };
    case "later":
    case "soon":
      return { txt: "ครบใน " + (a.daysAway ?? 0) + " วัน", cls: "b-soon" };
    default:
      return { txt: "ครบแล้ว", cls: "b-done" };
  }
}

/** Format YYYY-MM-DD -> "15 ม.ค." (Thai month abbrev). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const p = iso.split("-");
  const m = +p[1];
  const d = +p[2];
  return `${d} ${TH_MONTHS[m - 1]}`;
}

/** Thai Buddhist year from a JS Date year. */
export function thYear(y: number): number {
  return y + 543;
}

/** Thai date pieces {d, m, y(Buddhist)}. */
export function thDate(d: Date) {
  return { d: d.getDate(), m: d.getMonth() + 1, y: d.getFullYear() + 543 };
}

/** Day-of-week index 1..7 (1 = Mon .. 7 = Sun). */
export function thDayIdx(d: Date): number {
  return (d.getDay() + 6) % 7 + 1;
}

/** Your hosting sync URL: localhost dev vs deployed export both serve from public/. */
export function dataUrl(path: string): string {
  return `${path}?t=${Date.now()}`;
}