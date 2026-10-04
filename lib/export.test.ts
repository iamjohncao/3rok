import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECORD_TYPES, type CaseDocument, type CaseRecord } from "./case";
import { newCase } from "./case-ops";
import {
  BUNDLE_NOTE,
  FLIGHT_SOURCE_LABELS,
  applyExport,
  bundleDownload,
  bundleFileName,
  caseBundle,
  flightArtifact,
  oemDownload,
  oemFileName,
} from "./export";
import { parseOem } from "./oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const minimal = readFileSync(`${root}fixtures/minimal.oem`, "utf8");
const T0 = "2026-10-04T10:00:00.000Z";
const T1 = "2026-10-04T10:05:00.000Z";
const ID = "5b0c8c1e-7a53-4c58-9a58-0a1d4a3a9d11";

function record(type: CaseRecord["record_type"], index: number): CaseRecord {
  return {
    record_id: `r-${index}`,
    record_type: type,
    chip_family: "Jetson Orin",
    part_number: "AGX",
    test_or_model: "test",
    particle_or_stress: null,
    split: index % 2 === 0 ? "train" : "holdout",
    source_url: "https://example.com/source",
    value_status: index % 2 === 0 ? "measured" : "assumed",
    body: "{}",
    source_filename: null,
  };
}

function caseWith(over: Partial<CaseDocument> = {}): CaseDocument {
  return {
    ...newCase(ID, T0, "account-1"),
    records: RECORD_TYPES.map((type, index) => record(type, index)),
    ...over,
  };
}

describe("flightArtifact", () => {
  it("sends the working copy when there is one", () => {
    expect(flightArtifact(caseWith({ workingOem: "WORK", optimizedOem: "OPT" }))).toEqual({
      source: "workingOem",
      text: "WORK",
    });
  });

  it("sends the optimized OEM when the working copy is empty", () => {
    expect(flightArtifact(caseWith({ workingOem: null, optimizedOem: "OPT" }))).toEqual({
      source: "optimizedOem",
      text: "OPT",
    });
    expect(flightArtifact(caseWith({ workingOem: "  \n", optimizedOem: "OPT" }))?.source).toBe("optimizedOem");
  });

  it("has no flight file when both are empty", () => {
    expect(flightArtifact(caseWith())).toBeNull();
    expect(flightArtifact(caseWith({ workingOem: " ", optimizedOem: "" }))).toBeNull();
  });

  it("names the two sources in the words the screens use", () => {
    expect(FLIGHT_SOURCE_LABELS).toEqual({ workingOem: "Working copy", optimizedOem: "Optimized OEM" });
  });
});

describe("the .oem download", () => {
  it("is CASE-<id>.oem, and its bytes are exactly the text the globe parses", () => {
    const doc = caseWith({ workingOem: minimal });
    const download = oemDownload(doc);
    expect(download).not.toBeNull();
    if (!download) return;

    expect(download.filename).toBe(`CASE-${ID}.oem`);
    expect(oemFileName(doc)).toBe(download.filename);
    expect(download.source).toBe("workingOem");

    const saved = new TextDecoder().decode(download.bytes);
    expect(saved).toBe(flightArtifact(doc)?.text);
    expect(saved).toBe(minimal);

    // The testing page parses flightArtifact(doc).text. The file on disk parses to the same flight.
    const onGlobe = parseOem(flightArtifact(doc)?.text ?? "");
    const fromFile = parseOem(saved);
    expect(onGlobe.ok).toBe(true);
    expect(fromFile).toEqual(onGlobe);
  });

  it("adds no newline and changes no byte", () => {
    const text = "CCSDS_OEM_VERS = 3.0\r\nno final newline";
    const download = oemDownload(caseWith({ workingOem: text }));
    expect(new TextDecoder().decode(download?.bytes)).toBe(text);
  });

  it("saves the optimized OEM when the working copy is empty", () => {
    const download = oemDownload(caseWith({ optimizedOem: minimal }));
    expect(download?.source).toBe("optimizedOem");
    expect(new TextDecoder().decode(download?.bytes)).toBe(minimal);
  });

  it("has nothing to save when the case has no flight file", () => {
    expect(oemDownload(caseWith())).toBeNull();
  });

  it("keeps anything that is not a file-name character out of the name", () => {
    expect(oemFileName({ ...caseWith(), id: "../../etc/passwd" })).toBe("CASE-______etc_passwd.oem");
  });
});

describe("applyExport", () => {
  it("logs an export that names which copy left and how big it was", () => {
    const doc = caseWith({ workingOem: minimal, optimizedOem: "OPT", holdoutError: 0.4 });
    const next = applyExport(doc, "testing", T1);

    expect(next.log).toHaveLength(1);
    const entry = next.log[0];
    expect(entry.kind).toBe("export");
    expect(entry.at).toBe(T1);
    expect(entry.text).toContain("Exported to testing");
    expect(entry.text).toContain("working copy");
    expect(entry.text).toMatch(/\d+ lines, \d+ bytes/);
    expect(entry.oem).toBeNull();
    expect(entry.holdout_error).toBeNull();
    expect(next.updatedAt).toBe(T1);
  });

  it("names the optimized OEM when that is what left", () => {
    const next = applyExport(caseWith({ optimizedOem: minimal }), "oem", T1);
    expect(next.log[0].text).toContain(`Downloaded CASE-${ID}.oem`);
    expect(next.log[0].text).toContain("optimized oem");
  });

  it("logs the case download, with the flight artifact or the lack of one", () => {
    const withFlight = applyExport(caseWith({ workingOem: minimal }), "case", T1);
    expect(withFlight.log[0].text).toContain(`CASE-${ID}.json`);
    expect(withFlight.log[0].text).toContain("working copy");

    const without = applyExport(caseWith(), "case", T1);
    expect(without.log[0].kind).toBe("export");
    expect(without.log[0].text).toContain("none");
  });

  it("writes nothing when there is no flight file to send to testing or to disk", () => {
    const doc = caseWith();
    expect(applyExport(doc, "testing", T1)).toBe(doc);
    expect(applyExport(doc, "oem", T1)).toBe(doc);
  });

  it("appends to the log and changes nothing else: not the OEM strings, not the score, not the records", () => {
    const earlier = applyExport(caseWith({ workingOem: minimal, optimizedOem: "OPT", holdoutError: 0.4 }), "testing", T0);
    const next = applyExport(earlier, "oem", T1);
    expect(next.log).toHaveLength(2);
    expect(next.log[0]).toBe(earlier.log[0]);
    expect(next.workingOem).toBe(minimal);
    expect(next.optimizedOem).toBe("OPT");
    expect(next.holdoutError).toBe(0.4);
    expect(next.records).toBe(earlier.records);
    expect(next.chipIds).toBe(earlier.chipIds);
  });

  it("never reaches the model or the evaluator", () => {
    const source = readFileSync(`${root}lib/export.ts`, "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.every((line) => /from "\.\/case"/.test(line))).toBe(true);
  });
});

describe("the case bundle", () => {
  const doc = caseWith({
    chipIds: ["AGX"],
    workingOem: minimal,
    optimizedOem: "OPT",
    holdoutError: 0.4,
    log: [{ at: T0, kind: "instruction", text: "Lower the apogee.", oem: null, holdout_error: null }],
  });

  it("holds every record with its value_status and split, the log, both OEM strings, and the last score", () => {
    const bundle = caseBundle(doc, T1);
    expect(bundle.case.records).toHaveLength(9);
    expect(new Set(bundle.case.records.map((row) => row.record_type))).toEqual(new Set(RECORD_TYPES));
    for (const row of bundle.case.records) {
      expect(["measured", "derived", "assumed", "not_observable"]).toContain(row.value_status);
      expect(["train", "holdout"]).toContain(row.split);
    }
    expect(bundle.case.records).toEqual(doc.records);
    expect(bundle.case.log).toEqual(doc.log);
    expect(bundle.case.workingOem).toBe(minimal);
    expect(bundle.case.optimizedOem).toBe("OPT");
    expect(bundle.case.holdoutError).toBe(0.4);
    expect(bundle.case.chipIds).toEqual(["AGX"]);
  });

  it("names which OEM string is the flight, and says the chat is not the flight", () => {
    expect(caseBundle(doc, T1).flight_artifact).toBe("workingOem");
    expect(caseBundle({ ...doc, workingOem: null }, T1).flight_artifact).toBe("optimizedOem");
    expect(caseBundle(caseWith(), T1).flight_artifact).toBeNull();
    expect(caseBundle(doc, T1).note).toBe(BUNDLE_NOTE);
    expect(BUNDLE_NOTE).toContain("The chat is not the flight");
    expect(BUNDLE_NOTE).toContain("A working copy is never scored");
  });

  it("leaves the account id out", () => {
    const bundle = caseBundle(doc, T1);
    expect("accountId" in bundle.case).toBe(false);
    expect(JSON.stringify(bundle)).not.toContain("account-1");
  });

  it("is a JSON file named CASE-<id>.json that reads back to the bundle", () => {
    const download = bundleDownload(doc, T1);
    expect(download.filename).toBe(`CASE-${ID}.json`);
    expect(bundleFileName(doc)).toBe(download.filename);
    expect(download.mime).toBe("application/json");
    const text = new TextDecoder().decode(download.bytes);
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(caseBundle(doc, T1));
  });

  it("carries the export it records for itself", () => {
    const exported = applyExport(doc, "case", T1);
    const bundle = JSON.parse(new TextDecoder().decode(bundleDownload(exported, T1).bytes));
    expect(bundle.case.log.at(-1).kind).toBe("export");
  });
});
