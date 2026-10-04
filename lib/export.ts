// How a case leaves the editor. Pure: no storage, no network, no React.
//
// The flight is one OEM string. Export reads a case and writes one log entry. It never calls
// the model, never re-scores, and never changes either OEM string.

import type { CaseDocument, LogEntry } from "./case";

export type FlightSource = "workingOem" | "optimizedOem";

export const FLIGHT_SOURCE_LABELS: Record<FlightSource, string> = {
  workingOem: "Working copy",
  optimizedOem: "Optimized OEM",
};

export type FlightArtifact = { source: FlightSource; text: string };

function present(text: string | null): text is string {
  return text !== null && text.trim() !== "";
}

/**
 * The text that leaves the case as the flight: the working copy, or the optimized OEM when the
 * working copy is empty. The testing page and the `.oem` download both read it from here, so the
 * globe and the file are the same text. Null when the case has no flight file yet.
 */
export function flightArtifact(doc: CaseDocument): FlightArtifact | null {
  if (present(doc.workingOem)) return { source: "workingOem", text: doc.workingOem };
  if (present(doc.optimizedOem)) return { source: "optimizedOem", text: doc.optimizedOem };
  return null;
}

/** A case id is a UUID once saved. Anything else is kept out of a file name. */
function fileSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function oemFileName(doc: CaseDocument): string {
  return `CASE-${fileSafe(doc.id)}.oem`;
}

export function bundleFileName(doc: CaseDocument): string {
  return `CASE-${fileSafe(doc.id)}.json`;
}

export type FileDownload = { filename: string; mime: string; bytes: Uint8Array };

/** The `.oem` download: the exact bytes of the text the globe parses. Null when there is no flight file. */
export function oemDownload(doc: CaseDocument): (FileDownload & { source: FlightSource }) | null {
  const artifact = flightArtifact(doc);
  if (artifact === null) return null;
  return {
    filename: oemFileName(doc),
    mime: "text/plain;charset=utf-8",
    bytes: new TextEncoder().encode(artifact.text),
    source: artifact.source,
  };
}

export const BUNDLE_NOTE =
  "The chat is not the flight. The flight is the CCSDS OEM named by flight_artifact. " +
  "holdoutError is the last holdout score of the optimized OEM. A working copy is never scored.";

export type CaseBundle = {
  bundle: "3rok-case";
  bundle_version: 1;
  exported_at: string;
  note: string;
  /** Which OEM string is the flight, by its field name in `case`. Null when the case has none. */
  flight_artifact: FlightSource | null;
  /** The whole case: records of every type with `value_status` and `split`, the log, both OEM strings, and the last holdout score. */
  case: Omit<CaseDocument, "accountId">;
};

/** The saved record of a case. The account id stays behind: the file can be shared, the account cannot. */
export function caseBundle(doc: CaseDocument, exportedAt: string): CaseBundle {
  const { accountId: _accountId, ...rest } = doc;
  return {
    bundle: "3rok-case",
    bundle_version: 1,
    exported_at: exportedAt,
    note: BUNDLE_NOTE,
    flight_artifact: flightArtifact(doc)?.source ?? null,
    case: rest,
  };
}

export function bundleDownload(doc: CaseDocument, exportedAt: string): FileDownload {
  return {
    filename: bundleFileName(doc),
    mime: "application/json",
    bytes: new TextEncoder().encode(`${JSON.stringify(caseBundle(doc, exportedAt), null, 2)}\n`),
  };
}

export type ExportAction = "testing" | "oem" | "case";

function lineCount(text: string): number {
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

function describeFlight(artifact: FlightArtifact): string {
  const bytes = new TextEncoder().encode(artifact.text).length;
  const lines = lineCount(artifact.text);
  return `${FLIGHT_SOURCE_LABELS[artifact.source].toLowerCase()}, ${lines} line${lines === 1 ? "" : "s"}, ${bytes} bytes`;
}

/**
 * Appends one `export` entry: what left the case, as which file, and which OEM string it was. The
 * entry holds no copy of the OEM. Returns the same document when there is no flight file to send, so
 * a refused export writes nothing. Never touches either OEM string or `holdoutError`.
 */
export function applyExport(doc: CaseDocument, action: ExportAction, now: string): CaseDocument {
  const artifact = flightArtifact(doc);
  let text: string;
  if (action === "case") {
    text = `Downloaded the case as ${bundleFileName(doc)}. Flight artifact: ${artifact ? describeFlight(artifact) : "none, the case has no flight file"}.`;
  } else if (artifact === null) {
    return doc;
  } else if (action === "oem") {
    text = `Downloaded ${oemFileName(doc)}: ${describeFlight(artifact)}.`;
  } else {
    text = `Exported to testing: ${describeFlight(artifact)}.`;
  }
  const entry: LogEntry = { at: now, kind: "export", text, oem: null, holdout_error: null };
  return { ...doc, log: [...doc.log, entry], updatedAt: now };
}
