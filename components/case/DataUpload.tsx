"use client";

import { useId, useMemo, useState } from "react";
import type { CaseDocument, CaseRecord } from "../../lib/case";
import { applyIngest, caseBytes, looksLikePdf, previewIngest } from "../../lib/case-ops";
import { MAX_CASE_BYTES } from "../../lib/case-validate";
import {
  MAX_FILE_BYTES,
  describeIssue,
  formatOf,
  ingestText,
  type IngestIssue,
  type IngestResult,
} from "../../lib/ingest";
import { Button } from "../ui/Button";

const MAX_ROWS_SHOWN = 12;
const ACCEPT = ".json,.csv,.xlsx,.md,.markdown,.pdf";

type Pending =
  | { kind: "records"; filename: string; records: CaseRecord[] }
  | { kind: "pdf"; filename: string; bytes: ArrayBuffer };

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

async function ingestFile(file: File): Promise<IngestResult> {
  if (formatOf(file.name) === "xlsx") {
    const { ingestXlsx } = await import("../../lib/ingest-xlsx");
    return ingestXlsx(await file.arrayBuffer());
  }
  return ingestText(file.name, await file.text());
}

function RowList({ records }: { records: CaseRecord[] }) {
  const shown = records.slice(0, MAX_ROWS_SHOWN);
  return (
    <ul className="upload-rows">
      {shown.map((record) => (
        <li key={record.record_id} className="upload-row">
          <span className="data-sm">{record.record_id}</span>
          <span className="body-sm rok-muted">{record.record_type}</span>
          <span className="tag data-sm">{record.value_status}</span>
          <span className="tag data-sm">{record.split}</span>
        </li>
      ))}
      {records.length > shown.length ? (
        <li className="body-sm rok-subtle">and {records.length - shown.length} more.</li>
      ) : null}
    </ul>
  );
}

// Add or replace records from a file. A file is saved whole or refused whole. Nothing is
// saved until the person confirms the preview, and a replaced row is logged by name.
export function DataUpload({
  doc,
  locked,
  onIngest,
  onAttachPdf,
}: {
  doc: CaseDocument;
  locked: boolean;
  onIngest: (records: CaseRecord[], filename: string) => Promise<boolean>;
  onAttachPdf: (recordId: string, filename: string, bytes: ArrayBuffer) => Promise<boolean>;
}) {
  const inputId = useId();
  const selectId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [refusal, setRefusal] = useState<IngestIssue[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [recordId, setRecordId] = useState("");
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () => (pending?.kind === "records" ? previewIngest(doc, pending.records) : null),
    [doc, pending],
  );

  // A case is saved in one request. Say so before the save, not after it fails.
  const tooLarge = useMemo(() => {
    if (pending?.kind !== "records") return false;
    return caseBytes(applyIngest(doc, pending.records, pending.filename, new Date().toISOString())) > MAX_CASE_BYTES;
  }, [doc, pending]);

  function reset() {
    setPending(null);
    setRefusal([]);
    setSaved(null);
  }

  function refuse(message: string) {
    setRefusal([{ where: null, message }]);
  }

  async function choose(file: File) {
    reset();
    setBusy(true);
    try {
      const kind = formatOf(file.name);
      if (file.size > MAX_FILE_BYTES) {
        refuse(`${file.name} is over 100 MB, so it was not read. Split it into smaller files.`);
      } else if (kind === null) {
        refuse(`${file.name} is not accepted. Use JSON, CSV, XLSX, or Markdown. A PDF can be attached to a record.`);
      } else if (kind === "pdf") {
        if (doc.records.length === 0) {
          refuse("A PDF rides along under a record that is already in the case. Add the record first.");
          return;
        }
        const bytes = await file.arrayBuffer();
        if (!looksLikePdf(new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength)))) {
          refuse(`${file.name} does not start with %PDF-, so it is not a PDF.`);
          return;
        }
        setRecordId(doc.records[0].record_id);
        setPending({ kind: "pdf", filename: file.name, bytes });
      } else {
        const result = await ingestFile(file);
        if (result.ok) setPending({ kind: "records", filename: file.name, records: result.records });
        else setRefusal(result.errors);
      }
    } catch (error) {
      refuse(`${file.name} could not be read: ${error instanceof Error ? error.message : "unknown error"}.`);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "records" && preview) {
        const parts = [
          preview.added.length > 0 ? `added ${plural(preview.added.length, "record")}` : null,
          preview.replaced.length > 0 ? `replaced ${plural(preview.replaced.length, "record")}` : null,
        ].filter(Boolean);
        if (!(await onIngest(pending.records, pending.filename))) return;
        setSaved(`Saved ${pending.filename}: ${parts.join(" and ")}.`);
      } else if (pending.kind === "pdf") {
        if (!(await onAttachPdf(recordId, pending.filename, pending.bytes))) return;
        setSaved(`Attached ${pending.filename} to ${recordId}.`);
      }
      // A failed save leaves the preview up, so the person can try again. The case screen says why.
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="data-upload">
      <label className="rok-field__label eyebrow" htmlFor={inputId}>
        Add a file
      </label>
      <input
        id={inputId}
        type="file"
        className="body-sm"
        accept={ACCEPT}
        disabled={busy || locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void choose(file);
        }}
      />
      <p className="body-sm rok-subtle">
        JSON, CSV, XLSX, or Markdown tables, up to 100 MB. A file is saved whole or not at all.
      </p>

      {refusal.length > 0 ? (
        <div role="alert" className="upload-refusal">
          <p className="body-sm">Nothing was saved.</p>
          <ul className="validation-list body-sm">
            {refusal.map((issue, index) => (
              <li key={`${index}-${issue.message}`}>{describeIssue(issue)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pending?.kind === "records" && preview ? (
        <div role="status" className="upload-preview">
          <p className="body-sm">
            {pending.filename} has {plural(pending.records.length, "record")}.
          </p>
          {preview.added.length > 0 ? (
            <>
              <p className="eyebrow">Added</p>
              <RowList records={preview.added} />
            </>
          ) : null}
          {preview.replaced.length > 0 ? (
            <>
              <p className="eyebrow">Replaced</p>
              <RowList records={preview.replaced.map((pair) => pair.after)} />
              <p className="body-sm rok-subtle">Each replacement is written to the activity log by record_id.</p>
            </>
          ) : null}
          {tooLarge ? (
            <p className="body-sm" role="alert">
              Nothing was saved. With these records the case would be over 4 MB, the most one case can save. Split the
              file, or leave the records you do not need out of it.
            </p>
          ) : null}
          <div className="algorithm-actions">
            <Button size="sm" disabled={busy || locked || tooLarge} onClick={confirm}>
              {preview.replaced.length > 0
                ? `Save and replace ${plural(preview.replaced.length, "record")}`
                : `Save ${plural(preview.added.length, "record")}`}
            </Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {pending?.kind === "pdf" ? (
        <div role="status" className="upload-preview">
          <p className="body-sm">
            {pending.filename} is not a record. It is attached to one record that is already in the case.
          </p>
          <label className="rok-field__label eyebrow" htmlFor={selectId}>
            Attach to record
          </label>
          <select
            id={selectId}
            className="rok-field__input body"
            value={recordId}
            onChange={(event) => setRecordId(event.target.value)}
          >
            {doc.records.map((record) => (
              <option key={record.record_id} value={record.record_id}>
                {record.record_id} · {record.record_type}
              </option>
            ))}
          </select>
          <p className="body-sm rok-subtle">
            The PDF stays in this browser. It is not saved to your account yet. Put the numbers in the record&apos;s
            body.
          </p>
          <div className="algorithm-actions">
            <Button size="sm" disabled={busy || locked || recordId === ""} onClick={confirm}>
              Attach PDF
            </Button>
            <Button variant="quiet" size="sm" disabled={busy} onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {saved ? (
        <p className="body-sm rok-muted" role="status">
          {saved}
        </p>
      ) : null}
    </div>
  );
}
