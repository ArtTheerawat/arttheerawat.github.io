"use client";

import { useEffect, useMemo, useState } from "react";
import { DAYS, dataUrl, fmtDate, thDayIdx } from "@/lib/data";

interface Assignment {
  title?: string;
  course?: string;
  courseName?: string;
  due?: string;
  bucket?: string;
  overdue?: number;
}

interface Quiz {
  date?: string;
  summary?: string;
}

interface AssignData {
  todo?: Assignment[];
  courseNames?: Record<string, string>;
  updated?: string;
}
interface SchedData {
  events?: unknown[];
  quizzes?: Quiz[];
  updated?: string;
}

function classify(x: Assignment) {
  if (!x.due) {
    x.bucket = "soon";
    x.overdue = 999;
    return;
  }
  const t = new Date(x.due + "T00:00:00");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
  const diff = Math.round((t.getTime() - today.getTime()) / 86400000);
  x.overdue = diff < 0 ? -diff : 0;
  if (diff < 0) x.bucket = "over";
  else if (diff === 0) x.bucket = "today";
  else if (diff <= 5) x.bucket = "soon";
  else x.bucket = "later";
}

function badgeTxt(a: Assignment): { txt: string; cls: string } {
  switch (a.bucket) {
    case "over":
      return { txt: "เลย " + a.overdue + " วัน", cls: "b-over" };
    case "today":
      return { txt: "ครบวันนี้", cls: "b-today" };
    case "soon":
      return { txt: "ครบใน " + a.overdue + " วัน", cls: "b-soon" };
    default:
      return { txt: "ครบแล้ว", cls: "b-done" };
  }
}

function fmtSync(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TodayPage() {
  const [all, setAll] = useState<Assignment[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [synced, setSynced] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(dataUrl("/data/assignments.json"), { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const j: AssignData = await r.json();
        const todo = (j.todo || []).map((a) => ({ ...a }));
        todo.forEach(classify);
        setAll(todo);
        setSynced(j.updated || "");
        try {
          const q = await fetch(dataUrl("/data/schedule.json"), { cache: "no-store" });
          if (q.ok) {
            const qj: SchedData = await q.json();
            setQuizzes(qj.quizzes || []);
          }
        } catch {
          /* quizzes optional */
        }
      } catch (e) {
        setErr("โหลดข้อมูลไม่ได้: " + (e instanceof Error ? e.message : String(e)) + " (รัน cron ซิงก์แล้วลองใหม่)");
      }
    })();
  }, []);

  const { over, tod, soon, later } = useMemo(() => {
    return {
      over: all.filter((a) => a.bucket === "over"),
      tod: all.filter((a) => a.bucket === "today"),
      soon: all.filter((a) => a.bucket === "soon"),
      later: all.filter((a) => a.bucket === "later"),
    };
  }, [all]);

  const now = new Date();
  const today = new Date().toISOString().slice(0, 10);
  const dayLabel = DAYS[(now.getDay() + 6) % 7];

  const Item = ({ a, overCl }: { a: Assignment; overCl?: boolean }) => {
    const b = badgeTxt(a);
    return (
      <div className={"item" + (overCl ? " over" : "")}>
        <div className="pd">
          <span className={"badge " + b.cls}>{b.txt}</span>
          <span>⏰ {fmtDate(a.due)}</span>
        </div>
        <div className="ttl">{a.title}</div>
        <div className="subj">{a.courseName || a.course || ""}</div>
      </div>
    );
  };

  const Section = ({
    label,
    items,
    badgeCls,
  }: {
    label: string;
    items: Assignment[];
    badgeCls: string;
  }) =>
    items.length ? (
      <div className="grp" style={{ marginTop: 8 }}>
        <h2>
          {label} <span className="cnt">{items.length}</span>
        </h2>
        {items.map((a, i) => (
          <Item key={i} a={a} overCl={a.bucket === "over"} />
        ))}
      </div>
    ) : null;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            เช็ค<span className="dot">งาน</span>วันนี้
          </h1>
          <div className="dayhead">
            <div className="sub">
              วันนี้ {dayLabel} · {today}
            </div>
          </div>
        </div>
        {synced && <div style={{ fontSize: 12, color: "var(--muted)" }}>ซิงก์ {fmtSync(synced)}</div>}
      </header>

      {err && <div className="err">⚠ {err}</div>}

      <div className="counts">
        <div className="c">
          <b className="down" style={{ color: "var(--down)" }}>
            {over.length}
          </b>
          เลยกำหนด
        </div>
        <div className="c">
          <b style={{ color: "var(--warn)" }}>{tod.length}</b>
          ครบวันนี้
        </div>
        <div className="c">
          <b style={{ color: "var(--accent2)" }}>{soon.length}</b>
          ใกล้ถึง (5 วัน)
        </div>
        <div className="c">
          <b>{quizzes.length}</b>
          สอบ/กิจกรรม
        </div>
      </div>

      {quizzes.length > 0 && (
        <div className="quizban">
          <h3>🔔 แจ้งเตือนสอบ / กิจกรรมใกล้ถึง</h3>
          {quizzes.map((q, i) => {
            const diff = Math.round(
              (new Date((q.date || "") + "T00:00:00").getTime() -
                new Date(today + "T00:00:00").getTime()) /
                86400000
            );
            const when =
              diff < 0 ? `ผ่านมา ${-diff} วัน` : diff === 0 ? "วันนี้!" : `ใน ${diff} วัน`;
            return (
              <div className="q" key={i}>
                <span>{q.summary}</span>
                <span className={"badge " + (diff <= 3 ? "b-quiz" : "b-soon")}>
                  {fmtDate(q.date)} · {when}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Section label="🔴 เลยกำหนด ต้องรีบทำ" items={over} badgeCls="b-over" />
      <Section label="⏳ ครบกำหนดวันนี้" items={tod} badgeCls="b-today" />
      <Section label="🟣 ใกล้ถึง (5 วัน)" items={soon} badgeCls="b-soon" />

      {later.length > 0 && (
        <div className="grp" style={{ marginTop: 8 }}>
          <h2>
            📅 อีกไกล <span className="cnt">{later.length}</span>
          </h2>
          <button className="togglenext" onClick={() => setShowLater((s) => !s)}>
            {showLater ? "ซ่อนงานที่ยังอีกไกล ▲" : `แสดงงานที่ยังอีกไกล (${later.length}) ▼`}
          </button>
          {showLater && (
            <div>
              {later.map((a, i) => {
                const d = Math.round(
                  (new Date((a.due || "") + "T00:00:00").getTime() -
                    new Date(today + "T00:00:00").getTime()) /
                    86400000
                );
                return (
                  <div className="item" key={i}>
                    <div className="pd">
                      <span className="badge b-soon">ครบใน {d} วัน</span>
                      <span>⏰ {fmtDate(a.due)}</span>
                    </div>
                    <div className="ttl">{a.title}</div>
                    <div className="subj">{a.courseName || a.course || ""}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!over.length && !tod.length && !soon.length && (
        <div className="cards-sec" style={{ textAlign: "center", padding: 34 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
          <div style={{ color: "var(--muted)" }}>วันนี้ไม่มีงานค้าง / ครบส่ง ค่อยๆ ผ่อนได้</div>
        </div>
      )}
    </div>
  );
}