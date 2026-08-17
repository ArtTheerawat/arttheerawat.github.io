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