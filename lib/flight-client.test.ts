import { describe, expect, it } from "vitest";
import { PhysicsUnavailableError, flightEnv, scoreOrbitVia, wakeFlightServer } from "./flight-client";
import type { ScoreOrbitInput } from "./holdout";

const INPUT: ScoreOrbitInput = { altitude_km: 650, inclination: "sso", ltan_hours: 6, shield_mm_Al: 5, chip_id: "nvidia_jetson_agx_orin" };
const FLIGHT = { mcpUrl: "https://flight.example/mcp", scoreUrl: "https://flight.example/score", healthUrl: "https://flight.example/health", token: "tok-123456" };

describe("flightEnv", () => {
  it("is null with no FLIGHT_MCP_URL, so the route validates in-process", () => {
    expect(flightEnv({})).toBeNull();
    expect(flightEnv({ FLIGHT_MCP_URL: "  " })).toBeNull();
  });

  it("derives the score URL from the MCP URL, and carries the token", () => {
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/mcp", FLIGHT_MCP_TOKEN: " tok " })).toEqual({
      mcpUrl: "https://flight.example/mcp",
      scoreUrl: "https://flight.example/score",
      healthUrl: "https://flight.example/health",
      token: "tok",
    });
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/prefix/mcp/" })?.scoreUrl).toBe("https://flight.example/prefix/score");
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example" })?.scoreUrl).toBe("https://flight.example/score");
  });

  it("derives the health URL beside the score URL", () => {
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/mcp" })?.healthUrl).toBe("https://flight.example/health");
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/prefix/mcp" })?.healthUrl).toBe("https://flight.example/prefix/health");
  });

  it("has no token when none is set", () => {
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/mcp" })?.token).toBeNull();
  });

  it("refuses a URL xAI could not safely reach: not https, or not a URL", () => {
    expect(flightEnv({ FLIGHT_MCP_URL: "http://flight.example/mcp" })).toBeNull();
    expect(flightEnv({ FLIGHT_MCP_URL: "not a url" })).toBeNull();
    expect(flightEnv({ FLIGHT_MCP_URL: "http://127.0.0.1:8000/mcp" })?.scoreUrl).toBe("http://127.0.0.1:8000/score");
  });
});

function answering(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

describe("scoreOrbitVia", () => {
  it("posts exactly the scoring input, with the bearer token, to /score", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: false, lifetime_years: 3 }, seen) })(INPUT);
    expect(seen.url).toBe("https://flight.example/score");
    expect(JSON.parse(seen.init?.body as string)).toEqual(INPUT);
    expect(new Headers(seen.init?.headers).get("authorization")).toBe("Bearer tok-123456");
  });

  it("sends no Authorization header when there is no token", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await scoreOrbitVia({ ...FLIGHT, token: null }, { fetch: answering(200, { refused: false, lifetime_years: 3 }, seen) })(INPUT);
    expect(new Headers(seen.init?.headers).has("authorization")).toBe(false);
  });

  it("carries the rest of the estimate and the chip's dose-limit provenance, and nothing it was not given", async () => {
    const body = {
      refused: false,
      lifetime_years: 3.2,
      mean_power_kW: 5.2,
      radiator_area_m2: 11.5,
      shield_mass_kg: 31.4,
      limiting_mode: "dose",
      chip: { id: "nvidia_jetson_agx_orin", dose_limit_provenance: "assumed" },
    };
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(200, body) })(INPUT);
    expect(result).toMatchObject({
      refused: false,
      estimate: { mean_power_kW: 5.2, radiator_area_m2: 11.5, shield_mass_kg: 31.4, limiting_mode: "dose", dose_limit_provenance: "assumed" },
    });
    const sparse = await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: false, lifetime_years: 3, mean_power_kW: "lots", limiting_mode: 7 }) })(INPUT);
    expect(sparse).toMatchObject({ estimate: { mean_power_kW: null, limiting_mode: null, dose_limit_provenance: null } });
  });

  it("returns the lifetime and the note from a score", async () => {
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: false, lifetime_years: 21.07, assumptions_note: "A ranking." }) })(INPUT);
    expect(result).toEqual({
      refused: false,
      lifetime_years: 21.07,
      assumptions_note: "A ranking.",
      estimate: { mean_power_kW: null, radiator_area_m2: null, shield_mass_kg: null, limiting_mode: null, dose_limit_provenance: null },
    });
  });

  it("returns a refusal with the reason, and no lifetime", async () => {
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: true, reason: "Outside the envelope." }) })(INPUT);
    expect(result).toEqual({ refused: true, reason: "Outside the envelope." });
  });

  it("treats a 400 as a refusal that says what the server said", async () => {
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(400, { error: "ltan_hours must be a number." }) })(INPUT);
    expect(result).toEqual({ refused: true, reason: "ltan_hours must be a number." });
  });

  it("reads a lifetime that is not a finite number as no lifetime", async () => {
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: false, lifetime_years: null }) })(INPUT);
    expect(result).toMatchObject({ refused: false, lifetime_years: null });
  });

  it.each([
    ["a 401", () => answering(401, { error: "Unauthorized." })],
    ["a 403", () => answering(403, {})],
    ["a 503", () => answering(503, { error: "Physics unavailable: x" })],
    ["a 500", () => answering(500, { error: "x" })],
    ["a body that is not JSON", () => answering(200, "<html>")],
    ["a network failure", () => (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch],
  ])("throws PhysicsUnavailableError for %s, never a made-up score", async (_name, make) => {
    await expect(scoreOrbitVia(FLIGHT, { fetch: make() })(INPUT)).rejects.toBeInstanceOf(PhysicsUnavailableError);
  });

  it("does not put the token in an error message", async () => {
    const error = (await scoreOrbitVia(FLIGHT, { fetch: answering(401, {}) })(INPUT).catch((e) => e)) as Error;
    expect(error.message).not.toContain("tok-123456");
  });
});

describe("wakeFlightServer", () => {
  it("asks the health URL, with no token and nothing to score", async () => {
    const seen: { url?: string; init?: RequestInit } = {};
    await wakeFlightServer(FLIGHT, { fetch: answering(200, {}, seen) });
    expect(seen.url).toBe("https://flight.example/health");
    expect(seen.init?.method).toBe("GET");
    expect(new Headers(seen.init?.headers).has("authorization")).toBe(false);
  });

  it("never throws, whatever happens to the request", async () => {
    await expect(wakeFlightServer(FLIGHT, { fetch: (async () => { throw new Error("down"); }) as typeof fetch })).resolves.toBeUndefined();
    await expect(wakeFlightServer(FLIGHT, { fetch: answering(503, {}) })).resolves.toBeUndefined();
  });
});

describe("a flight server that was asleep", () => {
  const sequence = (steps: (number | "throw")[]): { fetch: typeof fetch; calls: () => number } => {
    let calls = 0;
    const fetchImpl = (async () => {
      const step = steps[Math.min(calls, steps.length - 1)];
      calls += 1;
      if (step === "throw") throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify(step === 200 ? { refused: false, lifetime_years: 3 } : { error: "waking" }), { status: step });
    }) as typeof fetch;
    return { fetch: fetchImpl, calls: () => calls };
  };

  it("is tried once more after a 502, 503 or 504, and the second answer is used", async () => {
    for (const status of [502, 503, 504]) {
      const s = sequence([status, 200]);
      const result = await scoreOrbitVia(FLIGHT, { fetch: s.fetch, retryAfterMs: 1 })(INPUT);
      expect(result).toMatchObject({ refused: false, lifetime_years: 3 });
      expect(s.calls()).toBe(2);
    }
  });

  it("is tried once more after a refused connection", async () => {
    const s = sequence(["throw", 200]);
    expect(await scoreOrbitVia(FLIGHT, { fetch: s.fetch, retryAfterMs: 1 })(INPUT)).toMatchObject({ refused: false });
    expect(s.calls()).toBe(2);
  });

  it("is unavailable after two failures, never scored", async () => {
    for (const steps of [["throw", "throw"], [503, 503], [503, "throw"]] as (number | "throw")[][]) {
      const s = sequence(steps);
      await expect(scoreOrbitVia(FLIGHT, { fetch: s.fetch, retryAfterMs: 1 })(INPUT)).rejects.toBeInstanceOf(PhysicsUnavailableError);
      expect(s.calls()).toBe(2);
    }
  });

  it("is not tried again for an answer that is not about waking: 200, 400, 401, 500", async () => {
    for (const status of [200, 400, 401, 500]) {
      const s = sequence([status]);
      await scoreOrbitVia(FLIGHT, { fetch: s.fetch, retryAfterMs: 1 })(INPUT).catch(() => undefined);
      expect(s.calls(), String(status)).toBe(1);
    }
  });

  it("is not tried again once the deadline has passed", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    const error = (await scoreOrbitVia(FLIGHT, { fetch: fetchImpl, signal: controller.signal, retryAfterMs: 1 })(INPUT).catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(PhysicsUnavailableError);
    expect(error.message).toContain("did not answer in time");
    expect(calls).toBe(1);
  });
});
