import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import { newCase } from "./case-ops";
import { evaluateCandidate, type HoldoutResult, type ScoreOrbit, type ScoreOrbitInput } from "./holdout";
import { ingestText } from "./ingest";
import { sunSynchronousInclinationDeg } from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureText = readFileSync(`${root}fixtures/orin-case/records.json`, "utf8");
const ingested = ingestText("records.json", fixtureText);
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const FIXTURE: CaseRecord[] = ingested.records;

const AGX = "nvidia_jetson_agx_orin";
const NOW = "2026-10-04T00:00:00.000Z";

type Doc = Pick<CaseDocument, "records" | "chipIds" | "holdoutError">;

/** The Orin fixture case with the AGX selected. Change what a test needs, with copies. */
function orinCase(overrides: Partial<Doc> = {}, edit: (records: CaseRecord[]) => CaseRecord[] = (r) => r): Doc {
  return { records: edit(FIXTURE.map((r) => ({ ...r }))), chipIds: [AGX], holdoutError: null, ...overrides };
}

const withBody = (records: CaseRecord[], id: string, change: (body: Record<string, unknown>) => void): CaseRecord[] =>
  records.map((r) => {
    if (r.record_id !== id) return r;
    const body = JSON.parse(r.body) as Record<string, unknown>;
    change(body);
    return { ...r, body: JSON.stringify(body) };
  });

// A 650 km sun-synchronous orbit, and a 650 km 30 degree one.
const SSO_OEM = circularOemText({ altitudeKm: 650, inclinationDeg: sunSynchronousInclinationDeg(650) });
const OEM_30 = circularOemText({ altitudeKm: 650, inclinationDeg: 30 });

function service(lifetime: number | null, calls: ScoreOrbitInput[] = []): ScoreOrbit {
  return async (input) => {
    calls.push(input);
    return { refused: false, lifetime_years: lifetime, assumptions_note: "A ranking under assumed coefficients." };
  };
}

async function score(doc: Doc, lifetime: number, oem = SSO_OEM): Promise<HoldoutResult> {
  return evaluateCandidate({ candidateOem: oem, doc, scoreOrbit: service(lifetime) });
}

// The fixture's holdout outcomes: a failure at 4.5 years and a survivor censored at 2 years.
describe("keeping a candidate", () => {
  it("keeps the first finite score, and names every row and the lifetime it compared", async () => {
    const result = await score(orinCase(), 3);
    expect(result.verdict).toBe("kept");
    if (result.verdict !== "kept") return;
    expect(result.rows).toEqual([
      { record_id: "outcome-synthetic-failure", kind: "failure", observed_years: 4.5, predicted_years: 3, error_years: 1.5 },
      { record_id: "outcome-synthetic-survivor", kind: "censored", observed_years: 2, predicted_years: 3, error_years: 0 },
    ]);
    expect(result.error).toBeCloseTo(0.75, 12);
    expect(result.previous_error).toBeNull();
    expect(result.predicted_lifetime_years).toBe(3);
    expect(result.assumptions_note).toBe("A ranking under assumed coefficients.");
    expect(result.reason).toContain("first score");
  });

  it("keeps a revision whose error drops", async () => {
    const result = await score(orinCase({ holdoutError: 0.9 }), 3);
    expect(result.verdict).toBe("kept");
    expect(result.previous_error).toBe(0.9);
    expect(result.reason).toContain("fell from 0.900 to 0.750");
  });

  it("sends the service the reduced orbit and the case's own numbers, and nothing else", async () => {
    const calls: ScoreOrbitInput[] = [];
    await evaluateCandidate({ candidateOem: SSO_OEM, doc: orinCase(), scoreOrbit: service(3, calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ inclination: "sso", ltan_hours: 6, shield_mm_Al: 5, chip_id: AGX });
    expect(calls[0].altitude_km).toBeCloseTo(650, 6);
    expect(Object.keys(calls[0]).sort()).toEqual(["altitude_km", "chip_id", "inclination", "ltan_hours", "shield_mm_Al"]);
  });

  it("sends the derived inclination for a 30 degree orbit", async () => {
    const calls: ScoreOrbitInput[] = [];
    await evaluateCandidate({ candidateOem: OEM_30, doc: orinCase(), scoreOrbit: service(3, calls) });
    expect(calls[0].inclination).toBeCloseTo(30, 6);
  });

  it("says where each input came from, with that record's value_status", async () => {
    const result = await score(orinCase(), 3);
    expect(result.inputs).toEqual({
      chip: { record_id: "orin-agx-identity", part_number: "Jetson AGX Orin module", sent_as: "chip_id", value: AGX },
      ltan_hours: { record_id: "traj-dawn-dusk-assumed", value: 6, value_status: "assumed" },
      shield_mm_Al: { record_id: "place-a1-assumed", value: 5, value_status: "assumed" },
    });
    expect(result.orbit?.value_status).toBe("derived");
  });

  it("gives the same result when it is run twice", async () => {
    const doc = orinCase({ holdoutError: 5 });
    expect(await score(doc, 3)).toEqual(await score(doc, 3));
  });
});

describe("rejecting a candidate", () => {
  it("rejects a revision whose error rises", async () => {
    const result = await score(orinCase({ holdoutError: 0.75 }), 1);
    expect(result.verdict).toBe("rejected");
    // |1 - 4.5| = 3.5 for the failure, 2 - 1 = 1 for the survivor.
    expect(result.error).toBeCloseTo(2.25, 12);
    expect(result.reason).toContain("not kept");
  });

  it("rejects an error that only ties, because it must be strictly lower", async () => {
    const result = await score(orinCase({ holdoutError: 0.75 }), 3);
    expect(result.verdict).toBe("rejected");
  });

  it("rejects a 400 km file, with an infinite error, and never calls the service", async () => {
    const service = vi.fn(async () => ({ refused: false as const, lifetime_years: 3 }));
    const result = await evaluateCandidate({
      candidateOem: circularOemText({ altitudeKm: 400, inclinationDeg: 30 }),
      doc: orinCase({ holdoutError: 0.5 }),
      scoreOrbit: service,
    });
    expect(result.verdict).toBe("rejected");
    expect(result.error).toBe(Number.POSITIVE_INFINITY);
    expect(result.previous_error).toBe(0.5);
    expect(result.refusals[0]).toContain("400.0 km");
    expect(result.rows).toEqual([]);
    expect(service).not.toHaveBeenCalled();
  });

  it("rejects text that is not an OEM", async () => {
    const result = await score(orinCase(), 3, "Sure! A good orbit is 650 km.");
    expect(result.verdict).toBe("rejected");
    expect(result.refusals[0]).toContain("does not pass the OEM profile");
  });

  it("rejects when the physics service refuses the orbit, and says what it said", async () => {
    const result = await evaluateCandidate({
      candidateOem: SSO_OEM,
      doc: orinCase(),
      scoreOrbit: async () => ({ refused: true, reason: "Outside the filed envelope." }),
    });
    expect(result.verdict).toBe("rejected");
    expect(result.error).toBe(Number.POSITIVE_INFINITY);
    expect(result.reason).toContain("Outside the filed envelope.");
  });

  it("rejects when the service returns no lifetime", async () => {
    expect((await score(orinCase(), null as unknown as number)).verdict).toBe("rejected");
    expect((await score(orinCase(), Number.NaN)).verdict).toBe("rejected");
  });

  it("does not swallow a service that cannot be reached", async () => {
    await expect(
      evaluateCandidate({
        candidateOem: SSO_OEM,
        doc: orinCase(),
        scoreOrbit: async () => {
          throw new Error("Physics unavailable");
        },
      }),
    ).rejects.toThrow("Physics unavailable");
  });
});

describe("outcomes", () => {
  const survivorOnly = () =>
    orinCase({}, (records) => records.filter((r) => r.record_id !== "outcome-synthetic-failure"));

  it("a survivor predicted dead adds error, and one predicted to live adds none", async () => {
    // Censor time 2 years.
    expect((await score(survivorOnly(), 0.5)).error).toBeCloseTo(1.5, 12);
    expect((await score(survivorOnly(), 2)).error).toBe(0);
    expect((await score(survivorOnly(), 10)).error).toBe(0);
  });

  it("a failure is scored on the distance either way", async () => {
    const failureOnly = orinCase({}, (records) => records.filter((r) => r.record_id !== "outcome-synthetic-survivor"));
    expect((await score(failureOnly, 6)).error).toBeCloseTo(1.5, 12);
    expect((await score(failureOnly, 3)).error).toBeCloseTo(1.5, 12);
  });

  it("is unscored with no holdout outcome rows, and does not call the service", async () => {
    const noOutcomes = orinCase({}, (records) => records.filter((r) => r.record_type !== "outcome"));
    const service = vi.fn(async () => ({ refused: false as const, lifetime_years: 3 }));
    const result = await evaluateCandidate({ candidateOem: SSO_OEM, doc: noOutcomes, scoreOrbit: service });
    expect(result.verdict).toBe("unscored");
    expect(result.error).toBeNull();
    expect(result.reason).toContain("unscored");
    expect(service).not.toHaveBeenCalled();
  });

  it("does not use a training outcome, because only holdout rows score", async () => {
    const trainOnly = orinCase({}, (records) => records.map((r) => (r.record_type === "outcome" ? { ...r, split: "train" as const } : r)));
    expect((await score(trainOnly, 3)).verdict).toBe("unscored");
  });

  it("is unscored, not scored, when the holdout rows have no time", async () => {
    const noTimes = orinCase({}, (records) =>
      records.map((r) => (r.record_type === "outcome" ? { ...r, body: JSON.stringify({ time_window: "5 years" }) } : r)),
    );
    const result = await score(noTimes, 3);
    expect(result.verdict).toBe("unscored");
    expect(result.skipped.map((s) => s.record_id).sort()).toEqual(["outcome-synthetic-failure", "outcome-synthetic-survivor"]);
  });

  it("skips and names a row that gives both times, or a time that is not a number", async () => {
    const edited = orinCase({}, (records) => {
      let next = withBody(records, "outcome-synthetic-failure", (b) => (b.censor_time_years = 1));
      next = withBody(next, "outcome-synthetic-survivor", (b) => (b.censor_time_years = "about two"));
      return next;
    });
    const result = await score(edited, 3);
    expect(result.verdict).toBe("unscored");
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.record_id, s.reason]));
    expect(reasons["outcome-synthetic-failure"]).toContain("both");
    expect(reasons["outcome-synthetic-survivor"]).toContain("not a number of years");
  });

  it("reads a time that a CSV or spreadsheet stored as text", async () => {
    const edited = orinCase({}, (records) => withBody(records, "outcome-synthetic-failure", (b) => (b.failure_time_years = "4.5")));
    expect((await score(edited, 3)).error).toBeCloseTo(0.75, 12);
  });

  it("scores only the outcomes for the selected chip, and says which it set aside", async () => {
    const other: CaseRecord = {
      ...FIXTURE.find((r) => r.record_id === "outcome-synthetic-failure")!,
      record_id: "outcome-h100",
      part_number: "H100",
      body: JSON.stringify({ time_window: "54 days", position_reference: "ground", upsets: "not_reported", resets: "not_reported", uncorrectable_ecc: "not_reported", temperatures: "not_reported", failure_time_years: 100 }),
    };
    const result = await score(orinCase({}, (records) => [...records, other]), 3);
    expect(result.verdict).toBe("kept");
    expect(result.rows.map((r) => r.record_id)).toEqual(["outcome-synthetic-failure", "outcome-synthetic-survivor"]);
    expect(result.skipped).toEqual([
      { record_id: "outcome-h100", reason: "It is for H100, not for the selected chip Jetson AGX Orin module." },
    ]);
  });

  it("is unscored when every outcome is for another chip", async () => {
    const result = await score(
      orinCase({}, (records) => records.map((r) => (r.record_type === "outcome" ? { ...r, part_number: "H100" } : r))),
      3,
    );
    expect(result.verdict).toBe("unscored");
    expect(result.reason).toContain("No holdout outcome is for the selected chip");
  });
});

describe("inputs the case must give", () => {
  const rejectedWith = async (doc: Doc, text: string) => {
    const service = vi.fn(async () => ({ refused: false as const, lifetime_years: 3 }));
    const result = await evaluateCandidate({ candidateOem: SSO_OEM, doc, scoreOrbit: service });
    expect(result.verdict).toBe("rejected");
    expect(result.refusals.join(" ")).toContain(text);
    expect(result.error).toBe(Number.POSITIVE_INFINITY);
    expect(service).not.toHaveBeenCalled();
  };

  it("refuses without ltan_hours, and does not fill in 6 hours", async () => {
    await rejectedWith(
      orinCase({}, (records) => withBody(records, "traj-dawn-dusk-assumed", (b) => delete b.ltan_hours)),
      "ltan_hours",
    );
  });

  it("refuses without a trajectory record at all", async () => {
    await rejectedWith(orinCase({}, (records) => records.filter((r) => r.record_type !== "trajectory")), "No trajectory record gives ltan_hours");
  });

  it("refuses without shield_mm_Al, and does not fill in 5 mm", async () => {
    await rejectedWith(
      orinCase({}, (records) => withBody(records, "place-a1-assumed", (b) => delete b.shield_mm_Al)),
      "shield_mm_Al",
    );
  });

  it("refuses a placement for a different chip", async () => {
    await rejectedWith(
      orinCase({}, (records) => records.map((r) => (r.record_type === "placement" ? { ...r, part_number: "Other part" } : r))),
      "No placement record gives shield_mm_Al",
    );
  });

  it("refuses when two trajectory records disagree, naming both", async () => {
    const second = { ...FIXTURE.find((r) => r.record_type === "trajectory")!, record_id: "traj-other", body: JSON.stringify({ ltan_hours: 10.5 }) };
    await rejectedWith(orinCase({}, (records) => [...records, second]), "traj-dawn-dusk-assumed says 6, traj-other says 10.5");
  });

  it("accepts two trajectory records that agree", async () => {
    const second = { ...FIXTURE.find((r) => r.record_type === "trajectory")!, record_id: "traj-same", body: JSON.stringify({ ltan_hours: "6" }) };
    expect((await score(orinCase({}, (records) => [...records, second]), 3)).verdict).toBe("kept");
  });

  it("refuses a case with no chip-identity record", async () => {
    await rejectedWith(orinCase({ chipIds: [] }, (records) => records.filter((r) => r.record_type !== "chip-identity")), "no chip-identity record");
  });

  it("refuses when more than one chip is selected", async () => {
    await rejectedWith(orinCase({ chipIds: [AGX, "jetson_orin_nx"] }), "More than one chip is selected");
  });

  it("refuses when none is selected and there are two chips, but takes the only chip when there is one", async () => {
    await rejectedWith(orinCase({ chipIds: [] }), "none is selected");
    const single = orinCase({ chipIds: [] }, (records) => records.filter((r) => r.record_id !== "orin-nx-identity"));
    expect((await score(single, 3)).verdict).toBe("kept");
  });

  it("refuses a chip that is not in ai_chips.yaml and does not name a preset", async () => {
    await rejectedWith(orinCase({ chipIds: ["jetson_orin_nx"] }), "jetson_orin_nx is not in ai_chips.yaml");
  });

  it("sends a chip_preset when the record says commercial or rad_hard", async () => {
    const calls: ScoreOrbitInput[] = [];
    const nx = "Jetson Orin NX module";
    const doc = orinCase({ chipIds: ["jetson_orin_nx"] }, (records) =>
      withBody(records, "orin-nx-identity", (b) => (b.chip_preset = "Commercial")).map((r) =>
        r.record_type === "outcome" || r.record_type === "placement" ? { ...r, part_number: nx } : r,
      ),
    );
    const result = await evaluateCandidate({ candidateOem: SSO_OEM, doc, scoreOrbit: service(3, calls) });
    expect(calls[0]).toMatchObject({ chip_preset: "commercial" });
    expect("chip_id" in calls[0]).toBe(false);
    expect(result.inputs?.chip).toMatchObject({ sent_as: "chip_preset", value: "commercial" });
    expect(result.verdict).toBe("kept");
  });

  it("does not score the AGX outcomes against another chip's lifetime", async () => {
    const calls: ScoreOrbitInput[] = [];
    const doc = orinCase({ chipIds: ["jetson_orin_nx"] }, (records) =>
      withBody(records, "orin-nx-identity", (b) => (b.chip_preset = "commercial")).map((r) =>
        r.record_type === "placement" ? { ...r, part_number: "Jetson Orin NX module" } : r,
      ),
    );
    const result = await evaluateCandidate({ candidateOem: SSO_OEM, doc, scoreOrbit: service(3, calls) });
    expect(result.verdict).toBe("unscored");
    expect(calls).toHaveLength(0);
  });

  it("refuses an unknown preset", async () => {
    const doc = orinCase({ chipIds: ["jetson_orin_nx"] }, (records) =>
      withBody(records, "orin-nx-identity", (b) => (b.chip_preset = "custom")),
    );
    await rejectedWith(doc, "does not say commercial or rad_hard");
  });

  it("says every refusal at once", async () => {
    const doc = orinCase({ chipIds: [] }, (records) => records.filter((r) => r.record_type !== "trajectory" && r.record_type !== "placement"));
    const result = await evaluateCandidate({ candidateOem: circularOemText({ altitudeKm: 300, inclinationDeg: 60 }), doc, scoreOrbit: service(3) });
    expect(result.verdict).toBe("rejected");
    expect(result.refusals.length).toBeGreaterThanOrEqual(4);
  });
});

describe("what the function leaves alone", () => {
  it("does not change the case it reads, so a working copy and the optimized file stay as they were", async () => {
    const full: CaseDocument = {
      ...newCase("c1", NOW, "u1"),
      records: FIXTURE,
      chipIds: [AGX],
      workingOem: "working copy text",
      optimizedOem: "optimized text",
      holdoutError: 5,
    };
    const frozen = structuredClone(full);
    const deepFreeze = (value: unknown): void => {
      if (typeof value === "object" && value !== null) {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
    };
    deepFreeze(full);
    const result = await evaluateCandidate({ candidateOem: SSO_OEM, doc: full, scoreOrbit: service(3) });
    expect(result.verdict).toBe("kept");
    expect(full).toEqual(frozen);
    expect(result).not.toHaveProperty("optimizedOem");
    expect(result).not.toHaveProperty("workingOem");
  });

  it("is only given OEM text, and a candidate that is not one is not scored", async () => {
    const transcript = `User: fly it\nAssistant: ${OEM_30}`;
    expect((await score(orinCase(), 3, transcript)).verdict).toBe("rejected");
  });

  it("imports no AI SDK and makes no network call", () => {
    const source = readFileSync(`${root}lib/holdout.ts`, "utf8") + readFileSync(`${root}lib/oem-reduce.ts`, "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier.startsWith("./")).toBe(true);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|api\.x\.ai|XAI_API_KEY/);
  });
});
