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
  return {
    mcpUrl: url.toString(),
    scoreUrl: `${base.toString().replace(/\/+$/, "")}/score`,
    token: env.FLIGHT_MCP_TOKEN?.trim() || null,
  };
}

export class PhysicsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhysicsUnavailableError";
  }
}

export function scoreOrbitVia(
  flight: FlightEnv,
  { fetch: fetchImpl = fetch, signal }: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): ScoreOrbit {
  return async (input: ScoreOrbitInput): Promise<ScoreOrbitResult> => {
    let response: Response;
    try {
      response = await fetchImpl(flight.scoreUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(flight.token ? { Authorization: `Bearer ${flight.token}` } : {}) },
        body: JSON.stringify(input),
        signal,
      });
    } catch {
      throw new PhysicsUnavailableError("The physics server could not be reached.");
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
    return {
      refused: false,
      lifetime_years: typeof lifetime === "number" && Number.isFinite(lifetime) ? lifetime : null,
      assumptions_note: typeof body.assumptions_note === "string" ? body.assumptions_note : null,
    };
  };
}
