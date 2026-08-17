import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GET /api/usage — live OpenRouter credit usage, fetched server-side so the
 * OPENROUTER_API_KEY never ships to the browser.
 *
 * Authorization: this endpoint returns a user's private cost/credit data, so it
 * is gated behind Supabase auth. Guests get 401, signed-in non-owners 403, and
 * only the owner (email in USAGE_ALLOWED_EMAILS) gets the data. If the
 * allowlist env is unset, any signed-in user is treated as the owner (least
 * restrictive — acceptable for a personal dashboard, but set the allowlist to
 * lock it to one account).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = process.env.USAGE_ALLOWED_EMAILS;
  if (!allow || !allow.trim()) {
    // No allowlist configured → any authenticated user is allowed (default).
    return true;
  }
  return allow
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function GET() {
  const key = process.env.OPENROUTER_API_KEY;

  // 1) Authorization gate — runs before any data is fetched so anonymous /
  //    non-owner callers never trigger a (paid) upstream request at all.
  let sb;
  try {
    sb = getSupabaseServerClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { status: "unauthorized", error: "ต้องเข้าสู่ระบบก่อน" },
        { status: 401 }
      );
    }
    if (!isOwner(user.email)) {
      return NextResponse.json(
        { status: "forbidden", error: "บัญชีนี้ไม่มีสิทธิ์ดูข้อมูล usage" },
        { status: 403 }
      );
    }
  } catch {
    // Supabase env not configured — fail closed rather than leak usage.
    return NextResponse.json(
      { status: "error", error: "server auth not configured" },
      { status: 500 }
    );
  }

  if (!key) {
    return NextResponse.json(
      { status: "unconfigured", error: "ยังไม่ได้ตั้งค่า OPENROUTER_API_KEY บนเซิร์ฟเวอร์" },
      { status: 200 }
    );
  }

  // Fetch each endpoint independently (not Promise.all) and capture the raw
  // failure reason so we can see exactly where serverless stalls.
  async function getOne(url: string): Promise<{ ok: boolean; status: number; body: unknown; err?: string }> {
      try {
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
        });
        const text = await r.text();
        let json: unknown = null;
        try { json = JSON.parse(text); } catch { /* keep null */ }
        return { ok: r.ok, status: r.status, body: json };
      } catch (e) {
        return { ok: false, status: 0, body: null, err: e instanceof Error ? e.message : String(e) };
      }
    }

  const cred = await getOne("https://openrouter.ai/api/v1/credits");
  const keyinfo = await getOne("https://openrouter.ai/api/v1/auth/key");

  if (!cred.ok || !keyinfo.ok) {
    // Honest HTTP status (502 = upstream Bad Gateway) instead of a 200 with an
    // error body, so monitoring/logging sees a real failure. The diagnostic
    // payload is still attached for the client to surface specific details.
    return NextResponse.json(
      {
        status: "error",
        error: "OpenRouter API unreachable",
        credits_error: cred.err || (cred.ok ? null : `HTTP ${cred.status ?? "?"}`),
        key_error: keyinfo.err || (keyinfo.ok ? null : `HTTP ${keyinfo.status ?? "?"}`),
        credits_body: cred.body,
        key_body: keyinfo.body,
      },
      { status: 502 }
    );
  }

  const cd: any = cred.body;
  const ki: any = keyinfo.body;
  const total = cd?.data?.total_credits;
  const usage = ki?.data?.usage;

  const out: Record<string, unknown> = {
    status: "ok",
    usage: typeof usage === "number" ? Number(usage.toFixed(4)) : null,
    usage_monthly:
      typeof ki?.data?.usage_monthly === "number" ? Number(ki.data.usage_monthly.toFixed(4)) : null,
    usage_weekly:
      typeof ki?.data?.usage_weekly === "number" ? Number(ki.data.usage_weekly.toFixed(4)) : null,
    usage_daily:
      typeof ki?.data?.usage_daily === "number" ? Number(ki.data.usage_daily.toFixed(4)) : null,
    total_credits: total ?? null,
    is_free_tier: Boolean(ki?.data?.is_free_tier),
  };
  if (typeof total === "number" && typeof cd?.data?.total_usage === "number") {
    out.remaining = Number((total - cd.data.total_usage).toFixed(4));
  }
  return NextResponse.json(out);
}