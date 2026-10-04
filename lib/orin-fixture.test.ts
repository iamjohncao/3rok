import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RECORD_TYPES } from "./case";
import { applyIngest, groupRecords, newCase, toggleChip } from "./case-ops";
import { summarizeCase } from "./case-store";
import { describeIssue, ingestText } from "./ingest";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureText = readFileSync(`${root}fixtures/orin-case/records.json`, "utf8");
const guidelines = readFileSync(`${root}docs/universal-data-input-guidelines.md`, "utf8");
const chipsYaml = readFileSync(`${root}starmind-physics/starmind_physics/data/ai_chips.yaml`, "utf8");

const result = ingestText("records.json", fixtureText);
if (!result.ok) throw new Error(result.errors.map(describeIssue).join("\n"));
const records = result.records;

describe("fixtures/orin-case", () => {
  it("passes the same ingest every upload passes", () => {
    expect(result.ok).toBe(true);
    expect(records.length).toBeGreaterThan(0);
  });

  it("uses only record types from the contract, and each row once", () => {
    for (const record of records) expect(RECORD_TYPES).toContain(record.record_type);
    expect(new Set(records.map((r) => r.record_id)).size).toBe(records.length);
  });

  it("claims measured or derived only where a citation in the data guidelines supports it", () => {
    const sourced = records.filter((r) => r.value_status === "measured" || r.value_status === "derived");
    expect(sourced.length).toBeGreaterThan(0);
    for (const record of sourced) expect(guidelines).toContain(record.source_url);
  });

  it("labels every placeholder and every outcome as assumed, and keeps outcomes in the holdout", () => {
    for (const record of records.filter((r) => ["trajectory", "placement", "outcome"].includes(r.record_type))) {
      expect(record.value_status).toBe("assumed");
    }
    const outcomes = records.filter((r) => r.record_type === "outcome");
    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) expect(outcome.split).toBe("holdout");
    expect(records.filter((r) => r.split === "holdout").every((r) => r.record_type === "outcome")).toBe(true);
  });

  it("carries the figures the guidelines print, in the rows that cite them", () => {
    const byId = Object.fromEntries(records.map((r) => [r.record_id, JSON.parse(r.body)]));
    expect(byId["tid-agx-co60"].failure_dose).toBe("42 krad(Si)");
    expect(byId["tid-agx-proton-150mev"].failure_dose).toBe("6 krad(Si)");
    expect(byId["tid-agx-redw-2023"].failure_dose).toBe("19 krad(Si)");
    expect(byId["tid-nx-survived"].survived_past).toBe("36.2 krad(Si)");
    expect(byId["see-nx-soc-480mev"]).toMatchObject({ fluence: "5.65e9 p/cm2", power_mode: "15 W" });
    expect(byId["see-nx-gpu-480mev"].cross_section).toContain("6.5e-10");
    expect(byId["see-nx-gpu-480mev"].cross_section).toContain("3.5e-10");
  });

  it("does not fill an H100, Rubin, or Starmind lifetime", () => {
    expect(fixtureText).not.toMatch(/h100|rubin|starmind|vera/i);
  });

  it("names a chip the physics package knows, so a score for it is not refused", () => {
    const agx = records.find((r) => r.record_id === "orin-agx-identity");
    const chipId = JSON.parse(agx?.body ?? "{}").chip_id as string;
    expect(chipsYaml).toContain(`id: ${chipId}`);
  });

  it("gives the outcome lane a failure and a survivor, each with a number", () => {
    const outcomes = records.filter((r) => r.record_type === "outcome").map((r) => JSON.parse(r.body));
    expect(outcomes.some((o) => typeof o.failure_time_years === "number")).toBe(true);
    expect(outcomes.some((o) => typeof o.censor_time_years === "number")).toBe(true);
  });

  it("gives the holdout lane the two numbers it reads, as assumed placeholders", () => {
    const traj = JSON.parse(records.find((r) => r.record_type === "trajectory")?.body ?? "{}");
    const place = JSON.parse(records.find((r) => r.record_type === "placement")?.body ?? "{}");
    expect(typeof traj.ltan_hours).toBe("number");
    expect(typeof place.shield_mm_Al).toBe("number");
  });

  it("loads into a case: the family on the list is Jetson Orin, and the log says what arrived", () => {
    const now = "2026-10-03T18:00:00.000Z";
    const doc = applyIngest(newCase("c1", now), records, "records.json", now);
    expect(doc.records).toHaveLength(records.length);
    expect(summarizeCase(doc).chipFamily).toBe("Jetson Orin");
    expect(doc.log).toHaveLength(1);
    expect(doc.log[0].kind).toBe("record_added");
    const groups = groupRecords(doc.records);
    expect(groups.filter((g) => g.records.length === 0).map((g) => g.type)).toEqual(["thermal-wear", "provenance"]);

    const chosen = toggleChip(doc, "nvidia_jetson_agx_orin", now);
    expect(chosen.chipIds).toEqual(["nvidia_jetson_agx_orin"]);
  });

  it("a second upload of the same file replaces every row and logs each by name", () => {
    const t0 = "2026-10-03T18:00:00.000Z";
    const t1 = "2026-10-03T18:05:00.000Z";
    const first = applyIngest(newCase("c1", t0), records, "records.json", t0);
    const second = applyIngest(first, records, "records.json", t1);
    expect(second.records).toHaveLength(records.length);
    const replaced = second.log.filter((e) => e.kind === "record_replaced");
    expect(replaced).toHaveLength(records.length);
    for (const record of records) {
      expect(replaced.some((e) => e.text.includes(record.record_id) && e.text.includes(record.record_type))).toBe(true);
    }
  });
});
