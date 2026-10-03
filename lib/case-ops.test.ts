import { describe, expect, it } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import {
  CASE_NAME_MAX_LENGTH,
  RECORD_TYPE_LABELS,
  UNTITLED_CASE,
  applyHandEdit,
  applyIngest,
  attachPdf,
  caseBytes,
  chipIdFor,
  describeEdit,
  formatUtc,
  groupRecords,
  looksLikePdf,
  newCase,
  previewIngest,
  renameCase,
  toggleChip,
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

describe("previewing an upload", () => {
  it("separates new rows from rows that share a record_id", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" }), record({ record_id: "b" })] };
    const preview = previewIngest(doc, [record({ record_id: "b", test_or_model: "new" }), record({ record_id: "c" })]);
    expect(preview.added.map((r) => r.record_id)).toEqual(["c"]);
    expect(preview.replaced.map((r) => r.after.record_id)).toEqual(["b"]);
    expect(preview.replaced[0].before.test_or_model).toBe("Co-60");
  });

  it("changes nothing", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" })] };
    const copy = structuredClone(doc);
    previewIngest(doc, [record({ record_id: "a", test_or_model: "new" })]);
    expect(doc).toEqual(copy);
  });
});

describe("saving an upload", () => {
  it("appends new rows and logs one record_added entry that counts them by type", () => {
    const doc = newCase("c1", T0);
    const next = applyIngest(
      doc,
      [record({ record_id: "a" }), record({ record_id: "b", record_type: "see" }), record({ record_id: "c" })],
      "orin.csv",
      T1,
    );
    expect(next.records.map((r) => r.record_id)).toEqual(["a", "b", "c"]);
    expect(next.log).toHaveLength(1);
    expect(next.log[0]).toMatchObject({ at: T1, kind: "record_added", oem: null, holdout_error: null });
    expect(next.log[0].text).toBe("Added 3 records from orin.csv: 2 tid, 1 see.");
    expect(next.updatedAt).toBe(T1);
  });

  it("says record, not records, for one", () => {
    const next = applyIngest(newCase("c1", T0), [record()], "one.json", T1);
    expect(next.log[0].text).toBe("Added 1 record from one.json: 1 tid.");
  });

  it("replaces a row in place and logs it by record_id and type, never silently", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" }), record({ record_id: "b" })] };
    const next = applyIngest(doc, [record({ record_id: "a", test_or_model: "Proton" })], "update.csv", T1);
    expect(next.records.map((r) => [r.record_id, r.test_or_model])).toEqual([
      ["a", "Proton"],
      ["b", "Co-60"],
    ]);
    expect(next.log).toHaveLength(1);
    expect(next.log[0]).toMatchObject({ kind: "record_replaced", at: T1 });
    expect(next.log[0].text).toContain("a");
    expect(next.log[0].text).toContain("tid");
  });

  it("logs a replacement per row, then one summary for the rows that were new", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" }), record({ record_id: "b" })] };
    const next = applyIngest(
      doc,
      [record({ record_id: "a" }), record({ record_id: "b" }), record({ record_id: "c" })],
      "f.csv",
      T1,
    );
    expect(next.log.map((e) => e.kind)).toEqual(["record_replaced", "record_replaced", "record_added"]);
    expect(next.records).toHaveLength(3);
  });

  it("names both types when a replacement changes the type", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a", record_type: "tid" })] };
    const next = applyIngest(doc, [record({ record_id: "a", record_type: "see" })], "f.csv", T1);
    expect(next.log[0].text).toContain("was tid, now see");
  });

  it("keeps the old source_filename when the new row has none", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a", source_filename: "report.pdf" })] };
    const kept = applyIngest(doc, [record({ record_id: "a", source_filename: null })], "f.csv", T1);
    expect(kept.records[0].source_filename).toBe("report.pdf");
    const named = applyIngest(doc, [record({ record_id: "a", source_filename: "new.pdf" })], "f.csv", T1);
    expect(named.records[0].source_filename).toBe("new.pdf");
  });

  it("never touches the flight, the score, or the chip selection", () => {
    const doc: CaseDocument = {
      ...newCase("c1", T0),
      optimizedOem: "OPT",
      workingOem: "WORK",
      holdoutError: 0.3,
      chipIds: ["AGX"],
    };
    const next = applyIngest(doc, [record({ record_id: "a", record_type: "trajectory" })], "traj.json", T1);
    expect(next.optimizedOem).toBe("OPT");
    expect(next.workingOem).toBe("WORK");
    expect(next.holdoutError).toBe(0.3);
    expect(next.chipIds).toEqual(["AGX"]);
  });

  it("stores holdout rows like any other and keeps their split", () => {
    const next = applyIngest(newCase("c1", T0), [record({ record_id: "h", split: "holdout" })], "f.csv", T1);
    expect(next.records[0].split).toBe("holdout");
  });

  it("returns the same document for an empty upload", () => {
    const doc = newCase("c1", T0);
    expect(applyIngest(doc, [], "f.csv", T1)).toBe(doc);
  });

  it("does not change the document it was given", () => {
    const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" })] };
    const copy = structuredClone(doc);
    applyIngest(doc, [record({ record_id: "a", test_or_model: "x" }), record({ record_id: "b" })], "f.csv", T1);
    expect(doc).toEqual(copy);
  });
});

describe("attaching a PDF", () => {
  const doc = { ...newCase("c1", T0), records: [record({ record_id: "a" })] };

  it("names the file on the record and logs it, without making a record", () => {
    const next = attachPdf(doc, "a", "report.pdf", T1);
    expect(next.records).toHaveLength(1);
    expect(next.records[0].source_filename).toBe("report.pdf");
    expect(next.records[0].body).toBe(doc.records[0].body);
    expect(next.log[0]).toMatchObject({ kind: "record_replaced", at: T1 });
    expect(next.log[0].text).toBe("Attached report.pdf to a (tid).");
  });

  it("says so when it replaces an earlier attachment", () => {
    const first = attachPdf(doc, "a", "old.pdf", T1);
    const second = attachPdf(first, "a", "new.pdf", T2);
    expect(second.records[0].source_filename).toBe("new.pdf");
    expect(second.log[1].text).toContain("old.pdf is now new.pdf");
  });

  it("does nothing for a record that is not in the case, or the same file twice", () => {
    expect(attachPdf(doc, "missing", "r.pdf", T1)).toBe(doc);
    const once = attachPdf(doc, "a", "r.pdf", T1);
    expect(attachPdf(once, "a", "r.pdf", T2)).toBe(once);
  });
});

describe("looksLikePdf", () => {
  it("checks the magic bytes, not the name", () => {
    expect(looksLikePdf(new TextEncoder().encode("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLikePdf(new Uint8Array([]))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false);
  });
});

describe("the chip selector", () => {
  const orin = record({
    record_id: "c1",
    record_type: "chip-identity",
    part_number: "AGX Orin",
    body: JSON.stringify({ chip_id: "jetson_agx_orin", node: "8 nm" }),
  });
  const tpu = record({ record_id: "c2", record_type: "chip-identity", part_number: "TPU v6", body: "node,die\n4nm,600" });
  const doc = { ...newCase("c1", T0), records: [orin, tpu, record({ record_id: "t1" })] };

  it("uses the body's chip_id, then the part number", () => {
    expect(chipIdFor(orin)).toBe("jetson_agx_orin");
    expect(chipIdFor(tpu)).toBe("TPU v6");
    expect(chipIdFor(record({ body: '{"chip_id": ""}' }))).toBe("AGX");
    expect(chipIdFor(record({ body: "[1,2]" }))).toBe("AGX");
  });

  it("checks and unchecks a chip", () => {
    const on = toggleChip(doc, "jetson_agx_orin", T1);
    expect(on.chipIds).toEqual(["jetson_agx_orin"]);
    expect(on.updatedAt).toBe(T1);
    const both = toggleChip(on, "TPU v6", T2);
    expect(both.chipIds).toEqual(["jetson_agx_orin", "TPU v6"]);
    expect(toggleChip(both, "jetson_agx_orin", T2).chipIds).toEqual(["TPU v6"]);
  });

  it("ignores an id that is not on a chip-identity row", () => {
    expect(toggleChip(doc, "t1", T1)).toBe(doc);
    expect(toggleChip(doc, "nope", T1)).toBe(doc);
  });

  it("lets a chip whose row was replaced be unchecked", () => {
    const stale = { ...doc, chipIds: ["gone"] };
    expect(toggleChip(stale, "gone", T1).chipIds).toEqual([]);
  });
});

describe("caseBytes", () => {
  it("counts the bytes the save sends, not the characters", () => {
    const ascii = { ...newCase("c1", T0), name: "abc" };
    const accents = { ...newCase("c1", T0), name: "ééé" };
    expect(caseBytes(accents) - caseBytes(ascii)).toBe(3);
  });
});
