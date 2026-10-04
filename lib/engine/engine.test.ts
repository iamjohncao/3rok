import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gcrfToEarthFixed, meanPoleGcrf } from "../frame";
import { parseOem, type Oem, type OemSegment, type OemState, type Vec3 } from "../oem";
import { elementsOf } from "./elements";
import { FlightEngine, blendWeight } from "./flight";
import { J2, MU_KM3_S2, RADIUS_KM, acceleration, specificEnergy } from "./gravity";
import { propagate, propagateThrough, type State } from "./integrate";
import { norm, sub } from "./vec";

const root = fileURLToPath(new URL("../..", import.meta.url));
const minimal = readFileSync(`${root}fixtures/minimal.oem`, "utf8");

const Z: Vec3 = [0, 0, 1];
const TWO_BODY = { model: { j2: false, pole: Z } };
const WITH_J2 = { model: { j2: true, pole: Z } };
// The pole the engine flies about, so a file made with it is one the engine finds consistent.
const DATE_POLE = meanPoleGcrf(Date.UTC(2026, 9, 3, 18, 0, 0) / 1000);
const WITH_J2_OF_DATE = { model: { j2: true, pole: DATE_POLE } };

function circular(altKm: number, incDeg: number): State {
  const a = RADIUS_KM + altKm;
  const v = Math.sqrt(MU_KM3_S2 / a);
  const i = (incDeg * Math.PI) / 180;
  return { r: [a, 0, 0], v: [0, v * Math.cos(i), v * Math.sin(i)] };
}

function period(altKm: number): number {
  const a = RADIUS_KM + altKm;
  return 2 * Math.PI * Math.sqrt((a * a * a) / MU_KM3_S2);
}

const T0 = Date.UTC(2026, 9, 3, 18, 0, 0) / 1000;

function oemOf(segments: { time: number; r: Vec3; v: Vec3 }[][]): Oem {
  const toState = (s: { time: number; r: Vec3; v: Vec3 }): OemState => ({
    epoch: new Date(s.time * 1000).toISOString().replace("Z", ""),
    time: s.time,
    position: s.r,
    velocity: s.v,
    acceleration: null,
  });
  const make = (states: ReturnType<typeof toState>[]): OemSegment => ({
    comments: [],
    objectName: "TEST",
    objectId: "UNKNOWN",
    centerName: "EARTH",
    refFrame: "GCRF",
    timeSystem: "UTC",
    startTime: states[0].epoch,
    stopTime: states[states.length - 1].epoch,
    useableStartTime: null,
    useableStopTime: null,
    interpolation: null,
    interpolationDegree: null,
    dataComments: [],
    states,
  });
  return {
    headerComments: [],
    classification: null,
    creationDate: "2026-10-03T18:00:00",
    originator: "3ROK",
    messageId: null,
    segments: segments.map((states) => make(states.map(toState))),
  };
}

/** States a gravity-only satellite really flies, so a file made of them is consistent. */
function flown(start: State, offsets: number[]): { time: number; r: Vec3; v: Vec3 }[] {
  const states = propagateThrough(start, offsets, WITH_J2_OF_DATE);
  return offsets.map((offset, i) => ({ time: T0 + offset, r: states[i].r, v: states[i].v }));
}

describe("gravity", () => {
  it("is the point-mass pull when J2 is off", () => {
    const r: Vec3 = [7000, 1000, -500];
    const a = acceleration(r, { j2: false, pole: Z });
    const rn = norm(r);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo((-MU_KM3_S2 * r[i]) / rn ** 3, 14);
  });

  it("makes the equatorial pull stronger and the polar pull weaker, by the J2 factors", () => {
    const eq = acceleration([RADIUS_KM, 0, 0], { j2: true, pole: Z });
    expect(eq[0]).toBeCloseTo((-MU_KM3_S2 / RADIUS_KM ** 2) * (1 + 1.5 * J2), 12);
    const pole = acceleration([0, 0, RADIUS_KM], { j2: true, pole: Z });
    expect(pole[2]).toBeCloseTo((-MU_KM3_S2 / RADIUS_KM ** 2) * (1 - 3 * J2), 12);
    expect(Math.abs(eq[1])).toBeLessThan(1e-15);
  });

  it("takes the pole it is given: tilting the pole tilts the J2 pull with it", () => {
    const tilted = acceleration([0, RADIUS_KM, 0], { j2: true, pole: [0, 1, 0] });
    const polar = acceleration([0, 0, RADIUS_KM], { j2: true, pole: Z });
    expect(tilted[1]).toBeCloseTo(polar[2], 12);
  });
});

describe("the propagator", () => {
  it("returns a circular two-body orbit to where it started after one period, and conserves energy", () => {
    const start = circular(700, 51.6);
    const end = propagate(start, period(700), TWO_BODY);
    expect(norm(sub(end.r, start.r))).toBeLessThan(1e-6);
    expect(norm(sub(end.v, start.v))).toBeLessThan(1e-9);
    expect(Math.abs(specificEnergy(end.r, end.v) - specificEnergy(start.r, start.v)) / Math.abs(specificEnergy(start.r, start.v))).toBeLessThan(5e-11);
  });

  it("keeps the energy of an eccentric two-body orbit over ten revolutions", () => {
    const rp = RADIUS_KM + 400;
    const a = (rp + (RADIUS_KM + 5000)) / 2;
    const start: State = { r: [rp, 0, 0], v: [0, Math.sqrt(MU_KM3_S2 * (2 / rp - 1 / a)), 0] };
    const T = 2 * Math.PI * Math.sqrt(a ** 3 / MU_KM3_S2);
    const end = propagate(start, 10 * T, TWO_BODY);
    const e0 = specificEnergy(start.r, start.v);
    expect(Math.abs(specificEnergy(end.r, end.v) - e0) / Math.abs(e0)).toBeLessThan(1e-9);
  });

  it("flown backward undoes flown forward", () => {
    const start = circular(650, 98);
    const there = propagate(start, 1234.5, WITH_J2);
    const back = propagate(there, -1234.5, WITH_J2);
    expect(norm(sub(back.r, start.r))).toBeLessThan(1e-6);
    expect(norm(sub(back.v, start.v))).toBeLessThan(1e-9);
  });

  it("gives the same state through a list of offsets as it does one at a time", () => {
    const start = circular(650, 30);
    const offsets = [30, 90, 400, 1500];
    const through = propagateThrough(start, offsets, WITH_J2);
    offsets.forEach((offset, i) => {
      const single = propagate(start, offset, WITH_J2);
      expect(norm(sub(through[i].r, single.r))).toBeLessThan(1e-6);
    });
    expect(propagateThrough(start, [-30, -90], WITH_J2)).toHaveLength(2);
    expect(() => propagateThrough(start, [90, 30], WITH_J2)).toThrow();
  });

  it("is deterministic", () => {
    const start = circular(900, 45);
    expect(propagate(start, 777, WITH_J2)).toEqual(propagate(start, 777, WITH_J2));
  });

  it("regresses the node at the rate J2 predicts", () => {
    const alt = 700;
    const inc = 60;
    const start = circular(alt, inc);
    const orbits = 30;
    const end = propagate(start, orbits * period(alt), WITH_J2);
    const before = elementsOf(start.r, start.v).raanDeg ?? NaN;
    const after = elementsOf(end.r, end.v).raanDeg ?? NaN;
    let drift = after - before;
    if (drift > 180) drift -= 360;
    if (drift < -180) drift += 360;

    const a = RADIUS_KM + alt;
    const n = Math.sqrt(MU_KM3_S2 / a ** 3);
    const predicted = ((-1.5 * J2 * n * (RADIUS_KM / a) ** 2 * Math.cos((inc * Math.PI) / 180) * orbits * period(alt)) * 180) / Math.PI;
    expect(drift).toBeLessThan(0);
    expect(Math.abs(drift - predicted) / Math.abs(predicted)).toBeLessThan(0.03);
  });

  it("with J2 off, leaves the node where it was", () => {
    const start = circular(700, 60);
    const end = propagate(start, 20 * period(700), TWO_BODY);
    const raw = (elementsOf(end.r, end.v).raanDeg ?? 0) - (elementsOf(start.r, start.v).raanDeg ?? 0);
    const drift = ((raw + 540) % 360) - 180;
    expect(Math.abs(drift)).toBeLessThan(1e-6);
  });
});

describe("classical elements", () => {
  it("reads a circular orbit back", () => {
    const e = elementsOf(...(Object.values(circular(650, 97.9)) as [Vec3, Vec3]));
    expect(e.eccentricity).toBeLessThan(1e-9);
    expect(e.semiMajorAxisKm).toBeCloseTo(RADIUS_KM + 650, 6);
    expect(e.inclinationDeg).toBeCloseTo(97.9, 9);
    expect(e.periodS).toBeCloseTo(period(650), 6);
    expect(e.perigeeAltitudeKm).toBeCloseTo(650, 6);
    expect(e.apogeeAltitudeKm).toBeCloseTo(650, 6);
    expect(e.argumentOfPerigeeDeg).toBeNull();
    expect(e.trueAnomalyDeg).toBeNull();
  });

  it("reads an eccentric orbit's perigee, apogee and period", () => {
    const rp = RADIUS_KM + 500;
    const ra = RADIUS_KM + 2500;
    const a = (rp + ra) / 2;
    const e = elementsOf([rp, 0, 0], [0, Math.sqrt(MU_KM3_S2 * (2 / rp - 1 / a)), 0]);
    expect(e.perigeeAltitudeKm).toBeCloseTo(500, 6);
    expect(e.apogeeAltitudeKm).toBeCloseTo(2500, 6);
    expect(e.eccentricity).toBeCloseTo((ra - rp) / (ra + rp), 12);
    expect(e.inclinationDeg).toBeCloseTo(0, 9);
    expect(e.raanDeg).toBeNull();
  });

  it("has no period or apogee on an escape trajectory", () => {
    const e = elementsOf([RADIUS_KM + 400, 0, 0], [0, 12, 0]);
    expect(e.periodS).toBeNull();
    expect(e.apogeeAltitudeKm).toBeNull();
  });
});

describe("the mean pole", () => {
  it("is a unit vector close to GCRF z, off by the precession since J2000", () => {
    const pole = meanPoleGcrf(T0);
    expect(norm(pole)).toBeCloseTo(1, 14);
    const angleDeg = (Math.acos(pole[2]) * 180) / Math.PI;
    expect(angleDeg).toBeGreaterThan(0.12);
    expect(angleDeg).toBeLessThan(0.18);
    expect(meanPoleGcrf(Date.UTC(2000, 0, 1, 12) / 1000)[2]).toBeCloseTo(1, 12);
  });

  it("is the Earth-fixed z axis once rotated the way the display rotates", () => {
    const fixed = gcrfToEarthFixed(meanPoleGcrf(T0), T0);
    expect(fixed[0]).toBeCloseTo(0, 12);
    expect(fixed[1]).toBeCloseTo(0, 12);
    expect(fixed[2]).toBeCloseTo(1, 12);
  });
});

describe("the flight engine on a file that is a gravity-only orbit", () => {
  const start = circular(650, 97.9);
  const offsets = [0, 120, 240, 360, 480, 600];
  const file = oemOf([flown(start, offsets)]);
  const engine = new FlightEngine(file);

  it("agrees with the physics between the states, so the blend adds nothing", () => {
    for (const offset of [30, 120.5, 299, 431.25, 590]) {
      const sample = engine.sample(T0 + offset);
      const truth = propagate(start, offset, WITH_J2_OF_DATE);
      expect(sample).not.toBeNull();
      expect(norm(sub(sample!.position, truth.r))).toBeLessThan(1e-5);
      expect(sample!.atState).toBe(false);
    }
  });

  it("reports a mismatch of nothing worth the name", () => {
    const report = engine.report();
    expect(report.gravity).toBe("point mass + J2");
    expect(report.stateCount).toBe(6);
    expect(report.intervals).toHaveLength(5);
    expect(report.maxPositionKm).toBeLessThan(1e-5);
    expect(report.maxVelocityKmS).toBeLessThan(1e-8);
  });
});

describe("the flight engine on a file that is not", () => {
  const fixture = parseOem(minimal);
  if (!fixture.ok) throw new Error("the fixture must parse");
  const engine = new FlightEngine(fixture.oem);
  const [a, b] = fixture.oem.segments[0].states;

  it("returns the file's own state at every epoch the file gives, to the bit", () => {
    for (const state of [a, b]) {
      const sample = engine.sample(state.time);
      expect(sample?.atState).toBe(true);
      expect(sample?.position).toEqual(state.position);
      expect(sample?.velocity).toEqual(state.velocity);
    }
  });

  it("leaves each state with the file's velocity: the line is tangent to it", () => {
    const eps = 1e-2;
    const after = engine.sample(a.time + eps)!;
    const slopeA = [0, 1, 2].map((i) => (after.position[i] - a.position[i]) / eps) as Vec3;
    expect(norm(sub(slopeA, a.velocity))).toBeLessThan(1e-3);
    const before = engine.sample(b.time - eps)!;
    const slopeB = [0, 1, 2].map((i) => (b.position[i] - before.position[i]) / eps) as Vec3;
    expect(norm(sub(slopeB, b.velocity))).toBeLessThan(1e-3);
  });

  it("returns a velocity that is the time derivative of the line it draws", () => {
    const t = a.time + 0.37 * (b.time - a.time);
    const eps = 0.05;
    const lo = engine.sample(t - eps)!.position;
    const hi = engine.sample(t + eps)!.position;
    const fd = [0, 1, 2].map((i) => (hi[i] - lo[i]) / (2 * eps)) as Vec3;
    expect(norm(sub(fd, engine.sample(t)!.velocity))).toBeLessThan(1e-3);
  });

  it("says so, in kilometres, when gravity alone does not reach the next state", () => {
    const report = engine.report();
    expect(report.intervals).toHaveLength(1);
    expect(report.maxPositionKm).toBeGreaterThan(100);
    expect(report.rmsPositionKm).toBe(report.maxPositionKm);
    expect(report.maxVelocityKmS).toBeGreaterThan(0.1);
  });

  it("has no state before the file, after it, or in the time between two segments", () => {
    expect(engine.sample(a.time - 1)).toBeNull();
    expect(engine.sample(b.time + 1)).toBeNull();

    const two = oemOf([
      [
        { time: T0, r: [7000, 0, 0], v: [0, 7.5, 0] },
        { time: T0 + 60, r: [6990, 450, 0], v: [-0.5, 7.5, 0] },
      ],
      [
        { time: T0 + 600, r: [0, 7000, 0], v: [-7.5, 0, 0] },
        { time: T0 + 660, r: [-450, 6990, 0], v: [-7.5, -0.5, 0] },
      ],
    ]);
    const split = new FlightEngine(two);
    expect(split.sample(T0 + 300)).toBeNull();
    expect(split.sample(T0 + 30)?.segmentIndex).toBe(0);
    expect(split.sample(T0 + 630)?.segmentIndex).toBe(1);
    expect(split.report().intervals).toHaveLength(2);
    expect(split.path(10).map((segment) => segment.length)).toEqual([7, 7]);
    expect(split.bounds()).toEqual({ start: T0, stop: T0 + 660 });
  });
});

describe("the drawn path", () => {
  const start = circular(650, 51.6);
  const file = oemOf([flown(start, [0, 90, 300, 301, 900])]);
  const engine = new FlightEngine(file);

  it("includes every state epoch, ascending, with the file's own states at them", () => {
    const [line] = engine.path(30);
    const times = line.map((s) => s.time);
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(new Set(times).size).toBe(times.length);
    for (const state of file.segments[0].states) {
      const hit = line.find((s) => s.time === state.time);
      expect(hit?.atState).toBe(true);
      expect(hit?.position).toEqual(state.position);
    }
  });

  it("is the same line sample() gives", () => {
    const [line] = engine.path(30);
    for (const s of line.filter((x) => !x.atState).slice(0, 12)) {
      const direct = engine.sample(s.time)!;
      expect(norm(sub(s.position, direct.position))).toBeLessThan(1e-6);
      expect(norm(sub(s.velocity, direct.velocity))).toBeLessThan(1e-8);
    }
  });

  it("never has more samples than it was allowed", () => {
    const [line] = engine.path(1, 50);
    expect(line.length).toBeLessThanOrEqual(50 + file.segments[0].states.length);
  });
});

describe("the blend weight", () => {
  it("is 0 and 1 at the ends, flat at both, and 1/2 in the middle", () => {
    expect(blendWeight(0)).toEqual({ w: 0, dw: 0 });
    expect(blendWeight(1)).toEqual({ w: 1, dw: 0 });
    expect(blendWeight(0.5).w).toBe(0.5);
    expect(blendWeight(-1).w).toBe(0);
    expect(blendWeight(2).w).toBe(1);
  });
});
