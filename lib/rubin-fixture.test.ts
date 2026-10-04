import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECORD_TYPES, type CaseRecord } from "./case";
import { applyIngest, groupRecords, newCase, toggleChip } from "./case-ops";
import { summarizeCase } from "./case-store";
import { evaluateCandidate, gatherScoreInputs, type ScoreOrbit } from "./holdout";
import { describeIssue, ingestText } from "./ingest";
import { sunSynchronousInclinationDeg } from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = `${root}fixtures/rubin-nvl72-case/`;
const jsonText = readFileSync(`${dir}records.json`, "utf8");
const csvText = readFileSync(`${dir}records.csv`, "utf8");
const readme = readFileSync(`${dir}README.md`, "utf8");
const chipsYaml = readFileSync(`${root}starmind-physics/starmind_physics/data/ai_chips.yaml`, "utf8");

function load(name: string, text: string): CaseRecord[] {
  const result = ingestText(name, text);
  if (!result.ok) throw new Error(result.errors.map(describeIssue).join("\n"));
  return result.records;
}
const records = load("records.json", jsonText);
const csvRecords = load("records.csv", csvText);
const body = (id: string) => JSON.parse(records.find((r) => r.record_id === id)?.body ?? "{}") as Record<string, unknown>;

describe("fixtures/rubin-nvl72-case", () => {
  it("passes the same ingest every upload passes, as JSON and as CSV, and the two are the same rows", () => {
    expect(records).toHaveLength(20);
    expect(csvRecords).toHaveLength(records.length);
    const key = (rs: CaseRecord[]) => rs.map((r) => ({ ...r, body: JSON.parse(r.body) }));
    expect(key(csvRecords)).toEqual(key(records));
  });

  it("holds every one of the nine record types, each row once", () => {
    expect(new Set(records.map((r) => r.record_type))).toEqual(new Set(RECORD_TYPES));
    expect(new Set(records.map((r) => r.record_id)).size).toBe(records.length);
    expect(groupRecords(records).every((g) => g.records.length > 0)).toBe(true);
  });

  it("claims no measurement: nothing is measured, and only the two package outputs are derived", () => {
    expect(records.filter((r) => r.value_status === "measured")).toEqual([]);
    const derived = records.filter((r) => r.value_status === "derived");
    expect(derived.map((r) => r.record_id).sort()).toEqual(["env-ap8ae8-700km-sso-orbit-average", "env-dose-rate-700km-sso-5mm-al"]);
    for (const r of derived) expect(r.source_url).toContain("starmind-physics/starmind_physics/");
  });

  it("says synthetic on every test and outcome row, so a row shown alone cannot pass for data", () => {
    const tested = records.filter((r) => ["tid", "see", "thermal-wear", "outcome"].includes(r.record_type));
    expect(tested.length).toBeGreaterThan(10);
    for (const r of tested) expect(r.test_or_model).toMatch(/^Synthetic example/);
    expect(readme).toMatch(/No public radiation test data exists for Rubin/);
    expect(readme).toMatch(/Nothing in it is `measured`/);
  });

  it("keeps the holdout to outcomes, with one outcome left in the train split", () => {
    expect(records.filter((r) => r.split === "holdout").every((r) => r.record_type === "outcome")).toBe(true);
    expect(records.filter((r) => r.split === "holdout")).toHaveLength(4);
    expect(records.filter((r) => r.record_type === "outcome" && r.split === "train")).toHaveLength(1);
  });

  it("names a chip the physics package knows, and the package says its dose limit is assumed", () => {
    const chipId = body("rubin-nvl72-identity").chip_id as string;
    expect(chipId).toBe("nvidia_vera_rubin_nvl72");
    const block = chipsYaml.slice(chipsYaml.indexOf(`id: ${chipId}`), chipsYaml.indexOf("tags:", chipsYaml.indexOf(`id: ${chipId}`)));
    expect(block).toMatch(/dose_limit_provenance: assumed/);
  });

  it("does not borrow another chip's rows: no Orin, Trillium or H100 in it", () => {
    expect(jsonText).not.toMatch(/jetson|orin|trillium|h100/i);
  });

  it("gives the evaluator the three inputs it needs, from the case, with nothing filled in", () => {
    const { chip, ltan, shield } = gatherScoreInputs({ records, chipIds: [] });
    if (typeof chip === "string" || typeof ltan === "string" || typeof shield === "string") throw new Error(`${chip} ${ltan} ${shield}`);
    expect(chip.request).toEqual({ chip_id: "nvidia_vera_rubin_nvl72" });
    expect(ltan.value).toBe(6);
    expect(shield.value).toBe(5);
    expect(shield.record.value_status).toBe("assumed");
  });

  it("gives the outcome lane two failures and two survivors in the holdout, and no row for another part", () => {
    const outcomes = records.filter((r) => r.record_type === "outcome" && r.split === "holdout").map((r) => JSON.parse(r.body));
    expect(outcomes.filter((o) => typeof o.failure_time_years === "number")).toHaveLength(2);
    expect(outcomes.filter((o) => typeof o.censor_time_years === "number")).toHaveLength(2);
    expect(new Set(records.filter((r) => r.chip_family !== "not_chip_specific").map((r) => r.part_number))).toEqual(new Set(["Vera Rubin NVL72"]));
  });

  it("scores the way the README says: 5.88 years at the package's 16.5, and 1.75 at 25", async () => {
    const oem = circularOemText({ altitudeKm: 640, inclinationDeg: sunSynchronousInclinationDeg(640) });
    const at = (lifetime: number): ScoreOrbit => async () => ({ refused: false, lifetime_years: lifetime });
    const baseline = await evaluateCandidate({ candidateOem: oem, doc: { records, chipIds: [], holdoutError: null }, scoreOrbit: at(16.496) });
    expect(baseline.verdict).toBe("kept");
    expect(baseline.error).toBeCloseTo(5.878, 3);
    expect(baseline.verdict === "kept" && baseline.rows.map((row) => row.record_id).sort()).toEqual([
      "outcome-synth-failure-a",
      "outcome-synth-failure-b",
      "outcome-synth-survivor-a",
      "outcome-synth-survivor-b",
    ]);
    const better = await evaluateCandidate({ candidateOem: oem, doc: { records, chipIds: [], holdoutError: baseline.error }, scoreOrbit: at(25) });
    expect(better.verdict).toBe("kept");
    expect(better.error).toBeCloseTo(1.75, 6);
  });

  it("loads into a case: the family on the list is Rubin, the chip can be checked, and the log says what arrived", () => {
    const now = "2026-10-04T12:00:00.000Z";
    const doc = applyIngest(newCase("c1", now), records, "records.json", now);
    expect(doc.records).toHaveLength(20);
    expect(summarizeCase(doc).chipFamily).toBe("Rubin");
    expect(doc.log).toHaveLength(1);
    expect(doc.log[0].kind).toBe("record_added");
    expect(toggleChip(doc, "nvidia_vera_rubin_nvl72", now).chipIds).toEqual(["nvidia_vera_rubin_nvl72"]);
  });
});
