// Who is signed in, for route handlers. Uses getClaims(), which checks the token's
// signature on every call. getSession() is never trusted on the server.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ACCOUNTS_NOT_SET_UP, supabaseEnv } from "./supabase/env";
import { createClient } from "./supabase/server";

export type AccountResult =
  | { ok: true; userId: string; email: string | null; supabase: SupabaseClient }
  | { ok: false; response: NextResponse };

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** The signed-in account, or the response to send when there is none. */
export async function requireAccount(): Promise<AccountResult> {
  if (!supabaseEnv()) return { ok: false, response: json({ error: ACCOUNTS_NOT_SET_UP }, 503) };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") {
    return { ok: false, response: json({ error: "Sign in to use cases." }, 401) };
  }
  const email = data?.claims?.email;
  return { ok: true, userId, email: typeof email === "string" ? email : null, supabase };
}
