// The physics service, as the evaluator calls it: POST /score on the flight server, the same
// score_candidate as the MCP tool. Server only. It builds `ScoreOrbit` for lib/holdout.ts and
// invents nothing: a service that cannot be reached throws, so the route can say "Physics
// unavailable" and no lifetime is made up.

import type { ScoreOrbit, ScoreOrbitInput, ScoreOrbitResult } from "./holdout";

export type FlightEnv = {
  /** What xAI is told to call: the MCP endpoint. */
  mcpUrl: string;
  /** Where the evaluator posts a score. */
  scoreUrl: string;
  /** Answers without scoring. Used to wake a host that sleeps when idle. */
  healthUrl: string;
  token: string | null;
};

type Env = Record<string, string | undefined>;

/** Null when no flight server is configured. The Grok route then validates in-process. */
export function flightEnv(env: Env = process.env): FlightEnv | null {
  const raw = env.FLIGHT_MCP_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  const base = new URL(url.toString());
  base.pathname = base.pathname.replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
  base.search = "";
  base.hash = "";
  const root = base.toString().replace(/\/+$/, "");
  return {
    mcpUrl: url.toString(),
    scoreUrl: `${root}/score`,
    healthUrl: `${root}/health`,
    token: env.FLIGHT_MCP_TOKEN?.trim() || null,
  };
}

export class PhysicsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhysicsUnavailableError";
  }
}

/**
 * Starts the flight server if it sleeps when idle (a free host spins down after minutes without a
 * request and takes up to a minute to come back). Called when an Ask Grok run starts, so the server is
 * awake by the time Grok calls a tool and the evaluator scores. Never throws, and nothing waits on it.
 */
export function wakeFlightServer(
  flight: FlightEnv,
  { fetch: fetchImpl = fetch, timeoutMs = 90_000 }: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<void> {
  return fetchImpl(flight.healthUrl, { method: "GET", signal: AbortSignal.timeout(timeoutMs) }).then(
    () => undefined,
    () => undefined,
  );
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Statuses a host that is waking up answers with, and so worth one more try. */
const WAKING = new Set([502, 503, 504]);
const RETRY_AFTER_MS = 3000;

export function scoreOrbitVia(
  flight: FlightEnv,
  { fetch: fetchImpl = fetch, signal, retryAfterMs = RETRY_AFTER_MS }: { fetch?: typeof fetch; signal?: AbortSignal; retryAfterMs?: number } = {},
): ScoreOrbit {
  const post = (input: ScoreOrbitInput) =>
    fetchImpl(flight.scoreUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(flight.token ? { Authorization: `Bearer ${flight.token}` } : {}) },
      body: JSON.stringify(input),
      signal,
    });

  const pause = () => new Promise((resolve) => setTimeout(resolve, retryAfterMs));

  return async (input: ScoreOrbitInput): Promise<ScoreOrbitResult> => {
    // Two tries at most. A host that was asleep may refuse the first connection or answer 502, 503 or 504.
    let response: Response | null = null;
    for (let attempt = 1; response === null; attempt++) {
      try {
        const answer = await post(input);
        if (attempt === 1 && WAKING.has(answer.status) && !signal?.aborted) {
          await pause();
          continue;
        }
        response = answer;
      } catch {
        if (signal?.aborted) throw new PhysicsUnavailableError("The physics server did not answer in time.");
        if (attempt >= 2) throw new PhysicsUnavailableError("The physics server could not be reached.");
        await pause();
      }
    }

    const text = await response.text().catch(() => "");
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }

    if (response.status === 401 || response.status === 403) throw new PhysicsUnavailableError("The physics server refused the access token.");
    if (response.status === 400) {
      const why = typeof body?.error === "string" ? body.error : "The physics server rejected the request.";
      return { refused: true, reason: why };
    }
    if (!response.ok || body === null) throw new PhysicsUnavailableError(`The physics server answered ${response.status}.`);

    if (body.refused === true) return { refused: true, reason: typeof body.reason === "string" ? body.reason : undefined };
    const lifetime = body.lifetime_years;
    const chip = typeof body.chip === "object" && body.chip !== null ? (body.chip as Record<string, unknown>) : null;
    return {
      refused: false,
      lifetime_years: typeof lifetime === "number" && Number.isFinite(lifetime) ? lifetime : null,
      assumptions_note: typeof body.assumptions_note === "string" ? body.assumptions_note : null,
      estimate: {
        mean_power_kW: finiteOrNull(body.mean_power_kW),
        radiator_area_m2: finiteOrNull(body.radiator_area_m2),
        shield_mass_kg: finiteOrNull(body.shield_mass_kg),
        limiting_mode: typeof body.limiting_mode === "string" ? body.limiting_mode : null,
        dose_limit_provenance: typeof chip?.dose_limit_provenance === "string" ? chip.dose_limit_provenance : null,
      },
    };
  };
}
