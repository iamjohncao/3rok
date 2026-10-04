// Who may ask Grok, and how often. Each Ask Grok spends the deployment's xAI credits, and sign-up
// is open, so the route checks both before it calls xAI. Server only.

import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_RUNS_PER_HOUR = 6;
const HOUR_MS = 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

/** GROK_RUNS_PER_HOUR, or the default. A value that is not a whole number above 0 is the default. */
export function runsPerHour(env: Env = process.env): number {
  const parsed = Number(env.GROK_RUNS_PER_HOUR);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RUNS_PER_HOUR;
}

/** GROK_ALLOWED_EMAILS, comma separated. Empty means every signed-in account may ask. */
export function allowedEmails(env: Env = process.env): string[] {
  return (env.GROK_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function mayAsk(email: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return email !== null && allowed.some((entry) => entry.trim().toLowerCase() === email.trim().toLowerCase());
}

export type Claim = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Counts the account's runs in the last hour and records this one. It runs as the signed-in person,
 * so row-level security applies, and a person can add rows for themselves and nothing else.
 */
export async function claimGrokRun(
  supabase: SupabaseClient,
  accountId: string,
  caseId: string,
  { limit, now = new Date() }: { limit: number; now?: Date },
): Promise<Claim> {
  const since = new Date(now.getTime() - HOUR_MS);
  const { data, error } = await supabase
    .from("grok_run")
    .select("started_at")
    .eq("account_id", accountId)
    .gt("started_at", since.toISOString())
    .order("started_at", { ascending: true });
  if (error) throw new Error("The recent Ask Grok runs could not be counted.");

  const recent = data ?? [];
  if (recent.length >= limit) {
    const oldest = new Date(recent[0].started_at as string).getTime();
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + HOUR_MS - now.getTime()) / 1000)) };
  }

  const { error: insertError } = await supabase.from("grok_run").insert({ account_id: accountId, case_id: caseId });
  if (insertError) throw new Error("This Ask Grok run could not be recorded.");
  return { ok: true };
}
