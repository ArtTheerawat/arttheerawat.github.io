import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// OAuth callback handler. Google sign-in redirects the browser here with a
// `code` query param; we exchange it for a session, set the auth cookie, and
// bounce the user back to the page they came from (or the home page).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      }
      if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Missing code or exchange failed → fall back to home.
  return NextResponse.redirect(`${origin}`);
}