import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbAttachmentStore } from "./attachment-store";

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("IndexedDbAttachmentStore", () => {
  let store: IndexedDbAttachmentStore;

  beforeEach(() => {
    store = new IndexedDbAttachmentStore(new IDBFactory());
  });

  it("keeps the bytes under the account, the case, and the record", async () => {
    await store.set("u1", "c1", "r1", "report.pdf", bytes("%PDF-1.7 one"));
    const found = await store.get("u1", "c1", "r1");
    expect(found?.filename).toBe("report.pdf");
    expect(new TextDecoder().decode(found?.bytes)).toBe("%PDF-1.7 one");
  });

  it("does not hand one account's file to another, or one record's to another", async () => {
    await store.set("u1", "c1", "r1", "report.pdf", bytes("%PDF-1.7 one"));
    expect(await store.get("u2", "c1", "r1")).toBeNull();
    expect(await store.get("u1", "c2", "r1")).toBeNull();
    expect(await store.get("u1", "c1", "r2")).toBeNull();
  });

  it("does not confuse ids that join to the same text", async () => {
    await store.set("a/b", "c", "r", "x.pdf", bytes("%PDF-1"));
    expect(await store.get("a", "b/c", "r")).toBeNull();
  });

  it("replaces the file on a second attach", async () => {
    await store.set("u1", "c1", "r1", "old.pdf", bytes("%PDF-1 old"));
    await store.set("u1", "c1", "r1", "new.pdf", bytes("%PDF-1 new"));
    const found = await store.get("u1", "c1", "r1");
    expect(found?.filename).toBe("new.pdf");
    expect(new TextDecoder().decode(found?.bytes)).toBe("%PDF-1 new");
  });
});
