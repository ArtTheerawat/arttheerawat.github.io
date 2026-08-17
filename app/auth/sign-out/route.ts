import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// POST /auth/sign-out — signs the current user out and clears the session
// cookie, then redirects home.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = getSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")));
}