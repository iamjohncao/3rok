// Checks that unknown data is a CaseDocument before the server saves it or reads
// it back. TypeScript types do not exist at run time, and a case document arrives
// over the network, so this is the contract at the door. It rejects any field the
// contract does not have, so the saved document can never gain a tenth record
// type, a flight in some other format, or a training-run field.

import {
  LOG_KINDS,
  RECORD_TYPES,
  SPLITS,
  VALUE_STATUSES,
  type CaseDocument,
  type CaseRecord,
  type LogEntry,
} from "./case";

/** The most the case route accepts in one save, under Vercel's request-body limit. */
export const MAX_CASE_BYTES = 4 * 1024 * 1024;
export const MAX_CASE_RECORDS = 10_000;
export const MAX_CASE_LOG_ENTRIES = 50_000;
export const MAX_CASE_NAME_LENGTH = 200;

export type CaseParseResult = { ok: true; doc: CaseDocument } | { ok: false; error: string };

const DOCUMENT_KEYS = [
  "id",
  "accountId",
  "name",
  "chipIds",
  "records",
  "log",
  "optimizedOem",
  "workingOem",
  "holdoutError",
  "updatedAt",
] as const;

const RECORD_KEYS = [
  "record_id",
  "record_type",
  "chip_family",
  "part_number",
  "test_or_model",
  "particle_or_stress",
  "split",
  "source_url",
  "value_status",
  "body",
  "source_filename",
] as const;

const LOG_ENTRY_KEYS = ["at", "kind", "text", "oem", "holdout_error"] as const;

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${where} has a field the case contract does not have: ${key}.`);
  }
  for (const key of allowed) {
    if (!(key in value)) fail(`${where} is missing the field ${key}.`);
  }
}

function string(value: unknown, where: string): string {
  if (typeof value !== "string") fail(`${where} must be text.`);
  return value;
}

function nullableString(value: unknown, where: string): string | null {
  return value === null ? null : string(value, where);
}

function nullableNumber(value: unknown, where: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${where} must be a number or null.`);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${where} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function record(value: unknown, index: number): CaseRecord {
  const where = `Record ${index + 1}`;
  if (!isObject(value)) fail(`${where} must be an object.`);
  exactKeys(value, RECORD_KEYS, where);
  return {
    record_id: string(value.record_id, `${where} record_id`),
    record_type: oneOf(value.record_type, RECORD_TYPES, `${where} record_type`),
    chip_family: string(value.chip_family, `${where} chip_family`),
    part_number: string(value.part_number, `${where} part_number`),
    test_or_model: string(value.test_or_model, `${where} test_or_model`),
    particle_or_stress: nullableString(value.particle_or_stress, `${where} particle_or_stress`),
    split: oneOf(value.split, SPLITS, `${where} split`),
    source_url: string(value.source_url, `${where} source_url`),
    value_status: oneOf(value.value_status, VALUE_STATUSES, `${where} value_status`),
    body: string(value.body, `${where} body`),
    source_filename: nullableString(value.source_filename, `${where} source_filename`),
  };
}

function logEntry(value: unknown, index: number): LogEntry {
  const where = `Log entry ${index + 1}`;
  if (!isObject(value)) fail(`${where} must be an object.`);
  exactKeys(value, LOG_ENTRY_KEYS, where);
  return {
    at: string(value.at, `${where} at`),
    kind: oneOf(value.kind, LOG_KINDS, `${where} kind`),
    text: string(value.text, `${where} text`),
    oem: nullableString(value.oem, `${where} oem`),
    holdout_error: nullableNumber(value.holdout_error, `${where} holdout_error`),
  };
}

/**
 * Returns a clean copy of the document, or the first reason it is not one. The
 * copy holds only the contract's fields, so nothing extra is ever saved.
 */
export function parseCaseDocument(value: unknown): CaseParseResult {
  try {
    if (!isObject(value)) fail("A case must be an object.");
    exactKeys(value, DOCUMENT_KEYS, "The case");

    const id = string(value.id, "The case id");
    if (id === "" || id.length > 100) fail("The case id must be 1 to 100 characters.");
    const name = string(value.name, "The case name");
    if (name.length > MAX_CASE_NAME_LENGTH) fail(`The case name must be at most ${MAX_CASE_NAME_LENGTH} characters.`);

    if (!Array.isArray(value.chipIds)) fail("chipIds must be a list.");
    const chipIds = value.chipIds.map((chipId, i) => string(chipId, `chipIds ${i + 1}`));

    if (!Array.isArray(value.records)) fail("records must be a list.");
    if (value.records.length > MAX_CASE_RECORDS) fail(`A case holds at most ${MAX_CASE_RECORDS} records.`);

    if (!Array.isArray(value.log)) fail("log must be a list.");
    if (value.log.length > MAX_CASE_LOG_ENTRIES) fail(`A case log holds at most ${MAX_CASE_LOG_ENTRIES} entries.`);

    const doc: CaseDocument = {
      id,
      accountId: nullableString(value.accountId, "accountId"),
      name,
      chipIds,
      records: value.records.map(record),
      log: value.log.map(logEntry),
      optimizedOem: nullableString(value.optimizedOem, "optimizedOem"),
      workingOem: nullableString(value.workingOem, "workingOem"),
      holdoutError: nullableNumber(value.holdoutError, "holdoutError"),
      updatedAt: string(value.updatedAt, "updatedAt"),
    };
    return { ok: true, doc };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
