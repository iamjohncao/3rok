// The flight tools Grok may call. The definitions are flight-mcp's own file, so the app and the
// server cannot drift. With a flight server configured, xAI calls the server itself. Without one,
// the route sends validate_oem and submit_oem as function tools and runs them here, with the same
// profile (lib/oem.ts, kept in step with the server's validator by fixtures/oem-profile-*.json).
// score_candidate has no local version: the physics lives in the server, and a local copy would
// be a second scorer.

import { createHash } from "node:crypto";
import schemas from "../flight-mcp/flight_mcp/tool_schemas.json";
import { validateOem } from "./oem";

export const FLIGHT_SERVER_LABEL = "flight";
export const FLIGHT_TOOL_NAMES = ["validate_oem", "submit_oem", "score_candidate"] as const;
export type FlightToolName = (typeof FLIGHT_TOOL_NAMES)[number];

export type ToolDefinition = { name: string; description: string; inputSchema: Record<string, unknown> };
export const FLIGHT_TOOLS: readonly ToolDefinition[] = schemas.tools as ToolDefinition[];

export const FLIGHT_SERVER_DESCRIPTION =
  "Validates a CCSDS OEM 3.0 trajectory and scores one reduced orbit for chip lifetime. It does not propagate the rocket and it cannot see holdout outcomes.";

/** The `mcp` entry for the Responses API. `allowed_tools` is the whole surface and is never empty. */
export function mcpTool(url: string, token: string | null) {
  return {
    type: "mcp" as const,
    server_url: url,
    server_label: FLIGHT_SERVER_LABEL,
    server_description: FLIGHT_SERVER_DESCRIPTION,
    allowed_tools: [...FLIGHT_TOOL_NAMES],
    ...(token ? { authorization: token } : {}),
  };
}

/** validate_oem and submit_oem as function tools, for a request with no flight server. */
export function localFunctionTools() {
  return FLIGHT_TOOLS.filter((tool) => tool.name !== "score_candidate").map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
}

export type LocalToolResult = {
  /** The JSON the model is given back. */
  output: string;
  /** The OEM text, when submit_oem accepted it. */
  accepted: string | null;
};

/** Runs a function tool the route executes itself. A malformed call is an error the model can fix. */
export function runLocalTool(name: string, rawArguments: string): LocalToolResult {
  const fail = (message: string): LocalToolResult => ({ output: JSON.stringify({ error: message }), accepted: null });

  if (name !== "validate_oem" && name !== "submit_oem") return fail(`Unknown tool ${name}.`);
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return fail("The arguments are not JSON.");
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) return fail("The arguments must be an object.");
  const keys = Object.keys(args);
  const oem = (args as { oem?: unknown }).oem;
  if (typeof oem !== "string") return fail("oem is required and must be the full OEM text.");
  const extra = keys.filter((key) => key !== "oem");
  if (extra.length > 0) return fail(`Unknown field ${extra.join(", ")}. This tool takes only oem.`);

  // A file Grok submits is a file this app writes, so ORIGINATOR must be 3ROK.
  const result = validateOem(oem, { thisAppWrote: true });
  if (name === "validate_oem") return { output: JSON.stringify(result), accepted: null };
  return {
    output: JSON.stringify({
      ...result,
      accepted: result.valid,
      held: result.valid,
      candidate_sha256: result.valid ? createHash("sha256").update(oem, "utf8").digest("hex") : null,
    }),
    accepted: result.valid ? oem : null,
  };
}
