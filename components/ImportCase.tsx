"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { getCaseStore, type CaseSummary } from "../lib/case-store";
import { FLIGHT_SOURCE_LABELS } from "../lib/export";
import { useAccount } from "./AccountProvider";
import { Button } from "./ui/Button";

type Listing =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; cases: CaseSummary[] }
  | { status: "error"; message: string };

// Opens one of the signed-in account's cases on the globe. This only reads: the list and the
// case come through the account-scoped routes, so another account's case id is never found, and
// nothing here saves a case or writes its log.
export function ImportCase({ current }: { current: string | null }) {
  const router = useRouter();
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const panelId = useId();
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing>({ status: "idle" });
  const [chosen, setChosen] = useState("");
  const requested = useRef(false);

  // The list is read once, the first time the panel opens.
  useEffect(() => {
    if (!open || userId === null || requested.current) return;
    requested.current = true;
    setListing({ status: "loading" });
    getCaseStore()
      .list(userId)
      .then((cases) => {
        setListing({ status: "ready", cases });
        const withFlight = cases.filter((entry) => entry.flightSource !== null);
        setChosen((withFlight.find((entry) => entry.id === current) ?? withFlight[0])?.id ?? "");
      })
      .catch((error: unknown) => {
        setListing({ status: "error", message: error instanceof Error ? error.message : "Something went wrong." });
      });
  }, [open, userId, current]);

  function body() {
    if (account.status === "unavailable") return <p className="body-sm rok-muted">Accounts are not set up here.</p>;
    if (account.status === "signed-out") {
      return (
        <p className="body-sm rok-muted">
          Sign in to import one of your cases. <Link href="/account">Sign in</Link>
        </p>
      );
    }
    if (account.status === "loading" || listing.status === "idle" || listing.status === "loading") {
      return <p className="body-sm rok-muted">Loading your cases.</p>;
    }
    if (listing.status === "error") return <p className="body-sm" role="alert">{listing.message}</p>;
    if (listing.cases.length === 0) {
      return (
        <p className="body-sm rok-muted">
          You have no saved cases. <Link href="/cases">Create one</Link>
        </p>
      );
    }
    return (
      <>
        <div className="rok-field">
          <label className="rok-field__label eyebrow" htmlFor={selectId}>
            Case
          </label>
          <select
            id={selectId}
            className="rok-field__input body"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            {chosen === "" ? <option value="">No case has a flight file yet</option> : null}
            {listing.cases.map((entry) => (
              <option key={entry.id} value={entry.id} disabled={entry.flightSource === null}>
                {entry.name} · {entry.flightSource ? FLIGHT_SOURCE_LABELS[entry.flightSource] : "no flight file"}
              </option>
            ))}
          </select>
        </div>
        <p className="body-sm rok-subtle">
          The globe flies the case&apos;s working copy, or its optimized OEM when the working copy is empty.
        </p>
        <div className="algorithm-actions">
          <Button size="sm" disabled={chosen === ""} onClick={() => router.push(`/test?case=${encodeURIComponent(chosen)}`)}>
            Open on the globe
          </Button>
          {current !== null ? (
            <Button variant="quiet" size="sm" onClick={() => router.push("/test")}>
              Back to the fixture
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <Button aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        Import case
      </Button>
      {open ? (
        <div id={panelId} className="import-case">
          {body()}
        </div>
      ) : null}
    </>
  );
}
