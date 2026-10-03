import { describe, expect, it } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import {
  CASE_NAME_MAX_LENGTH,
  RECORD_TYPE_LABELS,
  UNTITLED_CASE,
  applyHandEdit,
  describeEdit,
  formatUtc,
  groupRecords,
  newCase,
  renameCase,
} from "./case-ops";
import { RECORD_TYPES } from "./case";

const T0 = "2026-10-03T18:00:00.000Z";
const T1 = "2026-10-03T18:10:00.000Z";
const T2 = "2026-10-03T18:20:00.000Z";

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    record_id: "r1",
    record_type: "tid",
    chip_family: "Jetson Orin",
    part_number: "AGX",
    test_or_model: "Co-60",
    particle_or_stress: "Co-60",
    split: "train",
    source_url: "https://example.com/report",
    value_status: "measured",
    body: "dose,result\n42,fail",
    source_filename: null,
    ...overrides,
  };
}

describe("a new case", () => {
  it("is an empty container with no flight and no score", () => {
    expect(newCase("c1", T0)).toEqual({
      id: "c1",
      accountId: null,
      name: UNTITLED_CASE,
      chipIds: [],
      records: [],
      log: [],
      optimizedOem: null,
      workingOem: null,
      holdoutError: null,
      updatedAt: T0,
    });
  });
});

describe("renaming", () => {
  const doc = newCase("c1", T0);

  it("trims the name and stamps the time", () => {
    const renamed = renameCase(doc, "  Orin proton run  ", T1);
    expect(renamed.name).toBe("Orin proton run");
    expect(renamed.updatedAt).toBe(T1);
  });

  it("ignores an empty or unchanged name", () => {
    expect(renameCase(doc, "   ", T1)).toBe(doc);
    expect(renameCase(doc, UNTITLED_CASE, T1)).toBe(doc);
  });

  it("caps the length", () => {
    expect(renameCase(doc, "x".repeat(500), T1).name).toHaveLength(CASE_NAME_MAX_LENGTH);
  });

  it("does not touch the flight, the log, or the score", () => {
    const flown = { ...doc, optimizedOem: "OPT", workingOem: "WORK", holdoutError: 1.5 };
    const renamed = renameCase(flown, "New name", T1);
    expect(renamed).toMatchObject({ optimizedOem: "OPT", workingOem: "WORK", holdoutError: 1.5, log: [] });
  });
});

describe("a hand edit", () => {
  const base = {
    ...newCase("c1", T0),
    optimizedOem: "OPTIMIZED TEXT\n",
    holdoutError: 2.5,
  };

  it("changes the working copy and appends a hand_edit log entry with the time and the text", () => {
    const edited = applyHandEdit(base, "line one\nline two\n", T1);
    expect(edited.workingOem).toBe("line one\nline two\n");
    expect(edited.log).toHaveLength(1);
    expect(edited.log[0]).toMatchObject({
      at: T1,
      kind: "hand_edit",
      oem: "line one\nline two\n",
      holdout_error: null,
    });
    expect(edited.log[0].text).toContain("+ line one");
    expect(edited.updatedAt).toBe(T1);
  });

  it("never changes the optimized file or the score", () => {
    const edited = applyHandEdit(base, "anything at all", T1);
    expect(edited.optimizedOem).toBe("OPTIMIZED TEXT\n");
    expect(edited.holdoutError).toBe(2.5);
  });

  it("records what left and what arrived on a second edit", () => {
    const first = applyHandEdit(base, "a\nb\nc\n", T1);
    const second = applyHandEdit(first, "a\nB\nc\n", T2);
    expect(second.log).toHaveLength(2);
    expect(second.log[1].text).toContain("- b");
    expect(second.log[1].text).toContain("+ B");
    expect(second.log[1].text).toContain("from line 2");
    expect(second.log[0]).toEqual(first.log[0]); // earlier entries are never rewritten
  });

  it("is a no-op, with no log entry, when nothing changed", () => {
    const first = applyHandEdit(base, "same", T1);
    expect(applyHandEdit(first, "same", T2)).toBe(first);
    expect(applyHandEdit(base, "", T1)).toBe(base);
    expect(applyHandEdit(base, "   \n", T1)).toBe(base);
  });

  it("clears the working copy when the text is emptied, and logs it", () => {
    const first = applyHandEdit(base, "a\nb\n", T1);
    const cleared = applyHandEdit(first, "", T2);
    expect(cleared.workingOem).toBeNull();
    expect(cleared.log).toHaveLength(2);
    expect(cleared.log[1].oem).toBeNull();
    expect(cleared.optimizedOem).toBe("OPTIMIZED TEXT\n");
  });

  it("never lets the working copy change without a log entry", () => {
    let doc: CaseDocument = base;
    const texts = ["a", "a", "b\nc", "", "", "b\nc", "b\nc\n", "  ", "z", "z", "y\n"];
    for (const [index, text] of texts.entries()) {
      const before = doc;
      doc = applyHandEdit(doc, text, `2026-10-03T19:${String(index).padStart(2, "0")}:00.000Z`);
      if (doc.workingOem !== before.workingOem) {
        expect(doc.log.length).toBe(before.log.length + 1);
      } else {
        expect(doc.log.length).toBe(before.log.length);
      }
    }
  });
});

describe("describeEdit", () => {
  it("names the first changed line and counts the lines", () => {
    expect(describeEdit("a\nb\nc", "a\nx\ny\nc")).toBe(
      "Hand edit to the working copy: 1 line removed, 2 lines added, from line 2.\n- b\n+ x\n+ y",
    );
  });

  it("does not count a final newline as a line", () => {
    expect(describeEdit("", "a\nb\n")).toBe(
      "Hand edit to the working copy: 0 lines removed, 2 lines added, from line 1.\n+ a\n+ b",
    );
    expect(describeEdit("a\nb\n", "a\nb\nc\n")).toBe(
      "Hand edit to the working copy: 0 lines removed, 1 line added, from line 3.\n+ c",
    );
  });

  it("says so when only the final newline changed", () => {
    expect(describeEdit("a\nb", "a\nb\n")).toBe(
      "Hand edit to the working copy: only the final newline changed.",
    );
  });

  it("caps the changed lines it records", () => {
    const many = Array.from({ length: 50 }, (_, i) => `row ${i}`).join("\n");
    const text = describeEdit("", many);
    expect(text).toContain("0 lines removed, 50 lines added");
    expect(text).toContain("... 30 lines more changed.");
    expect(text.split("\n")).toHaveLength(1 + 20 + 1);
  });
});

describe("grouping records by the nine types", () => {
  it("returns all nine groups in order, even when empty", () => {
    const groups = groupRecords([]);
    expect(groups.map((group) => group.type)).toEqual([...RECORD_TYPES]);
    expect(groups.every((group) => group.records.length === 0)).toBe(true);
    for (const group of groups) expect(group.label).toBe(RECORD_TYPE_LABELS[group.type]);
  });

  it("puts each record in its type, with value_status and split intact", () => {
    const rows = [
      record({ record_id: "t1", record_type: "tid", value_status: "measured", split: "train" }),
      record({ record_id: "t2", record_type: "tid", value_status: "assumed", split: "holdout" }),
      record({ record_id: "o1", record_type: "outcome", value_status: "derived", split: "holdout" }),
    ];
    const groups = Object.fromEntries(groupRecords(rows).map((group) => [group.type, group.records]));
    expect(groups.tid.map((r) => r.record_id)).toEqual(["t1", "t2"]);
    expect(groups.outcome.map((r) => r.record_id)).toEqual(["o1"]);
    expect(groups.see).toEqual([]);
  });

  it("never hides a holdout row", () => {
    const rows = [record({ record_id: "h1", split: "holdout" }), record({ record_id: "h2", split: "train" })];
    const shown = groupRecords(rows).flatMap((group) => group.records);
    expect(shown.map((r) => r.record_id).sort()).toEqual(["h1", "h2"]);
    expect(shown.find((r) => r.record_id === "h1")?.split).toBe("holdout");
  });
});

describe("formatUtc", () => {
  it("writes a UTC minute", () => {
    expect(formatUtc("2026-10-03T18:20:00.000Z")).toBe("2026-10-03 18:20 UTC");
  });

  it("returns text it cannot read unchanged", () => {
    expect(formatUtc("not a time")).toBe("not a time");
  });
});
