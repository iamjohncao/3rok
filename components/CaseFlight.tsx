"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { CaseDocument } from "../lib/case";
import { UUID } from "../lib/case-validate";
import { getCaseStore } from "../lib/case-store";
import { flightArtifact } from "../lib/export";
import { ACCOUNTS_NOT_SET_UP } from "../lib/supabase/env";
import { useAccount } from "./AccountProvider";
import { FlightFile } from "./FlightFile";
import { ImportCase } from "./ImportCase";
import { Panel } from "./ui/Panel";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; doc: CaseDocument };

// No path to draw yet: the globe frame says why, and the way to another case stays in reach.
function NoPath({ caseId, children }: { caseId: string | null; children: ReactNode }) {
  return (
    <>
      <section aria-label="Globe" className="frame frame--empty globe-frame">
        <div role="status">{children}</div>
      </section>
      <aside aria-label="Specs" className="specs">
        <div className="controls__row">
          <ImportCase current={caseId} />
        </div>
        <Panel id="readings" title="Readings" eyebrow="At the scrubbed epoch">
          <p className="body-sm rok-muted">There is no path to read.</p>
        </Panel>
      </aside>
    </>
  );
}

// The file one of the signed-in account's cases exports to testing. The case is read through the
// account-scoped route, so another account's case id comes back as "not saved to your account".
// This reads only: it saves nothing, writes no log, and never asks Grok for anything.
export function CaseFlight({ caseId }: { caseId: string }) {
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const valid = UUID.test(caseId);

  useEffect(() => {
    if (userId === null || !valid) return;
    let live = true;
    setState({ status: "loading" });
    getCaseStore()
      .get(userId, caseId)
      .then((doc) => {
        if (live) setState(doc ? { status: "ready", doc } : { status: "missing" });
      })
      .catch((error: unknown) => {
        if (live) setState({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      });
    return () => {
      live = false;
    };
  }, [caseId, userId, valid]);

  if (!valid) {
    return (
      <NoPath caseId={null}>
        <p className="body">That address does not name a case.</p>
        <Link className="rok-btn button" href="/test">
          Back to the fixture
        </Link>
      </NoPath>
    );
  }
  if (account.status === "unavailable") {
    return (
      <NoPath caseId={null}>
        <p className="body">{ACCOUNTS_NOT_SET_UP}</p>
      </NoPath>
    );
  }
  if (account.status === "signed-out") {
    return (
      <NoPath caseId={null}>
        <p className="body rok-muted">Sign in to fly this case.</p>
        <Link className="rok-btn button" href="/account">
          Sign in
        </Link>
      </NoPath>
    );
  }
  if (account.status === "loading" || state.status === "loading") {
    return (
      <NoPath caseId={null}>
        <p className="body rok-muted">Loading the case.</p>
      </NoPath>
    );
  }
  if (state.status === "missing") {
    return (
      <NoPath caseId={null}>
        <p className="body">This case is not saved to your account.</p>
        <Link className="rok-btn button" href="/test">
          Back to the fixture
        </Link>
      </NoPath>
    );
  }
  if (state.status === "error") {
    return (
      <NoPath caseId={null}>
        <p className="body" role="alert">
          {state.message}
        </p>
      </NoPath>
    );
  }

  const { doc } = state;
  const artifact = flightArtifact(doc);
  if (artifact === null) {
    return (
      <NoPath caseId={doc.id}>
        <p className="body">{doc.name} has no flight file yet.</p>
        <p className="body-sm rok-subtle">Ask Grok for an optimized OEM, or save a working copy, then export it.</p>
        <Link className="rok-btn button" href={`/cases/${doc.id}`}>
          Open the case
        </Link>
      </NoPath>
    );
  }

  return (
    <FlightFile
      key={`${doc.id}:${artifact.source}:${doc.updatedAt}`}
      text={artifact.text}
      origin={{
        kind: "case",
        caseId: doc.id,
        caseName: doc.name,
        source: artifact.source,
        holdoutError: doc.holdoutError,
      }}
    />
  );
}
