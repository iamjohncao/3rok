"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUtc, newCase } from "../lib/case-ops";
import { LOCAL_ACCOUNT_ID, getCaseStore, type CaseSummary } from "../lib/case-store";
import { Button } from "./ui/Button";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

// The saved cases, newest first. Cases are saved in this browser until accounts arrive.
export function CaseList() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const rows = await getCaseStore().list(LOCAL_ACCOUNT_ID);
        if (live) setCases(rows);
      } catch (failure) {
        if (live) setError(messageOf(failure));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function create() {
    setCreating(true);
    try {
      const doc = newCase(crypto.randomUUID(), new Date().toISOString());
      await getCaseStore().save(LOCAL_ACCOUNT_ID, doc);
      router.push(`/cases/${doc.id}`);
    } catch (failure) {
      setError(messageOf(failure));
      setCreating(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">Saved work</p>
          <h1 className="page-head__title heading-lg">Cases</h1>
        </div>
        <Button variant="solid" onClick={create} disabled={creating || error !== null}>
          Create case
        </Button>
      </header>

      {error ? (
        <section className="frame frame--empty" role="alert">
          <p className="body">{error}</p>
        </section>
      ) : cases === null ? (
        <section className="frame frame--empty" role="status">
          <p className="body rok-muted">Loading cases.</p>
        </section>
      ) : cases.length === 0 ? (
        <section aria-label="Case list" className="frame frame--empty">
          <p className="body rok-muted">No cases yet.</p>
        </section>
      ) : (
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
      )}
    </>
  );
}
