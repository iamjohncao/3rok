import { describe, expect, it } from "vitest";
import { newCase } from "./case-ops";
import { MAX_CASE_RECORDS, UUID, parseCaseDocument } from "./case-validate";

const ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const OWNER = "0c8d2a33-7f4e-4a10-8b55-6e9f1a2b3c4d";
const base = () => newCase(ID, "2026-10-03T18:00:00.000Z", OWNER);

const record = {
  record_id: "r1",
  record_type: "tid",
  chip_family: "Jetson Orin",
  part_number: "AGX",
  test_or_model: "Co-60",
  particle_or_stress: null,
  split: "train",
  source_url: "https://example.com",
  value_status: "measured",
  body: "dose,result\n42,fail",
  source_filename: null,
};

function error(value: unknown): string {
  const result = parseCaseDocument(value);
  if (result.ok) throw new Error("expected the document to be refused");
  return result.error;
}

describe("parseCaseDocument", () => {
  it("accepts a new case and returns an equal copy", () => {
    const result = parseCaseDocument(base());
    expect(result.ok && result.doc).toEqual(base());
  });

  it("accepts a full case: records, a log, both OEM strings, and a score", () => {
    const doc = {
      ...base(),
      chipIds: ["AGX"],
      records: [record],
      log: [{ at: "2026-10-03T18:05:00.000Z", kind: "hand_edit", text: "x", oem: "OEM", holdout_error: null }],
      optimizedOem: "OPT",
      workingOem: "WORK",
      holdoutError: 1.25,
    };
    const result = parseCaseDocument(doc);
    expect(result.ok && result.doc).toEqual(doc);
  });

  it("returns a copy, so extra data cannot ride along", () => {
    const result = parseCaseDocument(base());
    expect(result.ok && result.doc).not.toBe(base());
  });

  it("refuses anything that is not an object", () => {
    for (const bad of [null, undefined, 5, "case", [], [base()]]) expect(error(bad)).toContain("must be an object");
  });

  it("refuses a field the contract does not have: a tenth kind of flight, a training field, a dollar field", () => {
    for (const extra of ["trajectory", "epoch", "loss", "checkpointId", "priceUsd", "teamId", "flightJson"]) {
      expect(error({ ...base(), [extra]: 1 })).toContain(`does not have: ${extra}`);
    }
  });

  it("refuses a missing field", () => {
    const { workingOem: _omitted, ...rest } = base();
    expect(error(rest)).toContain("missing the field workingOem");
  });

  it("refuses an unknown record type, split, value_status, or log kind", () => {
    expect(error({ ...base(), records: [{ ...record, record_type: "telemetry" }] })).toContain("record_type must be one of");
    expect(error({ ...base(), records: [{ ...record, split: "validation" }] })).toContain("split must be one of");
    expect(error({ ...base(), records: [{ ...record, value_status: "guessed" }] })).toContain("value_status must be one of");
    expect(
      error({ ...base(), log: [{ at: "t", kind: "fine_tune", text: "x", oem: null, holdout_error: null }] }),
    ).toContain("kind must be one of");
  });

  it("refuses an extra field on a record or a log entry", () => {
    expect(error({ ...base(), records: [{ ...record, thrust: 5 }] })).toContain("does not have: thrust");
    expect(
      error({ ...base(), log: [{ at: "t", kind: "score", text: "x", oem: null, holdout_error: null, loss: 1 }] }),
    ).toContain("does not have: loss");
  });

  it("refuses the wrong type for a field", () => {
    expect(error({ ...base(), name: 5 })).toContain("must be text");
    expect(error({ ...base(), chipIds: "AGX" })).toContain("chipIds must be a list");
    expect(error({ ...base(), holdoutError: "1.2" })).toContain("must be a number or null");
    expect(error({ ...base(), holdoutError: Number.NaN })).toContain("must be a number or null");
    expect(error({ ...base(), optimizedOem: 5 })).toContain("must be text");
  });

  it("limits the id, the name, and the number of records", () => {
    expect(error({ ...base(), id: "" })).toContain("1 to 100");
    expect(error({ ...base(), name: "x".repeat(201) })).toContain("at most 200");
    expect(error({ ...base(), records: new Array(MAX_CASE_RECORDS + 1).fill(record) })).toContain("at most");
  });
});

describe("UUID", () => {
  it("matches a v4 id and nothing else", () => {
    expect(UUID.test(ID)).toBe(true);
    expect(UUID.test("not-a-uuid")).toBe(false);
    expect(UUID.test("../../etc/passwd")).toBe(false);
    expect(UUID.test(`${ID}'; drop table case_doc;--`)).toBe(false);
  });
});
