import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import { ingestText } from "./ingest";
import type { ScoreOrbit, ScoreOrbitInput } from "./holdout";
import { sunSynchronousInclinationDeg } from "./oem-reduce";
import { physicsFor } from "./physics-estimate";
import { circularOemText } from "./test-support/circular-oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const FIXTURE: CaseRecord[] = ingested.records;
const AGX = "nvidia_jetson_agx_orin";

const SSO_OEM = circularOemText({ altitudeKm: 650, inclinationDeg: sunSynchronousInclinationDeg(650) });

type Doc = Pick<CaseDocument, "records" | "chipIds" | "workingOem" | "optimizedOem">;
function orin(over: Partial<Doc> = {}): Doc {
  return { records: FIXTURE.map((r) => ({ ...r })), chipIds: [AGX], workingOem: SSO_OEM, optimizedOem: null, ...over };
}

const ESTIMATE = {
  mean_power_kW: 5.2,
  radiator_area_m2: 11.5,
  shield_mass_kg: 31.4,
  limiting_mode: "dose",
  dose_limit_provenance: "assumed",
};

function service(calls: ScoreOrbitInput[] = []): ScoreOrbit {
  return async (input) => {
    calls.push(input);
    return { refused: false, lifetime_years: 3.2, assumptions_note: "A ranking under assumed coefficients.", estimate: ESTIMATE };
  };
}

describe("the physics report for a flight file", () => {
  it("returns the lifetime and the rest of the estimate, with the inputs and where each came from", async () => {
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin(), scoreOrbit: service(calls) });
    expect(report.kind).toBe("estimate");
    if (report.kind !== "estimate") return;

    expect(report.flight).toBe("workingOem");
    expect(report.lifetime_years).toBe(3.2);
    expect(report.estimate).toEqual(ESTIMATE);
    expect(report.assumptions_note).toBe("A ranking under assumed coefficients.");
    expect(report.orbit.altitude_km).toBeCloseTo(650, 0);
    expect(report.inputs.chip.value).toBe(AGX);
    expect(report.inputs.ltan_hours.value_status).toBeTruthy();
    expect(report.inputs.shield_mm_Al.record_id).toBeTruthy();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ chip_id: AGX, inclination: "sso" });
  });

  it("scores the same file the globe flies: the working copy, else the optimized OEM", async () => {
    const optimized = circularOemText({ altitudeKm: 900, inclinationDeg: 30 });
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin({ workingOem: null, optimizedOem: optimized }), scoreOrbit: service(calls) });
    expect(report.kind === "estimate" && report.flight).toBe("optimizedOem");
    expect(calls[0].altitude_km).toBeCloseTo(900, 0);
  });

  it("has nothing to estimate when the case has no flight file, and does not call the service", async () => {
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin({ workingOem: null }), scoreOrbit: service(calls) });
    expect(report).toEqual({ kind: "no_flight" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a file that fails the OEM profile, with the sentence and no lifetime", async () => {
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin({ workingOem: "CCSDS_OEM_VERS = 3.0\nnope\n" }), scoreOrbit: service(calls) });
    expect(report.kind).toBe("refused");
    if (report.kind !== "refused") return;
    expect(report.reasons.join(" ")).toMatch(/OEM/i);
    expect("lifetime_years" in report).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses an orbit outside the 500 to 2000 km envelope without asking the service", async () => {
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin({ workingOem: circularOemText({ altitudeKm: 300, inclinationDeg: 30 }) }), scoreOrbit: service(calls) });
    expect(report.kind).toBe("refused");
    expect(calls).toHaveLength(0);
  });

  it("refuses when the case does not state the shield, and fills nothing in", async () => {
    const records = FIXTURE.map((r) => {
      if (r.record_type !== "placement") return r;
      const body = JSON.parse(r.body) as Record<string, unknown>;
      delete body.shield_mm_Al;
      delete body.shield_mm_al;
      return { ...r, body: JSON.stringify(body) };
    });
    const calls: ScoreOrbitInput[] = [];
    const report = await physicsFor({ doc: orin({ records }), scoreOrbit: service(calls) });
    expect(report.kind).toBe("refused");
    if (report.kind !== "refused") return;
    expect(report.reasons.join(" ")).toMatch(/shield_mm_Al/);
    expect(calls).toHaveLength(0);
  });

  it("refuses when two chips are selected, because an estimate is for one chip", async () => {
    const report = await physicsFor({ doc: orin({ chipIds: [AGX, "other"] }), scoreOrbit: service() });
    expect(report.kind).toBe("refused");
  });

  it("shows the service's refusal and no lifetime", async () => {
    const refusing: ScoreOrbit = async () => ({ refused: true, reason: "The ranker will not score this orbit." });
    const report = await physicsFor({ doc: orin(), scoreOrbit: refusing });
    expect(report.kind).toBe("refused");
    if (report.kind !== "refused") return;
    expect(report.reasons).toEqual(["The ranker will not score this orbit."]);
    expect(report.inputs).not.toBeNull();
  });

  it("treats a reply with no lifetime as a refusal, not as zero", async () => {
    const empty: ScoreOrbit = async () => ({ refused: false, lifetime_years: null });
    const report = await physicsFor({ doc: orin(), scoreOrbit: empty });
    expect(report.kind).toBe("refused");
  });

  it("says the service is unavailable when it cannot be reached, and invents no number", async () => {
    const down: ScoreOrbit = async () => {
      throw new Error("The physics server could not be reached.");
    };
    const report = await physicsFor({ doc: orin(), scoreOrbit: down });
    expect(report).toMatchObject({ kind: "unavailable", message: "The physics server could not be reached." });
    expect("lifetime_years" in report).toBe(false);
  });

  it("says so when no physics server is configured", async () => {
    const report = await physicsFor({ doc: orin(), scoreOrbit: null });
    expect(report.kind).toBe("unavailable");
  });

  it("changes nothing in the case it reads", async () => {
    const doc = orin();
    const before = JSON.stringify(doc);
    await physicsFor({ doc, scoreOrbit: service() });
    expect(JSON.stringify(doc)).toBe(before);
  });
});
