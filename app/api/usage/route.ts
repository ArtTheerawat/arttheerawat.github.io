import { NextResponse } from "next/server";

/**
 * GET /api/usage — live OpenRouter credit usage, fetched server-side so the
 * OPENROUTER_API_KEY never ships to the browser. The browser calls this endpoint
 * instead of reading usage from data.json, so no cron push is needed for usage.
 *
 * Reads OPENROUTER_API_KEY from server env (set in Vercel project settings).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never static-cache; always fresh

export async function GET() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json(
      { status: "error", error: "no OPENROUTER_API_KEY on server" },
      { status: 200 }
    );
  }

  const get = async (url: string) => {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      return await r.json();
    } catch {
      return null;
    }
  };

  const [credits, keyinfo] = await Promise.all([
    get("https://openrouter.ai/api/v1/credits"),
    get("https://openrouter.ai/api/v1/auth/key"),
  ]);

  if (!credits && !keyinfo) {
    return NextResponse.json(
      { status: "error", error: "OpenRouter API unreachable" },
      { status: 200 }
    );
  }

  const cd = credits?.data;
  const ki = keyinfo?.data;
  const total = cd?.total_credits;
  const usage = ki?.usage;

  const out: Record<string, unknown> = {
    status: "ok",
    usage: typeof usage === "number" ? Number(usage.toFixed(4)) : null,
    usage_monthly:
      typeof ki?.usage_monthly === "number" ? Number(ki.usage_monthly.toFixed(4)) : null,
    usage_weekly:
      typeof ki?.usage_weekly === "number" ? Number(ki.usage_weekly.toFixed(4)) : null,
    usage_daily:
      typeof ki?.usage_daily === "number" ? Number(ki.usage_daily.toFixed(4)) : null,
    total_credits: total ?? null,
    is_free_tier: Boolean(ki?.is_free_tier),
  };
  if (typeof total === "number" && typeof cd?.total_usage === "number") {
    out.remaining = Number((total - cd.total_usage).toFixed(4));
  }
  return NextResponse.json(out);
}