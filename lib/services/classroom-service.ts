// Classroom service — the domain API pages use to load Classroom data. It owns
// the "Supabase first, static JSON fallback" strategy (previously inside the
// page) and calls the DatabaseAdapter via getDb(). Pages never touch Supabase.

import { getDb } from "../db";
import type { DataStatus } from "../data";
import type { CourseGroup } from "../db/types";

export interface ClassroomResult {
  courses: CourseGroup[];
  synced: string; // generated_at from static JSON; "" when from backend
  /** Data-source freshness: live / fallback / empty / error (partial not used
   *  here — classroom loads from one primary source). */
  status: DataStatus;
  loading: boolean;
  error: string | null;
}

interface StaticClassroomJson {
  generated_at?: string;
  courses?: CourseGroup[];
}

async function fetchStatic(): Promise<{ courses: CourseGroup[]; synced: string; error: string | null }> {
  try {
    const res = await fetch(`/data/classroom.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const j: StaticClassroomJson = await res.json();
      return { courses: j.courses || [], synced: j.generated_at || "", error: null };
    }
    return {
      courses: [],
      synced: "",
      error: "โหลดข้อมูลคลาสรูมไม่ได้ (HTTP " + res.status + ") — รอ cron ซิงก์แล้วลองใหม่",
    };
  } catch (e) {
    return {
      courses: [],
      synced: "",
      error: "โหลดข้อมูลล้มเหลว: " + (e instanceof Error ? e.message : String(e)),
    };
  }
}

/** Load Classroom data: live backend first, static JSON fallback. */
export async function loadClassroom(): Promise<ClassroomResult> {
  const db = getDb();
  const primary = await db.loadClassroom();
  // Truthy check on `primary.courses` is NOT enough — an empty array [] is also
  // truthy in JS, so it only means "the Supabase query succeeded", not "we have
  // real data". If Supabase is healthy but classroom_tasks / classroom_announcements
  // are empty (e.g. classroom_sync.py never fully synced), pages would render blank
  // and never fall back to the static JSON that has real data. Only trust the backend
  // when at least one course carries real coursework or a real announcement.
  if (
    primary.ok &&
    primary.courses &&
    primary.courses.some(
      (c) => (c.coursework?.length || 0) > 0 || (c.announcements?.length || 0) > 0
    )
  ) {
    return {
      courses: primary.courses,
      synced: "",
      status: "live",
      loading: false,
      error: null,
    };
  }
  // Backend healthy but tables empty → honest "ไม่มีข้อมูล", not a silent blank.
  if (primary.ok && primary.courses && primary.courses.length === 0) {
    return {
      courses: [],
      synced: "",
      status: "empty",
      loading: false,
      error: null,
    };
  }
  // Backend unavailable or errored → static JSON fallback.
  const fallback = await fetchStatic();
  const status: DataStatus = fallback.error
    ? "error"
    : fallback.courses.length > 0
    ? "fallback"
    : "empty";
  return {
    courses: fallback.courses,
    synced: fallback.synced,
    status,
    loading: false,
    error: fallback.error ?? primary.error ?? null,
  };
}