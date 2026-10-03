import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { CaseRecord } from "./case";
import { applyHandEdit, newCase } from "./case-ops";
import { IndexedDbCaseStore, LOCAL_ACCOUNT_ID, summarizeCase } from "./case-store";

const T0 = "2026-10-03T18:00:00.000Z";
const T1 = "2026-10-03T18:10:00.000Z";
const T2 = "2026-10-03T18:20:00.000Z";

function identity(family: string, partNumber = "P1"): CaseRecord {
  return {
    record_id: `id-${partNumber}`,
    record_type: "chip-identity",
    chip_family: family,
    part_number: partNumber,
    test_or_model: "ESCC25100",
    particle_or_stress: null,
    split: "train",
    source_url: "https://example.com",
    value_status: "measured",
    body: "{}",
    source_filename: null,
  };
}

describe("summarizeCase", () => {
  it("reads chip family, flight, score, and last log time from the document", () => {
    const empty = summarizeCase(newCase("c1", T0));
    expect(empty).toEqual({
      id: "c1",
      name: "Untitled case",
      chipFamily: null,
      hasOptimizedOem: false,
      isScored: false,
      lastLogAt: null,
      updatedAt: T0,
    });

    const doc = applyHandEdit(
      {
        ...newCase("c2", T0),
        records: [identity("Jetson Orin", "AGX"), identity("Jetson Orin", "NX"), identity("TPU v6", "T6")],
        optimizedOem: "OEM",
        holdoutError: 0.4,
      },
      "working",
      T1,
    );
    expect(summarizeCase(doc)).toMatchObject({
      chipFamily: "Jetson Orin, TPU v6",
      hasOptimizedOem: true,
      isScored: true,
      lastLogAt: T1,
      updatedAt: T1,
    });
  });

  it("uses only the selected chips' families when chips are selected", () => {
    const doc = {
      ...newCase("c3", T0),
      chipIds: ["T6"],
      records: [identity("Jetson Orin", "AGX"), identity("TPU v6", "T6")],
    };
    expect(summarizeCase(doc).chipFamily).toBe("TPU v6");
  });

  it("does not count rows that are not chip-identity records", () => {
    const doc = { ...newCase("c4", T0), records: [{ ...identity("Jetson Orin"), record_type: "tid" as const }] };
    expect(summarizeCase(doc).chipFamily).toBeNull();
  });
});

describe("IndexedDbCaseStore", () => {
  let factory: IDBFactory;
  let store: IndexedDbCaseStore;

  beforeEach(() => {
    factory = new IDBFactory();
    store = new IndexedDbCaseStore(factory);
  });

  it("saves a case and reads it back whole", async () => {
    const doc = applyHandEdit(newCase("c1", T0), "working copy\n", T1);
    await store.save(LOCAL_ACCOUNT_ID, doc);
    expect(await store.get(LOCAL_ACCOUNT_ID, "c1")).toEqual(doc);
  });

  it("returns null for a case that does not exist", async () => {
    expect(await store.get(LOCAL_ACCOUNT_ID, "nope")).toBeNull();
  });

  it("reopens after a reload: a new store on the same database sees the same case and log", async () => {
    const doc = applyHandEdit(newCase("c1", T0), "kept across reload\n", T1);
    await store.save(LOCAL_ACCOUNT_ID, doc);
    await store.close();

    const reopened = new IndexedDbCaseStore(factory);
    const loaded = await reopened.get(LOCAL_ACCOUNT_ID, "c1");
    expect(loaded?.workingOem).toBe("kept across reload\n");
    expect(loaded?.log).toHaveLength(1);
    expect(loaded?.log[0].kind).toBe("hand_edit");
    expect((await reopened.list(LOCAL_ACCOUNT_ID)).map((row) => row.id)).toEqual(["c1"]);
  });

  it("saving the same id again replaces the case", async () => {
    await store.save(LOCAL_ACCOUNT_ID, newCase("c1", T0));
    await store.save(LOCAL_ACCOUNT_ID, { ...newCase("c1", T1), name: "Renamed" });
    const rows = await store.list(LOCAL_ACCOUNT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Renamed");
  });

  it("lists the most recently updated case first", async () => {
    await store.save(LOCAL_ACCOUNT_ID, { ...newCase("old", T0), name: "Old" });
    await store.save(LOCAL_ACCOUNT_ID, { ...newCase("new", T2), name: "New" });
    await store.save(LOCAL_ACCOUNT_ID, { ...newCase("mid", T1), name: "Mid" });
    expect((await store.list(LOCAL_ACCOUNT_ID)).map((row) => row.name)).toEqual(["New", "Mid", "Old"]);
  });

  it("keeps one account's cases away from another's", async () => {
    await store.save("alice", newCase("c1", T0));
    await store.save("bob", { ...newCase("c2", T1), name: "Bob's" });

    expect((await store.list("alice")).map((row) => row.id)).toEqual(["c1"]);
    expect((await store.list("bob")).map((row) => row.id)).toEqual(["c2"]);
    expect(await store.get("bob", "c1")).toBeNull();
    expect(await store.get("alice", "c2")).toBeNull();
  });

  it("lists nothing for an account with no cases", async () => {
    expect(await store.list("nobody")).toEqual([]);
  });

  it("explains itself when the browser has no IndexedDB", () => {
    expect(() => new IndexedDbCaseStore()).toThrow(/IndexedDB is unavailable/);
  });
});
