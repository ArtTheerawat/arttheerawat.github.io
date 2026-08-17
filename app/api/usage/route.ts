import { NextResponse } from "next/server";

/**
 * GET /api/usage — live OpenRouter credit usage, fetched server-side so the
 * OPENROUTER_API_KEY never ships to the browser.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { status: "error", error: "no OPENROUTER_API_KEY on server" },
      { status: 200 }
    );
  }

  // Fetch each endpoint independently (not Promise.all) and capture the raw
  // failure reason so we can see exactly where serverless stalls.
  async function getOne(url: string): Promise<{ ok: boolean; body: unknown; err?: string }> {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      const text = await r.text();
      let json: unknown = null;
      try { json = JSON.parse(text); } catch { /* keep null */ }
      return { ok: r.ok, body: json };
    } catch (e) {
      return { ok: false, body: null, err: e instanceof Error ? e.message : String(e) };
    }
  }

  const cred = await getOne("https://openrouter.ai/api/v1/credits");
  const keyinfo = await getOne("https://openrouter.ai/api/v1/auth/key");

  if (!cred.ok || !keyinfo.ok) {
    return NextResponse.json(
      {
        status: "error",
        error: "OpenRouter API unreachable",
        credits_error: cred.err || (cred.ok ? null : `HTTP ${cred.ok}`),
        key_error: keyinfo.err || (keyinfo.ok ? null : `HTTP ${keyinfo.ok}`),
        credits_body: cred.body,
        key_body: keyinfo.body,
      },
      { status: 200 }
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