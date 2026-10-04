// Sign-in, in the browser, through Supabase Auth. Supabase owns users, passwords, and
// sessions. There is no password or session code here.

import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

export type AccountState =
  | { status: "loading" }
  /** The deployment has no Supabase values, so nobody can sign in. */
  | { status: "unavailable" }
  | { status: "signed-out" }
  | { status: "signed-in"; userId: string; email: string | null };

export function accountStateFor(user: User | null): AccountState {
  return user ? { status: "signed-in", userId: user.id, email: user.email ?? null } : { status: "signed-out" };
}

export const MIN_PASSWORD_LENGTH = 8;

/** A sentence for the first problem with what was typed, or null when it is fine to send. */
export function checkCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a full email address, like name@example.com.";
  if (password.length < MIN_PASSWORD_LENGTH) return `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

export type AuthResult =
  | { ok: true; next: "signed-in" }
  | { ok: true; next: "confirm-email"; email: string }
  | { ok: false; error: string };

type AuthFailure = { message: string; code?: string; status?: number };

/** Supabase's wording, in this app's plain sentences. */
export function describeAuthError(error: AuthFailure): string {
  const message = error.message.toLowerCase();
  if (error.code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password do not match an account.";
  }
  if (error.code === "email_not_confirmed" || message.includes("email not confirmed")) {
    return "This account's email is not confirmed yet. Open the link we emailed, then sign in.";
  }
  if (error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit" || error.status === 429) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (error.code === "weak_password") return "That password is too weak. Use a longer one.";
  if (error.code === "signup_disabled") return "New accounts are turned off for this app.";
  return error.message;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const problem = checkCredentials(email, password);
  if (problem) return { ok: false, error: problem };
  const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
  return error ? { ok: false, error: describeAuthError(error) } : { ok: true, next: "signed-in" };
}

export async function createAccount(email: string, password: string): Promise<AuthResult> {
  const problem = checkCredentials(email, password);
  if (problem) return { ok: false, error: problem };
  const address = email.trim();
  const { data, error } = await createClient().auth.signUp({
    email: address,
    password,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) return { ok: false, error: describeAuthError(error) };
  // With email confirmation on there is no session yet. The reply is the same whether
  // or not the address already has an account, so it cannot be used to find out.
  return data.session ? { ok: true, next: "signed-in" } : { ok: true, next: "confirm-email", email: address };
}

export async function signOut(): Promise<void> {
  await createClient().auth.signOut();
}
