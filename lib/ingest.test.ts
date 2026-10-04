import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECORD_TYPES, VALUE_STATUSES, type RecordType } from "./case";
import { MAX_CASE_RECORDS } from "./case-validate";
import {
  REQUIRED_BODY_FIELDS,
  describeIssue,
  formatOf,
  ingestRowSets,
  ingestText,
  normalizeKey,
  parseCsv,
  parseMarkdownTables,
  type IngestResult,
} from "./ingest";

const root = fileURLToPath(new URL("..", import.meta.url));
const minimalOem = readFileSync(`${root}fixtures/minimal.oem`, "utf8");

// A complete, valid body for each record type: every minimum field the plan names.
const BODIES: Record<RecordType, Record<string, unknown>> = {
  "chip-identity": { node: "7 nm", die_area: "not_reported", level_tested: "module", memory_ecc: "LPDDR5, ECC not_reported", serials: "not_reported", date_code: "not_reported" },
  tid: { source: "Co-60", energy: "1.25 MeV", dose_rate: "not_reported", bias: "not_reported", temperature: "not_reported", dose_steps: "not_reported", failure_dose: "42 krad(Si)", failure_mode: "not_reported", anneal: "not_reported" },
  see: { energy: "480 MeV", let: "not_applicable", tilt: "not_reported", flux: "not_reported", fluence: "5.65e9 p/cm2", events_by_type: "not_reported", cross_section: "3.9e-9 cm2", confidence_interval: "bounds in the paper", power_mode: "15 W", workload: "not_reported", sdc_count: "not_observable" },
  "thermal-wear": { junction_temperature: "85 C", power: "15 W", voltage: "12 V", cycle_profile: "not_reported", time_to_failure: "not_reported", mechanism: "not_reported", activation_energy: "not_reported" },
  trajectory: { altitude_km: 650, inclination: "sso", eccentricity: 0, raan_or_ltan: 6, epoch: "2026-10-03T18:00:00", duration: "5 years" },
  environment: { model: "AP9", version: "1.5", mode: "mean", percentile: 50, energies: "1-400 MeV", shielding: "5 mm Al", units: "rad(Si)/year", dose: 150 },
  placement: { location: "A1", shielding_material: "Al", shielding_thickness: "5 mm", thermal_coupling: "radiator path 1" },
  outcome: { time_window: "5 years", position_reference: "orbit above", upsets: 0, resets: 0, uncorrectable_ecc: 0, temperatures: "not_reported", failure_time_years: 3.2 },
  provenance: { source: "Test report", standard: "ESCC 22900", facility: "Co-60 cell", date: "2024-05-01", units: "krad(Si)" },
};

const metadata = (type: RecordType, extra: Record<string, unknown> = {}) => ({
  record_id: `r-${type}`,
  record_type: type,
  chip_family: "Jetson Orin",
  part_number: "AGX",
  test_or_model: "unit test",
  particle_or_stress: type === "see" ? "proton" : "",
  split: "train",
  source_url: "https://example.com/report",
  value_status: "measured",
  ...extra,
});

const record = (type: RecordType, extra: Record<string, unknown> = {}) => ({
  ...metadata(type, extra),
  body: BODIES[type],
});

const json = (value: unknown) => JSON.stringify(value);

function failures(result: IngestResult): string[] {
  if (result.ok) throw new Error("expected the file to be refused");
  return result.errors.map(describeIssue);
}

describe("accepting a JSON file", () => {
  it("maps all nine record types", () => {
    const result = ingestText("all.json", json(RECORD_TYPES.map((type) => record(type))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.format).toBe("json");
    expect(result.records.map((r) => r.record_type)).toEqual([...RECORD_TYPES]);
  });

  it("accepts a list in an object under records", () => {
    expect(ingestText("x.json", json({ records: [record("tid")] })).ok).toBe(true);
  });

  it("keeps the metadata, stores the body as JSON text, and leaves particle_or_stress null when empty", () => {
    const result = ingestText("x.json", json([record("tid")]));
    if (!result.ok) throw new Error(failures(result).join("\n"));
    const [tid] = result.records;
    expect(tid).toMatchObject({
      record_id: "r-tid",
      chip_family: "Jetson Orin",
      part_number: "AGX",
      split: "train",
      value_status: "measured",
      particle_or_stress: null,
      source_filename: null,
    });
    expect(JSON.parse(tid.body)).toEqual(BODIES.tid);
  });

  it("accepts a case-insensitive split, value_status, and record_type, and never invents a split", () => {
    const result = ingestText("x.json", json([record("tid", { split: "HOLDOUT", value_status: "Assumed", record_type: "TID" })]));
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(result.records[0]).toMatchObject({ split: "holdout", value_status: "assumed", record_type: "tid" });
  });

  it("takes the body from the other fields when there is no body field", () => {
    const { body, ...rest } = record("provenance");
    const result = ingestText("x.json", json([{ ...rest, ...BODIES.provenance }]));
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(JSON.parse(result.records[0].body)).toEqual(BODIES.provenance);
    void body;
  });

  it("keeps a body given as JSON text exactly as written", () => {
    const text = '{"source":"S","standard":"ST","facility":"F","date":"D","units":"U"}';
    const result = ingestText("x.json", json([{ ...record("provenance"), body: text }]));
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(result.records[0].body).toBe(text);
  });
});

describe("refusing a file, with the field named", () => {
  it("names every missing required metadata field", () => {
    for (const key of ["record_id", "record_type", "chip_family", "part_number", "test_or_model", "split", "source_url", "value_status"]) {
      const bad = { ...record("tid"), [key]: "" };
      const messages = failures(ingestText("x.json", json([bad])));
      expect(messages.some((m) => m.includes(`${key} is required`)), key).toBe(true);
    }
  });

  it("names a field that is missing altogether, not only empty", () => {
    const { split, ...noSplit } = record("tid");
    expect(failures(ingestText("x.json", json([noSplit])))[0]).toContain("split is required");
    void split;
  });

  it("does not turn a missing split into train", () => {
    const { split, ...noSplit } = record("outcome");
    const result = ingestText("x.json", json([noSplit]));
    expect(result.ok).toBe(false);
    expect(failures(result).join(" ")).toContain("never assumed");
    void split;
  });

  it("allows particle_or_stress to be empty", () => {
    expect(ingestText("x.json", json([record("tid", { particle_or_stress: null })])).ok).toBe(true);
    expect(ingestText("x.json", json([record("tid", { particle_or_stress: "" })])).ok).toBe(true);
  });

  it("accepts only the four value_status values", () => {
    for (const status of VALUE_STATUSES) expect(ingestText("x.json", json([record("tid", { value_status: status })])).ok, status).toBe(true);
    const messages = failures(ingestText("x.json", json([record("tid", { value_status: "guessed" })])));
    expect(messages[0]).toContain("value_status must be one of measured, derived, assumed, not_observable");
    expect(messages[0]).toContain('"guessed"');
  });

  it("accepts only the nine record types", () => {
    const messages = failures(ingestText("x.json", json([record("tid", { record_type: "telemetry" })])));
    expect(messages[0]).toContain("record_type must be one of chip-identity, tid, see");
  });

  it("accepts only train or holdout", () => {
    expect(failures(ingestText("x.json", json([record("tid", { split: "validation" })])))[0]).toContain("train or holdout");
  });

  it("refuses a body that is not a JSON object", () => {
    expect(failures(ingestText("x.json", json([{ ...record("tid"), body: "dose,rate\n1,2" }])))[0]).toContain("body must be a JSON object");
    expect(failures(ingestText("x.json", json([{ ...record("tid"), body: [1, 2] }])))[0]).toContain("body must be a JSON object");
    expect(failures(ingestText("x.json", json([{ ...record("tid"), body: "" }])))[0]).toContain("body is empty");
  });

  it("refuses a body field beside a body, so a typo in a metadata name is not hidden", () => {
    const messages = failures(ingestText("x.json", json([{ ...record("tid"), valuestatus: "measured" }])));
    expect(messages.some((m) => m.includes("valuestatus is not a metadata field"))).toBe(true);
  });

  it("refuses a record with no body at all", () => {
    const { body, ...rest } = record("tid");
    expect(failures(ingestText("x.json", json([rest])))[0]).toContain("There is no body");
    void body;
  });

  it("refuses a record_id used twice and says where it was first used", () => {
    const messages = failures(ingestText("x.json", json([record("tid"), record("tid")])));
    expect(messages.join(" ")).toContain("record_id r-tid is already used by Record 1");
  });

  it("refuses a file that is not JSON, not a list, or has no records", () => {
    expect(failures(ingestText("x.json", "{not json"))[0]).toContain("not valid JSON");
    expect(failures(ingestText("x.json", json({ records: "no" })))[0]).toContain("list of records");
    expect(failures(ingestText("x.json", "[]"))[0]).toContain("no records");
    expect(failures(ingestText("x.json", json([5])))[0]).toContain("must be an object");
  });

  it("refuses a file with too many records", () => {
    const many = new Array(MAX_CASE_RECORDS + 1).fill({});
    expect(failures(ingestText("x.json", json(many)))[0]).toContain("at most");
  });

  it("reports every problem in the file, not only the first, and names each row", () => {
    const messages = failures(ingestText("x.json", json([record("tid", { split: "" }), record("see", { record_id: "" })])));
    expect(messages.some((m) => m.startsWith("Record 1:"))).toBe(true);
    expect(messages.some((m) => m.startsWith("Record 2:"))).toBe(true);
  });
});

describe("the minimum body fields by record type", () => {
  // Fields the record's own metadata can supply.
  const FROM_METADATA = new Set(["part_number", "family", "particle"]);

  for (const type of RECORD_TYPES) {
    it(`${type}: a complete body passes`, () => {
      expect(ingestText("x.json", json([record(type)])).ok).toBe(true);
    });

    for (const requirement of REQUIRED_BODY_FIELDS[type]) {
      if (FROM_METADATA.has(requirement.label)) continue;
      it(`${type}: refuses a body without ${requirement.label}`, () => {
        const body = { ...BODIES[type] };
        for (const keys of requirement.anyOf) for (const key of keys) delete body[key];
        const messages = failures(ingestText("x.json", json([{ ...metadata(type), body }])));
        expect(messages.some((m) => m.includes(`The ${type} body is missing ${requirement.label}`)), messages.join(" | ")).toBe(true);
      });
    }
  }

  it("takes part number and family from the record's metadata", () => {
    expect(ingestText("x.json", json([record("chip-identity")])).ok).toBe(true);
  });

  it("takes the particle from particle_or_stress", () => {
    expect(ingestText("x.json", json([record("see")])).ok).toBe(true);
    const noParticle = { ...record("see", { particle_or_stress: "" }) };
    expect(failures(ingestText("x.json", json([noParticle])))[0]).toContain("missing particle");
  });

  it("accepts a value that says not_observable or not_reported, and refuses an empty one", () => {
    expect(ingestText("x.json", json([{ ...metadata("see"), body: { ...BODIES.see, sdc_count: "not_observable" } }])).ok).toBe(true);
    expect(failures(ingestText("x.json", json([{ ...metadata("see"), body: { ...BODIES.see, sdc_count: "" } }])))[0]).toContain("missing sdc_count");
    expect(failures(ingestText("x.json", json([{ ...metadata("see"), body: { ...BODIES.see, sdc_count: null } }])))[0]).toContain("missing sdc_count");
  });

  it("outcome: a failure time or a censor time, as a number of years, not both", () => {
    const outcome = (extra: Record<string, unknown>) => {
      const body: Record<string, unknown> = { ...BODIES.outcome, ...extra };
      return ingestText("x.json", json([{ ...metadata("outcome"), body }]));
    };
    expect(outcome({}).ok).toBe(true);
    expect(outcome({ failure_time_years: undefined, censor_time_years: 5 }).ok).toBe(true);
    expect(failures(outcome({ censor_time_years: 5 }))[0]).toContain("not both");
    expect(failures(outcome({ failure_time_years: "soon" }))[0]).toContain("must be a number of years");
    expect(failures(outcome({ failure_time_years: -1 }))[0]).toContain("must be a number of years");
    expect(failures(outcome({ failure_time_years: undefined }))[0]).toContain("failure_time_years or censor_time_years");
  });

  it("trajectory: stores an OEM that passes the profile, or the elements, and never makes one up", () => {
    expect(ingestText("x.json", json([{ ...metadata("trajectory"), body: { oem: minimalOem } }])).ok).toBe(true);
    expect(ingestText("x.json", json([record("trajectory")])).ok).toBe(true);
    const messages = failures(ingestText("x.json", json([{ ...metadata("trajectory"), body: { oem: minimalOem.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000") } }])));
    expect(messages[0]).toContain("does not pass the OEM profile");
    expect(messages[0]).toContain("REF_FRAME must be GCRF");
    expect(failures(ingestText("x.json", json([{ ...metadata("trajectory"), body: { note: "somewhere around 500 km" } }])))[0]).toContain("missing an OEM");
  });

  it("trajectory and placement accept the numeric names the holdout lane reads, in any letter case", () => {
    const elements = { altitude_km: 650, inclination: "sso", eccentricity: 0, ltan_hours: 6, epoch: "2027-01-01T00:00:00Z", duration: "5 years" };
    expect(ingestText("x.json", json([{ ...metadata("trajectory"), body: elements }])).ok).toBe(true);
    const { ltan_hours: _dropped, ...withoutLtan } = elements;
    expect(ingestText("x.json", json([{ ...metadata("trajectory"), body: withoutLtan }])).ok).toBe(false);
    const placement = { location: "A1", thermal_coupling: "not_reported" };
    for (const key of ["shield_mm_Al", "SHIELD_MM_AL"]) {
      expect(ingestText("x.json", json([{ ...metadata("placement"), body: { ...placement, [key]: 5 } }])).ok).toBe(true);
    }
    expect(ingestText("x.json", json([{ ...metadata("placement"), body: placement }])).ok).toBe(false);
  });

  it("trajectory: the stored body is the OEM text itself, unchanged", () => {
    const result = ingestText("x.json", json([{ ...metadata("trajectory"), body: { oem: minimalOem } }]));
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(JSON.parse(result.records[0].body).oem).toBe(minimalOem);
  });
});

describe("accepting a CSV file", () => {
  const header = "record_id,record_type,chip_family,part_number,test_or_model,particle_or_stress,split,source_url,value_status";
  const provenanceColumns = "source,standard,facility,date,units";
  const row = (id: string, extra = "Test report,ESCC 22900,Co-60 cell,2024-05-01,krad(Si)") =>
    `${id},provenance,Jetson Orin,AGX,report,,train,https://example.com,measured,${extra}`;

  it("maps one row to one record, with the other columns as the body", () => {
    const result = ingestText("x.csv", `${header},${provenanceColumns}\n${row("p1")}\n${row("p2")}\n`);
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(result.format).toBe("csv");
    expect(result.records.map((r) => r.record_id)).toEqual(["p1", "p2"]);
    expect(JSON.parse(result.records[0].body)).toEqual({
      source: "Test report",
      standard: "ESCC 22900",
      facility: "Co-60 cell",
      date: "2024-05-01",
      units: "krad(Si)",
    });
  });

  it("keeps cell text as written, so 0.50 stays 0.50", () => {
    const result = ingestText("x.csv", `${header},${provenanceColumns}\n${row("p1", "S,ST,F,D,0.50")}\n`);
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(JSON.parse(result.records[0].body).units).toBe("0.50");
  });

  it("reads friendly headers, quoted commas, doubled quotes, embedded newlines, CRLF, and a BOM", () => {
    const text =
      "﻿Record ID,Record Type,Chip Family,Part Number,Test Or Model,Particle Or Stress,Split,Source URL,Value Status,Source,Standard,Facility,Date,Units\r\n" +
      'p1,provenance,"Orin, AGX",AGX,report,,train,https://example.com,measured,"A ""quoted"" source","line one\nline two",F,D,U\r\n';
    const result = ingestText("x.csv", text);
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(result.records[0].chip_family).toBe("Orin, AGX");
    const body = JSON.parse(result.records[0].body);
    expect(body.source).toBe('A "quoted" source');
    expect(body.standard).toBe("line one\nline two");
  });

  it("reads a semicolon- or tab-separated file", () => {
    const semicolons = `${header},${provenanceColumns}\n${row("p1")}\n`.replaceAll(",", ";");
    expect(ingestText("x.csv", semicolons).ok).toBe(true);
    const tabs = `${header},${provenanceColumns}\n${row("p1")}\n`.replaceAll(",", "\t");
    expect(ingestText("x.csv", tabs).ok).toBe(true);
  });

  it("skips empty rows", () => {
    const result = ingestText("x.csv", `${header},${provenanceColumns}\n\n${row("p1")}\n,,,,,,,,,,,,,\n`);
    expect(result.ok && result.records.length).toBe(1);
  });

  it("names the row and the field when one is missing", () => {
    const messages = failures(ingestText("x.csv", `${header},${provenanceColumns}\n${row("p1")}\n${row("p2").replace(",train,", ",,")}\n`));
    expect(messages).toEqual(["Row 3: split is required. It must be train or holdout, and it is never assumed."]);
  });

  it("refuses a missing column as a missing field in every row", () => {
    const messages = failures(ingestText("x.csv", `record_id,record_type\np1,provenance\n`));
    expect(messages.some((m) => m.startsWith("Row 2:") && m.includes("chip_family is required"))).toBe(true);
  });

  it("refuses a header with a repeated or empty column name", () => {
    expect(failures(ingestText("x.csv", `record_id,record_id\np1,p1\n`))[0]).toContain("appears more than once");
    expect(failures(ingestText("x.csv", `record_id,,x\np1,,2\n`))[0]).toContain("Column 2 has no name");
  });

  it("refuses a row with more cells than the header", () => {
    const messages = failures(ingestText("x.csv", `${header},${provenanceColumns}\n${row("p1")},surprise\n`));
    expect(messages[0]).toContain("more cells than the header");
  });

  it("refuses a quoted value that never closes, in a sentence", () => {
    expect(failures(ingestText("x.csv", `a,b\n"never closed,2\n`))[0]).toContain("never closed");
  });

  it("refuses an empty file", () => {
    expect(failures(ingestText("x.csv", ""))[0]).toContain("no header row");
  });
});

describe("accepting a Markdown file", () => {
  const table = `| record_id | record_type | chip_family | part_number | test_or_model | particle_or_stress | split | source_url | value_status | source | standard | facility | date | units |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1 | provenance | Orin | AGX | report |  | train | https://example.com | measured | \`Test report\` | ESCC 22900 | A \\| B cell | 2024-05-01 | krad(Si) |
`;

  it("reads a pipe table, strips backticks, and unescapes pipes", () => {
    const result = ingestText("x.md", `# Records\n\nSome text.\n\n${table}\nMore text.\n`);
    if (!result.ok) throw new Error(failures(result).join("\n"));
    expect(result.format).toBe("markdown");
    const body = JSON.parse(result.records[0].body);
    expect(body.source).toBe("Test report");
    expect(body.facility).toBe("A | B cell");
  });

  it("reads several tables and says which one a problem is in", () => {
    const bad = table.replace("| p1 |", "| p2 |").replace("| train |", "|  |");
    const messages = failures(ingestText("x.md", `${table}\n\n${bad}`));
    expect(messages[0]).toMatch(/^Table 2, row 2: split is required/);
  });

  it("refuses a file with no table", () => {
    expect(failures(ingestText("x.md", "# Just words\n\nNo table here."))[0]).toContain("No table found");
  });

  it("parseMarkdownTables ignores a line with a pipe that is not a table", () => {
    expect(parseMarkdownTables("a | b is not a table\n\nnor is this")).toEqual([]);
  });
});

describe("rows from a spreadsheet", () => {
  it("maps rows the same way, and names the sheet", () => {
    const rows = [
      ["record_id", "record_type", "chip_family", "part_number", "test_or_model", "split", "source_url", "value_status", "source", "standard", "facility", "date", "units"],
      ["p1", "provenance", "Orin", "AGX", "report", "train", "https://example.com", "measured", "S", "ST", "F", "D", "U"],
      ["p2", "provenance", "Orin", "AGX", "report", "", "https://example.com", "measured", "S", "ST", "F", "D", "U"],
    ];
    const messages = failures(ingestRowSets("xlsx", [{ label: 'Sheet "Data"', rows }]));
    expect(messages[0]).toMatch(/^Sheet "Data", row 3: split is required/);
  });
});

describe("file types", () => {
  it("tells JSON, CSV, Markdown, XLSX, and PDF apart by name", () => {
    expect(formatOf("a.JSON")).toBe("json");
    expect(formatOf("a.csv")).toBe("csv");
    expect(formatOf("a.md")).toBe("markdown");
    expect(formatOf("a.markdown")).toBe("markdown");
    expect(formatOf("a.xlsx")).toBe("xlsx");
    expect(formatOf("a.pdf")).toBe("pdf");
    expect(formatOf("a.docx")).toBeNull();
    expect(formatOf("noextension")).toBeNull();
  });

  it("says a PDF is not a record, and which file types are accepted", () => {
    expect(failures(ingestText("report.pdf", "%PDF-1.7"))[0]).toContain("A PDF is not a record");
    expect(failures(ingestText("notes.txt", "x"))[0]).toContain("JSON, CSV, XLSX, or Markdown");
  });
});

describe("helpers", () => {
  it("normalizes header names", () => {
    expect(normalizeKey(" Record ID ")).toBe("record_id");
    expect(normalizeKey("value-status")).toBe("value_status");
  });

  it("parses CSV with a trailing newline and no trailing newline the same way", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("every refusal is a sentence", () => {
  it("starts with a capital or a name and ends with a period", () => {
    const bad = [
      ingestText("x.json", "{"),
      ingestText("x.json", json([{ record_id: "a" }])),
      ingestText("x.json", json([record("tid", { split: "x" }), record("tid")])),
      ingestText("x.csv", "a,a\n1,2"),
      ingestText("x.md", "nothing"),
      ingestText("x.txt", "x"),
    ];
    for (const result of bad) {
      for (const message of failures(result)) {
        expect(message, message).toMatch(/^[A-Z"][^\n]*\.$/);
      }
    }
  });
});

describe("source gates (Phase 4)", () => {
  const source = readFileSync(`${root}lib/ingest.ts`, "utf8");

  it("calls no model and no network, and never writes the optimized file", () => {
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|api\.x\.ai|XAI_API_KEY|@ai-sdk|openai|anthropic/i);
    expect(source).not.toMatch(/optimizedOem|workingOem/);
  });
});
