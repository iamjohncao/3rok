// What happens after Grok answers. The model does not do any of it. The candidate is the OEM that
// submit_oem accepted, validated again here, scored on the holdout outcomes by lib/holdout.ts, and
// kept only when the error drops. The log records the instruction, the file, the score, and the
// verdict. `optimizedOem` and `holdoutError` change only on a keep. The working copy is never
// touched: it changes when the person edits it.

import type { CaseDocument, LogEntry } from "./case";
import { PhysicsUnavailableError } from "./flight-client";
import { GROK_INSTRUCTIONS_VERSION } from "./grok-instructions";
import type { GrokTrace } from "./grok-run";
import { evaluateCandidate, type HoldoutResult, type ScoreOrbit } from "./holdout";
import { validateOem } from "./oem";

export type Verdict = "kept" | "rejected" | "unscored" | "failed";

export type Revision = { doc: CaseDocument; verdict: Verdict; reason: string };

const SAID_MAX_CHARS = 1500;

function entry(at: string, kind: LogEntry["kind"], text: string, oem: string | null = null, holdoutError: number | null = null): LogEntry {
  return { at, kind, text, oem, holdout_error: holdoutError };
}

const years = (value: number) => `${value.toFixed(3)} years`;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What Grok was given, in the words the person reads. */
export function givenText(trace: GrokTrace): string {
  const records =
    trace.retrieval.kind === "collection"
      ? `this case's ${trace.retrieval.records} train records, searched in the collection ${trace.retrieval.collectionId} (built for this request and deleted after it)`
      : `this case's ${trace.retrieval.records} train records, read inline in the request`;
  const tools =
    trace.mode === "mcp"
      ? "the flight server's tools (validate_oem, submit_oem, score_candidate)"
      : "validate_oem and submit_oem, run by the app, because no flight server is set up";
  return [
    `Model: ${trace.model}.`,
    `Given: ${records}. Holdout records were not sent.`,
    trace.retrieval.kind === "inline" && trace.retrieval.collectionFailed
      ? `The collection could not be built (${trace.retrieval.collectionFailed}), so the records went inline.`
      : null,
    `The working copy was ${trace.usedWorkingOem ? "sent" : "not sent, because there is none"}.`,
    `Tools: ${tools}.`,
    `Instructions sent (version ${GROK_INSTRUCTIONS_VERSION}):\n${trace.systemInstructions}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function said(trace: GrokTrace): string {
  return trace.assistantText === "" ? "" : `\nGrok said:\n${clip(trace.assistantText, SAID_MAX_CHARS)}`;
}

function scoreText(result: HoldoutResult): string {
  const lines = [result.reason];
  if (result.orbit) {
    lines.push(
      `Reduced orbit (derived from the file): ${result.orbit.altitude_km.toFixed(1)} km, inclination ${result.orbit.inclination_deg.toFixed(2)} degrees.`,
    );
  }
  if (result.inputs) {
    const { chip, ltan_hours: ltan, shield_mm_Al: shield } = result.inputs;
    lines.push(
      `Chip ${chip.value} sent as ${chip.sent_as} (record ${chip.record_id}). ltan_hours ${ltan.value} from ${ltan.record_id} (${ltan.value_status}). shield_mm_Al ${shield.value} from ${shield.record_id} (${shield.value_status}).`,
    );
  }
  if (result.predicted_lifetime_years !== null) {
    lines.push(`Predicted lifetime ${years(result.predicted_lifetime_years)} (derived by the physics service).`);
    if (result.assumptions_note) lines.push(result.assumptions_note);
  }
  for (const row of result.rows) {
    lines.push(
      `${row.record_id}: ${row.kind === "failure" ? "failed at" : "still alive at"} ${years(row.observed_years)}, predicted ${years(row.predicted_years)}, error ${years(row.error_years)}.`,
    );
  }
  for (const skipped of result.skipped) lines.push(`Skipped ${skipped.record_id}: ${skipped.reason}`);
  return lines.join("\n");
}

/** The case after a revision. Applies to the freshest copy of the case, so edits made while Grok worked are kept. */
function apply(fresh: CaseDocument, entries: LogEntry[], now: string, kept: { oem: string; error: number } | null): CaseDocument {
  return {
    ...fresh,
    log: [...fresh.log, ...entries],
    optimizedOem: kept ? kept.oem : fresh.optimizedOem,
    holdoutError: kept ? kept.error : fresh.holdoutError,
    updatedAt: now,
  };
}

/** The request never produced a candidate. The log says so, and nothing else in the case changes. */
export function failedRevision({
  doc,
  instruction,
  reason,
  now,
  trace = null,
}: {
  doc: CaseDocument;
  instruction: string;
  reason: string;
  now: string;
  trace?: GrokTrace | null;
}): Revision {
  const text = [reason, trace ? givenText(trace) : null, trace ? said(trace).trim() || null : null].filter(Boolean).join("\n");
  return {
    doc: apply(doc, [entry(now, "instruction", instruction), entry(now, "rejected", text)], now, null),
    verdict: "failed",
    reason,
  };
}

/**
 * Turns a run into a revision of the case. `doc` is the case as it is now, read after Grok finished.
 * `scoreOrbit` is the physics service. A service that cannot be reached leaves the candidate unscored.
 */
export async function reviseCase({
  doc,
  instruction,
  trace,
  now,
  scoreOrbit,
}: {
  doc: CaseDocument;
  instruction: string;
  trace: GrokTrace;
  now: string;
  scoreOrbit: ScoreOrbit;
}): Promise<Revision> {
  const asked = entry(now, "instruction", instruction);

  if (trace.candidate === null) {
    const incomplete = trace.incomplete ? ` Grok stopped early: ${trace.incomplete}.` : "";
    const reason =
      trace.submissions > 0
        ? `Grok called submit_oem ${trace.submissions} time${trace.submissions === 1 ? "" : "s"}, but the tool did not accept any file, so there is no candidate.${incomplete}`
        : `Grok did not submit an OEM through submit_oem, so there is no candidate. An OEM that appears only in the chat is ignored.${incomplete}`;
    return failedRevision({ doc, instruction, reason, now, trace });
  }

  const candidate = trace.candidate;

  // The model said the tool accepted it. The check is this one: the same profile, run again here.
  const summary = validateOem(candidate, { thisAppWrote: true });
  const header = summary.valid
    ? `Grok proposed this file: ${summary.state_count} state${summary.state_count === 1 ? "" : "s"} from ${summary.start_time} to ${summary.stop_time}. It has not been kept.`
    : "Grok proposed this file. It has not been kept.";
  const proposal = entry(now, "proposal", `${header}\n${givenText(trace)}${said(trace)}`, candidate);

  if (!summary.valid) {
    const reason = `The submitted file does not pass the OEM profile when the app checks it again, so it is not kept. ${summary.errors.slice(0, 3).join(" ")}`;
    return { doc: apply(doc, [asked, proposal, entry(now, "rejected", reason)], now, null), verdict: "rejected", reason };
  }

  let result: HoldoutResult;
  try {
    result = await evaluateCandidate({ candidateOem: candidate, doc, scoreOrbit });
  } catch (error) {
    if (!(error instanceof PhysicsUnavailableError)) throw error;
    const reason = `Physics unavailable: ${error.message} The candidate was not scored, and it is not the optimized file.`;
    return { doc: apply(doc, [asked, proposal, entry(now, "score", reason)], now, null), verdict: "unscored", reason };
  }

  const finite = Number.isFinite(result.error) ? (result.error as number) : null;
  const score = entry(now, "score", scoreText(result), null, finite);

  if (result.verdict === "unscored") {
    return { doc: apply(doc, [asked, proposal, score], now, null), verdict: "unscored", reason: result.reason };
  }
  if (result.verdict === "kept") {
    const kept = entry(now, "kept", result.reason, candidate, result.error);
    return { doc: apply(doc, [asked, proposal, score, kept], now, { oem: candidate, error: result.error }), verdict: "kept", reason: result.reason };
  }
  return {
    doc: apply(doc, [asked, proposal, score, entry(now, "rejected", result.reason)], now, null),
    verdict: "rejected",
    reason: result.reason,
  };
}
