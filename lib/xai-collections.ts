// A collection of one case's train records, built for one Grok request and deleted after it.
// xAI Collections store files and serve search to the file_search tool. They do not train a model.
// Nothing about the collection is saved in the case: it exists only while the request runs, so
// there is no stale copy of a case's records at xAI, and no collection id in the case contract.
//
// Collections are managed with a separate management key (XAI_MANAGEMENT_API_KEY, permission
// AddFileToCollection and the Collections endpoint group). Searching uses the normal key.

import type { CaseRecord } from "./case";
import { recordForModel } from "./grok-request";
import { XaiError, describeHttpError, scrub, type FetchLike, type XaiEnv } from "./xai";

/** The metadata fields the guidelines name: the id is unique, and the type and chip fields are injected into every chunk. */
export const COLLECTION_FIELD_DEFINITIONS = [
  { key: "record_id", required: true, unique: true },
  { key: "record_type", required: true, inject_into_chunk: true },
  { key: "chip_family", inject_into_chunk: true },
  { key: "part_number", inject_into_chunk: true },
  { key: "value_status", inject_into_chunk: true },
];

export type CaseCollection = { collectionId: string; documentCount: number };

type Options = {
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Milliseconds between readiness checks, and how long to wait for them. */
  pollMs?: number;
  readyTimeoutMs?: number;
};

const UPLOAD_CONCURRENCY = 4;

function managementHeaders(env: XaiEnv): Record<string, string> {
  return { Authorization: `Bearer ${env.managementKey ?? ""}` };
}

async function failFrom(response: Response, env: XaiEnv, what: string): Promise<never> {
  const body = await response.text().catch(() => "");
  throw new XaiError("http", `${what}. ${describeHttpError(response.status, body, env)}`, response.status);
}

function idFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  for (const key of ["collection_id", "id", "collectionId"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

export async function deleteCollection(collectionId: string, env: XaiEnv, { fetch: fetchImpl = fetch }: Pick<Options, "fetch"> = {}): Promise<void> {
  try {
    await fetchImpl(`${env.managementBase}/collections/${encodeURIComponent(collectionId)}`, { method: "DELETE", headers: managementHeaders(env) });
  } catch {
    // Best effort. A collection left behind holds only train records the person already has.
  }
}

/** Creates the collection, uploads every record, and waits until search can see them all. */
export async function createCaseCollection(
  { caseId, records, env }: { caseId: string; records: CaseRecord[]; env: XaiEnv },
  { fetch: fetchImpl = fetch, signal, pollMs = 1500, readyTimeoutMs = 45_000 }: Options = {},
): Promise<CaseCollection> {
  if (!env.managementKey) throw new XaiError("http", "A management key is needed to build a collection.");
  if (records.length === 0) throw new XaiError("shape", "There are no train records to put in a collection.");

  let created: Response;
  try {
    created = await fetchImpl(`${env.managementBase}/collections`, {
      method: "POST",
      headers: { ...managementHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify({ collection_name: `3rok-case-${caseId}-${Date.now()}`, field_definitions: COLLECTION_FIELD_DEFINITIONS }),
      signal,
    });
  } catch (error) {
    throw new XaiError("network", `The collection could not be created: ${scrub(error instanceof Error ? error.message : "network error", [env.apiKey, env.managementKey])}`);
  }
  if (!created.ok) await failFrom(created, env, "The collection could not be created");
  const collectionId = idFrom(await created.json().catch(() => null));
  if (collectionId === null) throw new XaiError("shape", "xAI created a collection but gave no id for it.");

  try {
    // Upload with a few at a time.
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= records.length) return;
        const record = records[index];
        const content = JSON.stringify(recordForModel(record), null, 1);
        const form = new FormData();
        form.append("name", `${String(index + 1).padStart(4, "0")}-${record.record_id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80)}.json`);
        form.append("data", new Blob([content], { type: "text/plain" }), "record.json");
        form.append("content_type", "text/plain");
        form.append(
          "fields",
          JSON.stringify({
            record_id: record.record_id,
            record_type: record.record_type,
            chip_family: record.chip_family,
            part_number: record.part_number,
            value_status: record.value_status,
          }),
        );
        const uploaded = await fetchImpl(`${env.managementBase}/collections/${encodeURIComponent(collectionId)}/documents`, {
          method: "POST",
          headers: managementHeaders(env),
          body: form,
          signal,
        });
        if (!uploaded.ok) await failFrom(uploaded, env, `The record ${record.record_id} could not be added to the collection`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, records.length) }, worker));

    await waitUntilSearchable(collectionId, records, env, { fetch: fetchImpl, signal, pollMs, readyTimeoutMs });
    return { collectionId, documentCount: records.length };
  } catch (error) {
    await deleteCollection(collectionId, env, { fetch: fetchImpl });
    if (error instanceof XaiError) throw error;
    if (signal?.aborted) throw new XaiError("timeout", "Grok did not finish before the time limit.");
    throw new XaiError("network", `The collection could not be filled: ${scrub(error instanceof Error ? error.message : "network error", [env.apiKey, env.managementKey])}`);
  }
}

/** Search sees a document a little after it is uploaded. Wait until every record is findable, or give up. */
async function waitUntilSearchable(
  collectionId: string,
  records: CaseRecord[],
  env: XaiEnv,
  { fetch: fetchImpl = fetch, signal, pollMs = 1500, readyTimeoutMs = 45_000 }: Options,
): Promise<void> {
  const wanted = new Set(records.map((record) => record.record_id));
  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    const response = await fetchImpl(`${env.apiBase}/documents/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify({ query: "train record", source: { collection_ids: [collectionId] }, limit: Math.min(100, Math.max(10, records.length * 2)) }),
      signal,
    });
    if (!response.ok) await failFrom(response, env, "The collection could not be searched");
    const body = (await response.json().catch(() => null)) as { matches?: { fields?: Record<string, unknown> }[] } | null;
    const seen = new Set<string>();
    for (const match of body?.matches ?? []) {
      const id = match.fields?.record_id;
      if (typeof id === "string") seen.add(id);
    }
    if ([...wanted].every((id) => seen.has(id))) return;
    if (Date.now() >= deadline) throw new XaiError("timeout", "The case's collection was not ready to search in time.");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
