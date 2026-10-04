import { describe, expect, it } from "vitest";
import { PhysicsUnavailableError, flightEnv, scoreOrbitVia } from "./flight-client";
import type { ScoreOrbitInput } from "./holdout";

const INPUT: ScoreOrbitInput = { altitude_km: 650, inclination: "sso", ltan_hours: 6, shield_mm_Al: 5, chip_id: "nvidia_jetson_agx_orin" };
const FLIGHT = { mcpUrl: "https://flight.example/mcp", scoreUrl: "https://flight.example/score", token: "tok-123456" };

describe("flightEnv", () => {
  it("is null with no FLIGHT_MCP_URL, so the route validates in-process", () => {
    expect(flightEnv({})).toBeNull();
    expect(flightEnv({ FLIGHT_MCP_URL: "  " })).toBeNull();
  });

  it("derives the score URL from the MCP URL, and carries the token", () => {
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/mcp", FLIGHT_MCP_TOKEN: " tok " })).toEqual({
      mcpUrl: "https://flight.example/mcp",
      scoreUrl: "https://flight.example/score",
      token: "tok",
    });
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example/prefix/mcp/" })?.scoreUrl).toBe("https://flight.example/prefix/score");
    expect(flightEnv({ FLIGHT_MCP_URL: "https://flight.example" })?.scoreUrl).toBe("https://flight.example/score");
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

  it("returns the lifetime and the note from a score", async () => {
    const result = await scoreOrbitVia(FLIGHT, { fetch: answering(200, { refused: false, lifetime_years: 21.07, assumptions_note: "A ranking." }) })(INPUT);
    expect(result).toEqual({ refused: false, lifetime_years: 21.07, assumptions_note: "A ranking." });
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
