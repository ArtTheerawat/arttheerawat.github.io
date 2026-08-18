// ─────────────────────────────────────────────────────────────────────────────
// Domain data models — the ONLY data shapes UI and Services should know about.
//
// These are deliberately database-agnostic: they carry no Supabase / D1 column
// names or query syntax. The DatabaseAdapter (lib/db/adapter.ts) is responsible
// for mapping backend rows <-> these models, so swapping the backend (e.g.
// Supabase → Cloudflare D1) only touches the adapter, never the pages/services.
// ─────────────────────────────────────────────────────────────────────────────

/** A single trade (from the trading bot log). */
export interface Trade {
  timestamp?: unknown; // string | Excel serial | null — page formats it
  symbol?: string;
  direction?: string;
  volume?: unknown;
  entry?: string;
  tp?: string;
  sl?: string;
  netPnl?: unknown;
  status?: string;
}

/** A trading signal row. */
export interface Signal {
  timestamp?: unknown;
  symbol?: string;
  signal?: string;
  direction?: string;
  confidence?: string;
  d1Trend?: string;
  h1Trend?: string;
  entryZone?: string;
  status?: string;
}

/** Daily performance summary row. */
export interface PerfDay {
  date?: string;
  totalTrades?: unknown;
  wins?: unknown;
  losses?: unknown;
  winrate?: unknown;
  netPnl?: unknown;
  balance?: unknown;
}

/** A classroom coursework (assignment) row. */
export interface Coursework {
  title?: string;
  due?: string;
  dueTime?: string;
  state?: string;
  id?: string;
  courseName?: string;
  courseId?: string;
}

/** A classroom announcement row. */
export interface Announcement {
  text?: string;
  time?: string;
  id?: string;
  courseName?: string;
  courseId?: string;
}

/** A course bucket grouping coursework + announcements (page-facing view). */
export interface CourseGroup {
  name?: string;
  id?: string;
  coursework?: Coursework[];
  announcements?: Announcement[];
}

/** The full classroom data-set a page renders. */
export interface ClassroomData {
  generated_at?: string;
  courses?: CourseGroup[];
}

/** A hidden-task row (global hide set). */
export interface HiddenTask {
  key: string;
  course: string;
  title: string;
  due?: string;
  reason: string; // e.g. "wrong-due" | "already-submitted" | "cancelled" | "other"
  custom?: string; // free text when reason === "other"
  hiddenAt: string; // ISO timestamp
}

/** Minimal signed-in user info (for owner gating). */
export interface DbUser {
  id: string;
  email?: string;
  name?: string;
}

/** A per-assignment manual override for the "ไปที่ Classroom" deep link,
 *  synced cross-device via Supabase (global set, owner-only writes), keyed
 *  by the same stable task_key as HiddenTask (course|title|due). */
export interface LinkOverride {
  key: string;             // task_key == hidden-like stable key (course|title|due)
  url: string;             // fully-qualified https:// URL the owner chose
  updatedAt: string;       // ISO timestamp
}

/** A single notification generated deterministically by lib/notifications.ts.
 *  Notifications are *derived* data (computed in the browser from the same
 *  data files the pages read), so the table only stores READ STATE keyed by a
 *  stable notif_key for cross-device dedup; the notification body is always
 *  recomputed fresh. */
export interface NotificationItem {
  key: string;             // stable dedup key, e.g. taskKey|over, quiz|date|summary
  kind: "overdue" | "due-today" | "due-soon" | "quiz" | "announcement" | "system";
  title: string;           // short Thai title
  body: string;            // Thai detail line
  href?: string;           // where the notification navigates when clicked
  order: number;           // sort weight (higher = more urgent)
}

/** Persisted read-state for a notification key. `read` true → not shown as unread. */
export interface NotificationRead {
  key: string;
  read: boolean;
  readAt: string;          // ISO timestamp
}