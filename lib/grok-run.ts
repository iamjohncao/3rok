// One Grok request, from the case to what Grok submitted. Server only. Grok reads the case's train
// records and proposes an OEM through submit_oem. This file does not decide whether that file is
// kept: lib/grok-revision.ts and lib/holdout.ts do.

import type { CaseDocument } from "./case";
import { grokInstructions } from "./grok-instructions";
import { parseOutput } from "./grok-response";
import {
  INLINE_BUDGET_CHARS,
  buildRequest,
  renderTrainRecords,
  trainRecords,
  type Retrieval,
} from "./grok-request";
import { runLocalTool } from "./grok-tools";
import type { FlightEnv } from "./flight-client";
import { createCaseCollection, deleteCollection } from "./xai-collections";
import { XaiError, createResponse, type FetchLike, type XaiEnv } from "./xai";

export type RetrievalTrace =
  | { kind: "inline"; records: number; collectionFailed: string | null }
  | { kind: "collection"; records: number; collectionId: string };

export type GrokTrace = {
  model: string;
  /** `mcp`: xAI calls the flight server. `function`: the app runs validate_oem and submit_oem itself. */
  mode: "mcp" | "function";
  retrieval: RetrievalTrace;
  systemInstructions: string;
  usedWorkingOem: boolean;
  /** The last OEM submit_oem accepted. Null when Grok submitted none. */
  candidate: string | null;
  submissions: number;
  assistantText: string;
  toolCalls: string[];
  fileSearchQueries: string[];
  requests: number;
  /** Why xAI stopped early, or null. */
  incomplete: string | null;
};

/** The case cannot be sent as it is. The person can fix it. Nothing was spent. */
export class GrokSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrokSetupError";
  }
}

/**
 * Why this case cannot be sent as it is, or null. Checked before the account's budget is spent, so a case
 * that cannot be sent costs nothing.
 */
export function checkSetup(doc: Pick<CaseDocument, "records">, env: Pick<XaiEnv, "managementKey">): string | null {
  const train = trainRecords(doc);
  if (train.length === 0) {
    return "This case has no train records, so there is nothing for Grok to read. Add records in the Data region first.";
  }
  const size = renderTrainRecords(train).length;
  if (size > INLINE_BUDGET_CHARS && !env.managementKey) {
    return `This case's train records are ${Math.round(size / 1000)} KB, more than the ${Math.round(INLINE_BUDGET_CHARS / 1000)} KB that fit in one request. Grok searches a collection for a case this size, and this deployment has no XAI_MANAGEMENT_API_KEY to build one.`;
  }
  return null;
}

/** Rounds of function calls the app will answer before it stops. */
export const MAX_FUNCTION_ROUNDS = 8;

type Deps = { env: XaiEnv; flight: FlightEnv | null; fetch?: FetchLike; signal?: AbortSignal };

export async function runGrok({
  doc,
  instruction,
  deps,
}: {
  doc: Pick<CaseDocument, "id" | "records" | "workingOem">;
  instruction: string;
  deps: Deps;
}): Promise<GrokTrace> {
  const { env, flight, signal } = deps;
  const fetchImpl = deps.fetch ?? fetch;

  const setup = checkSetup(doc, env);
  if (setup !== null) throw new GrokSetupError(setup);
  const train = trainRecords(doc);
  const inlineText = renderTrainRecords(train);
  const fits = inlineText.length <= INLINE_BUDGET_CHARS;

  let retrieval: Retrieval = { kind: "inline", records: train, text: inlineText };
  let retrievalTrace: RetrievalTrace = { kind: "inline", records: train.length, collectionFailed: null };
  let collectionId: string | null = null;

  if (env.managementKey) {
    try {
      const created = await createCaseCollection({ caseId: doc.id, records: train, env }, { fetch: fetchImpl, signal });
      collectionId = created.collectionId;
      retrieval = { kind: "collection", records: train, collectionId };
      retrievalTrace = { kind: "collection", records: train.length, collectionId };
    } catch (error) {
      // A case that fits is sent inline instead, and the log says the collection failed.
      if (!(error instanceof XaiError) || !fits) throw error;
      retrievalTrace = { kind: "inline", records: train.length, collectionFailed: error.message };
    }
  }

  const request = buildRequest({
    model: env.model,
    caseId: doc.id,
    instruction,
    workingOem: doc.workingOem,
    retrieval,
    flight,
  });

  const trace: GrokTrace = {
    model: env.model,
    mode: flight ? "mcp" : "function",
    retrieval: retrievalTrace,
    systemInstructions: grokInstructions(doc.id),
    usedWorkingOem: doc.workingOem !== null && doc.workingOem.trim() !== "",
    candidate: null,
    submissions: 0,
    assistantText: "",
    toolCalls: [],
    fileSearchQueries: [],
    requests: 0,
    incomplete: null,
  };

  try {
    if (flight) {
      // xAI runs the loop itself and calls the flight server. One request.
      const result = await createResponse(request, env, { fetch: fetchImpl, signal });
      const parsed = parseOutput(result.output);
      trace.requests = 1;
      trace.candidate = parsed.candidate;
      trace.submissions = parsed.submissions.length;
      trace.assistantText = parsed.assistantText;
      trace.toolCalls = parsed.toolCalls;
      trace.fileSearchQueries = parsed.fileSearch.queries;
      trace.incomplete = result.incomplete;
    } else {
      // No flight server: Grok's function calls come back to the app, which runs the same checks and answers them.
      let input = request.input as unknown[];
      for (let round = 1; round <= MAX_FUNCTION_ROUNDS; round++) {
        const result = await createResponse({ ...request, input }, env, { fetch: fetchImpl, signal });
        trace.requests += 1;
        const parsed = parseOutput(result.output);
        if (parsed.assistantText !== "") trace.assistantText = parsed.assistantText;
        trace.fileSearchQueries.push(...parsed.fileSearch.queries);
        trace.incomplete = result.incomplete;
        if (parsed.functionCalls.length === 0) break;

        const answers = parsed.functionCalls.map((call) => {
          const ran = runLocalTool(call.name, call.arguments);
          trace.toolCalls.push(call.name);
          if (call.name === "submit_oem") {
            trace.submissions += 1;
            if (ran.accepted !== null) trace.candidate = ran.accepted;
          }
          return { type: "function_call_output", call_id: call.callId, output: ran.output };
        });
        input = [...input, ...result.output, ...answers];
        if (round === MAX_FUNCTION_ROUNDS) trace.incomplete = "the app's limit on tool rounds";
      }
    }
  } finally {
    if (collectionId !== null) await deleteCollection(collectionId, env, { fetch: fetchImpl });
  }
  return trace;
}
