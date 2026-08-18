"use client";

// GlobalSearch — command-palette style search for the whole TheeDeck.
//
// SYSTEM 7. Opened with Ctrl+K (mobile: the visible search button in the nav).
// Searches ONLY real, already-synced data from the existing public/ JSON files
// (assignments, classroom coursework/announcements, schedule events/quizzes)
// plus static course + page definitions. It reuses the same data files the
// pages themselves read, never queries the database directly, uses no AI, and
// navigates to existing routes only. Ranking is deterministic: exact title
// match → starts-with → contains → secondary metadata.
//
// Data is fetched lazily on first open and cached for the session, so repeat
// opens (or empty search) cost nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Command, CornerDownLeft } from "lucide-react";
import { dataUrl } from "@/lib/data";
import { COURSES } from "@/lib/schedule-data";

const PAGES: { title: string; href: string; desc: string }[] = [
  { title: "TheeDeck", href: "/", desc: "หน้าแรก / ภาพรวม" },
  { title: "งานวันนี้ (Today)", href: "/today", desc: "งานเรียน · Timeline" },
  { title: "คลาสรูม (Classroom)", href: "/classroom", desc: "งาน · ประกาศ" },
  { title: "ตารางเรียน (Schedule)", href: "/schedule", desc: "ตารางเรียน · สอบ" },
  { title: "เทรด (Trading)", href: "/trading", desc: "ข้อมูลเทรดทอง/BTC" },
  { title: "ฝึกฟัง (Dictation)", href: "/dictation", desc: "ฝึกฟังภาษา" },
  { title: "สถานะ (System)", href: "/system", desc: "ระบบ · สุขภาพ" },
];

type Category = "งานเรียน" | "งานคลาสรูม" | "ประกาศ" | "วิชา" | "ตาราง" | "หน้าเว็บ";

interface SearchItem {
  title: string;
  sub: string;       // Thai secondary line
  href: string;      // existing destination ("" = non-actionable)
  category: Category;
}

// (Re)build the searchable index from the same JSON the pages load.
async function buildIndex(): Promise<SearchItem[]> {
  const items: SearchItem[] = [];

  // Static pages — always available, no fetch needed.
  for (const p of PAGES) {
    items.push({ title: p.title, sub: p.desc, href: p.href, category: "หน้าเว็บ" });
  }

  // Courses — static definition in lib/schedule-data.ts.
  for (const [code, def] of Object.entries(COURSES)) {
    items.push({ title: code, sub: def.name, href: "/schedule", category: "วิชา" });
    items.push({ title: def.name, sub: `รหัส ${code}`, href: "/schedule", category: "วิชา" });
  }

  try {
    const fetchJson = async (path: string): Promise<any | null> => {
      try {
        const r = await fetch(dataUrl(path), { cache: "force-cache" });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };

    // Assignments (todo list).
    const assign = await fetchJson("/data/assignments.json");
    if (assign?.todo) {
      for (const a of assign.todo) {
        const title = (a.title || "").trim();
        if (!title) continue;
        items.push({
          title,
          sub: `งานเรียน · ${a.courseName || a.course || ""}${a.due ? " · ครบ " + a.due : ""}`,
          href: "/today",
          category: "งานเรียน",
        });
      }
    }

    // Classroom coursework + announcements.
    const klass = await fetchJson("/data/classroom.json");
    if (klass?.courses) {
      for (const c of klass.courses) {
        const cname = c.name || c.id || "";
        for (const w of c.coursework || []) {
          const title = (w.title || "").trim();
          if (!title) continue;
          items.push({
            title,
            sub: `งานคลาสรูม · ${cname}`,
            href: "/classroom",
            category: "งานคลาสรูม",
          });
        }
        for (const n of c.announcements || []) {
          // Announcements often start with a long subject line on line 1.
          const firstLine = (n.text || "").split("\n")[0].trim().slice(0, 80);
          if (!firstLine) continue;
          items.push({
            title: firstLine,
            sub: `ประกาศ · ${cname}`,
            href: "/classroom",
            category: "ประกาศ",
          });
        }
      }
    }

    // Schedule events + quizzes.
    const sched = await fetchJson("/data/schedule.json");
    if (sched?.events) {
      for (const e of sched.events) {
        const summary = (e.summary || "").trim();
        if (!summary) continue;
        items.push({
          title: summary,
          sub: `ตาราง · ${e.date || ""}`,
          href: "/schedule",
          category: "ตาราง",
        });
      }
    }
    if (sched?.quizzes) {
      for (const q of sched.quizzes) {
        const summary = (q.summary || "").trim();
        if (!summary) continue;
        items.push({
          title: summary,
          sub: `สอบ/กิจกรรม · ${q.date || ""}`,
          href: "/schedule",
          category: "ตาราง",
        });
      }
    }
  } catch {
    // Any fetch error just returns whatever we already have (pages + courses).
  }

  return items;
}

// Deterministic relevance score (higher = better). Order per spec:
//   1. exact title match, 2. starts-with, 3. contains, 4. secondary metadata.
function scoreItem(item: SearchItem, q: string): number {
  const t = item.title.toLowerCase();
  const s = item.sub.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800;
  if (t.includes(q)) return 600;
  if (s.includes(q)) return 300;
  return 0;
}

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [dataErr, setDataErr] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Ctrl+K (and Cmd+K on Mac) toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "k" && e.altKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Load the index once on first open (lazily, cached for the session).
  const ensureIndex = useCallback(async () => {
    if (index) return;
    setLoading(true);
    setDataErr(false);
    try {
      const items = await buildIndex();
      setIndex(items);
    } catch {
      setDataErr(true);
    } finally {
      setLoading(false);
    }
  }, [index]);

  useEffect(() => {
    if (!open) return;
    ensureIndex();
    // Reset search + selection each time the palette opens.
    setQuery("");
    setActiveIdx(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(t);
  }, [open, ensureIndex]);

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Close when the route changes (navigation already happened).
  const close = useCallback(() => setOpen(false), []);

  // Filter + rank results for the current query.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return index ? index.slice(0, 8) : []; // empty query → show a few
    if (!index) return [];
    return index
      .map((it) => ({ it, score: scoreItem(it, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title))
      .slice(0, 12)
      .map((r) => r.it);
  }, [query, index]);

  // Keep selection inside the list bounds.
  useEffect(() => setActiveIdx(0), [query]);

  const go = useCallback(
    (item: SearchItem | undefined) => {
      if (!item) return;
      if (item.href) {
        close();
        router.push(item.href);
      }
    },
    [router, close]
  );

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[activeIdx]);
    }
  };

  // Auto-scroll the active item into view inside the palette list.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, results]);

  return (
    <>
      {/* Mobile / visible entry point — always shown in the nav. */}
      <button
        type="button"
        className="search-open-btn"
        aria-label="ค้นหา TheeDeck"
        onClick={() => setOpen(true)}
      >
        <Search className="nav-ico" aria-hidden="true" />
        <span className="search-open-label">ค้นหา</span>
      </button>

      {open && (
        <div className="gs-overlay" onClick={close}>
          <div
            className="gs-panel"
            role="dialog"
            aria-modal="true"
            aria-label="ค้นหา TheeDeck"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gs-input-row">
              <Search className="gs-input-ico" aria-hidden="true" />
              <input
                ref={inputRef}
                className="gs-input"
                placeholder="ค้นหา งานเรียน, วิชา, ตาราง, หน้าเว็บ…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                aria-label="ค้นหา TheeDeck"
              />
              <kbd className="gs-kbd">
                <Command className="gs-kbd-ico" aria-hidden="true" />K
              </kbd>
            </div>

            {loading && (
              <div className="gs-status" role="status">
                กำลังโหลดข้อมูล…
              </div>
            )}

            {!loading && dataErr && (
              <div className="gs-status" role="alert">
                ⚠ โหลดข้อมูลค้นหาไม่สำเร็จ — ลองอีกครั้ง
              </div>
            )}

            {!loading && !dataErr && index && results.length === 0 && (
              <div className="gs-status">ไม่พบผลลัพธ์สำหรับคำค้นนี้</div>
            )}

            {!loading && index && results.length > 0 && (
              <div className="gs-body">
                <ul className="gs-list" ref={listRef} role="listbox">
                  {results.map((item, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        data-idx={i}
                        className={"gs-item" + (i === activeIdx ? " on" : "")}
                        onClick={() => go(item)}
                        onMouseEnter={() => setActiveIdx(i)}
                        role="option"
                        aria-selected={i === activeIdx}
                      >
                        <span className="gs-item-title">{item.title || "—"}</span>
                        {item.sub && <span className="gs-item-sub">{item.sub}</span>}
                        <span className="gs-item-cat">{item.category}</span>
                      </button>
                      {item.href && i === activeIdx && (
                        <CornerDownLeft className="gs-enter-ico" aria-hidden="true" />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!loading && !dataErr && !index && (
              <div className="gs-status">เริ่มพิมพ์เพื่อค้นหา...</div>
            )}

            <div className="gs-footer">
              <span>↑↓ เลือก</span>
              <span className="gs-footer-hint">
                <CornerDownLeft className="gs-footer-ico" aria-hidden="true" /> เปิด · Esc ปิด
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}