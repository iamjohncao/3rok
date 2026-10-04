import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FLIGHT_SERVER_LABEL,
  FLIGHT_TOOLS,
  FLIGHT_TOOL_NAMES,
  localFunctionTools,
  mcpTool,
  runLocalTool,
} from "./grok-tools";
import { validateOem } from "./oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const minimal = readFileSync(`${root}fixtures/minimal.oem`, "utf8");
const bad = minimal.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000");

describe("the tool definitions", () => {
  it("are flight-mcp's own file, the three tools in the order the docs give", () => {
    const file = JSON.parse(readFileSync(`${root}flight-mcp/flight_mcp/tool_schemas.json`, "utf8")).tools;
    expect(FLIGHT_TOOLS).toEqual(file);
    expect(FLIGHT_TOOLS.map((tool) => tool.name)).toEqual([...FLIGHT_TOOL_NAMES]);
  });

  it("are closed: nothing extra is accepted", () => {
    for (const tool of FLIGHT_TOOLS) expect(tool.inputSchema.additionalProperties).toBe(false);
  });
});

describe("the mcp entry", () => {
  it("names the flight server, lists the three tools, and is never an empty allow-list", () => {
    const tool = mcpTool("https://flight.example/mcp", null);
    expect(tool).toMatchObject({ type: "mcp", server_url: "https://flight.example/mcp", server_label: FLIGHT_SERVER_LABEL, allowed_tools: ["validate_oem", "submit_oem", "score_candidate"] });
    expect(tool.allowed_tools.length).toBeGreaterThan(0);
    expect("authorization" in tool).toBe(false);
  });

  it("sends the bearer token in the authorization field when there is one", () => {
    expect(mcpTool("https://flight.example/mcp", "tok-123456")).toMatchObject({ authorization: "tok-123456" });
  });

  it("says the server cannot see holdout outcomes", () => {
    expect(mcpTool("https://x.test/mcp", null).server_description).toContain("cannot see holdout outcomes");
  });
});

describe("the function tools used when there is no flight server", () => {
  it("are validate_oem and submit_oem only, never a local score_candidate", () => {
    const tools = localFunctionTools();
    expect(tools.map((tool) => tool.name)).toEqual(["validate_oem", "submit_oem"]);
    for (const tool of tools) expect(tool).toMatchObject({ type: "function", parameters: expect.objectContaining({ additionalProperties: false }) });
  });
});

describe("running a function tool in the app", () => {
  it("validate_oem returns the lib/oem.ts result and accepts nothing", () => {
    const ran = runLocalTool("validate_oem", JSON.stringify({ oem: minimal }));
    expect(JSON.parse(ran.output)).toEqual(validateOem(minimal, { thisAppWrote: true }));
    expect(ran.accepted).toBeNull();
  });

  it("submit_oem accepts a valid file and returns it, with the same fields as the server", () => {
    const ran = runLocalTool("submit_oem", JSON.stringify({ oem: minimal }));
    expect(ran.accepted).toBe(minimal);
    const out = JSON.parse(ran.output);
    expect(out).toMatchObject({ valid: true, accepted: true, held: true, errors: [] });
    expect(out.candidate_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("submit_oem refuses a bad file with sentences, and holds nothing", () => {
    const ran = runLocalTool("submit_oem", JSON.stringify({ oem: bad }));
    expect(ran.accepted).toBeNull();
    const out = JSON.parse(ran.output);
    expect(out).toMatchObject({ valid: false, accepted: false, held: false, candidate_sha256: null });
    expect(out.errors[0]).toContain("REF_FRAME must be GCRF");
  });

  it("requires ORIGINATOR = 3ROK, because a file Grok submits is a file this app writes", () => {
    const other = minimal.replace("ORIGINATOR = 3ROK", "ORIGINATOR = NASA/JPL");
    expect(runLocalTool("submit_oem", JSON.stringify({ oem: other })).accepted).toBeNull();
  });

  it.each([
    ["not json", "{", "not JSON"],
    ["an array", "[1]", "must be an object"],
    ["no oem", "{}", "oem is required"],
    ["a number for oem", JSON.stringify({ oem: 5 }), "oem is required"],
    ["an extra field", JSON.stringify({ oem: minimal, epoch: "x" }), "Unknown field epoch"],
  ])("answers %s with an error the model can fix", (_name, args, message) => {
    const ran = runLocalTool("submit_oem", args);
    expect(ran.accepted).toBeNull();
    expect(JSON.parse(ran.output).error).toContain(message);
  });

  it("has no score_candidate, and says so", () => {
    const ran = runLocalTool("score_candidate", "{}");
    expect(JSON.parse(ran.output).error).toBe("Unknown tool score_candidate.");
  });
});
