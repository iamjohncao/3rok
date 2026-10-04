// The two public Supabase values. Both are browser-safe by design: row-level
// security protects the data. The service-role key is never used by this app.

export type SupabaseEnv = { url: string; key: string };

/** Null when accounts are not set up (a preview or a fresh clone without the values). */
export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export function accountsConfigured(): boolean {
  return supabaseEnv() !== null;
}

export const ACCOUNTS_NOT_SET_UP =
  "Accounts are not set up on this deployment. NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are missing.";
