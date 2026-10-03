import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { ACCOUNTS_NOT_SET_UP, supabaseEnv } from "./env";

// The server client, for route handlers and server components. It acts as the
// signed-in person (the publishable key plus their session cookie), so row-level
// security applies to everything it does. Create one per request.
export async function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error(ACCOUNTS_NOT_SET_UP);
  const cookieStore = await cookies();

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component, which cannot write cookies. The proxy
          // refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}
