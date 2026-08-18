"use client";

// app/assistant/page.tsx — SYSTEM 8: AI Study Assistant.
//
// A small chat surface that answers only study questions from REAL TheeDeck
// context (today's schedule, assignments, priorities, task detail). It is NOT
// a generic chatbot. Quick actions insert a canned Thai question; every send
// POSTs to /api/assistant, which routes the question to compact relevant data,
// prefers a deterministic (code) answer, and only calls AI when needed.
// Read-only: this page never mutates tasks/schedule/notifications.

import { useCallback, useEffect, useRef, useState } from "react";
import { dataUrl } from "@/lib/data";

type Msg = { role: "user" | "assistant"; text: string };

const QUICK: { label: string; q: string }[] = [
  { label: "วันนี้มีอะไร?", q: "วันนี้มีอะไรต้องทำ?" },
  { label: "งานไหนควรทำก่อน?", q: "งานไหนควรทำก่อน?" },
  { label: "ช่วยวางแผนวันนี้", q: "ช่วยวางแผนวันนี้ให้หน่อย" },
  { label: "อธิบายงานนี้", q: "อธิบายงานที่ใกล้ที่สุดให้ฟังหน่อย" },
];

const SAMPLE_START: Msg = {
  role: "assistant",
  text: "สวัสดีหัวหน้า 🙏 ฉันคือผู้ช่วยการเรียน ตอบจากข้อมูลจริงของ TheeDeck (งาน, ตาราง, ลำดับความสำคัญ) ลองถามได้เลย หรือกดปุ่มด้านล่าง",
};

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([SAMPLE_START]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setErr(null);
      setMsgs((m) => [...m, { role: "user", text: q }]);
      setBusy(true);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
          cache: "no-store",
        });
        const j = await res.json().catch(() => null);
        if (res.status === 401 || res.status === 403) {
          setMsgs((m) => [
            ...m,
            { role: "assistant", text: "ต้องเข้าสู่ระบบด้วยบัญชีเจ้าของก่อนจึงจะใช้ผู้ช่วยได้ (กดล็อกอินที่มุมบน)" },
          ]);
        } else if (j?.answer) {
          setMsgs((m) => [...m, { role: "assistant", text: j.answer }]);
        } else if (j?.error) {
          setMsgs((m) => [...m, { role: "assistant", text: "เกิดข้อผิดพลาด: " + j.error }]);
        } else {
          setMsgs((m) => [...m, { role: "assistant", text: "ขอตอบไม่ได้ในตอนนี้ ลองถามใหม่ภายหลังนะครับ" }]);
        }
      } catch {
        setErr("เชื่อมต่อกับผู้ช่วยไม่ได้ (อาจเป็นปัญหาเครือข่าย) ลองอีกที");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
    setInput("");
  };

  return (
    <div className="wrap assistant-wrap">
      <header>
        <div>
          <h1>
            ผู้ช่วยการเรียน <span className="dot">AI</span>
          </h1>
          <div className="sub">ตอบจากข้อมูลจริงของ TheeDeck · อ่านอย่างเดียว (ไม่มีสิทธิ์แก้ข้อมูล)</div>
        </div>
      </header>

      {/* Quick actions */}
      <div className="assistant-quick">
        {QUICK.map((b) => (
          <button key={b.label} type="button" className="assistant-chip" onClick={() => void send(b.q)} disabled={busy}>
            {b.label}
          </button>
        ))}
      </div>

      {/* Chat transcript */}
      <div className="assistant-chat" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={"assistant-msg " + (m.role === "user" ? "user" : "ai")}>
            <div className="bubble">{m.text}</div>
          </div>
        ))}
        {busy && (
          <div className="assistant-msg ai">
            <div className="bubble typing">กำลังวิเคราะห์...</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {err && <div className="err">{err}</div>}

      {/* Input */}
      <form className="assistant-input" onSubmit={onSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ถามเกี่ยวกับงาน/ตาราง/การวางแผน..."
          aria-label="คำถาม"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          ส่ง
        </button>
      </form>
    </div>
  );
}