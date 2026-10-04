import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaseRecord } from "./case";
import { trainRecords } from "./grok-request";
import { ingestText } from "./ingest";
import { TEST_ENV, fakeXai } from "./test-support/fake-xai";
import { COLLECTION_FIELD_DEFINITIONS, createCaseCollection, deleteCollection } from "./xai-collections";
import { XaiError } from "./xai";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const TRAIN: CaseRecord[] = trainRecords({ records: ingested.records });
const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const fast = { pollMs: 1, readyTimeoutMs: 500 };

describe("the collection's metadata fields", () => {
  it("make record_id unique and required, and inject the type and the chip fields into every chunk", () => {
    expect(COLLECTION_FIELD_DEFINITIONS).toContainEqual({ key: "record_id", required: true, unique: true });
    for (const key of ["record_type", "chip_family", "part_number"]) {
      expect(COLLECTION_FIELD_DEFINITIONS).toContainEqual(expect.objectContaining({ key, inject_into_chunk: true }));
    }
  });
});

describe("createCaseCollection", () => {
  it("creates the collection with the management key, then adds every record with its fields", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    const made = await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast });
    expect(made.documentCount).toBe(TRAIN.length);

    const create = xai.requests[0];
    expect(create).toMatchObject({ method: "POST", url: "https://mgmt.test/v1/collections" });
    expect(create.headers.authorization).toBe(`Bearer ${TEST_ENV.managementKey}`);
    expect((create.body as any).field_definitions).toEqual(COLLECTION_FIELD_DEFINITIONS);
    expect((create.body as any).collection_name).toContain(CASE_ID);

    const stored = xai.collections.get(made.collectionId)!.documents;
    expect(stored).toHaveLength(TRAIN.length);
    expect(stored.map((d) => d.fields.record_id).sort()).toEqual(TRAIN.map((r) => r.record_id).sort());
    expect(stored[0].fields).toEqual({
      record_id: expect.any(String),
      record_type: expect.any(String),
      chip_family: expect.any(String),
      part_number: expect.any(String),
      value_status: expect.any(String),
    });
    expect(JSON.parse(stored[0].content)).toHaveProperty("body");
  });

  it("uses the management key for the collection and the normal key for search", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast });
    for (const request of xai.requests) {
      const expected = request.url.startsWith(TEST_ENV.managementBase) ? TEST_ENV.managementKey : TEST_ENV.apiKey;
      expect(request.headers.authorization, request.url).toBe(`Bearer ${expected}`);
    }
    expect(xai.requests.some((r) => r.url === "https://xai.test/v1/documents/search")).toBe(true);
  });

  it("never uploads a record it was not given: no holdout row, because the caller passes only train rows", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    const made = await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast });
    const text = xai.collections.get(made.collectionId)!.documents.map((d) => d.content + JSON.stringify(d.fields)).join("");
    expect(text).not.toContain("outcome-synthetic");
    expect(text).not.toContain("holdout");
  });

  it("waits until search can see every record", async () => {
    const xai = fakeXai(() => ({ output: [] }), { searchReadyAfter: 2 });
    await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast });
    expect(xai.requests.filter((r) => r.url.endsWith("/documents/search")).length).toBe(3);
  });

  it("gives up, deletes the collection, and says it was not ready, when search never sees the records", async () => {
    const xai = fakeXai(() => ({ output: [] }), { searchReadyAfter: 10_000 });
    const error = (await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, pollMs: 1, readyTimeoutMs: 30 }).catch((e) => e)) as XaiError;
    expect(error).toBeInstanceOf(XaiError);
    expect(error.kind).toBe("timeout");
    expect([...xai.collections.values()].every((c) => c.deleted)).toBe(true);
  });

  it("deletes the collection when an upload fails, and the error carries no key", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    xai.failNext.upload = 1;
    const error = (await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast }).catch((e) => e)) as XaiError;
    expect(error.message).toContain("could not be added to the collection");
    expect(error.message).not.toContain(TEST_ENV.managementKey!);
    expect([...xai.collections.values()].every((c) => c.deleted)).toBe(true);
  });

  it("says so when the collection cannot be created", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    xai.failNext.create = 1;
    const error = (await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: xai.fetch, ...fast }).catch((e) => e)) as XaiError;
    expect(error.message).toContain("could not be created");
  });

  it("needs a management key and at least one record", async () => {
    await expect(createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: { ...TEST_ENV, managementKey: null } })).rejects.toThrow("management key");
    await expect(createCaseCollection({ caseId: CASE_ID, records: [], env: TEST_ENV })).rejects.toThrow("no train records");
  });

  it("reads the collection id however xAI names it", async () => {
    for (const key of ["id", "collectionId"]) {
      const calls: string[] = [];
      const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(url)}`);
        if (String(url).endsWith("/collections")) return new Response(JSON.stringify({ [key]: "collection_x" }));
        if (String(url).endsWith("/documents")) return new Response("{}");
        return new Response(JSON.stringify({ matches: TRAIN.map((r) => ({ fields: { record_id: r.record_id } })) }));
      }) as typeof fetch;
      const made = await createCaseCollection({ caseId: CASE_ID, records: TRAIN, env: TEST_ENV }, { fetch: fetchImpl, ...fast });
      expect(made.collectionId).toBe("collection_x");
    }
  });
});

describe("deleteCollection", () => {
  it("deletes with the management key, and never throws", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    xai.collections.set("collection_z", { documents: [], deleted: false });
    await deleteCollection("collection_z", TEST_ENV, { fetch: xai.fetch });
    expect(xai.collections.get("collection_z")!.deleted).toBe(true);
    await expect(deleteCollection("collection_z", TEST_ENV, { fetch: (async () => { throw new Error("down"); }) as typeof fetch })).resolves.toBeUndefined();
  });
});
