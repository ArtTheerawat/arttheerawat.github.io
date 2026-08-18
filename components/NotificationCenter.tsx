"use client";

// NotificationCenter — the SYSTEM 5 bell + dropdown panel.
//
// Lives in the nav (next to AuthStatus). It fetches the SAME data files the
// pages read (assignments.json / schedule.json / classroom.json), derives
// notification items via lib/notifications.ts buildNotifications, excludes
// hidden tasks via the hidden-task set, and tracks read/unread via
// lib/notifications.ts useNotifications (Supabase owner + localStorage fallback).
//
// Opening any page recomputes the same stable notif_keys → no duplicate
// notifications from a mere page load (dedup is the stable key, not a push).

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { dataUrl, classifyAssignment } from "@/lib/data";
import { useHiddenTasks } from "@/lib/hidden-tasks";
import { buildNotifications, useNotifications } from "@/lib/notifications";
import type { NotificationItem } from "@/lib/db/types";

const KIND_ICON: Record<NotificationItem["kind"], string> = {
  overdue: "🟥",
  "due-today": "⚠️",
  "due-soon": "🕐",
  quiz: "📝",
  announcement: "📢",
  system: "🔔",
};

export default function NotificationCenter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { hiddenList } = useHiddenTasks();

  // Derive the notification feed from the same JSON the pages read. Recomputing
  // on mount + focus keeps it fresh; stable keys prevent duplicates.
  const refreshFeed = useCallback(async () => {
    try {
      const [r, q, c] = await Promise.all([
        fetch(dataUrl("/data/assignments.json"), { cache: "no-store" }),
        fetch(dataUrl("/data/schedule.json"), { cache: "no-store" }),
        fetch(dataUrl("/data/classroom.json", { cache: true }), { cache: "force-cache" }),
      ]);
      const [aj, qj, cj] = await Promise.all([r.json(), q.json(), c.json()]);

      const assignments = (aj.todo || []).map((a: any) => {
        classifyAssignment(a);
        return a;
      });

      const quizzes: { date?: string; summary?: string }[] = (qj.quizzes || []).map(
        (qq: any) => ({ date: qq.date, summary: qq.summary })
      );

      // Flatten announcements across courses (the shape in classroom.json).
      const announcements: { courseName?: string; text?: string; time?: string }[] = [];
      for (const course of cj.courses || []) {
        for (const ann of course.announcements || []) {
          announcements.push({ courseName: course.name, text: ann.text, time: ann.time });
        }
      }

      const excluded = new Set<string>((hiddenList || []).map((h) => h.key));
      setItems(buildNotifications({ assignments, quizzes, announcements, excludedTaskKeys: excluded }));
      setError(null);
    } catch (e) {
      setError("โหลดข้อมูลการแจ้งเตือนไม่ได้: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setReady(true);
    }
  }, [hiddenList]);

  useEffect(() => {
    void refreshFeed();
  }, [refreshFeed]);

  const notif = useNotifications(items);

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="notif-wrap" ref={panelRef}>
      <button
        type="button"
        className="notif-bell"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={notif.unreadCount > 0 ? `การแจ้งเตือน ${notif.unreadCount} รายการยังไม่ได้อ่าน` : "การแจ้งเตือน"}
      >
        <Bell className="notif-ico" aria-hidden="true" />
        {notif.unreadCount > 0 && <span className="notif-dot">{notif.unreadCount > 99 ? "99+" : notif.unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="การแจ้งเตือน">
          <div className="notif-head">
            <span className="notif-title">การแจ้งเตือน</span>
            {notif.unreadCount > 0 && (
              <button
                type="button"
                className="notif-markall"
                onClick={() => void notif.markAllRead()}
                title="ทำเครื่องหมายว่าอ่านแล้วทั้งหมด"
              >
                <CheckCheck className="notif-markall-ico" aria-hidden="true" />
                อ่านทั้งหมด
              </button>
            )}
          </div>

          {!ready ? (
            <div className="notif-state">กำลังโหลด…</div>
          ) : error ? (
            <div className="notif-state notif-err">{error}</div>
          ) : items.length === 0 ? (
            <div className="notif-state">ไม่มีการแจ้งเตือน</div>
          ) : (
            <ul className="notif-list">
              {items.map((it) => {
                const unread = notif.unreadKeys.has(it.key);
                return (
                  <li key={it.key} className={unread ? "unread" : ""}>
                    <Link
                      href={it.href || "/today"}
                      onClick={() => {
                        void notif.markRead(it.key);
                        setOpen(false);
                        if (it.href) return;
                        router.push("/today");
                      }}
                    >
                      <span className="notif-kind" aria-hidden="true">{KIND_ICON[it.kind]}</span>
                      <span className="notif-body">
                        <span className="notif-item-title">{it.title}</span>
                        <span className="notif-item-body">{it.body}</span>
                      </span>
                      {unread && <span className="notif-unread-dot" aria-label="ยังไม่ได้อ่าน" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}