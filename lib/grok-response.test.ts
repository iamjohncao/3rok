import { describe, expect, it } from "vitest";
import { bareToolName, parseOutput, toolResultObject } from "./grok-response";
import { assistantMessage, functionCall, mcpSubmit } from "./test-support/fake-xai";

const OEM_A = "CCSDS_OEM_VERS = 3.0\nA";
const OEM_B = "CCSDS_OEM_VERS = 3.0\nB";

describe("bareToolName", () => {
  it("drops the server prefix", () => {
    expect(bareToolName("flight.submit_oem")).toBe("submit_oem");
    expect(bareToolName("flight:submit_oem")).toBe("submit_oem");
    expect(bareToolName("submit_oem")).toBe("submit_oem");
  });
});

describe("toolResultObject", () => {
  const result = { accepted: true };
  it("reads the JSON itself, in text, or inside content blocks, or in structuredContent", () => {
    expect(toolResultObject(JSON.stringify(result))).toEqual(result);
    expect(toolResultObject(JSON.stringify([{ type: "text", text: JSON.stringify(result) }]))).toEqual(result);
    expect(toolResultObject(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(result) }] }))).toEqual(result);
    expect(toolResultObject(JSON.stringify({ content: [], structuredContent: result }))).toEqual(result);
    expect(toolResultObject(result)).toEqual(result);
  });

  it("is null for anything else", () => {
    expect(toolResultObject("not json")).toBeNull();
    expect(toolResultObject(undefined)).toBeNull();
    expect(toolResultObject("[1,2]")).toBeNull();
  });
});

describe("the candidate", () => {
  it("is the OEM of the last submit_oem call the tool accepted", () => {
    const parsed = parseOutput([mcpSubmit(OEM_A), mcpSubmit(OEM_B)]);
    expect(parsed.candidate).toBe(OEM_B);
    expect(parsed.submissions).toEqual([
      { oem: OEM_A, accepted: true },
      { oem: OEM_B, accepted: true },
    ]);
  });

  it("is an earlier accepted file when a later submit was refused, as the server keeps the earlier one", () => {
    expect(parseOutput([mcpSubmit(OEM_A), mcpSubmit(OEM_B, { accepted: false })]).candidate).toBe(OEM_A);
  });

  it("is null when every submit was refused, or the call carried an error", () => {
    expect(parseOutput([mcpSubmit(OEM_A, { accepted: false })]).candidate).toBeNull();
    expect(parseOutput([mcpSubmit(OEM_A, { error: "server down" })]).candidate).toBeNull();
  });

  it("is null when the tool's answer cannot be read, because the app does not take the model's word", () => {
    expect(parseOutput([{ ...mcpSubmit(OEM_A), output: "???" }]).candidate).toBeNull();
  });

  it("is null for an OEM that appears only in the chat", () => {
    const parsed = parseOutput([assistantMessage(`Here is the file:\n\n${OEM_A}`)]);
    expect(parsed.candidate).toBeNull();
    expect(parsed.assistantText).toContain(OEM_A);
  });

  it("reads a prefixed tool name and an answer wrapped in content blocks", () => {
    expect(parseOutput([mcpSubmit(OEM_A, { name: "flight.submit_oem", wrapped: true })]).candidate).toBe(OEM_A);
  });

  it("ignores a call from some other server", () => {
    expect(parseOutput([{ ...mcpSubmit(OEM_A), server_label: "elsewhere" }]).candidate).toBeNull();
  });

  it("does not count validate_oem or score_candidate as a submission", () => {
    const parsed = parseOutput([mcpSubmit(OEM_A, { name: "validate_oem" }), mcpSubmit(OEM_A, { name: "score_candidate" })]);
    expect(parsed.submissions).toEqual([]);
    expect(parsed.toolCalls).toEqual(["validate_oem", "score_candidate"]);
  });

  it("is null when the arguments are not JSON", () => {
    expect(parseOutput([{ ...mcpSubmit(OEM_A), arguments: "{" }]).submissions).toEqual([]);
  });
});

describe("what else the output carries", () => {
  it("joins what the assistant said, and reports a refusal as one", () => {
    const parsed = parseOutput([
      assistantMessage("First."),
      { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
      { type: "message", role: "user", content: [{ type: "output_text", text: "ignored" }] },
    ]);
    expect(parsed.assistantText).toBe("First.\nGrok declined: no");
  });

  it("counts file searches, their queries, and their results", () => {
    const parsed = parseOutput([
      { type: "file_search_call", queries: ["tid", "see"], results: [{ file_id: "f", filename: "x", text: "t" }] },
      { type: "file_search_call", queries: ["outcome"], results: [] },
    ]);
    expect(parsed.fileSearch).toEqual({ calls: 2, queries: ["tid", "see", "outcome"], results: 1 });
  });

  it("returns function calls for the app to answer", () => {
    const parsed = parseOutput([functionCall("flight.validate_oem", { oem: "x" }, "call_9")]);
    expect(parsed.functionCalls).toEqual([{ callId: "call_9", name: "validate_oem", arguments: JSON.stringify({ oem: "x" }) }]);
  });

  it("skips items it does not know and values that are not objects", () => {
    expect(parseOutput([null, 5, "x", { type: "reasoning" }, { type: "web_search_call" }]).submissions).toEqual([]);
  });
});
