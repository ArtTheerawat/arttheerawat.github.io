// Hidden-task helpers for the hub. Hides assignments without touching the
// Google-Classroom-synced source (public/data/assignments.json stays intact).
// State lives in localStorage — no DB needed.
//
// Stable task key = course + title + due. Because `due` is part of the key, if
// a professor CHANGES the due date the key changes too, so the task re-appears
// as a "new" task (guard against genuinely missing a real deadline).

export interface HiddenTask {
  key: string;
  course: string;
  title: string;
  due?: string;
  reason: string; // e.g. "wrong-due" | "already-submitted" | "cancelled" | "other"
  custom?: string; // free text when reason === "other"
  hiddenAt: string; // ISO timestamp
}

export interface Hiddenable {
  course?: string;
  title?: string;
  due?: string;
}

const STORAGE_KEY = "theedeck.hiddenTasks.v1";

/** Build a stable key for an assignment (course + normalized title + due). */
export function taskKey(a: Hiddenable): string {
  const course = (a.course || "").trim();
  const title = (a.title || "").trim();
  const due = (a.due || "").trim();
  return [course, title, due].join("|");
}

function safeParse(raw: string | null): HiddenTask[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x) => x && typeof x.key === "string" && typeof x.reason === "string"
    ) as HiddenTask[];
  } catch {
    return [];
  }
}

export function loadHiddenTasks(): HiddenTask[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function persist(list: HiddenTask[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage full / unavailable — ignore, in-memory state still works for the session */
  }
}

/** Is the given assignment currently hidden? */
export function isTaskHidden(a: Hiddenable, list: HiddenTask[]): boolean {
  const k = taskKey(a);
  return list.some((h) => h.key === k);
}

/** Hide an assignment. Returns the updated list. */
export function hideTask(
  list: HiddenTask[],
  a: Hiddenable,
  reason: string,
  custom?: string
): HiddenTask[] {
  const key = taskKey(a);
  const next = list.filter((h) => h.key !== key);
  next.unshift({
    key,
    course: (a.course || "").trim(),
    title: (a.title || "").trim(),
    due: (a.due || "").trim() || undefined,
    reason,
    custom: reason === "other" ? (custom || "").trim() : undefined,
    hiddenAt: new Date().toISOString(),
  });
  persist(next);
  return next;
}

/** Un-hide (restore) an assignment. Returns the updated list. */
export function unhideTask(list: HiddenTask[], key: string): HiddenTask[] {
  const next = list.filter((h) => h.key !== key);
  persist(next);
  return next;
}

/** Remove every hidden entry. Returns []. */
export function clearHiddenTasks(): HiddenTask[] {
  persist([]);
  return [];
}

/** Filter an assignment draft for strictly canonical fields (no bucket noise). */
export function canonicalAssignment(a: Hiddenable, list: HiddenTask[]): {
  a: Hiddenable;
  hidden: boolean;
} {
  return { a, hidden: isTaskHidden(a, list) };
}

/** REASON_LABELS: stable labels + ids shown in the hide modal. */
export const HIDE_REASONS: { id: string; label: string }[] = [
  { id: "wrong-due", label: "อาจารย์ตั้งกำหนดส่งผิด" },
  { id: "already-submitted", label: "ส่งแล้ว แต่ระบบยังไม่อัปเดต" },
  { id: "cancelled", label: "ยกเลิกงาน" },
  { id: "other", label: "อื่น ๆ" },
];

export function reasonLabel(id: string): string {
  const hit = HIDE_REASONS.find((r) => r.id === id);
  return hit ? hit.label : id;
}