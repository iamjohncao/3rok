// Test support: a stand-in for api.x.ai and management-api.x.ai. It answers /responses from a script,
// keeps collections in memory, and records every request so a test can read what was sent.
// Not imported by the app.

import type { XaiEnv } from "../xai";

export const TEST_ENV: XaiEnv = {
  apiKey: "xai-test-key-1234567890",
  managementKey: "xai-mgmt-key-0987654321",
  model: "grok-test",
  apiBase: "https://xai.test/v1",
  managementBase: "https://mgmt.test/v1",
};

export type Recorded = { method: string; url: string; headers: Record<string, string>; body: unknown };

export type ResponsesScript = (body: Record<string, any>, round: number) => { output: unknown[]; status?: string; incomplete_details?: unknown } | Response;

export type FakeXai = {
  fetch: typeof fetch;
  requests: Recorded[];
  collections: Map<string, { documents: { name: string; content: string; fields: Record<string, string> }[]; deleted: boolean }>;
  /** Make the next calls of a kind fail. */
  failNext: Record<string, number>;
};

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => (out[key] = value));
  return out;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function fakeXai(script: ResponsesScript, options: { searchReadyAfter?: number } = {}): FakeXai {
  const requests: Recorded[] = [];
  const collections: FakeXai["collections"] = new Map();
  const failNext: Record<string, number> = {};
  let responseRound = 0;
  let searches = 0;
  let nextCollection = 1;

  const fail = (kind: string): Response | null => {
    if ((failNext[kind] ?? 0) > 0) {
      failNext[kind] -= 1;
      return json({ error: { message: `${kind} failed on purpose` } }, 500);
    }
    return null;
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headersOf(init);
    let body: unknown = null;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) {
      const form: Record<string, unknown> = {};
      for (const [key, value] of init.body.entries()) form[key] = value instanceof Blob ? await value.text() : value;
      body = form;
    }
    requests.push({ method, url, headers, body });

    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");

    if (url === `${TEST_ENV.apiBase}/responses` && method === "POST") {
      const failure = fail("responses");
      if (failure) return failure;
      responseRound += 1;
      const result = script(body as Record<string, any>, responseRound);
      if (result instanceof Response) return result;
      return json({ id: `resp_${responseRound}`, object: "response", status: "completed", ...result });
    }

    if (url === `${TEST_ENV.managementBase}/collections` && method === "POST") {
      const failure = fail("create");
      if (failure) return failure;
      const id = `collection_test-${nextCollection++}`;
      collections.set(id, { documents: [], deleted: false });
      return json({ collection_id: id, collection_name: (body as { collection_name: string }).collection_name });
    }

    const docs = url.match(/^https:\/\/mgmt\.test\/v1\/collections\/([^/]+)\/documents$/);
    if (docs && method === "POST") {
      const failure = fail("upload");
      if (failure) return failure;
      const collection = collections.get(decodeURIComponent(docs[1]));
      if (!collection) return json({ error: "no such collection" }, 404);
      const form = body as Record<string, string>;
      collection.documents.push({ name: form.name, content: form.data, fields: JSON.parse(form.fields) });
      return json({ file_id: `file_${collection.documents.length}` });
    }

    const one = url.match(/^https:\/\/mgmt\.test\/v1\/collections\/([^/]+)$/);
    if (one && method === "DELETE") {
      const collection = collections.get(decodeURIComponent(one[1]));
      if (collection) collection.deleted = true;
      return json({});
    }

    if (url === `${TEST_ENV.apiBase}/documents/search` && method === "POST") {
      const failure = fail("search");
      if (failure) return failure;
      searches += 1;
      const ids = (body as { source: { collection_ids: string[] } }).source.collection_ids;
      const ready = searches > (options.searchReadyAfter ?? 0);
      const matches = ready
        ? ids.flatMap((id) => (collections.get(id)?.documents ?? []).map((doc, index) => ({ file_id: `file_${index}`, chunk_id: `c${index}`, chunk_content: doc.content, score: 1, collection_ids: [id], fields: doc.fields })))
        : [];
      return json({ matches });
    }

    return json({ error: `unexpected ${method} ${url}` }, 404);
  };

  return { fetch: handler as typeof fetch, requests, collections, failNext };
}

/** An output item list for a Grok turn that submits an OEM through the flight server. */
export function mcpSubmit(oem: string, options: { accepted?: boolean; wrapped?: boolean; name?: string; error?: string } = {}) {
  const result = { valid: options.accepted !== false, errors: [], accepted: options.accepted !== false, held: true };
  const output = options.wrapped ? JSON.stringify([{ type: "text", text: JSON.stringify(result) }]) : JSON.stringify(result);
  return {
    type: "mcp_call",
    id: "mcp_1",
    name: options.name ?? "submit_oem",
    server_label: "flight",
    arguments: JSON.stringify({ oem }),
    output,
    ...(options.error ? { error: options.error } : {}),
    status: "completed",
  };
}

export function assistantMessage(text: string) {
  return { type: "message", role: "assistant", id: "msg_1", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
}

export function functionCall(name: string, args: unknown, callId = "call_1") {
  return { type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" };
}
