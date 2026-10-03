// Upload mapping: CSV, JSON, and Markdown tables become CaseRecord rows. Mapping, not
// a new schema. The record types, the metadata fields, and the minimum body fields
// come from docs/universal-data-input-guidelines.md and docs/mvp-phase-plan.md.
//
// Pure functions. No network, no model, no storage. XLSX is read in ingest-xlsx.ts
// and comes here as rows. A file is accepted whole or refused whole, and a refusal
// names every field and row that is wrong, so nothing is saved half-understood.

import {
  RECORD_TYPES,
  SPLITS,
  VALUE_STATUSES,
  type CaseRecord,
  type RecordType,
} from "./case";
import { MAX_CASE_RECORDS } from "./case-validate";
import { formatIssue, parseOem } from "./oem";

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_ISSUES_REPORTED = 50;

export type IngestFormat = "json" | "csv" | "markdown" | "xlsx";

/** One problem, in a plain sentence. `where` names the row, record, or table. */
export type IngestIssue = { where: string | null; message: string };

export type IngestResult =
  | { ok: true; format: IngestFormat; records: CaseRecord[] }
  | { ok: false; errors: IngestIssue[] };

/** What kind of file a name says it is. A PDF is not a record. It rides along under one. */
export function formatOf(filename: string): IngestFormat | "pdf" | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case "json":
      return "json";
    case "csv":
      return "csv";
    case "md":
    case "markdown":
      return "markdown";
    case "xlsx":
      return "xlsx";
    case "pdf":
      return "pdf";
    default:
      return null;
  }
}

export function describeIssue(issue: IngestIssue): string {
  return issue.where ? `${issue.where}: ${issue.message}` : issue.message;
}

// ---------------------------------------------------------------------------
// Metadata

const REQUIRED_METADATA = [
  "record_id",
  "record_type",
  "chip_family",
  "part_number",
  "test_or_model",
  "split",
  "source_url",
  "value_status",
] as const;
const OPTIONAL_METADATA = ["particle_or_stress", "source_filename"] as const;
const METADATA: readonly string[] = [...REQUIRED_METADATA, ...OPTIONAL_METADATA];

/** `Record ID`, `record-id`, and `record_id` are the same field. */
export function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// ---------------------------------------------------------------------------
// Minimum body fields by record type (the guidelines table). A requirement is met
// when any one of its alternatives has every key present and not empty. The record's
// own metadata also counts: part_number, chip_family as `family`, and
// particle_or_stress as `particle`. "not_observable" and "not_reported" are values,
// so a field a source does not give can still be present and honest about it.

type Requirement = { label: string; anyOf: string[][] };
const need = (label: string, ...anyOf: string[][]): Requirement => ({ label, anyOf });
const field = (name: string): Requirement => need(name, [name]);

export const REQUIRED_BODY_FIELDS: Record<RecordType, Requirement[]> = {
  "chip-identity": [
    need("part_number", ["part_number"]),
    need("family", ["family"], ["chip_family"]),
    field("node"),
    field("die_area"),
    field("level_tested"),
    need("memory_ecc", ["memory_ecc"], ["memory_type", "ecc"]),
    need("serials", ["serials"], ["serial_numbers"]),
    field("date_code"),
  ],
  tid: [
    field("source"),
    field("energy"),
    field("dose_rate"),
    field("bias"),
    field("temperature"),
    field("dose_steps"),
    field("failure_dose"),
    field("failure_mode"),
    field("anneal"),
  ],
  see: [
    field("particle"),
    field("energy"),
    need("let", ["let"], ["effective_let"], ["let_or_effective_let"]),
    field("tilt"),
    field("flux"),
    field("fluence"),
    field("events_by_type"),
    field("cross_section"),
    need("confidence_interval", ["confidence_interval"], ["cross_section_ci"]),
    field("power_mode"),
    field("workload"),
    field("sdc_count"),
  ],
  "thermal-wear": [
    need("junction_temperature", ["junction_temperature"], ["tj"]),
    field("power"),
    field("voltage"),
    field("cycle_profile"),
    need("time_or_cycles_to_failure", ["time_to_failure"], ["cycles_to_failure"], ["time_or_cycles_to_failure"]),
    field("mechanism"),
    need("activation_energy", ["activation_energy"], ["ea"]),
  ],
  trajectory: [
    need(
      "an OEM (oem), or OMM elements (altitude_km, inclination, eccentricity, raan_or_ltan, epoch, duration)",
      ["oem"],
      ["altitude_km", "inclination", "eccentricity", "raan_or_ltan", "epoch", "duration"],
      ["altitude_km", "inclination", "eccentricity", "raan", "epoch", "duration"],
      ["altitude_km", "inclination", "eccentricity", "ltan", "epoch", "duration"],
      ["altitude_km", "inclination", "eccentricity", "ltan_hours", "epoch", "duration"],
    ),
  ],
  environment: [
    field("model"),
    field("version"),
    field("mode"),
    field("percentile"),
    field("energies"),
    field("shielding"),
    field("units"),
    need("flux, fluence, or dose", ["flux"], ["fluence"], ["dose"]),
  ],
  placement: [
    need("location", ["location"], ["grid_cell"], ["x", "y", "z"]),
    need(
      "shielding",
      ["shielding"],
      ["shielding_material", "shielding_thickness"],
      ["sector_shielding"],
      ["shielding_sector"],
      ["shield_mm_al"],
    ),
    field("thermal_coupling"),
  ],
  outcome: [
    field("time_window"),
    field("position_reference"),
    field("upsets"),
    field("resets"),
    field("uncorrectable_ecc"),
    field("temperatures"),
    need("failure_time_years or censor_time_years", ["failure_time_years"], ["censor_time_years"]),
  ],
  provenance: [field("source"), field("standard"), field("facility"), field("date"), field("units")],
};

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

// ---------------------------------------------------------------------------
// One record

type Entry = { where: string; fields: Record<string, unknown> };

const BODY_HELP =
  "Put the measurements inside body, as a JSON object, or give them as columns that are not metadata fields.";

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  const lower = value.toLowerCase();
  return (allowed as readonly string[]).includes(lower) ? (lower as T) : null;
}

function bodyOf(entry: Entry, issues: IngestIssue[]): { text: string; fields: Record<string, unknown> } | null {
  const { where, fields } = entry;
  const extra = Object.keys(fields).filter((key) => key !== "body" && !METADATA.includes(key));

  if ("body" in fields) {
    for (const key of extra) {
      issues.push({
        where,
        message: `${key} is not a metadata field, and this record also has a body. ${BODY_HELP}`,
      });
    }
    const raw = fields.body;
    if (typeof raw === "string") {
      if (raw.trim() === "") {
        issues.push({ where, message: `body is empty. ${BODY_HELP}` });
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { text: raw, fields: parsed as Record<string, unknown> };
        }
      } catch {
        // falls through to the message below
      }
      issues.push({
        where,
        message: `body must be a JSON object, such as {"dose_rate": "50 rad/s"}. CSV text can sit inside a field.`,
      });
      return null;
    }
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      return { text: JSON.stringify(raw, null, 2), fields: raw as Record<string, unknown> };
    }
    issues.push({ where, message: `body must be a JSON object. ${BODY_HELP}` });
    return null;
  }

  if (extra.length === 0) {
    issues.push({ where, message: `There is no body. ${BODY_HELP}` });
    return null;
  }
  const body: Record<string, unknown> = {};
  for (const key of extra) body[key] = fields[key];
  return { text: JSON.stringify(body, null, 2), fields: body };
}

function mapEntry(entry: Entry, issues: IngestIssue[]): CaseRecord | null {
  const { where, fields } = entry;
  const before = issues.length;

  for (const key of REQUIRED_METADATA) {
    if (text(fields[key]) === "") {
      issues.push({
        where,
        message:
          key === "split"
            ? "split is required. It must be train or holdout, and it is never assumed."
            : `${key} is required.`,
      });
    }
  }

  const recordType = oneOf(text(fields.record_type), RECORD_TYPES);
  if (text(fields.record_type) !== "" && recordType === null) {
    issues.push({
      where,
      message: `record_type must be one of ${RECORD_TYPES.join(", ")}, but this record says "${text(fields.record_type)}".`,
    });
  }
  const split = oneOf(text(fields.split), SPLITS);
  if (text(fields.split) !== "" && split === null) {
    issues.push({
      where,
      message: `split must be train or holdout, but this record says "${text(fields.split)}".`,
    });
  }
  const valueStatus = oneOf(text(fields.value_status), VALUE_STATUSES);
  if (text(fields.value_status) !== "" && valueStatus === null) {
    issues.push({
      where,
      message: `value_status must be one of ${VALUE_STATUSES.join(", ")}, but this record says "${text(fields.value_status)}".`,
    });
  }

  const body = bodyOf(entry, issues);

  if (recordType && body) {
    // The record's own metadata counts toward the minimum fields.
    const bag: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body.fields)) bag[normalizeKey(key)] = value;
    bag.part_number ??= text(fields.part_number);
    bag.chip_family ??= text(fields.chip_family);
    bag.particle ??= text(fields.particle_or_stress);

    for (const requirement of REQUIRED_BODY_FIELDS[recordType]) {
      const met = requirement.anyOf.some((keys) => keys.every((key) => present(bag[key])));
      if (!met) {
        issues.push({
          where,
          message: `The ${recordType} body is missing ${requirement.label}. A value that a source does not give can be written as not_reported.`,
        });
      }
    }

    if (recordType === "outcome") {
      const failure = present(bag.failure_time_years);
      const censor = present(bag.censor_time_years);
      if (failure && censor) {
        issues.push({ where, message: "An outcome gives a failure time or a censor time, not both." });
      }
      for (const key of ["failure_time_years", "censor_time_years"]) {
        if (present(bag[key]) && !(Number.isFinite(Number(bag[key])) && Number(bag[key]) >= 0)) {
          issues.push({ where, message: `${key} must be a number of years, 0 or more.` });
        }
      }
    }

    if (recordType === "trajectory" && typeof bag.oem === "string" && present(bag.oem)) {
      const parsed = parseOem(bag.oem);
      if (!parsed.ok) {
        for (const error of parsed.errors.slice(0, 5)) {
          issues.push({ where, message: `The trajectory's OEM does not pass the OEM profile. ${formatIssue(error)}` });
        }
      }
    }
  }

  if (issues.length > before || !recordType || !split || !valueStatus || !body) return null;

  return {
    record_id: text(fields.record_id),
    record_type: recordType,
    chip_family: text(fields.chip_family),
    part_number: text(fields.part_number),
    test_or_model: text(fields.test_or_model),
    particle_or_stress: text(fields.particle_or_stress) || null,
    split,
    source_url: text(fields.source_url),
    value_status: valueStatus,
    body: body.text,
    source_filename: text(fields.source_filename) || null,
  };
}

function mapEntries(format: IngestFormat, entries: Entry[]): IngestResult {
  const issues: IngestIssue[] = [];
  if (entries.length === 0) {
    return { ok: false, errors: [{ where: null, message: "The file has no records. Add at least one." }] };
  }
  if (entries.length > MAX_CASE_RECORDS) {
    return {
      ok: false,
      errors: [{ where: null, message: `A file holds at most ${MAX_CASE_RECORDS} records, and this one has ${entries.length}.` }],
    };
  }

  const records: CaseRecord[] = [];
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const record = mapEntry(entry, issues);
    const id = text(entry.fields.record_id);
    if (id !== "") {
      const first = seen.get(id);
      if (first) {
        issues.push({ where: entry.where, message: `record_id ${id} is already used by ${first}. Each record_id is unique.` });
      } else {
        seen.set(id, entry.where);
      }
    }
    if (record) records.push(record);
  }

  if (issues.length > 0) {
    const shown = issues.slice(0, MAX_ISSUES_REPORTED);
    if (issues.length > shown.length) {
      shown.push({ where: null, message: `And ${issues.length - shown.length} more problems.` });
    }
    return { ok: false, errors: shown };
  }
  return { ok: true, format, records };
}

// ---------------------------------------------------------------------------
// Reading files into entries

/** A table: a header row, then rows. Headers are normalized. Empty rows are dropped. */
function tableEntries(label: string | null, rows: string[][], issues: IngestIssue[]): Entry[] {
  const [header, ...body] = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  const rowLabel = (index: number) => (label ? `${label}, row ${index + 2}` : `Row ${index + 2}`);
  if (!header) {
    issues.push({ where: label, message: "The table has no header row." });
    return [];
  }
  const keys = header.map((cell) => normalizeKey(cell));
  const seen = new Set<string>();
  keys.forEach((key, column) => {
    if (key === "") issues.push({ where: label, message: `Column ${column + 1} has no name in the header row.` });
    else if (seen.has(key)) issues.push({ where: label, message: `The column ${key} appears more than once in the header row.` });
    seen.add(key);
  });

  return body.map((row, index) => {
    const fields: Record<string, unknown> = {};
    keys.forEach((key, column) => {
      if (key !== "") fields[key] = row[column] ?? "";
    });
    const extra = row.slice(keys.length).filter((cell) => cell.trim() !== "");
    if (extra.length > 0) {
      issues.push({ where: rowLabel(index), message: "This row has more cells than the header row has columns." });
    }
    return { where: rowLabel(index), fields };
  });
}

/** Quoted fields, doubled quotes, embedded newlines, a BOM, and comma, semicolon, or tab separators. */
export function parseCsv(input: string): string[][] {
  const textBody = input.replace(/^﻿/, "");
  const firstLine = textBody.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => firstLine.split(d).length - 1);
  const delimiter = [",", ";", "\t"][counts.indexOf(Math.max(...counts))];

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;

  for (let i = 0; i < textBody.length; i++) {
    const c = textBody[i];
    if (quoted) {
      if (c === '"') {
        if (textBody[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        cell += c;
      }
    } else if (c === '"' && cell === "") {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && textBody[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      line++;
    } else {
      cell += c;
    }
  }
  if (quoted) throw new Error(`A quoted value that starts before line ${line} is never closed.`);
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const MARKDOWN_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function markdownCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (trimmed[i] === "|") {
      cells.push(cell);
      cell = "";
    } else {
      cell += trimmed[i];
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim().replace(/^`(.*)`$/, "$1"));
}

/** Every pipe table in a Markdown file, each as rows of cells with the header first. */
export function parseMarkdownTables(input: string): string[][][] {
  const lines = input.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const tables: string[][][] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !MARKDOWN_SEPARATOR.test(lines[i + 1]) || !lines[i + 1].includes("-")) continue;
    const rows = [markdownCells(lines[i])];
    let j = i + 2;
    while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
      rows.push(markdownCells(lines[j]));
      j++;
    }
    tables.push(rows);
    i = j - 1;
  }
  return tables;
}

/** A named set of rows from a spreadsheet or a Markdown file: one sheet, or one table. */
export type RowSet = { label: string | null; rows: string[][] };

/** Records from tables of rows. Used for CSV, Markdown, and XLSX. */
export function ingestRowSets(format: IngestFormat, sets: RowSet[]): IngestResult {
  const issues: IngestIssue[] = [];
  const entries = sets.flatMap((set) => tableEntries(set.label, set.rows, issues));
  if (issues.length > 0) return { ok: false, errors: issues.slice(0, MAX_ISSUES_REPORTED) };
  return mapEntries(format, entries);
}

function jsonEntries(input: string): { entries: Entry[] } | { error: IngestIssue } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.replace(/^﻿/, ""));
  } catch (error) {
    return { error: { where: null, message: `The file is not valid JSON: ${(error as Error).message}.` } };
  }
  const list =
    Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { records?: unknown }).records)
        ? (parsed as { records: unknown[] }).records
        : null;
  if (list === null) {
    return {
      error: { where: null, message: 'A JSON file is a list of records, or an object with a "records" list.' },
    };
  }
  const entries: Entry[] = list.map((item, index) => {
    const where = `Record ${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { where, fields: { __notAnObject: true } };
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) fields[normalizeKey(key)] = value;
    return { where, fields };
  });
  return { entries };
}

/** Records from the text of a JSON, CSV, or Markdown file. XLSX comes through ingestRowSets. */
export function ingestText(filename: string, input: string): IngestResult {
  const format = formatOf(filename);
  if (format === "json") {
    const result = jsonEntries(input);
    if ("error" in result) return { ok: false, errors: [result.error] };
    const notObjects = result.entries.filter((entry) => "__notAnObject" in entry.fields);
    if (notObjects.length > 0) {
      return {
        ok: false,
        errors: notObjects.map((entry) => ({ where: entry.where, message: "A record must be an object." })),
      };
    }
    return mapEntries("json", result.entries);
  }
  if (format === "csv") {
    try {
      return ingestRowSets("csv", [{ label: null, rows: parseCsv(input) }]);
    } catch (error) {
      return { ok: false, errors: [{ where: null, message: (error as Error).message }] };
    }
  }
  if (format === "markdown") {
    const tables = parseMarkdownTables(input);
    if (tables.length === 0) {
      return {
        ok: false,
        errors: [{ where: null, message: "No table found. A Markdown file needs a pipe table with a header row and a row of dashes." }],
      };
    }
    return ingestRowSets(
      "markdown",
      tables.map((rows, index) => ({ label: tables.length > 1 ? `Table ${index + 1}` : null, rows })),
    );
  }
  return {
    ok: false,
    errors: [
      {
        where: null,
        message:
          format === "pdf"
            ? "A PDF is not a record. Attach it to a record that is already in the case."
            : "This file type is not accepted. Use JSON, CSV, XLSX, or Markdown.",
      },
    ],
  };
}
