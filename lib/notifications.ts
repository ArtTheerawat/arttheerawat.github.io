"use client";

// lib/notifications.ts — NOTIFICATION CENTER (SYSTEM 5)
//
// Centralized, deterministic notification feed for the personal hub.
//
// CONCEPT: notifications are DERIVED data. This module computes notification
// items purely from the SAME data files the pages already read (assignments +
// quizzes + announcements), using the existing date/bucket helpers in lib/data
// and the stable task-key convention in lib/hidden-tasks. No cron, no AI, no
// duplicated business logic, no fabricated sources.
//
// DEDUP: each source row maps to a STABLE notif_key (assignments reuse
// `course|title|due` — the same key hidden_tasks uses; quizzes use
// `date|title`). Read-state is persisted keyed by notif_key (Supabase + local
// fallback via lib/services/notifications-service). Because the feed is
// recomputed on every load and matched against that key, merely OPENING /today
// or Home NEVER creates a duplicate notification — the same keys resolve to the
// same single notifications. A source that stops meeting the rule simply stops
// emitting; nothing is auto-deleted from history.

import { useEffect, useMemo, useState, useCallback } from "react";
import { classifyAssignment, dueDiffDays, fmtDate, todayStr, type Bucket } from "./data";
import { taskKey } from "./hidden-tasks";
import type { NotificationItem } from "./db/types";
import {
  loadNotificationReads,
  upsertNotificationRead,
  markAllNotificationsRead,
} from "./services/notifications-service";

/* ──────────────────────────────────────────────────────────────────────────
 * Sources (the only things that can become notifications)
 * ──────────────────────────────────────────────────────────────────────────
 * These match exactly what the pages already read. Do NOT add sources here that
 * don't exist elsewhere in the repo. */

export interface NotifAssignment {
  title?: string;
  course?: string;         // course code
  courseName?: string;     // display name
  due?: string;
  bucket?: Bucket;
  overdue?: number;
  daysAway?: number;
}

export interface NotifQuiz {
  date?: string;
  summary?: string;
}

export interface NotifAnnouncement {
  courseName?: string;
  text?: string;
  time?: string;
}

export interface NotificationFeedInput {
  assignments?: NotifAssignment[];
  quizzes?: NotifQuiz[];
  announcements?: NotifAnnouncement[];
  /** Stable task keys (course|title|due) that must NOT generate notifications
   *  (the hidden-task set — reuse the same hide decision the pages apply). */
  excludedTaskKeys?: Set<string>;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Deterministic rule engine (pure)
 * ────────────────────────────────────────────────────────────────────────── */

/** The maximum number of notification items to keep per source bucket, so the
 *  feed stays readable on mobile without an oversized dashboard. */
const MAX_PER_BUCKET = 6;

const SORT_WEIGHT: Record<NotificationItem["kind"], number> = {
  overdue: 5000,
  "due-today": 4000,
  quiz: 3000,
  "due-soon": 2000,
  announcement: 1000,
  system: 0,
};

function clip(s?: string, n = 64): string {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Derive the full notification list. Pure + deterministic. */
export function buildNotifications(input: NotificationFeedInput): NotificationItem[] {
  const out: NotificationItem[] = [];
  const excluded = input.excludedTaskKeys || new Set<string>();

  // 1) Overdue assignments (never filtered: these are the most important).
  const over = (input.assignments || []).filter((a) => a.bucket === "over");
  for (const a of over.slice(0, MAX_PER_BUCKET)) {
    if (excluded.has(taskKey(a))) continue;
    out.push({
      key: taskKey(a) + "|over",
      kind: "overdue",
      title: "เลยกำหนด: " + clip(a.title),
      body: `${clip(a.courseName || a.course)} · เลย ${
        a.overdue ?? 1
      } วัน (เดิม ${fmtDate(a.due)})`,
      href: "/today",
      order: SORT_WEIGHT.overdue,
    });
  }

  // 2) Due today.
  const tod = (input.assignments || []).filter((a) => a.bucket === "today");
  for (const a of tod.slice(0, MAX_PER_BUCKET)) {
    if (excluded.has(taskKey(a))) continue;
    out.push({
      key: taskKey(a) + "|today",
      kind: "due-today",
      title: "ครบกำหนดวันนี้: " + clip(a.title),
      body: clip(a.courseName || a.course),
      href: "/today",
      order: SORT_WEIGHT["due-today"],
    });
  }

  // 3) Upcoming exams / activities (from schedule.json — the same "สอบ/กิจกรรม"
  //    shown on /today). Due soon includes quizzes within the next 5 days.
  const today = todayStr();
  const quizzes = (input.quizzes || []).filter((q) => {
    const diff = dueDiffDays(q.date);
    // show quiz/activity 0..5 days ahead (same horizon as the "ใกล้ถึง" bucket)
    return diff !== null && diff >= 0 && diff <= 5;
  });
  for (const q of quizzes.slice(0, MAX_PER_BUCKET)) {
    const diff = dueDiffDays(q.date)!;
    out.push({
      key: "quiz|" + (q.date || "") + "|" + (q.summary || "").trim(),
      kind: "quiz",
      title: "สอบ/กิจกรรม: " + clip(q.summary),
      body: diff === 0 ? "วันนี้!" : `${fmtDate(q.date)} · อีก ${diff} วัน`,
      href: "/schedule",
      order: SORT_WEIGHT.quiz - diff, // nearer = higher
    });
  }

  // 4) Due soon (1–5 days) — limited so it doesn't crowd out urgent items.
  const soon = (input.assignments || []).filter((a) => a.bucket === "soon");
  for (const a of soon.slice(0, MAX_PER_BUCKET)) {
    if (excluded.has(taskKey(a))) continue;
    out.push({
      key: taskKey(a) + "|soon",
      kind: "due-soon",
      title: "ใกล้ถึงกำหนด: " + clip(a.title),
      body: `${clip(a.courseName || a.course)} · อีก ${
        a.daysAway ?? 1
      } วัน (${fmtDate(a.due)})`,
      href: "/today",
      order: SORT_WEIGHT["due-soon"],
    });
  }

  // 5) Recent announcements (latest first, capped).
  const anns = (input.announcements || []).slice(0, 3);
  for (const a of anns) {
    out.push({
      key: "ann|" + clip(a.text, 40) + "|" + (a.time || ""),
      kind: "announcement",
      title: "ประกาศใหม่: " + clip(a.text, 48),
      body: clip(a.courseName || "ประกาศ") + (a.time ? " · " + fmtDate(a.time.slice(0, 10)) : ""),
      href: "/classroom",
      order: SORT_WEIGHT.announcement,
    });
  }

  return out.sort((a, b) => b.order - a.order);
}

/* ──────────────────────────────────────────────────────────────────────────
 * useNotifications — the hook the Notification Center uses.
 *
 * Input: the already-derived `items` (caller computes them via buildNotifications
 * with the data the page already fetched + the hidden set), plus the visibility
 * of the parent (so we only fetch read-state when a panel might render).
 *
 * Returns:
 *   - items        : the same list, filtered to currently-relevant ones
 *   - unreadKeys   : Set of notif_keys not yet marked read
 *   - unreadCount  : number of unread items
 *   - loading      : true while read-state is being resolved
 *   - markRead(key), markAllRead() : persist read-state (Supabase owner / local fallback)
 *
 * Opening a page merely recomputes `items` from the same source rows → the same
 * stable notif_keys resolve to the same single notifications → no duplicates.
 * ────────────────────────────────────────────────────────────────────────── */
export function useNotifications(items: NotificationItem[]) {
  const [readMap, setReadMap] = useState<Map<string, boolean>>(new Map());
  const [source, setSource] = useState<"supabase" | "local">("local");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { reads, source: src } = await loadNotificationReads();
      setReadMap(reads);
      setSource(src);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const relevant = useMemo(() => items, [items]);
  const unreadKeys = useMemo(() => {
    const s = new Set<string>();
    for (const it of relevant) {
      if (!readMap.get(it.key)) s.add(it.key);
    }
    return s;
  }, [relevant, readMap]);
  const unreadCount = unreadKeys.size;

  const markRead = useCallback(
    async (key: string) => {
      // optimistic update, then persist
      setReadMap((prev) => {
        const next = new Map(prev);
        next.set(key, true);
        return next;
      });
      await upsertNotificationRead(key, true, source);
    },
    [source]
  );

  const markAllRead = useCallback(async () => {
    if (relevant.length === 0) return;
    const keys = relevant.map((it) => it.key);
    setReadMap((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.set(k, true));
      return next;
    });
    await markAllNotificationsRead(keys, source);
  }, [relevant, source]);

  return { items: relevant, unreadKeys, unreadCount, loading, markRead, markAllRead };
}