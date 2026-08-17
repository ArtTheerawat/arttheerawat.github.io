import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/supabase/types";

// Supabase auth middleware for Next.js App Router.
//  - Creates a session-scoped client using the request cookies.
//  - Refreshes the auth token (and rewrites cookies) on every request so a
//    session stays alive across navigation without a manual refresh.
//  - Proxies anything that carries a session. There is no page lock-down here:
//    sign-in is optional (a guest simply can't persist hidden tasks).

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not run code between createServerClient and supabase.auth.getUser().
  // A simple mistake can make it hard to debug being logged in / logged out.
  // IMPORTANT: getUser is safe because the user's JWT is verified server-side.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // No session — just pass the request through untouched.
  }

  return supabaseResponse;
}

export async function middleware(request: NextRequest) {
  // Skip middleware entirely when Supabase env vars aren't configured yet, so
  // the site still builds and renders before wiring Supabase (fresh clone).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets & images & explicit API that do
    // not need the session. The matcher excludes _next/static + files.
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};