import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import { supabaseEnv } from "../../../lib/supabase/env";

// Where the confirmation link in the sign-up email lands. It trades the one-time code
// for a session, then sends the person to their cases. The redirect target is fixed.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code && supabaseEnv()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/cases`);
  }
  return NextResponse.redirect(`${origin}/account?problem=link`);
}
