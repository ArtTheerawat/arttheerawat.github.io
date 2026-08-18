import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildContext, detectIntent, type AssistantData, type Intent } from "@/lib/assistant/context";

// lib/assistant/route logic lives here (server-only: reads public/data JSON,
// calls the project's configured 9arm model when a key is present, and always
// has a deterministic no-AI fallback). The key is read from env only — never
// baked in, never sent to the browser.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Owner gate (mirrors /api/usage: fail-closed allow-list) ──
function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = process.env.USAGE_ALLOWED_EMAILS;
  if (!allow || !allow.trim()) return false;
  return allow
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// ── Reads the same real data files the whole app reads. ──
function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "public", "data", p), "utf-8")) as T;
  } catch {
    return null;
  }
}

function loadAssistantData(): AssistantData {
  const assign = readJson<any>("assignments.json");
  const schedule = readJson<any>("schedule.json");
  const classroom = readJson<any>("classroom.json");

  const courseworkByCourse: Record<string, { title?: string; due?: string; dueTime?: string; state?: string }[]> = {};
  for (const c of classroom?.courses || []) {
    const key = c?.name || c?.id || "";
    if (!key || !Array.isArray(c?.coursework)) continue;
    courseworkByCourse[key] = c.coursework.map((w: any) => ({
      title: w?.title,
      due: w?.due,
      dueTime: w?.dueTime,
      state: w?.state,
    }));
  }

  return {
    todo: (assign?.todo || []).map((a: any) => ({
      title: a?.title,
      course: a?.course,
      courseName: a?.courseName,
      due: a?.due ?? null,
      workType: a?.workType,
      points: a?.points ?? null,
    })),
    quizzes: (schedule?.quizzes || []).map((q: any) => ({ date: q?.date, summary: q?.summary })),
    courseNames: assign?.courseNames || {},
    courseworkByCourse,
  };
}

// ── Deterministic answer path (no AI, no tokens) for common direct questions. ──
function deterministicAnswer(intent: Intent, term: string | undefined, data: AssistantData): string | null {
  const ctx = buildContext(intent, term, data);
  // For what_first / what_today, the deterministic engine already yields the
  // full answer — return it verbatim (always true, zero tokens).
  if (intent === "what_first" || intent === "what_today") {
    return ctx.replace(/^วันนี้[^\n]*\n/, "").trim();
  }
  // task_detail without a term has nothing useful to say deterministically.
  if (intent === "task_detail" && !term) return "ขอระบุชื่องาน/คำค้นหน่อยนะครับ เช่น \"Lab 5\" หรือ \"ใบงานที่ 6\"";
  // For plan_day / unknown / term-less detail we still want AI, or explicit "ไม่มีข้อมูล".
  return null;
}

// ── 9arm chat call (mirrors generate_next_action.py's provider/model chain). ──
const MODEL = process.env.ASSISTANT_MODEL || "deepseek-v4-flash-0731";
const FALLBACK_MODEL = process.env.ASSISTANT_FALLBACK_MODEL || "qwen3.8-27b-fp8";

async function callModel(model: string, system: string, user: string): Promise<string | null> {
  const key = process.env.ASSISTANT_API_KEY;
  const base = process.env.ASSISTANT_BASE_URL || "https://gateway.9arm.co/v1";
  if (!key) return null;
  const url = `${base.replace(/\/+$/, "")}/chat/completions`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        max_tokens: 450,
        extra_body: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* keep null */ }
    if (!res.ok || json?.error) return null;
    const content = (json?.choices?.[0]?.message?.content || "").trim();
    return content || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // 1) Auth gate — only the owner may talk to the assistant.
  let sb;
  try {
    sb = getSupabaseServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ status: "unauthorized", error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }
    if (!isOwner(user.email)) {
      return NextResponse.json({ status: "forbidden", error: "บัญชีนี้ไม่มีสิทธิ์ใช้ผู้ช่วย" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ status: "error", error: "server auth not configured" }, { status: 500 });
  }

  // 2) Parse + validate input.
  let body: { q?: unknown } = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const rawQ = typeof body?.q === "string" ? body.q.trim() : "";
  if (!rawQ) {
    return NextResponse.json({ status: "empty", answer: "ป้อนคำถามก่อนนะครับ" });
  }
  if (rawQ.length > 300) {
    return NextResponse.json({ status: "too_long", answer: "คำถามยาวเกินไป ลองถามสั้นๆ ก่อนครับ" });
  }

  // 3) Intent routing → build compact context from REAL data.
  const data = loadAssistantData();
  const { intent, term } = detectIntent(rawQ);
  const context = buildContext(intent, term, data);

  // 4) Deterministic fast-path (zero tokens) when code can answer fully.
  const direct = deterministicAnswer(intent, term, data);
  if (direct && !process.env.ASSISTANT_API_KEY) {
    return NextResponse.json({ status: "ok", answer: direct, mode: "deterministic" });
  }
  // Even with a key, what_first/what_today are fully known by code — prefer
  // deterministic (token-optimized, per the brief). Only fall back to AI when
  // the answer truly needs natural-language reasoning.
  if (direct && (intent === "what_first" || intent === "what_today")) {
    return NextResponse.json({ status: "ok", answer: direct, mode: "deterministic" });
  }

  // 5) AI call (only now — never on page load, only when asked + needs AI).
  const system =
    "คุณคือผู้ช่วยการเรียนส่วนตัวของธีรวัฒน์ (นักศึกษา CS ปี 2). " +
    "ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ใช้ข้อมูลด้านล่างที่กรองมาจากระบบจริงเท่านั้น. " +
    "ห้ามมโน/สร้างกำหนดส่ง, ชั้นเรียน, งาน, คะแนน, หรือสถานะที่ไม่อยู่ในข้อมูล; ถ้าไม่มีข้อมูลให้พูดตรงๆ ว่า 'ไม่มีข้อมูล'. " +
    "ถ้าเป็นการวางแผน ให้ลำดับตามความเร่งด่วนจริงจากข้อมูล. ตอบสั้น ไม่เกิน ~120 คำ.";
  const answer = (await callModel(MODEL, system, context + "\n\nคำถาม: " + rawQ)) ||
    (await callModel(FALLBACK_MODEL, system, context + "\n\nคำถาม: " + rawQ));

  if (!answer) {
    return NextResponse.json({
      status: "ai_unavailable",
      answer:
        "ผู้ช่วย AI ตอนนี้ไม่พร้อม (ไม่มี key หรือ provider error) ถามแบบที่ระบบตอบได้เองได้ เช่น \"วันนี้มีอะไร?\" \"งานไหนควรทำก่อน?\"",
    });
  }
  return NextResponse.json({ status: "ok", answer, mode: "ai" });
}