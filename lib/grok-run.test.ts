import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaseRecord } from "./case";
import { grokInstructions } from "./grok-instructions";
import { INLINE_BUDGET_CHARS } from "./grok-request";
import { GrokSetupError, MAX_FUNCTION_ROUNDS, runGrok } from "./grok-run";
import { ingestText } from "./ingest";
import { sunSynchronousInclinationDeg } from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";
import { TEST_ENV, assistantMessage, fakeXai, functionCall, mcpSubmit } from "./test-support/fake-xai";
import { XaiError } from "./xai";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const RECORDS: CaseRecord[] = ingested.records;
const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const OEM = circularOemText({ altitudeKm: 650, inclinationDeg: sunSynchronousInclinationDeg(650) });

const doc = (over: Partial<{ records: CaseRecord[]; workingOem: string | null }> = {}) => ({ id: CASE_ID, records: RECORDS, workingOem: null, ...over });
const NO_MGMT = { ...TEST_ENV, managementKey: null };
const FLIGHT = { mcpUrl: "https://flight.example/mcp", scoreUrl: "https://flight.example/score", token: "tok-123456" };
const fast = { pollMs: 1 };

describe("with a flight server", () => {
  it("is one request. xAI calls the server, and the candidate is the file submit_oem accepted", async () => {
    const xai = fakeXai(() => ({ output: [mcpSubmit(OEM), assistantMessage("Submitted a dawn-dusk orbit.")] }));
    const trace = await runGrok({ doc: doc(), instruction: "Choose an orbit.", deps: { env: NO_MGMT, flight: FLIGHT, fetch: xai.fetch } });

    expect(xai.requests).toHaveLength(1);
    expect(trace).toMatchObject({ mode: "mcp", candidate: OEM, submissions: 1, requests: 1, incomplete: null, model: "grok-test", assistantText: "Submitted a dawn-dusk orbit.", toolCalls: ["submit_oem"] });
    const sent = xai.requests[0].body as any;
    expect(sent.tools.find((t: any) => t.type === "mcp")).toMatchObject({ server_url: FLIGHT.mcpUrl, authorization: "tok-123456" });
    expect(sent.input[0].content).toBe(grokInstructions(CASE_ID));
    expect(trace.systemInstructions).toBe(grokInstructions(CASE_ID));
    expect(xai.requests[0].headers.authorization).toBe(`Bearer ${TEST_ENV.apiKey}`);
  });

  it("has no candidate when Grok only writes the file in the chat", async () => {
    const xai = fakeXai(() => ({ output: [assistantMessage(`Here is the file:\n${OEM}`)] }));
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: FLIGHT, fetch: xai.fetch } });
    expect(trace.candidate).toBeNull();
    expect(trace.submissions).toBe(0);
  });

  it("sends the working copy when there is one, and says so", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    await runGrok({ doc: doc({ workingOem: "CCSDS_OEM_VERS = 3.0\nMY-WORKING-COPY\n" }), instruction: "go", deps: { env: NO_MGMT, flight: FLIGHT, fetch: xai.fetch } });
    expect(JSON.stringify(xai.requests[0].body)).toContain("MY-WORKING-COPY");
  });

  it("reports why xAI stopped early", async () => {
    const xai = fakeXai(() => ({ output: [], status: "incomplete", incomplete_details: { reason: "max_turns" } }));
    expect((await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: FLIGHT, fetch: xai.fetch } })).incomplete).toBe("max_turns");
  });
});

describe("without a flight server", () => {
  it("answers Grok's function calls in the app, round by round, and keeps the file submit_oem accepted", async () => {
    const badOem = OEM.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000");
    const xai = fakeXai((_body, round) => {
      if (round === 1) return { output: [functionCall("validate_oem", { oem: badOem }, "c1")] };
      if (round === 2) return { output: [functionCall("submit_oem", { oem: OEM }, "c2")] };
      return { output: [assistantMessage("Done.")] };
    });
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: null, fetch: xai.fetch } });

    expect(trace).toMatchObject({ mode: "function", candidate: OEM, submissions: 1, requests: 3, assistantText: "Done.", toolCalls: ["validate_oem", "submit_oem"] });
    // Round 2 carries the validation answer for call c1, and says why the draft failed.
    const second = (xai.requests[1].body as any).input as any[];
    const answer = second.find((item) => item.type === "function_call_output" && item.call_id === "c1");
    expect(JSON.parse(answer.output).errors[0]).toContain("REF_FRAME must be GCRF");
    // Round 3 carries everything so far, and no request asks xAI to remember anything.
    expect(((xai.requests[2].body as any).input as any[]).filter((item) => item.type === "function_call_output")).toHaveLength(2);
    for (const request of xai.requests) expect((request.body as any).store).toBe(false);
  });

  it("has no candidate when Grok never calls submit_oem, even if it validated a good file", async () => {
    const xai = fakeXai((_body, round) => (round === 1 ? { output: [functionCall("validate_oem", { oem: OEM })] } : { output: [assistantMessage(OEM)] }));
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: null, fetch: xai.fetch } });
    expect(trace.candidate).toBeNull();
    expect(trace.submissions).toBe(0);
  });

  it("keeps the last accepted file when a later submit is refused", async () => {
    const bad = OEM.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000");
    const xai = fakeXai((_body, round) =>
      round === 1 ? { output: [functionCall("submit_oem", { oem: OEM }, "a")] } : round === 2 ? { output: [functionCall("submit_oem", { oem: bad }, "b")] } : { output: [assistantMessage("ok")] },
    );
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: null, fetch: xai.fetch } });
    expect(trace).toMatchObject({ candidate: OEM, submissions: 2 });
  });

  it("stops after a fixed number of rounds and says so", async () => {
    const xai = fakeXai(() => ({ output: [functionCall("validate_oem", { oem: "x" })] }));
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: null, fetch: xai.fetch } });
    expect(trace.requests).toBe(MAX_FUNCTION_ROUNDS);
    expect(trace.incomplete).toBe("the app's limit on tool rounds");
  });

  it("answers a call to a tool it does not run with an error, not a score", async () => {
    const xai = fakeXai((_body, round) => (round === 1 ? { output: [functionCall("score_candidate", {}, "s1")] } : { output: [assistantMessage("ok")] }));
    await runGrok({ doc: doc(), instruction: "go", deps: { env: NO_MGMT, flight: null, fetch: xai.fetch } });
    const answer = ((xai.requests[1].body as any).input as any[]).find((i) => i.type === "function_call_output" && i.call_id === "s1");
    expect(JSON.parse(answer.output).error).toBe("Unknown tool score_candidate.");
  });
});

describe("what the case must hold", () => {
  it("refuses a case with no train records before any request is made", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    const onlyHoldout = RECORDS.filter((r) => r.split === "holdout");
    await expect(runGrok({ doc: doc({ records: onlyHoldout }), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } })).rejects.toBeInstanceOf(GrokSetupError);
    expect(xai.requests).toHaveLength(0);
  });

  const big: CaseRecord[] = Array.from({ length: 400 }, (_, i) => ({
    ...RECORDS[2],
    record_id: `big-${i}`,
    body: JSON.stringify({ note: "x".repeat(400), i }),
  }));

  it("refuses a case too large to send inline when there is no management key to build a collection", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    const error = (await runGrok({ doc: doc({ records: big }), instruction: "go", deps: { env: NO_MGMT, flight: FLIGHT, fetch: xai.fetch } }).catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(GrokSetupError);
    expect(error.message).toContain("XAI_MANAGEMENT_API_KEY");
    expect(xai.requests).toHaveLength(0);
    expect(JSON.stringify(big.map((r) => r.body)).length).toBeGreaterThan(INLINE_BUDGET_CHARS);
  });
});

describe("with a collection", () => {
  it("builds it from the train rows only, searches it, and deletes it after", async () => {
    const xai = fakeXai(() => ({ output: [mcpSubmit(OEM)] }));
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } });

    const [[id, collection]] = [...xai.collections.entries()];
    expect(trace.retrieval).toEqual({ kind: "collection", records: RECORDS.length - 2, collectionId: id });
    expect(collection.documents).toHaveLength(RECORDS.length - 2);
    expect(JSON.stringify(collection.documents)).not.toContain("outcome-synthetic");
    expect(collection.deleted).toBe(true);

    const sent = xai.requests.find((r) => r.url.endsWith("/responses"))!.body as any;
    expect(sent.tools[0]).toEqual({ type: "file_search", vector_store_ids: [id], max_num_results: 20 });
    expect(JSON.stringify(sent)).not.toContain("tid-agx-co60");
  });

  it("deletes the collection even when the request to Grok fails", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    xai.failNext.responses = 1;
    await expect(runGrok({ doc: doc(), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } })).rejects.toBeInstanceOf(XaiError);
    expect([...xai.collections.values()].every((c) => c.deleted)).toBe(true);
  });

  it("sends the records inline when the collection cannot be built and they fit, and records why", async () => {
    const xai = fakeXai(() => ({ output: [] }));
    xai.failNext.create = 1;
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } });
    expect(trace.retrieval).toMatchObject({ kind: "inline", collectionFailed: expect.stringContaining("could not be created") });
    expect(JSON.stringify(xai.requests.at(-1)!.body)).toContain("tid-agx-co60");
  });

  it("fails when the collection cannot be built and the records do not fit inline", async () => {
    const big: CaseRecord[] = Array.from({ length: 400 }, (_, i) => ({ ...RECORDS[2], record_id: `big-${i}`, body: JSON.stringify({ note: "x".repeat(400) }) }));
    const xai = fakeXai(() => ({ output: [] }));
    xai.failNext.create = 1;
    await expect(runGrok({ doc: doc({ records: big }), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } })).rejects.toBeInstanceOf(XaiError);
  });
});

describe("secrets", () => {
  it("never appear in anything the run returns", async () => {
    const xai = fakeXai(() => ({ output: [mcpSubmit(OEM), assistantMessage("done")] }));
    const trace = await runGrok({ doc: doc(), instruction: "go", deps: { env: TEST_ENV, flight: FLIGHT, fetch: xai.fetch } });
    const text = JSON.stringify(trace);
    expect(text).not.toContain(TEST_ENV.apiKey);
    expect(text).not.toContain(TEST_ENV.managementKey!);
    expect(text).not.toContain("tok-123456");
  });
});
