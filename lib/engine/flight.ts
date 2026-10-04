// The flight engine. It reads a parsed OEM and answers: where is the satellite at this instant,
// and how does the line run between the file's states.
//
// The OEM is the flight. This never writes a state, never replaces one, never changes the file.
// At every epoch the file gives, the answer is the file's own state, to the last bit. Between
// two states the engine flies gravity alone (lib/engine/gravity.ts): forward from the earlier
// state, backward from the later one, blended with a weight that has zero slope at both ends.
// So the line passes through every state and leaves each one with the file's velocity. When the
// file is itself a gravity-only orbit the two flights agree and the blend adds nothing. When it
// is not, the gap between them is the mismatch, and the engine reports it and does not guess why.
//
// A META_START boundary stays a boundary. An instant between two segments has no state.

import { meanPoleGcrf } from "../frame";
import type { Oem, OemSegment, OemState, Vec3 } from "../oem";
import { GRAVITY_NAME, RADIUS_KM, type GravityModel } from "./gravity";
import { propagate, propagateThrough, type PropagateOptions, type State } from "./integrate";
import { norm, sub } from "./vec";

export type FlightSample = {
  /** Seconds since 1970-01-01T00:00:00Z (UTC). */
  time: number;
  segmentIndex: number;
  /** GCRF position, km. */
  position: Vec3;
  /** GCRF velocity, km/s. The time derivative of the line the engine draws. */
  velocity: Vec3;
  /** True when `time` is a state epoch in the file, so the state is the file's own. */
  atState: boolean;
};

export type IntervalMismatch = {
  segmentIndex: number;
  fromTime: number;
  toTime: number;
  /** Where gravity alone takes the earlier state, minus the later state's position, km. */
  positionKm: number;
  /** The same for velocity, km/s. */
  velocityKmS: number;
};

export type FlightReport = {
  gravity: typeof GRAVITY_NAME;
  stateCount: number;
  intervals: IntervalMismatch[];
  maxPositionKm: number;
  maxVelocityKmS: number;
  /** Root mean square of the intervals' position mismatch, km. 0 for a file with no interval. */
  rmsPositionKm: number;
};

/** The weight of the backward flight at fraction u of an interval: 0 at the earlier state, 1 at the later, flat at both. */
export function blendWeight(u: number): { w: number; dw: number } {
  const c = Math.min(1, Math.max(0, u));
  return { w: c * c * (3 - 2 * c), dw: 6 * c * (1 - c) };
}

function stateOf(s: OemState): State {
  return { r: s.position, v: s.velocity };
}

type Interval = { segmentIndex: number; a: OemState; b: OemState; options: PropagateOptions };

function mix(forward: State, backward: State, u: number, span: number): { position: Vec3; velocity: Vec3 } {
  const { w, dw } = blendWeight(u);
  const position: Vec3 = [0, 0, 0];
  const velocity: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    position[i] = (1 - w) * forward.r[i] + w * backward.r[i];
    // d/dt of the blend: the weights move with time, so the gap between the flights adds a term.
    velocity[i] = (1 - w) * forward.v[i] + w * backward.v[i] + ((dw / span) * (backward.r[i] - forward.r[i]));
  }
  return { position, velocity };
}

/** The mean of |position| over every state, less the equatorial radius, km. The same definition lib/oem-reduce.ts uses. */
export function meanAltitudeKm(oem: Oem): number {
  let sum = 0;
  let n = 0;
  for (const segment of oem.segments) {
    for (const state of segment.states) {
      sum += norm(state.position);
      n++;
    }
  }
  return n === 0 ? NaN : sum / n - RADIUS_KM;
}

export class FlightEngine {
  private readonly cache = new Map<string, IntervalMismatch>();
  private cachedReport: FlightReport | null = null;

  constructor(
    readonly oem: Oem,
    private readonly gravity: { j2: boolean } = { j2: true },
  ) {}

  bounds(): { start: number; stop: number } {
    const first = this.oem.segments[0].states[0];
    const last = this.oem.segments[this.oem.segments.length - 1];
    return { start: first.time, stop: last.states[last.states.length - 1].time };
  }

  private optionsFor(a: OemState, b: OemState): PropagateOptions {
    const model: GravityModel = { j2: this.gravity.j2, pole: meanPoleGcrf((a.time + b.time) / 2) };
    return { model };
  }

  private intervalAt(segment: OemSegment, segmentIndex: number, time: number): Interval {
    const { states } = segment;
    let low = 0;
    let high = states.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (states[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    const i = Math.min(low, states.length - 2);
    return { segmentIndex, a: states[i], b: states[i + 1], options: this.optionsFor(states[i], states[i + 1]) };
  }

  /** The state at `time`, or null when no segment of the file covers that instant. */
  sample(time: number): FlightSample | null {
    for (let segmentIndex = 0; segmentIndex < this.oem.segments.length; segmentIndex++) {
      const segment = this.oem.segments[segmentIndex];
      const { states } = segment;
      if (time < states[0].time || time > states[states.length - 1].time) continue;

      const interval = this.intervalAt(segment, segmentIndex, time);
      const { a, b, options } = interval;
      const exact = time === a.time ? a : time === b.time ? b : null;
      if (exact) {
        return { time, segmentIndex, position: exact.position, velocity: exact.velocity, atState: true };
      }
      const span = b.time - a.time;
      const forward = propagate(stateOf(a), time - a.time, options);
      const backward = propagate(stateOf(b), time - b.time, options);
      const { position, velocity } = mix(forward, backward, (time - a.time) / span, span);
      return { time, segmentIndex, position, velocity, atState: false };
    }
    return null;
  }

  /**
   * Samples along each segment, for drawing: one list per segment, so a line is never drawn across a
   * boundary. Every state epoch is included, times ascend, and no segment gets more than `maxPoints`.
   */
  path(stepSeconds: number, maxPoints = 4000): FlightSample[][] {
    return this.oem.segments.map((segment, segmentIndex) => {
      const { states } = segment;
      const first = states[0].time;
      const last = states[states.length - 1].time;
      const step = Math.max(stepSeconds, (last - first) / maxPoints);
      const out: FlightSample[] = [];

      for (let k = 0; k < states.length; k++) {
        const a = states[k];
        if (k === 0) out.push({ time: a.time, segmentIndex, position: a.position, velocity: a.velocity, atState: true });
        if (k === states.length - 1) break;
        const b = states[k + 1];
        const span = b.time - a.time;
        const count = Math.max(1, Math.ceil(span / step));
        const times: number[] = [];
        for (let m = 1; m < count; m++) times.push(a.time + (span * m) / count);

        if (times.length > 0) {
          const options = this.optionsFor(a, b);
          const forward = propagateThrough(stateOf(a), times.map((t) => t - a.time), options);
          const backward = propagateThrough(stateOf(b), [...times].reverse().map((t) => t - b.time), options).reverse();
          times.forEach((t, m) => {
            const { position, velocity } = mix(forward[m], backward[m], (t - a.time) / span, span);
            out.push({ time: t, segmentIndex, position, velocity, atState: false });
          });
        }
        out.push({ time: b.time, segmentIndex, position: b.position, velocity: b.velocity, atState: true });
      }
      return out;
    });
  }

  /** How far gravity alone, from each state, lands from the next state. */
  report(): FlightReport {
    if (this.cachedReport) return this.cachedReport;
    const intervals: IntervalMismatch[] = [];
    let stateCount = 0;
    this.oem.segments.forEach((segment, segmentIndex) => {
      stateCount += segment.states.length;
      for (let k = 0; k + 1 < segment.states.length; k++) {
        const a = segment.states[k];
        const b = segment.states[k + 1];
        const key = `${segmentIndex}:${k}`;
        let entry = this.cache.get(key);
        if (!entry) {
          const flown = propagate(stateOf(a), b.time - a.time, this.optionsFor(a, b));
          entry = {
            segmentIndex,
            fromTime: a.time,
            toTime: b.time,
            positionKm: norm(sub(flown.r, b.position)),
            velocityKmS: norm(sub(flown.v, b.velocity)),
          };
          this.cache.set(key, entry);
        }
        intervals.push(entry);
      }
    });
    const maxPositionKm = intervals.reduce((m, i) => Math.max(m, i.positionKm), 0);
    const maxVelocityKmS = intervals.reduce((m, i) => Math.max(m, i.velocityKmS), 0);
    const rmsPositionKm = intervals.length === 0 ? 0 : Math.sqrt(intervals.reduce((s, i) => s + i.positionKm ** 2, 0) / intervals.length);
    this.cachedReport = { gravity: GRAVITY_NAME, stateCount, intervals, maxPositionKm, maxVelocityKmS, rmsPositionKm };
    return this.cachedReport;
  }
}
