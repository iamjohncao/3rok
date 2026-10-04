import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CaseRecord } from "./case";
import { grokInstructions } from "./grok-instructions";
import {
  FILE_SEARCH_MAX_RESULTS,
  INLINE_BUDGET_CHARS,
  MAX_TURNS,
  buildRequest,
  recordForModel,
  renderTrainRecords,
  trainRecords,
  userMessage,
  type Retrieval,
} from "./grok-request";
import { ingestText } from "./ingest";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const FIXTURE: CaseRecord[] = ingested.records;
const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";

const train = trainRecords({ records: FIXTURE });
const inline = (records: CaseRecord[] = train): Retrieval => ({ kind: "inline", records, text: renderTrainRecords(records) });
const request = (overrides: Partial<Parameters<typeof buildRequest>[0]> = {}) =>
  buildRequest({ model: "grok-4.7", caseId: CASE_ID, instruction: "Choose a dawn-dusk orbit.", workingOem: null, retrieval: inline(), flight: null, ...overrides });

describe("which records can be sent", () => {
  it("only train rows, so the two synthetic holdout outcomes stay out", () => {
    expect(train.map((r) => r.record_id)).not.toContain("outcome-synthetic-failure");
    expect(train.map((r) => r.record_id)).not.toContain("outcome-synthetic-survivor");
    expect(train.every((r) => r.split === "train")).toBe(true);
    expect(train.length).toBe(FIXTURE.length - 2);
  });

  it("fails closed: a row whose split is anything but train is held back", () => {
    const odd = { ...FIXTURE[0], record_id: "odd", split: "validation" as unknown as "train" };
    expect(trainRecords({ records: [odd, ...FIXTURE] }).map((r) => r.record_id)).not.toContain("odd");
  });
});

describe("holdout never reaches the request", () => {
  // Canary text in every field a holdout row has. None of it may appear anywhere in what is sent.
  const canary = (field: string) => `CANARY-${field}-7f3a9c`;
  const holdoutRow: CaseRecord = {
    record_id: canary("id"),
    record_type: "outcome",
    chip_family: canary("family"),
    part_number: canary("part"),
    test_or_model: canary("test"),
    particle_or_stress: canary("stress"),
    split: "holdout",
    source_url: `https://example.com/${canary("url")}`,
    value_status: "assumed",
    body: JSON.stringify({ note: canary("body"), failure_time_years: 0.123456 }),
    source_filename: canary("file"),
  };
  const records = [...FIXTURE, holdoutRow];

  it("in the inline request, the system text, the tools, or the user message", () => {
    const body = JSON.stringify(
      buildRequest({
        model: "m",
        caseId: CASE_ID,
        instruction: "go",
        workingOem: null,
        retrieval: inline(trainRecords({ records })),
        flight: { mcpUrl: "https://flight.example/mcp", token: "tok-123456" },
      }),
    );
    expect(body).not.toContain("CANARY");
    expect(body).not.toContain("0.123456");
  });

  it("in the rendered train records or one record as the model reads it", () => {
    expect(renderTrainRecords(trainRecords({ records }))).not.toContain("CANARY");
    expect(JSON.stringify(recordForModel(train[0]))).not.toContain("holdout");
  });

  it("not by id either: the holdout ids are absent from the text", () => {
    const text = JSON.stringify(request({ retrieval: inline(trainRecords({ records })) }));
    for (const id of ["outcome-synthetic-failure", "outcome-synthetic-survivor"]) expect(text).not.toContain(id);
  });

  it("and the stored score is not sent", () => {
    expect(JSON.stringify(request())).not.toMatch(/holdoutError|holdout_error/);
  });
});

describe("the request", () => {
  it("names the model, sends the instructions as the system text, and keeps nothing at xAI", () => {
    const body = request();
    expect(body.model).toBe("grok-4.7");
    expect(body.store).toBe(false);
    expect(body.max_turns).toBe(MAX_TURNS);
    expect(body.input[0]).toEqual({ role: "system", content: grokInstructions(CASE_ID) });
    expect(body.input[1].role).toBe("user");
  });

  it("puts the editor's request and the working OEM in the user message", () => {
    const message = userMessage({ instruction: "  Prefer low SAA exposure.  ", workingOem: "CCSDS_OEM_VERS = 3.0\nX\n", retrieval: inline() });
    expect(message).toContain("Request from the editor:\nPrefer low SAA exposure.");
    expect(message).toContain("The editor's working OEM, as it stands now:\n\nCCSDS_OEM_VERS = 3.0\nX");
  });

  it("says there is no working OEM when there is none or it is blank", () => {
    expect(userMessage({ instruction: "x", workingOem: null, retrieval: inline() })).toContain("no working OEM yet");
    expect(userMessage({ instruction: "x", workingOem: "  \n", retrieval: inline() })).toContain("no working OEM yet");
  });

  it("inlines the train records when there is no collection, and sends no file_search", () => {
    const body = request();
    expect(body.input[1].content).toContain(`train records (${train.length})`);
    expect(body.input[1].content).toContain("tid-agx-co60");
    expect(body.tools.some((tool: any) => tool.type === "file_search")).toBe(false);
  });

  it("searches only this case's collection when there is one, and does not inline the rows", () => {
    const body = request({ retrieval: { kind: "collection", records: train, collectionId: "collection_abc" } });
    expect(body.tools[0]).toEqual({ type: "file_search", vector_store_ids: ["collection_abc"], max_num_results: FILE_SEARCH_MAX_RESULTS });
    expect(body.tools[0]).toMatchObject({ max_num_results: 20 });
    expect(body.input[1].content).not.toContain("tid-agx-co60");
    expect(body.input[1].content).toContain("file_search");
  });

  it("points at the flight server with the three tools when one is configured, and no function tools", () => {
    const body = request({ flight: { mcpUrl: "https://flight.example/mcp", token: "tok-123456" } });
    const mcp = body.tools.find((tool: any) => tool.type === "mcp") as any;
    expect(mcp).toMatchObject({ server_url: "https://flight.example/mcp", server_label: "flight", authorization: "tok-123456", allowed_tools: ["validate_oem", "submit_oem", "score_candidate"] });
    expect(body.tools.some((tool: any) => tool.type === "function")).toBe(false);
  });

  it("omits the mcp entry when there is no flight server, and sends the two text tools as functions", () => {
    const body = request({ flight: null });
    expect(body.tools.some((tool: any) => tool.type === "mcp")).toBe(false);
    expect(body.tools.filter((tool: any) => tool.type === "function").map((tool: any) => tool.name)).toEqual(["validate_oem", "submit_oem"]);
  });

  it("never asks for a fine-tune, a training run, or a checkpoint", () => {
    expect(JSON.stringify(request())).not.toMatch(/fine.?tun|training|checkpoint|loss curve/i);
  });

  it("has a budget that fits the fixture inline with room to spare", () => {
    expect(renderTrainRecords(train).length).toBeLessThan(INLINE_BUDGET_CHARS);
  });
});
