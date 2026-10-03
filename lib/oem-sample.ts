// Reads a state out of a parsed OEM at any instant. The testing page samples
// the file with this. It never asks a model for the next state and never
// interpolates across a META_START boundary: between two segments there is no
// state to read.

import type { Oem, OemSegment, OemState, Vec3 } from "./oem";

export type OemSample = {
  /** Seconds since 1970-01-01T00:00:00Z (UTC). */
  time: number;
  segmentIndex: number;
  /** GCRF position, km. */
  position: Vec3;
  /** GCRF velocity, km/s. */
  velocity: Vec3;
  /** GCRF acceleration, km/s^2. Null unless the file carries it. */
  acceleration: Vec3 | null;
  method: "linear" | "hermite";
  /** True when `time` is exactly a state epoch, so nothing was interpolated. */
  atState: boolean;
  /** Set when the file names an interpolation this code does not use. */
  note: string | null;
};

export function oemTimeBounds(oem: Oem): { start: number; stop: number } {
  const first = oem.segments[0].states[0];
  const lastSegment = oem.segments[oem.segments.length - 1];
  return { start: first.time, stop: lastSegment.states[lastSegment.states.length - 1].time };
}

type Method = { kind: "linear" | "hermite"; note: string | null };

// The file's INTERPOLATION when this code can do it: LINEAR, or HERMITE of degree 3
// (cubic Hermite on the two states that bracket the instant). Anything else falls
// back to linear, and the sample says so.
function methodFor(segment: OemSegment): Method {
  const name = segment.interpolation?.toUpperCase() ?? null;
  if (name === null || name === "LINEAR") return { kind: "linear", note: null };
  if (name === "HERMITE" && segment.interpolationDegree === 3) return { kind: "hermite", note: null };
  const asked = segment.interpolationDegree === null ? name : `${name} degree ${segment.interpolationDegree}`;
  return { kind: "linear", note: `The file asks for ${asked}. This page interpolates linearly.` };
}

function lerp(a: Vec3, b: Vec3, u: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function hermite(a: OemState, b: OemState, time: number): { position: Vec3; velocity: Vec3 } {
  const h = b.time - a.time;
  const u = (time - a.time) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  const position = [0, 1, 2].map(
    (i) => h00 * a.position[i] + h10 * h * a.velocity[i] + h01 * b.position[i] + h11 * h * b.velocity[i],
  ) as Vec3;
  const velocity = [0, 1, 2].map(
    (i) => (d00 * a.position[i] + d10 * h * a.velocity[i] + d01 * b.position[i] + d11 * h * b.velocity[i]) / h,
  ) as Vec3;
  return { position, velocity };
}

// Index i of the last state whose time is at or before `time`, for time inside the segment.
function bracketStart(states: OemState[], time: number): number {
  let low = 0;
  let high = states.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (states[mid].time <= time) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, states.length - 2);
}

/** The state at `time`, or null when no segment of the file covers that instant. */
export function sampleOem(oem: Oem, time: number): OemSample | null {
  for (let segmentIndex = 0; segmentIndex < oem.segments.length; segmentIndex++) {
    const segment = oem.segments[segmentIndex];
    const { states } = segment;
    if (time < states[0].time || time > states[states.length - 1].time) continue;

    const { kind, note } = methodFor(segment);
    const i = bracketStart(states, time);
    const a = states[i];
    const b = states[i + 1];

    const exact = time === a.time ? a : time === b.time ? b : null;
    if (exact) {
      return {
        time,
        segmentIndex,
        position: exact.position,
        velocity: exact.velocity,
        acceleration: exact.acceleration,
        method: kind,
        atState: true,
        note,
      };
    }

    const u = (time - a.time) / (b.time - a.time);
    const acceleration = a.acceleration && b.acceleration ? lerp(a.acceleration, b.acceleration, u) : null;
    if (kind === "hermite") {
      const { position, velocity } = hermite(a, b, time);
      return { time, segmentIndex, position, velocity, acceleration, method: kind, atState: false, note };
    }
    return {
      time,
      segmentIndex,
      position: lerp(a.position, b.position, u),
      velocity: lerp(a.velocity, b.velocity, u),
      acceleration,
      method: kind,
      atState: false,
      note,
    };
  }
  return null;
}

/**
 * Evenly spaced samples along each segment, for drawing. One list per segment,
 * so a line is never drawn across a discontinuity. Every state epoch is
 * included, and no segment gets more than `maxPoints` samples.
 */
export function samplePath(oem: Oem, stepSeconds: number, maxPoints = 4000): OemSample[][] {
  return oem.segments.map((segment) => {
    const first = segment.states[0].time;
    const last = segment.states[segment.states.length - 1].time;
    const step = Math.max(stepSeconds, (last - first) / maxPoints);
    const times = new Set<number>(segment.states.map((state) => state.time));
    for (let t = first + step; t < last; t += step) times.add(t);

    return [...times]
      .sort((x, y) => x - y)
      .map((t) => sampleOem({ ...oem, segments: [segment] }, t))
      .filter((sample): sample is OemSample => sample !== null)
      .map((sample) => ({ ...sample, segmentIndex: oem.segments.indexOf(segment) }));
  });
}
