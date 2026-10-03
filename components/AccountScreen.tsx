"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createAccount, signIn, signOut } from "../lib/account";
import { ACCOUNTS_NOT_SET_UP } from "../lib/supabase/env";
import { useAccount } from "./AccountProvider";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";
import { Panel } from "./ui/Panel";

type Mode = "sign-in" | "create";

// Sign in, create an account, or sign out. Supabase Auth does the work. This screen is a
// form, nothing else: it draws no path and calls no model.
export function AccountScreen({ problem }: { problem: string | null }) {
  const router = useRouter();
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = mode === "sign-in" ? await signIn(email, password) : await createAccount(email, password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.next === "confirm-email") {
        setNotice(
          `We sent a confirmation link to ${result.email}. Open it, then sign in. If you already have an account, sign in instead.`,
        );
        setMode("sign-in");
        setPassword("");
        return;
      }
      router.push("/cases");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      await signOut();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const linkProblem =
    problem === "link" ? (
      <p className="save-error body-sm" role="alert">
        That confirmation link did not work, or it has expired. Sign in, or create the account again.
      </p>
    ) : null;

  if (account.status === "loading") {
    return (
      <p className="body rok-muted" role="status">
        Checking who is signed in.
      </p>
    );
  }

  if (account.status === "unavailable") {
    return (
      <Panel id="unavailable" title="Accounts are not set up">
        <p className="body rok-muted">{ACCOUNTS_NOT_SET_UP}</p>
      </Panel>
    );
  }

  if (account.status === "signed-in") {
    return (
      <>
        {linkProblem}
        <Panel id="signed-in" title="Signed in">
          <p className="body-sm rok-subtle">Your cases are saved to this account.</p>
          <p className="data-md">{account.email ?? account.userId}</p>
          <div className="account-form__actions">
            <Link className="rok-btn rok-btn--solid button" href="/cases">
              Open cases
            </Link>
            <Button onClick={leave} disabled={busy}>
              Sign out
            </Button>
          </div>
        </Panel>
      </>
    );
  }

  const creating = mode === "create";
  return (
    <>
      {linkProblem}
      <Panel id="credentials" title={creating ? "Create account" : "Sign in"}>
        <form className="account-form" onSubmit={submit} noValidate>
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            hint={creating ? "At least 8 characters." : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? (
            <p className="save-error body-sm" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="fixture-banner body-sm" role="status">
              {notice}
            </p>
          ) : null}
          <div className="account-form__actions">
            <Button variant="solid" type="submit" disabled={busy}>
              {creating ? "Create account" : "Sign in"}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setMode(creating ? "sign-in" : "create");
                setError(null);
                setNotice(null);
              }}
            >
              {creating ? "I already have an account" : "Create an account"}
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
