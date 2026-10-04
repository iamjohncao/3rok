"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAttachmentStore } from "../lib/attachment-store";
import type { CaseDocument, CaseRecord } from "../lib/case";
import {
  CASE_NAME_MAX_LENGTH,
  applyHandEdit,
  applyIngest,
  attachPdf,
  renameCase,
  toggleChip,
} from "../lib/case-ops";
import { getCaseStore } from "../lib/case-store";
import { saveFile } from "../lib/download";
import { applyExport, bundleDownload, oemDownload, type ExportAction } from "../lib/export";
import { ACCOUNTS_NOT_SET_UP } from "../lib/supabase/env";
import { useAccount } from "./AccountProvider";
import { SignInPrompt } from "./SignInPrompt";
import { ActivityRegion } from "./case/ActivityRegion";
import { AlgorithmRegion } from "./case/AlgorithmRegion";
import type { AskResult } from "./case/AskGrokForm";
import { DataRegion } from "./case/DataRegion";
import { ScoreRegion } from "./case/ScoreRegion";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; doc: CaseDocument };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function CaseHeader({
  doc,
  asking,
  onRename,
}: {
  doc: CaseDocument;
  asking: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(doc.name);

  return (
    <header className="page-head">
      <div>
        <p className="page-head__eyebrow eyebrow">Case</p>
        {editing ? (
          <form
            className="rename-form"
            onSubmit={async (event) => {
              event.preventDefault();
              await onRename(name);
              setEditing(false);
            }}
          >
            <Field
              label="Case name"
              value={name}
              maxLength={CASE_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={name.trim() === ""}>
              Save name
            </Button>
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setName(doc.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <>
            <h1 className="page-head__title heading-lg">{doc.name}</h1>
            <p className="page-head__meta data-sm">{doc.id}</p>
            <Button
              variant="quiet"
              size="sm"
              disabled={asking}
              onClick={() => {
                setName(doc.name);
                setEditing(true);
              }}
            >
              Rename
            </Button>
          </>
        )}
      </div>
      {/* Submits the instruction form in the Activity region. The one solid button on this screen. */}
      <Button variant="solid" type="submit" form="ask-grok-form" disabled={asking}>
        {asking ? "Grok is reading" : "Ask Grok"}
      </Button>
    </header>
  );
}

// One case: Data, Activity, Algorithm, Score. Saved to the signed-in account.
export function CaseScreen({ id }: { id: string }) {
  const router = useRouter();
  const account = useAccount();
  const userId = account.status === "signed-in" ? account.userId : null;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const askingRef = useRef(false);
  const latest = useRef<CaseDocument | null>(null);
  const accountRef = useRef<string | null>(userId);
  const queue = useRef<Promise<void>>(Promise.resolve());
  accountRef.current = userId;

  useEffect(() => {
    if (userId === null) return;
    let live = true;
    setState({ status: "loading" });
    (async () => {
      try {
        const doc = await getCaseStore().get(userId, id);
        if (!live) return;
        latest.current = doc;
        setState(doc ? { status: "ready", doc } : { status: "missing" });
      } catch (error) {
        if (live) setState({ status: "error", message: messageOf(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, userId]);

  // Saves run one at a time, each starting from the last saved document, so a
  // rename and a hand edit can never overwrite each other. Resolves true unless the
  // save failed, so a caller never reports a save that did not happen.
  const update = useCallback((change: (doc: CaseDocument) => CaseDocument) => {
    const run = queue.current.then(async (): Promise<boolean> => {
      // While Grok works the server saves the case. A save from this page then would overwrite its result.
      if (askingRef.current) return false;
      const current = latest.current;
      const owner = accountRef.current;
      if (!current || owner === null) return false;
      const next = change(current);
      if (next === current) return true;
      try {
        await getCaseStore().save(owner, next);
        latest.current = next;
        setState({ status: "ready", doc: next });
        setSaveError(null);
        return true;
      } catch (error) {
        setSaveError(messageOf(error));
        return false;
      }
    });
    queue.current = run.then(() => undefined);
    return run;
  }, []);

  // Ask Grok. The server reads the case, runs Grok and the evaluator, saves the case, and returns it.
  // Saves still waiting go first, so the server reads what the person last wrote.
  async function ask(instruction: string): Promise<boolean> {
    if (askingRef.current) return false;
    askingRef.current = true;
    setAsking(true);
    setAskError(null);
    setAskResult(null);
    try {
      await queue.current;
      const response = await fetch("/api/grok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: id, instruction }),
      });
      const data: { case?: CaseDocument; verdict?: AskResult["verdict"]; reason?: string; error?: string } | null = await response
        .json()
        .catch(() => null);
      if (!response.ok || !data?.case || !data.verdict) {
        setAskError(data?.error ?? `Ask Grok failed (${response.status}).`);
        return false;
      }
      latest.current = data.case;
      setState({ status: "ready", doc: data.case });
      setAskResult({ verdict: data.verdict, reason: data.reason ?? "" });
      return true;
    } catch {
      setAskError("Ask Grok could not be reached. Check the connection and try again.");
      return false;
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  }

  // Every export is logged first. If the log cannot be saved the file is not sent, so no export is silent.
  // Export reads the saved case. It does not call Grok and it does not score anything.
  async function exportCase(action: ExportAction): Promise<void> {
    const sent: { doc: CaseDocument | null; at: string } = { doc: null, at: new Date().toISOString() };
    const saved = await update((current) => {
      const next = applyExport(current, action, sent.at);
      if (next !== current) sent.doc = next;
      return next;
    });
    if (!saved || sent.doc === null) return;

    if (action === "testing") {
      router.push(`/test?case=${encodeURIComponent(sent.doc.id)}`);
      return;
    }
    const file = action === "oem" ? oemDownload(sent.doc) : bundleDownload(sent.doc, sent.at);
    if (file) saveFile(file);
  }

  if (account.status === "unavailable") {
    return (
      <section className="frame frame--empty" role="alert">
        <p className="body">{ACCOUNTS_NOT_SET_UP}</p>
      </section>
    );
  }
  if (account.status === "signed-out") return <SignInPrompt what="Sign in to open this case." />;
  if (account.status === "loading" || state.status === "loading") {
    return (
      <section className="frame frame--empty" role="status">
        <p className="body rok-muted">Loading case.</p>
      </section>
    );
  }
  if (state.status === "missing") {
    return (
      <section className="frame frame--empty">
        <div>
          <p className="body rok-muted">This case is not saved to your account.</p>
          <Link className="rok-btn button" href="/cases">
            Back to cases
          </Link>
        </div>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="frame frame--empty" role="alert">
        <p className="body">{state.message}</p>
      </section>
    );
  }

  const { doc } = state;
  return (
    <>
      <CaseHeader
        key={doc.id}
        doc={doc}
        asking={asking}
        onRename={async (name) => {
          await update((current) => renameCase(current, name, new Date().toISOString()));
        }}
      />
      {saveError ? (
        <p className="save-error body-sm" role="alert">
          Could not save this case: {saveError}
        </p>
      ) : null}
      <div className="case-grid">
        <DataRegion
          doc={doc}
          locked={asking}
          onIngest={(records: CaseRecord[], filename: string) =>
            update((current) => applyIngest(current, records, filename, new Date().toISOString()))
          }
          onAttachPdf={async (recordId, filename, bytes) => {
            // The bytes stay in this browser. The case keeps only the file's name.
            const owner = accountRef.current;
            if (owner !== null) {
              await getAttachmentStore()
                ?.set(owner, doc.id, recordId, filename, bytes)
                .catch(() => undefined);
            }
            return update((current) => attachPdf(current, recordId, filename, new Date().toISOString()));
          }}
          onToggleChip={(chipId) => {
            void update((current) => toggleChip(current, chipId, new Date().toISOString()));
          }}
        />
        <AlgorithmRegion
          doc={doc}
          locked={asking}
          onHandEdit={async (text) => {
            await update((current) => applyHandEdit(current, text, new Date().toISOString()));
          }}
          onExport={exportCase}
        />
        <ActivityRegion doc={doc} asking={asking} askError={askError} askResult={askResult} onAsk={ask} />
        <ScoreRegion doc={doc} />
      </div>
    </>
  );
}
