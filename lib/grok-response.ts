// Reads a Responses API `output` list. Pure. It finds what Grok submitted, what it said, and what
// it searched, and it believes none of it: the route validates and scores the candidate itself.

export type Submission = { oem: string; accepted: boolean };

export type FunctionCall = { callId: string; name: string; arguments: string };

export type ParsedOutput = {
  /** Every submit_oem call, in order. */
  submissions: Submission[];
  /** The OEM of the last submit_oem the tool accepted, or null. An OEM only in the chat does not count. */
  candidate: string | null;
  /** What Grok wrote in its own words. Never the flight. */
  assistantText: string;
  /** Names of the flight tools called through the server. */
  toolCalls: string[];
  fileSearch: { calls: number; queries: string[]; results: number };
  /** Calls the route must run and answer (function mode). */
  functionCalls: FunctionCall[];
};

type Item = Record<string, unknown>;

const isItem = (value: unknown): value is Item => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** `flight.submit_oem` and `submit_oem` are the same tool. */
export function bareToolName(name: string): string {
  const cut = Math.max(name.lastIndexOf("."), name.lastIndexOf(":"), name.lastIndexOf("/"));
  return cut === -1 ? name : name.slice(cut + 1);
}

/** What a tool result carried, however the server wrapped it: the JSON itself, or content blocks around it. */
export function toolResultObject(output: unknown): Item | null {
  let value: unknown = output;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return null;
      }
      continue;
    }
    if (Array.isArray(value)) {
      const block = value.find((entry) => isItem(entry) && typeof entry.text === "string");
      if (!block) return null;
      value = (block as Item).text;
      continue;
    }
    if (isItem(value)) {
      if (isItem(value.structuredContent)) return value.structuredContent;
      if (Array.isArray(value.content) && !("accepted" in value) && !("valid" in value)) {
        value = value.content;
        continue;
      }
      return value;
    }
    return null;
  }
  return null;
}

export function parseOutput(output: unknown[]): ParsedOutput {
  const parsed: ParsedOutput = {
    submissions: [],
    candidate: null,
    assistantText: "",
    toolCalls: [],
    fileSearch: { calls: 0, queries: [], results: 0 },
    functionCalls: [],
  };
  const said: string[] = [];

  for (const item of output) {
    if (!isItem(item)) continue;

    if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!isItem(part)) continue;
        if (part.type === "output_text") said.push(text(part.text));
        else if (part.type === "refusal") said.push(`Grok declined: ${text(part.refusal)}`);
      }
    } else if (item.type === "file_search_call") {
      parsed.fileSearch.calls += 1;
      if (Array.isArray(item.queries)) parsed.fileSearch.queries.push(...item.queries.filter((q): q is string => typeof q === "string"));
      if (Array.isArray(item.results)) parsed.fileSearch.results += item.results.length;
    } else if (item.type === "function_call") {
      parsed.functionCalls.push({ callId: text(item.call_id), name: bareToolName(text(item.name)), arguments: text(item.arguments) });
    } else if (item.type === "mcp_call") {
      const label = text(item.server_label);
      const name = bareToolName(text(item.name));
      if (label !== "" && label !== "flight") continue;
      parsed.toolCalls.push(name);
      if (name !== "submit_oem") continue;

      let oem: string | null = null;
      try {
        const args: unknown = JSON.parse(text(item.arguments));
        if (isItem(args) && typeof args.oem === "string") oem = args.oem;
      } catch {
        oem = null;
      }
      if (oem === null) continue;

      // The tool's own answer. A call with an error, or an answer that says it was not accepted, is not a candidate.
      const result = text(item.error) === "" ? toolResultObject(item.output) : null;
      parsed.submissions.push({ oem, accepted: result?.accepted === true });
    }
  }

  parsed.assistantText = said.join("\n").trim();
  const last = [...parsed.submissions].reverse().find((submission) => submission.accepted);
  parsed.candidate = last?.oem ?? null;
  return parsed;
}
