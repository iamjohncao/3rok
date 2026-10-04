import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EARTH_J2,
  MAX_RADIUS_SPREAD_KM,
  TROPICAL_YEAR_DAYS,
  reduceOem,
  sunSynchronousInclinationDeg,
} from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const params = readFileSync(`${root}starmind-physics/starmind_physics/params.yaml`, "utf8");
const minimalOem = readFileSync(`${root}fixtures/minimal.oem`, "utf8");

function refusals(text: string): string[] {
  const result = reduceOem(text);
  if (result.ok) throw new Error("expected the file to be refused");
  return result.refusals;
}

function orbit(text: string) {
  const result = reduceOem(text);
  if (!result.ok) throw new Error(result.refusals.join("\n"));
  return result.orbit;
}

describe("the constants", () => {
  it("are the physics package's own", () => {
    expect(Number(params.match(/^\s*J2:\s*([0-9.eE+-]+)/m)?.[1])).toBe(EARTH_J2);
    expect(Number(params.match(/^\s*year_days:\s*([0-9.eE+-]+)/m)?.[1])).toBe(TROPICAL_YEAR_DAYS);
  });
});

describe("sun-synchronous inclination", () => {
  // Computed with starmind_physics.orbit.sso_inclination_deg's formula.
  it.each([
    [500, 97.40178471244401],
    [550, 97.59293139111506],
    [800, 98.60308383394924],
    [1200, 100.41945222598454],
    [2000, 104.89003127561323],
  ])("at %i km is %f degrees", (altitude, expected) => {
    expect(sunSynchronousInclinationDeg(altitude)).toBeCloseTo(expected, 9);
  });
});

describe("reducing a file the ranker can score", () => {
  it("reads the altitude and the inclination from the states, labeled derived", () => {
    const reduced = orbit(circularOemText({ altitudeKm: 650, inclinationDeg: 30 }));
    expect(reduced.altitude_km).toBeCloseTo(650, 6);
    expect(reduced.inclination_deg).toBeCloseTo(30, 6);
    expect(reduced.state_count).toBe(12);
    expect(reduced.value_status).toBe("derived");
    expect(reduced.radius_spread_km).toBeCloseTo(0, 6);
  });

  it("asks for the derived inclination near 30, and for sso near the sun-synchronous one", () => {
    expect(orbit(circularOemText({ altitudeKm: 650, inclinationDeg: 31.5 })).score_inclination).toBeCloseTo(31.5, 6);
    const sso = sunSynchronousInclinationDeg(650);
    expect(orbit(circularOemText({ altitudeKm: 650, inclinationDeg: sso + 1.5 })).score_inclination).toBe("sso");
  });

  it("accepts the edges: 500 km, 2000 km, and 2 degrees off", () => {
    expect(reduceOem(circularOemText({ altitudeKm: 500.5, inclinationDeg: 30 })).ok).toBe(true);
    expect(reduceOem(circularOemText({ altitudeKm: 1999.5, inclinationDeg: 30 })).ok).toBe(true);
    expect(reduceOem(circularOemText({ altitudeKm: 800, inclinationDeg: 31.99 })).ok).toBe(true);
    expect(reduceOem(circularOemText({ altitudeKm: 800, inclinationDeg: 28.01 })).ok).toBe(true);
  });

  it("reads a retrograde orbit as an inclination above 90", () => {
    const reduced = orbit(circularOemText({ altitudeKm: 800, inclinationDeg: 98.6 }));
    expect(reduced.inclination_deg).toBeCloseTo(98.6, 6);
  });
});

describe("refusing", () => {
  it("a 400 km file, in a sentence that says the range", () => {
    const [sentence] = refusals(circularOemText({ altitudeKm: 400, inclinationDeg: 30 }));
    expect(sentence).toContain("400.0 km");
    expect(sentence).toContain("500 to 2000 km");
  });

  it("a file above 2000 km", () => {
    expect(refusals(circularOemText({ altitudeKm: 2100, inclinationDeg: 30 }))[0]).toContain("2100.0 km");
  });

  it("an inclination that is neither 30 nor sun-synchronous, naming the sun-synchronous one", () => {
    const [sentence] = refusals(circularOemText({ altitudeKm: 800, inclinationDeg: 60 }));
    expect(sentence).toContain("60.0 degrees");
    expect(sentence).toContain("98.6 degrees at this altitude");
  });

  it("just outside the tolerance on either side", () => {
    expect(reduceOem(circularOemText({ altitudeKm: 800, inclinationDeg: 32.1 })).ok).toBe(false);
    expect(reduceOem(circularOemText({ altitudeKm: 800, inclinationDeg: 27.9 })).ok).toBe(false);
  });

  it("a file whose radius moves 50 km or more", () => {
    expect(reduceOem(circularOemText({ altitudeKm: 800, inclinationDeg: 30, radiusDriftKm: MAX_RADIUS_SPREAD_KM - 1 })).ok).toBe(true);
    const [sentence] = refusals(circularOemText({ altitudeKm: 800, inclinationDeg: 30, radiusDriftKm: MAX_RADIUS_SPREAD_KM + 1 }));
    expect(sentence).toContain("51.0 km");
    expect(sentence).toContain("circular");
  });

  it("every reason at once, so one fix is not followed by a second refusal", () => {
    const reasons = refusals(circularOemText({ altitudeKm: 300, inclinationDeg: 60, radiusDriftKm: 80 }));
    expect(reasons).toHaveLength(3);
  });

  it("text that is not an OEM, naming the profile", () => {
    const [sentence] = refusals("Please fly me to the moon.");
    expect(sentence).toContain("does not pass the OEM profile");
  });

  it("an OEM whose ORIGINATOR is not 3ROK", () => {
    const text = circularOemText({ altitudeKm: 650, inclinationDeg: 30 }).replace("ORIGINATOR = 3ROK", "ORIGINATOR = ACME");
    expect(refusals(text)[0]).toContain("ORIGINATOR");
  });

  it("the shape fixture, which is not a flyable trajectory", () => {
    expect(reduceOem(minimalOem).ok).toBe(false);
  });

  it("a chat transcript, even one with an OEM inside it", () => {
    const text = `Sure! Here is the file:\n\n${circularOemText({ altitudeKm: 650, inclinationDeg: 30 })}\nLet me know.`;
    expect(reduceOem(text).ok).toBe(false);
  });
});
