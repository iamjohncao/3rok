import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

// Refreshes the Supabase session on each request and passes the refreshed cookies
// to both the server and the browser. It never redirects: pages decide what a
// signed-out visitor sees.
export async function updateSession(request: NextRequest) {
  const env = supabaseEnv();
  if (!env) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  // Always a new client per request. Do not run code between creating it and getClaims().
  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Cache headers keep a CDN from caching a response that carries a session.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Validates the token's signature and refreshes it when it has expired. Removing
  // this call can sign people out at random.
  await supabase.auth.getClaims();

  return response;
}
