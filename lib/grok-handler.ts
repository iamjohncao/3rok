// POST /api/grok, without the framework. The route file is a thin wrapper, so this is what the tests
// drive. Order matters: who is asking, then the case, then the budget, then Grok, then the evaluator.
// Nothing here calls xAI until the account is signed in, allowed, owns the case, and is under its limit.

import type { CaseDocument } from "./case";
import { UUID } from "./case-validate";
import type { CaseStore } from "./case-store";
import { PhysicsUnavailableError, scoreOrbitVia, wakeFlightServer, type FlightEnv } from "./flight-client";
import { failedRevision, reviseCase, type Verdict } from "./grok-revision";
import { GrokSetupError, checkSetup, runGrok, type GrokTrace } from "./grok-run";
import { MAX_INSTRUCTION_CHARS } from "./grok-request";
import type { Claim } from "./grok-limit";
import { mayAsk } from "./grok-limit";
import type { ScoreOrbit } from "./holdout";
import { XaiError, scrub, type FetchLike, type XaiEnv } from "./xai";

export const GROK_NOT_SET_UP = "Grok is not set up on this deployment. XAI_API_KEY is missing.";
/** Grok gets this long, and scoring gets SCORE_DEADLINE_MS after it. Together they end before the route's 300 seconds. */
export const DEFAULT_DEADLINE_MS = 200_000;
export const SCORE_DEADLINE_MS = 80_000;

export type AskDeps = {
  xai: XaiEnv | null;
  flight: FlightEnv | null;
  fetch?: FetchLike;
  store: Pick<CaseStore, "get" | "save">;
  /** Counts the account's runs in the last hour and records this one. */
  claim: (caseId: string) => Promise<Claim>;
  allowedEmails: string[];
  now?: () => Date;
  deadlineMs?: number;
  scoreDeadlineMs?: number;
  /** Pause before the one retry of a score. Tests shorten it. */
  scoreRetryMs?: number;
};

export type AskResult = { status: number; body: Record<string, unknown>; headers?: Record<string, string> };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): AskResult => ({
  status,
  body: { error, ...extra },
  headers,
});

/** When the physics server is not configured, the evaluator says so. It never makes up a lifetime. */
const noPhysics: ScoreOrbit = async () => {
  throw new PhysicsUnavailableError("No flight server is set up (FLIGHT_MCP_URL is unset).");
};

export async function handleAsk(account: { userId: string; email: string | null }, body: unknown, deps: AskDeps): Promise<AskResult> {
  const { xai, flight, store } = deps;
  const now = deps.now ?? (() => new Date());
  const secrets = [xai?.apiKey, xai?.managementKey, flight?.token];

  if (!xai) return fail(503, GROK_NOT_SET_UP);
  if (!mayAsk(account.email, deps.allowedEmails)) return fail(403, "Ask Grok is not enabled for this account.");

  if (typeof body !== "object" || body === null) return fail(400, "The request body must be JSON with a caseId and an instruction.");
  const { caseId, instruction: rawInstruction } = body as { caseId?: unknown; instruction?: unknown };
  if (typeof caseId !== "string" || !UUID.test(caseId)) return fail(400, "A case id is a UUID.");
  if (typeof rawInstruction !== "string" || rawInstruction.trim() === "") return fail(400, "Write an instruction for Grok.");
  const instruction = rawInstruction.trim();
  if (instruction.length > MAX_INSTRUCTION_CHARS) return fail(400, `An instruction is at most ${MAX_INSTRUCTION_CHARS} characters.`);

  // The store runs as the signed-in person, so another account's case is not found.
  const doc = await store.get(account.userId, caseId);
  if (!doc) return fail(404, "No such case.");

  // A case that cannot be sent costs the account nothing.
  const unsendable = checkSetup(doc, xai);
  if (unsendable !== null) return fail(422, unsendable);

  const claim = await deps.claim(caseId);
  if (!claim.ok) {
    const minutes = Math.ceil(claim.retryAfterSeconds / 60);
    return fail(
      429,
      `This account has asked Grok as often as it may this hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { retryAfterSeconds: claim.retryAfterSeconds },
      { "Retry-After": String(claim.retryAfterSeconds) },
    );
  }

  // A flight server that sleeps when idle wakes while Grok reads the case. Nothing waits on this.
  if (flight) void wakeFlightServer(flight, { fetch: deps.fetch });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.deadlineMs ?? DEFAULT_DEADLINE_MS);
  let trace: GrokTrace | null = null;
  let failure: string | null = null;
  try {
    trace = await runGrok({ doc, instruction, deps: { env: xai, flight, fetch: deps.fetch, signal: controller.signal } });
  } catch (error) {
    if (error instanceof GrokSetupError) return fail(422, error.message);
    if (error instanceof XaiError) failure = `The request to Grok failed, so there is no candidate. ${error.message}`;
    else {
      console.error("grok run failed:", scrub(error instanceof Error ? error.message : String(error), secrets as string[]));
      return fail(500, "Ask Grok failed before it could answer. Nothing was changed.");
    }
  } finally {
    clearTimeout(timer);
  }

  // The case as it is now, so an edit made while Grok worked is not lost.
  const fresh: CaseDocument = (await store.get(account.userId, caseId)) ?? doc;
  const stamp = now().toISOString();

  const revision =
    trace === null
      ? failedRevision({ doc: fresh, instruction, reason: failure ?? "The request to Grok failed.", now: stamp })
      : await (async () => {
          const scoring = new AbortController();
          const scoringTimer = setTimeout(() => scoring.abort(), deps.scoreDeadlineMs ?? SCORE_DEADLINE_MS);
          try {
            const scoreOrbit = flight ? scoreOrbitVia(flight, { fetch: deps.fetch, signal: scoring.signal, retryAfterMs: deps.scoreRetryMs }) : noPhysics;
            return await reviseCase({ doc: fresh, instruction, trace: trace!, now: stamp, scoreOrbit });
          } finally {
            clearTimeout(scoringTimer);
          }
        })();

  await store.save(account.userId, revision.doc);
  return { status: 200, body: { case: revision.doc, verdict: revision.verdict satisfies Verdict, reason: revision.reason } };
}
