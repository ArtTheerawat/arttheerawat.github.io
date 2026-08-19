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

/** Parse "1,234.56" style numbers tolerant of $/₹/spaces.
 *  Invalid/blank input → 0 (legacy behaviour many KPI call-sites rely on).
 *  If you need to distinguish "invalid" from a real 0, use `numOrNull` instead. */
export function num(v: unknown): number {
  return numOrNull(v) ?? 0;
}

/** Like `num` but returns `null` (instead of 0) when the value cannot be parsed
 *  as a finite number. Use where a bad value must NOT be silently counted as a
 *  real zero (KPI validation, totals). */
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = String(v).replace(/[,$₹\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(v: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

/**
 * Format a trade/signal timestamp. Accepts either a serial number (float that
 * looks like > 40000) or a literal date string. Returns Thai-locale string,
 * or `null` for anything blank/invalid (never a garbled string).
 */
export function fmtTimestamp(t: unknown): string | null {
  if (t === null || t === undefined || t === "") return null;
  // Literal ISO-ish date string? Parse it cleanly before falling back.
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}/.test(t.trim())) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("th-TH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return null; // malformed ISO date — don't echo a broken string
  }
  // Excel/Sheets serial number: only treat as a date when finite in range.
  const n = numOrNull(t);
  if (n !== null && n > 40000) {
    const d = serialToDate(n);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString("th-TH", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  // Non-date string (e.g. a label) — echo verbatim as text.
  return String(t);
}

/** Bangkok timezone — the app is a Thai personal dashboard, so ALL \"now\"
 *  calculations must anchor to Asia/Bangkok regardless of where the Next.js
 *  server (SSR) or user agent (hydrate) happens to be. Without a fixed
 *  timezone you get server-vs-browser date divergence (e.g. server renders
 *  ``17/08`` while the browser hydrates to ``18/08`` after midnight Thai time). */
export const TH_TIMEZONE = "Asia/Bangkok";

/** Now as a JS Date normalised to the Bangkok wall-clock day (localtime-safe
 *  for day maths). Prefer this over bare ``new Date()`` everywhere "today"
 *  in Thailand is meant. */
export function nowBKK(): Date {
  const now = new Date();
  // Convert to a Date whose local fields reflect Bangkok's wall clock:
  // Bangkok is UTC+7 (no DST), so shift by the current UTC offset diff.
  const bkkParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TH_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) =>
    parseInt(
      (bkkParts.find((p) => p.type === t) || { value: "0" }).value,
      10
    );
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Today's ISO date string (YYYY-MM-DD) in Bangkok time. Use everywhere a
 *  human-visible "today" date is rendered or used for day-diff maths. */
export function todayStr(): string {
  const d = nowBKK();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Weekday index 1..7 (1=Mon..7=Sun) for TODAY in Bangkok time. */
export function todayIdxBKK(): number {
  return (nowBKK().getDay() + 6) % 7 + 1;
}

/** Current hour-of-day (0..23) in Bangkok time — for time-of-day greetings. */
export function nowBKKHour(): number {
  return nowBKK().getHours();
}

/** Thai weekday name for today in Bangkok time. */
export function todayLabelBKK(): string {
  return DAYS[(nowBKK().getDay() + 6) % 7];
}

/** Format a schedule hour (e.g. ``10.5`` = 10:30) as 24h ``"10:30"``.
 *  Single consistent time format across the site (matches Home's schedule),
 *  replaces the AM/PM ``fmt12`` used by the Schedule page. */
export function fmt24(h: number): string {
  const hh = String(Math.floor(h)).padStart(2, "0");
  const mm = h % 1 ? "30" : "00";
  return `${hh}:${mm}`;
}

/**
 * Strictly validate a "YYYY-MM-DD" date and return its LOCAL-midnight epoch ms.
 * Rejects partial strings and impossible dates (e.g. 2026-99-99, 2026-02-31)
 * instead of letting Date silently roll them over. Returns `null` when the
 * input is missing or not a real calendar date.
 */
export function parseIsoDateLocal(due?: string | null): number | null {
  if (!due) return null;
  const s = due.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null; // not a clean YYYY-MM-DD
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to catch real calendar impossibilities (Feb 30,
  // Apr 31, non-leap Feb 29). Compare fields — never trust Date normalisation.
  const dt = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null; // e.g. 2026-02-31 rolls to 03-03 → rejected
  }
  return dt.getTime();
}

/**
 * Whole-day date difference (due - today) in days, computed in LOCAL time.
 * Negative = overdue, 0 = today, positive = days remaining.
 * Returns `null` when due is missing or malformed (see parseIsoDateLocal).
 */
export function dueDiffDays(due?: string | null): number | null {
  const t = parseIsoDateLocal(due);
  if (t === null) return null;
  const now = nowBKK();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - todayMid) / 86400000);
}

export type Bucket = "over" | "today" | "soon" | "later" | "no_due";

/**
 * Classify an assignment (fire-and-forget: also writes bucket/daysAway/overdue
 * back onto the object) into a deadline bucket, computed fresh in LOCAL time.
 *  - over  : overdue -> overdue = days late
 *  - today : due today
 *  - soon  : 1..5 days away -> daysAway = days remaining
 *  - later : >5 days away -> daysAway = days remaining
 *  - no_due: missing or malformed due date (never a fake countdown).
 */
export function classifyAssignment(a: {
  due?: string | null;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}): Bucket {
  const diff = dueDiffDays(a.due);
  if (diff === null) {
    a.bucket = "no_due";
    a.overdue = 0;
    a.daysAway = 0;
    return "no_due";
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
      case "no_due":
        return { txt: "ยังไม่ระบุกำหนดส่ง", cls: "b-done" };
      case "over":
        return { txt: "เลย " + (a.overdue ?? 0) + " วัน", cls: "b-over" };
      case "today":
        return { txt: "ครบวันนี้", cls: "b-today" };
      case "later":
      case "soon":
        return { txt: "ครบใน " + (a.daysAway ?? 0) + " วัน", cls: "b-soon" };
      default:
        return { txt: "ยังไม่ระบุกำหนดส่ง", cls: "b-done" };
    }
  }

/** Format YYYY-MM-DD -> "15 ม.ค." (Thai month abbrev). Blank or malformed
 *  input → "—" (never "undefined undefined"). */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!p) return "—"; // don't echo broken dates as if valid
  const m = +p[2];
  const d = +p[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return "—";
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

/**
 * Build a URL for a data file served from public/ (static export + GitHub Pages).
 *
 * RATIONALE for cache-busting: this personal dashboard is exported as a static
 * site, and data.json / assignments.json / schedule.json are re-written on a
 * schedule (cron pulls from Google). A plain URL has no default TTL, so the
 * browser/CDN may serve stale numbers for a long time. The timestamp query
 * forces a fresh fetch each call — the intended behaviour for DATA files that
 * genuinely change. For a single-user page the bandwidth is negligible, and
 * correctness here beats caching.
 *
 * For files that DON'T change (static assets), pass `{ cache: true }` so the
 * browser/CDN can actually cache them.
 */
export function dataUrl(path: string, opts: { cache?: boolean } = {}): string {
  if (opts.cache) return path;
  return `${path}?t=${Date.now()}`;
}