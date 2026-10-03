import { createBrowserClient } from "@supabase/ssr";
import { ACCOUNTS_NOT_SET_UP, supabaseEnv } from "./env";

// The browser client. createBrowserClient keeps one instance, so calling this
// from several components is fine.
export function createClient() {
  const env = supabaseEnv();
  if (!env) throw new Error(ACCOUNTS_NOT_SET_UP);
  return createBrowserClient(env.url, env.key);
}
