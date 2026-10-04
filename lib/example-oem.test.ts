import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FlightEngine } from "./engine/flight";
import { parseOem, validateOem } from "./oem";
import { reduceOem } from "./oem-reduce";

const root = fileURLToPath(new URL("..", import.meta.url));
const text = readFileSync(`${root}fixtures/example-650km-sso.oem`, "utf8");

// The OEM the Rubin example case's README and the Activity guide tell people to paste.
describe("fixtures/example-650km-sso.oem", () => {
  it("passes the OEM profile as a file this app writes", () => {
    const result = validateOem(text, { thisAppWrote: true });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.state_count).toBe(25);
      expect(result.segment_count).toBe(1);
      expect(result.start_time).toBe("2027-01-01T00:00:00.000");
    }
  });

  it("reduces to the orbit it says: about 650 km, sun-synchronous, so the evaluator scores it", () => {
    const reduced = reduceOem(text);
    expect(reduced.ok).toBe(true);
    if (!reduced.ok) return;
    expect(Math.abs(reduced.orbit.altitude_km - 650)).toBeLessThan(10); // it starts at 650 km and J2 pulls the mean to about 645
    expect(reduced.orbit.score_inclination).toBe("sso");
    expect(reduced.orbit.inclination_deg).toBeCloseTo(97.99, 1);
    expect(reduced.orbit.radius_spread_km).toBeLessThan(50);
  });

  it("is a gravity-only orbit to the precision it is written in, and covers one revolution", () => {
    const parsed = parseOem(text, { thisAppWrote: true });
    if (!parsed.ok) throw new Error("parses");
    const engine = new FlightEngine(parsed.oem);
    expect(engine.report().maxPositionKm).toBeLessThan(0.01);
    expect(engine.report().maxVelocityKmS).toBeLessThan(1e-5);
    const { start, stop } = engine.bounds();
    expect((stop - start) / 60).toBeGreaterThan(97);
    expect((stop - start) / 60).toBeLessThan(98);
  });

  it("has no thrust, mass or lifetime in it, comments included", () => {
    expect(text).not.toMatch(/thrust|mass|pitch|lifetime|throttle|propellant/i);
  });
});
