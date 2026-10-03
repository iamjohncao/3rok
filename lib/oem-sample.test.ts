import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOem, serializeOem, type Oem } from "./oem";
import { oemTimeBounds, sampleOem, samplePath } from "./oem-sample";

const root = fileURLToPath(new URL("..", import.meta.url));
const minimalText = readFileSync(`${root}fixtures/minimal.oem`, "utf8");

function parse(text: string): Oem {
  const result = parseOem(text);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("\n"));
  return result.oem;
}

const minimal = parse(minimalText);
const { start, stop } = oemTimeBounds(minimal);
const [first, second] = minimal.segments[0].states;

describe("sampling the minimal fixture", () => {
  it("returns the file's own state at an epoch, with nothing interpolated", () => {
    const sample = sampleOem(minimal, start);
    expect(sample?.position).toEqual(first.position);
    expect(sample?.velocity).toEqual(first.velocity);
    expect(sample?.atState).toBe(true);
    expect(sampleOem(minimal, stop)?.position).toEqual(second.position);
  });

  it("interpolates linearly halfway between two states", () => {
    const sample = sampleOem(minimal, (start + stop) / 2);
    expect(sample?.atState).toBe(false);
    expect(sample?.method).toBe("linear");
    expect(sample?.position[0]).toBeCloseTo((first.position[0] + second.position[0]) / 2, 9);
    expect(sample?.position[1]).toBeCloseTo((first.position[1] + second.position[1]) / 2, 9);
    expect(sample?.velocity[2]).toBeCloseTo((first.velocity[2] + second.velocity[2]) / 2, 9);
    expect(sample?.acceleration).toBeNull();
    expect(sample?.note).toBeNull();
  });

  it("has no state before the first epoch or after the last", () => {
    expect(sampleOem(minimal, start - 1)).toBeNull();
    expect(sampleOem(minimal, stop + 1)).toBeNull();
  });

  it("reports the time bounds of the file", () => {
    expect(stop - start).toBe(15 * 60);
  });
});

describe("segments", () => {
  const twoSegments = parse(`${minimalText}META_START
OBJECT_NAME = CASE-CHIPSET
OBJECT_ID = UNKNOWN
CENTER_NAME = EARTH
REF_FRAME = GCRF
TIME_SYSTEM = UTC
START_TIME = 2026-10-03T18:25:00.000
STOP_TIME = 2026-10-03T18:30:00.000
META_STOP
2026-10-03T18:25:00.000  -3000.0  -1500.0  6300.0  -3.50  6.80  1.90
2026-10-03T18:30:00.000  -3500.0  -500.0  6350.0  -3.60  6.90  1.20
`);
  const afterFirst = start + 15 * 60; // 18:20, the end of segment one
  const gap = afterFirst + 2 * 60; // 18:22, between the segments

  it("does not read a state in the gap between segments", () => {
    expect(sampleOem(twoSegments, gap)).toBeNull();
  });

  it("reads each segment from its own states", () => {
    const inFirst = sampleOem(twoSegments, start + 60);
    const inSecond = sampleOem(twoSegments, start + 20 * 60 + 150); // 18:27:30, midway through segment two
    expect(inFirst?.segmentIndex).toBe(0);
    expect(inSecond?.segmentIndex).toBe(1);
    // Inside segment two the x position is between its own two states, nowhere near segment one's.
    expect(inSecond?.position[0]).toBeLessThan(-3000);
    expect(inSecond?.position[0]).toBeGreaterThan(-3500);
  });

  it("spans the whole file in its time bounds", () => {
    expect(oemTimeBounds(twoSegments).stop - oemTimeBounds(twoSegments).start).toBe(25 * 60);
  });

  it("draws one list of points per segment, never a line across the gap", () => {
    const path = samplePath(twoSegments, 60);
    expect(path).toHaveLength(2);
    expect(path[0].every((point) => point.segmentIndex === 0)).toBe(true);
    expect(path[1].every((point) => point.segmentIndex === 1)).toBe(true);
    expect(Math.max(...path[0].map((p) => p.time))).toBe(afterFirst);
    expect(Math.min(...path[1].map((p) => p.time))).toBe(start + 20 * 60);
  });
});

describe("interpolation named in the file", () => {
  // A cubic in time has an exact Hermite fit from positions and velocities.
  const cubic = (t: number) => [1000 + 2 * t + 0.5 * t ** 2 + 0.01 * t ** 3, -500 + t, 7000 - 0.3 * t ** 2];
  const cubicVelocity = (t: number) => [2 + t + 0.03 * t ** 2, 1, -0.6 * t];

  function cubicOem(interpolation: string): Oem {
    const states = [0, 10, 20].map((t) => {
      const base = new Date("2026-10-03T18:00:00Z").getTime() / 1000 + t;
      const iso = new Date(base * 1000).toISOString().replace("Z", "");
      const [x, y, z] = cubic(t);
      const [vx, vy, vz] = cubicVelocity(t);
      return `${iso}  ${x}  ${y}  ${z}  ${vx}  ${vy}  ${vz}`;
    });
    return parse(`CCSDS_OEM_VERS = 3.0
CREATION_DATE = 2026-10-03T18:00:00
ORIGINATOR = 3ROK
META_START
OBJECT_NAME = CUBIC
OBJECT_ID = UNKNOWN
CENTER_NAME = EARTH
REF_FRAME = GCRF
TIME_SYSTEM = UTC
START_TIME = ${states[0].split("  ")[0]}
STOP_TIME = ${states[2].split("  ")[0]}
${interpolation}META_STOP
${states.join("\n")}
`);
  }

  const t0 = new Date("2026-10-03T18:00:00Z").getTime() / 1000;

  it("follows HERMITE degree 3 exactly for a cubic path, position and velocity", () => {
    const oem = cubicOem("INTERPOLATION = HERMITE\nINTERPOLATION_DEGREE = 3\n");
    const sample = sampleOem(oem, t0 + 4);
    expect(sample?.method).toBe("hermite");
    expect(sample?.note).toBeNull();
    const [x, y, z] = cubic(4);
    const [vx, vy, vz] = cubicVelocity(4);
    expect(sample?.position[0]).toBeCloseTo(x, 9);
    expect(sample?.position[1]).toBeCloseTo(y, 9);
    expect(sample?.position[2]).toBeCloseTo(z, 9);
    expect(sample?.velocity[0]).toBeCloseTo(vx, 9);
    expect(sample?.velocity[1]).toBeCloseTo(vy, 9);
    expect(sample?.velocity[2]).toBeCloseTo(vz, 9);
  });

  it("is only linear when the file says LINEAR, or says nothing", () => {
    const linear = sampleOem(cubicOem("INTERPOLATION = LINEAR\nINTERPOLATION_DEGREE = 1\n"), t0 + 4);
    const silent = sampleOem(cubicOem(""), t0 + 4);
    expect(linear?.method).toBe("linear");
    expect(linear?.note).toBeNull();
    expect(silent?.method).toBe("linear");
    expect(silent?.position[0]).toBeCloseTo(linear?.position[0] as number, 12);
    // Linear is visibly different from the true cubic path.
    expect(Math.abs((linear?.position[0] as number) - cubic(4)[0])).toBeGreaterThan(0.1);
  });

  it("falls back to linear and says so for an interpolation it does not do", () => {
    const lagrange = sampleOem(cubicOem("INTERPOLATION = LAGRANGE\nINTERPOLATION_DEGREE = 5\n"), t0 + 4);
    expect(lagrange?.method).toBe("linear");
    expect(lagrange?.note).toContain("LAGRANGE degree 5");
    const hermite5 = sampleOem(cubicOem("INTERPOLATION = HERMITE\nINTERPOLATION_DEGREE = 5\n"), t0 + 4);
    expect(hermite5?.method).toBe("linear");
    expect(hermite5?.note).toContain("HERMITE degree 5");
  });

  it("interpolates acceleration only when both states carry it", () => {
    const withAcceleration = parse(
      serializeOem({
        ...minimal,
        segments: [
          {
            ...minimal.segments[0],
            states: minimal.segments[0].states.map((state, i) => ({
              ...state,
              acceleration: [i, 2 * i, 0] as [number, number, number],
            })),
          },
        ],
      }),
    );
    const sample = sampleOem(withAcceleration, (start + stop) / 2);
    expect(sample?.acceleration).toEqual([0.5, 1, 0]);
  });
});

describe("sampling for the line", () => {
  it("includes every state epoch and stays within the point limit", () => {
    const path = samplePath(minimal, 1, 100);
    expect(path).toHaveLength(1);
    const times = path[0].map((sample) => sample.time);
    expect(times).toContain(start);
    expect(times).toContain(stop);
    expect(path[0].length).toBeLessThanOrEqual(102);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
