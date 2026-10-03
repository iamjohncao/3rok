import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LOG_KINDS,
  RECORD_TYPES,
  SPLITS,
  VALUE_STATUSES,
  type CaseDocument,
  type CaseRecord,
  type LogEntry,
} from "./case";

// These tests lock the contract in docs/mvp-phase-plan.md ("Shared contract").
// If one fails because a field changed on purpose, change the plan and every
// lane that reads the field in the same commit.

describe("lib/case contract", () => {
  it("has exactly the nine record types from the data guidelines", () => {
    expect([...RECORD_TYPES]).toEqual([
      "chip-identity",
      "tid",
      "see",
      "thermal-wear",
      "trajectory",
      "environment",
      "placement",
      "outcome",
      "provenance",
    ]);
  });

  it("has the split, value_status and log kinds the plan names", () => {
    expect([...SPLITS]).toEqual(["train", "holdout"]);
    expect([...VALUE_STATUSES]).toEqual([
      "measured",
      "derived",
      "assumed",
      "not_observable",
    ]);
    expect([...LOG_KINDS]).toEqual([
      "instruction",
      "proposal",
      "score",
      "kept",
      "rejected",
      "hand_edit",
      "export",
    ]);
  });

  it("keeps the case document to the planned fields", () => {
    expectTypeOf<keyof CaseDocument>().toEqualTypeOf<
      | "id"
      | "accountId"
      | "name"
      | "chipIds"
      | "records"
      | "log"
      | "optimizedOem"
      | "workingOem"
      | "holdoutError"
      | "updatedAt"
    >();
    expectTypeOf<keyof CaseRecord>().toEqualTypeOf<
      | "record_id"
      | "record_type"
      | "chip_family"
      | "part_number"
      | "test_or_model"
      | "particle_or_stress"
      | "split"
      | "source_url"
      | "value_status"
      | "body"
      | "source_filename"
    >();
    expectTypeOf<keyof LogEntry>().toEqualTypeOf<
      "at" | "kind" | "text" | "oem" | "holdout_error"
    >();
  });

  it("stores the flight only as the two OEM strings", () => {
    expectTypeOf<CaseDocument["optimizedOem"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CaseDocument["workingOem"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CaseDocument["holdoutError"]>().toEqualTypeOf<number | null>();
  });

  it("has no training-run fields", () => {
    const keys = [
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
    ] satisfies (keyof CaseDocument)[];
    for (const key of keys) {
      expect(key).not.toMatch(/epoch|loss|checkpoint|fine.?tune|train(ed|ing)/i);
    }
  });
});
