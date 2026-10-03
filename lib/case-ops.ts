// Pure operations on a case document. No storage, no network, no React.
// Every function takes the time as a parameter so tests stay deterministic.

import {
  RECORD_TYPES,
  type CaseDocument,
  type CaseRecord,
  type LogEntry,
  type RecordType,
} from "./case";

export const UNTITLED_CASE = "Untitled case";
export const CASE_NAME_MAX_LENGTH = 120;

/** An empty container: no records, no log, and no flight. */
export function newCase(id: string, now: string, accountId: string | null = null): CaseDocument {
  return {
    id,
    accountId,
    name: UNTITLED_CASE,
    chipIds: [],
    records: [],
    log: [],
    optimizedOem: null,
    workingOem: null,
    holdoutError: null,
    updatedAt: now,
  };
}

/** Returns the same document when the name is empty or unchanged. */
export function renameCase(doc: CaseDocument, name: string, now: string): CaseDocument {
  const next = name.trim().slice(0, CASE_NAME_MAX_LENGTH);
  if (next === "" || next === doc.name) return doc;
  return { ...doc, name: next, updatedAt: now };
}

const MAX_CHANGED_LINES_LOGGED = 20;

function lineCount(n: number): string {
  return `${n} line${n === 1 ? "" : "s"}`;
}

// A file's final newline ends its last line. It does not start another one.
function toLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The text that changed, as the log records it: what left, what arrived, and where. */
export function describeEdit(before: string, after: string): string {
  const oldLines = toLines(before);
  const newLines = toLines(after);

  if (oldLines.length === newLines.length && oldLines.every((line, i) => line === newLines[i])) {
    return "Hand edit to the working copy: only the final newline changed.";
  }

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const removed = oldLines.slice(start, oldEnd);
  const added = newLines.slice(start, newEnd);
  const changed = [...removed.map((line) => `- ${line}`), ...added.map((line) => `+ ${line}`)];
  const shown = changed.slice(0, MAX_CHANGED_LINES_LOGGED);
  const hidden = changed.length - shown.length;

  return [
    `Hand edit to the working copy: ${lineCount(removed.length)} removed, ${lineCount(added.length)} added, from line ${start + 1}.`,
    ...shown,
    ...(hidden > 0 ? [`... ${lineCount(hidden)} more changed.`] : []),
  ].join("\n");
}

/**
 * The only way the working copy changes. A hand edit updates `workingOem` and
 * appends a `hand_edit` log entry with the time and the text that changed. It
 * never touches `optimizedOem` or `holdoutError`. Empty text clears the working
 * copy. Returns the same document when nothing changed, so there is no log
 * entry for a no-op.
 */
export function applyHandEdit(doc: CaseDocument, text: string, now: string): CaseDocument {
  const before = doc.workingOem ?? "";
  const next = text.trim() === "" ? null : text;
  if ((next ?? "") === before) return doc;

  const entry: LogEntry = {
    at: now,
    kind: "hand_edit",
    text: describeEdit(before, next ?? ""),
    oem: next,
    holdout_error: null,
  };
  return { ...doc, workingOem: next, log: [...doc.log, entry], updatedAt: now };
}

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  "chip-identity": "Record 1 · Chip identity",
  tid: "Record 2 · Total ionizing dose test",
  see: "Record 3 · Single-event effects test",
  "thermal-wear": "Record 4 · Thermal and electrical wear test",
  trajectory: "Record 5 · Vehicle trajectory",
  environment: "Record 6 · Environment along the trajectory",
  placement: "Record 7 · Placement inside the vehicle",
  outcome: "Record 8 · Observed outcome",
  provenance: "Record 9 · Provenance",
};

export type RecordGroup = { type: RecordType; label: string; records: CaseRecord[] };

/**
 * All nine types, in order, each with its records. Holdout rows are in the
 * group like any other row: the person always sees them.
 */
export function groupRecords(records: CaseRecord[]): RecordGroup[] {
  return RECORD_TYPES.map((type) => ({
    type,
    label: RECORD_TYPE_LABELS[type],
    records: records.filter((record) => record.record_type === type),
  }));
}

/** `2026-10-03T18:20:00.000Z` becomes `2026-10-03 18:20 UTC`. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
