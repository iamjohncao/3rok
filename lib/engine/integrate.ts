// Dormand-Prince 5(4) with an adaptive step. It integrates one state forward or backward in
// time under lib/engine/gravity.ts. Deterministic: the same input gives the same bits.

import type { Vec3 } from "../oem";
import { acceleration, type GravityModel } from "./gravity";

export type State = { r: Vec3; v: Vec3 };

export type PropagateOptions = {
  model: GravityModel;
  /** Relative tolerance per component. */
  rtol?: number;
  /** Absolute tolerance floor: km for position, km/s for velocity. */
  atol?: number;
  /** Longest single step, seconds. */
  maxStep?: number;
};

const DEFAULT_RTOL = 1e-11;
const DEFAULT_ATOL = 1e-10;
const DEFAULT_MAX_STEP = 60;
const MIN_STEP = 1e-6;
const MAX_STEPS = 200_000;

// Dormand-Prince coefficients.
const A21 = 1 / 5;
const A31 = 3 / 40, A32 = 9 / 40;
const A41 = 44 / 45, A42 = -56 / 15, A43 = 32 / 9;
const A51 = 19372 / 6561, A52 = -25360 / 2187, A53 = 64448 / 6561, A54 = -212 / 729;
const A61 = 9017 / 3168, A62 = -355 / 33, A63 = 46732 / 5247, A64 = 49 / 176, A65 = -5103 / 18656;
const A71 = 35 / 384, A73 = 500 / 1113, A74 = 125 / 192, A75 = -2187 / 6784, A76 = 11 / 84;
const E1 = 71 / 57600, E3 = -71 / 16695, E4 = 71 / 1920, E5 = -17253 / 339200, E6 = 22 / 525, E7 = -1 / 40;

type Y = [number, number, number, number, number, number];
type Deriv = Y;

function deriv(y: Y, model: GravityModel): Deriv {
  const a = acceleration([y[0], y[1], y[2]], model);
  return [y[3], y[4], y[5], a[0], a[1], a[2]];
}

function comb(y: Y, h: number, terms: [number, Deriv][]): Y {
  const out: Y = [y[0], y[1], y[2], y[3], y[4], y[5]];
  for (const [c, k] of terms) {
    const f = h * c;
    for (let i = 0; i < 6; i++) out[i] += f * k[i];
  }
  return out;
}

type StepResult = { y: Y; err: number; k7: Deriv };

function step(y: Y, k1: Deriv, h: number, model: GravityModel, rtol: number, atol: number): StepResult {
  const k2 = deriv(comb(y, h, [[A21, k1]]), model);
  const k3 = deriv(comb(y, h, [[A31, k1], [A32, k2]]), model);
  const k4 = deriv(comb(y, h, [[A41, k1], [A42, k2], [A43, k3]]), model);
  const k5 = deriv(comb(y, h, [[A51, k1], [A52, k2], [A53, k3], [A54, k4]]), model);
  const k6 = deriv(comb(y, h, [[A61, k1], [A62, k2], [A63, k3], [A64, k4], [A65, k5]]), model);
  const next = comb(y, h, [[A71, k1], [A73, k3], [A74, k4], [A75, k5], [A76, k6]]);
  const k7 = deriv(next, model);
  let err = 0;
  for (let i = 0; i < 6; i++) {
    const e = h * (E1 * k1[i] + E3 * k3[i] + E4 * k4[i] + E5 * k5[i] + E6 * k6[i] + E7 * k7[i]);
    const scaleI = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(next[i]));
    err = Math.max(err, Math.abs(e) / scaleI);
  }
  return { y: next, err, k7 };
}

/**
 * A stepper that moves one state through time, forward or backward, and can be asked for the
 * state at each of a list of offsets, nearest first. One pass costs the same as one propagation
 * to the farthest offset.
 */
class Stepper {
  private y: Y;
  private k1: Deriv;
  private elapsed = 0;
  private h: number;
  private steps = 0;
  private readonly rtol: number;
  private readonly atol: number;
  private readonly maxStep: number;

  constructor(
    state: State,
    private readonly model: GravityModel,
    options: PropagateOptions,
    private readonly direction: 1 | -1,
  ) {
    this.y = [state.r[0], state.r[1], state.r[2], state.v[0], state.v[1], state.v[2]];
    this.k1 = deriv(this.y, model);
    this.rtol = options.rtol ?? DEFAULT_RTOL;
    this.atol = options.atol ?? DEFAULT_ATOL;
    this.maxStep = options.maxStep ?? DEFAULT_MAX_STEP;
    this.h = Math.min(10, this.maxStep);
  }

  /** Advance to `distance` seconds from the start in this stepper's direction (distance >= current). */
  advanceTo(distance: number): State {
    while (this.elapsed < distance) {
      if (++this.steps > MAX_STEPS) throw new Error("The propagator took too many steps. The state may be inside the Earth.");
      const remaining = distance - this.elapsed;
      const h = Math.min(this.h, remaining, this.maxStep);
      const { y, err, k7 } = step(this.y, this.k1, this.direction * h, this.model, this.rtol, this.atol);
      if (!Number.isFinite(err)) throw new Error("The propagator left the finite numbers.");
      if (err <= 1 || h <= MIN_STEP) {
        this.y = y;
        this.k1 = k7;
        this.elapsed += h;
      }
      const factor = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(1 / err, 0.2)));
      this.h = Math.max(MIN_STEP, h * factor);
    }
    return { r: [this.y[0], this.y[1], this.y[2]], v: [this.y[3], this.y[4], this.y[5]] };
  }
}

/** The state `dt` seconds after `state` (before it, when dt is negative). */
export function propagate(state: State, dt: number, options: PropagateOptions): State {
  if (dt === 0) return { r: [...state.r], v: [...state.v] };
  return new Stepper(state, options.model, options, dt > 0 ? 1 : -1).advanceTo(Math.abs(dt));
}

/**
 * The states at each offset in `offsets`, seconds from `state`. All offsets must be on one side
 * of zero and sorted nearest first (for example 5, 10, 60 or -5, -10, -60).
 */
export function propagateThrough(state: State, offsets: number[], options: PropagateOptions): State[] {
  if (offsets.length === 0) return [];
  const direction = offsets[0] >= 0 ? 1 : -1;
  const stepper = new Stepper(state, options.model, options, direction);
  let previous = 0;
  return offsets.map((offset) => {
    const distance = offset * direction;
    if (distance < previous) throw new Error("Offsets must be sorted nearest first and on one side of zero.");
    previous = distance;
    return distance === 0 ? { r: [...state.r] as Vec3, v: [...state.v] as Vec3 } : stepper.advanceTo(distance);
  });
}
