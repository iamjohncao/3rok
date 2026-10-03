"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUtc, newCase } from "../lib/case-ops";
import { getCaseStore, type CaseSummary } from "../lib/case-store";
import { ACCOUNTS_NOT_SET_UP } from "../lib/supabase/env";
import { useAccount } from "./AccountProvider";
import { SignInPrompt } from "./SignInPrompt";
import { Button } from "./ui/Button";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// The signed-in account's saved cases, newest first.
export function CaseList() {
  const router = useRouter();
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (userId === null) return;
    let live = true;
    setCases(null);
    setError(null);
    (async () => {
      try {
        const rows = await getCaseStore().list(userId);
        if (live) setCases(rows);
      } catch (failure) {
        if (live) setError(messageOf(failure));
      }
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  async function create() {
    if (userId === null) return;
    setCreating(true);
    try {
      const doc = newCase(crypto.randomUUID(), new Date().toISOString(), userId);
      await getCaseStore().save(userId, doc);
      router.push(`/cases/${doc.id}`);
    } catch (failure) {
      setError(messageOf(failure));
      setCreating(false);
    }
  }

  function content() {
    if (account.status === "loading") {
      return (
        <section className="frame frame--empty" role="status">
          <p className="body rok-muted">Checking who is signed in.</p>
        </section>
      );
    }
    if (account.status === "unavailable") {
      return (
        <section className="frame frame--empty" role="alert">
          <p className="body">{ACCOUNTS_NOT_SET_UP}</p>
        </section>
      );
    }
    if (account.status === "signed-out") return <SignInPrompt what="Sign in to see and keep your cases." />;

    if (error) {
      return (
        <section className="frame frame--empty" role="alert">
          <p className="body">{error}</p>
        </section>
      );
    }
    if (cases === null) {
      return (
        <section className="frame frame--empty" role="status">
          <p className="body rok-muted">Loading cases.</p>
        </section>
      );
    }
    if (cases.length === 0) {
      return (
        <section aria-label="Case list" className="frame frame--empty">
          <p className="body rok-muted">No cases yet.</p>
        </section>
      );
    }
    return (
      <div className="frame table-wrap">
        <table className="rok-table">
          <thead>
            <tr>
              <th scope="col" className="eyebrow">Name</th>
              <th scope="col" className="eyebrow">Chip family</th>
              <th scope="col" className="eyebrow">Optimized OEM</th>
              <th scope="col" className="eyebrow">Score</th>
              <th scope="col" className="eyebrow">Last log entry</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/cases/${row.id}`}>{row.name}</Link>
                </td>
                <td>{row.chipFamily ?? "—"}</td>
                <td>{row.hasOptimizedOem ? "yes" : "no"}</td>
                <td>{row.isScored ? "scored" : "unscored"}</td>
                <td className="data-sm">{row.lastLogAt ? formatUtc(row.lastLogAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">Saved work</p>
          <h1 className="page-head__title heading-lg">Cases</h1>
        </div>
        <Button variant="solid" onClick={create} disabled={userId === null || creating || error !== null}>
          Create case
        </Button>
      </header>
      {content()}
    </>
  );
}
