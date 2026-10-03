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

// ---------------------------------------------------------------------------
// Upload: what a file would change, and the change itself.

export type IngestPreview = {
  added: CaseRecord[];
  /** Each replacement pairs the row now in the case with the row the file brings. */
  replaced: { before: CaseRecord; after: CaseRecord }[];
};

/** What saving these rows would do. Nothing is written. A row is replaced when its `record_id` is already in the case. */
export function previewIngest(doc: CaseDocument, incoming: CaseRecord[]): IngestPreview {
  const existing = new Map(doc.records.map((record) => [record.record_id, record]));
  const preview: IngestPreview = { added: [], replaced: [] };
  for (const record of incoming) {
    const before = existing.get(record.record_id);
    if (before) preview.replaced.push({ before, after: record });
    else preview.added.push(record);
  }
  return preview;
}

function countOf(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Saves uploaded rows. A new `record_id` is appended. An existing one is replaced in
 * place, and each replacement gets its own `record_replaced` entry that names the
 * `record_id` and the type, so no upload overwrites a row silently. One `record_added`
 * entry summarises the rest. A replaced row keeps its old `source_filename` when the new
 * row has none. Never touches either OEM string or `holdoutError`.
 */
export function applyIngest(
  doc: CaseDocument,
  incoming: CaseRecord[],
  filename: string,
  now: string,
): CaseDocument {
  if (incoming.length === 0) return doc;
  const { added, replaced } = previewIngest(doc, incoming);

  const replacements = new Map(
    replaced.map(({ before, after }) => [
      after.record_id,
      after.source_filename === null && before.source_filename !== null
        ? { ...after, source_filename: before.source_filename }
        : after,
    ]),
  );
  const records = [
    ...doc.records.map((record) => replacements.get(record.record_id) ?? record),
    ...added,
  ];

  const entries: LogEntry[] = replaced.map(({ before, after }) => ({
    at: now,
    kind: "record_replaced",
    text:
      before.record_type === after.record_type
        ? `Replaced ${after.record_id} (${after.record_type}) from ${filename}.`
        : `Replaced ${after.record_id} (was ${before.record_type}, now ${after.record_type}) from ${filename}.`,
    oem: null,
    holdout_error: null,
  }));
  if (added.length > 0) {
    entries.push({
      at: now,
      kind: "record_added",
      text: `Added ${countOf(added.length, "record")} from ${filename}: ${summarizeTypes(added)}.`,
      oem: null,
      holdout_error: null,
    });
  }
  return { ...doc, records, log: [...doc.log, ...entries], updatedAt: now };
}

function summarizeTypes(records: CaseRecord[]): string {
  return RECORD_TYPES.map((type) => [type, records.filter((r) => r.record_type === type).length] as const)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
}

/** The size of the case as it is sent to be saved. */
export function caseBytes(doc: CaseDocument): number {
  return new TextEncoder().encode(JSON.stringify(doc)).length;
}

/** A PDF starts with `%PDF-`. The name alone does not make a file one. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte);
}

/**
 * Names the PDF on an existing record. The PDF is never a record and the numbers stay in
 * the body. Returns the same document when the record is not there.
 */
export function attachPdf(doc: CaseDocument, recordId: string, filename: string, now: string): CaseDocument {
  const target = doc.records.find((record) => record.record_id === recordId);
  if (!target || target.source_filename === filename) return doc;
  const entry: LogEntry = {
    at: now,
    kind: "record_replaced",
    text:
      target.source_filename === null
        ? `Attached ${filename} to ${recordId} (${target.record_type}).`
        : `Replaced the attachment on ${recordId} (${target.record_type}): ${target.source_filename} is now ${filename}.`,
    oem: null,
    holdout_error: null,
  };
  return {
    ...doc,
    records: doc.records.map((record) =>
      record.record_id === recordId ? { ...record, source_filename: filename } : record,
    ),
    log: [...doc.log, entry],
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Chip selector

/** The id the selector stores for a chip-identity row: the body's `chip_id`, else the part number. */
export function chipIdFor(record: CaseRecord): string {
  try {
    const body: unknown = JSON.parse(record.body);
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      const id = (body as Record<string, unknown>).chip_id;
      if (typeof id === "string" && id.trim() !== "") return id.trim();
    }
  } catch {
    // A CSV body has no chip_id. The part number stands in.
  }
  return record.part_number;
}

/** Checks or unchecks one chip. Returns the same document when the id is not a chip-identity row's. */
export function toggleChip(doc: CaseDocument, chipId: string, now: string): CaseDocument {
  const known = doc.records.some(
    (record) => record.record_type === "chip-identity" && chipIdFor(record) === chipId,
  );
  const selected = doc.chipIds.includes(chipId);
  if (!known && !selected) return doc;
  const chipIds = selected ? doc.chipIds.filter((id) => id !== chipId) : [...doc.chipIds, chipId];
  return { ...doc, chipIds, updatedAt: now };
}

/** `2026-10-03T18:20:00.000Z` becomes `2026-10-03 18:20 UTC`. */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
