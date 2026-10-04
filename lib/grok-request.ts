// Builds the Responses API request. Pure. This is where holdout stays out: only records whose
// split is exactly "train" are ever put in the request or in a collection, so a record with any
// other split is left out too. Withholding the rows is the guarantee. A line in the prompt is not.

import type { CaseDocument, CaseRecord } from "./case";
import { grokInstructions } from "./grok-instructions";
import { localFunctionTools, mcpTool } from "./grok-tools";

/** How much train-record text goes inline before the case needs a collection. About 15k tokens. */
export const INLINE_BUDGET_CHARS = 60_000;
export const FILE_SEARCH_MAX_RESULTS = 20;
/** Most agentic turns xAI may run for one request. */
export const MAX_TURNS = 16;
export const MAX_INSTRUCTION_CHARS = 4000;

/** Only train rows. Anything that is not exactly "train" is held back, so an unknown split fails closed. */
export function trainRecords(doc: Pick<CaseDocument, "records">): CaseRecord[] {
  return doc.records.filter((record) => record.split === "train");
}

function bodyValue(record: CaseRecord): unknown {
  try {
    return JSON.parse(record.body);
  } catch {
    return record.body;
  }
}

/** One record as the model reads it. */
export function recordForModel(record: CaseRecord) {
  return {
    record_id: record.record_id,
    record_type: record.record_type,
    chip_family: record.chip_family,
    part_number: record.part_number,
    test_or_model: record.test_or_model,
    particle_or_stress: record.particle_or_stress,
    value_status: record.value_status,
    source_url: record.source_url,
    body: bodyValue(record),
  };
}

export function renderTrainRecords(records: CaseRecord[]): string {
  return JSON.stringify(records.map(recordForModel), null, 1);
}

export type Retrieval =
  | { kind: "inline"; records: CaseRecord[]; text: string }
  | { kind: "collection"; records: CaseRecord[]; collectionId: string };

export type GrokRequestInput = {
  model: string;
  caseId: string;
  instruction: string;
  /** The person's working copy, when there is one. */
  workingOem: string | null;
  retrieval: Retrieval;
  flight: { mcpUrl: string; token: string | null } | null;
};

export function userMessage({ instruction, workingOem, retrieval }: Pick<GrokRequestInput, "instruction" | "workingOem" | "retrieval">): string {
  const parts = [`Request from the editor:\n${instruction.trim()}`];
  parts.push(
    workingOem !== null && workingOem.trim() !== ""
      ? `The editor's working OEM, as it stands now:\n\n${workingOem.trim()}`
      : "The editor has no working OEM yet. Write one.",
  );
  parts.push(
    retrieval.kind === "inline"
      ? `This case's train records (${retrieval.records.length}). Read them before writing a trajectory:\n\n${retrieval.text}`
      : `This case's ${retrieval.records.length} train records are in the collection you can search with file_search. Search it before writing a trajectory.`,
  );
  return parts.join("\n\n");
}

/** The body of POST /v1/responses. */
export function buildRequest(input: GrokRequestInput) {
  const tools: unknown[] = [];
  if (input.retrieval.kind === "collection") {
    tools.push({ type: "file_search", vector_store_ids: [input.retrieval.collectionId], max_num_results: FILE_SEARCH_MAX_RESULTS });
  }
  if (input.flight) tools.push(mcpTool(input.flight.mcpUrl, input.flight.token));
  else tools.push(...localFunctionTools());

  return {
    model: input.model,
    input: [
      { role: "system", content: grokInstructions(input.caseId) },
      { role: "user", content: userMessage(input) },
    ],
    tools,
    max_turns: MAX_TURNS,
    // Nothing about this request is kept on xAI's side for later retrieval.
    store: false,
  };
}
