import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDbDraftStore } from "./draft-store";

describe("IndexedDbDraftStore", () => {
  let factory: IDBFactory;
  let store: IndexedDbDraftStore;

  beforeEach(() => {
    factory = new IDBFactory();
    store = new IndexedDbDraftStore(factory);
  });

  it("returns null when there is no draft", async () => {
    expect(await store.get("alice", "c1")).toBeNull();
  });

  it("keeps a draft and replaces it", async () => {
    await store.set("alice", "c1", "first");
    expect(await store.get("alice", "c1")).toBe("first");
    await store.set("alice", "c1", "second");
    expect(await store.get("alice", "c1")).toBe("second");
  });

  it("keeps an empty draft distinct from no draft", async () => {
    await store.set("alice", "c1", "");
    expect(await store.get("alice", "c1")).toBe("");
  });

  it("clears a draft", async () => {
    await store.set("alice", "c1", "text");
    await store.clear("alice", "c1");
    expect(await store.get("alice", "c1")).toBeNull();
  });

  it("clearing a draft that is not there is not an error", async () => {
    await expect(store.clear("alice", "nope")).resolves.toBeUndefined();
  });

  it("survives a reload: a new store on the same database finds it", async () => {
    await store.set("alice", "c1", "typed before the reload");
    await store.close();
    expect(await new IndexedDbDraftStore(factory).get("alice", "c1")).toBe("typed before the reload");
  });

  it("keeps drafts apart by account and by case", async () => {
    await store.set("alice", "c1", "alice c1");
    await store.set("alice", "c2", "alice c2");
    await store.set("bob", "c1", "bob c1");
    expect(await store.get("alice", "c1")).toBe("alice c1");
    expect(await store.get("alice", "c2")).toBe("alice c2");
    expect(await store.get("bob", "c1")).toBe("bob c1");
    expect(await store.get("bob", "c2")).toBeNull();
  });

  it("explains itself when the browser has no IndexedDB", () => {
    expect(() => new IndexedDbDraftStore()).toThrow(/IndexedDB is unavailable/);
  });
});
