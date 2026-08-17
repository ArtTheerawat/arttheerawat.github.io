"use client";

// Browser-side Supabase client used by client components for auth + hidden-task
// rows. Uses @supabase/ssr's createBrowserClient, which reads/writes the
// session via Next.js cookies so middleware can refresh it on navigation.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;
let missingEnv = false;

/** Returns the browser Supabase client, or null when env vars are missing
 *  (site built before Supabase was wired up). Callers must handle null by
 *  disabling the feature — never by crashing the page. */
export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    missingEnv = true;
    return null;
  }
  if (!cached) {
    cached = createBrowserClient<Database>(url, anon, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return cached;
}

/** True when the Supabase env vars aren't set (feature disabled). */
export function isSupabaseEnabled(): boolean {
  return !missingEnv && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}