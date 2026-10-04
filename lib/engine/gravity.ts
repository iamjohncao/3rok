// The gravity the flight engine flies in: a point mass plus the J2 term, about a pole the
// caller names (the mean pole of date, from lib/frame.ts). Nothing else. No drag, because the
// case states no area or mass. No thrust, no third body, no radiation pressure.

import type { Vec3 } from "../oem";
import { EARTH_EQUATORIAL_RADIUS_KM, EARTH_MU_KM3_S2 } from "../frame";
import { dot, norm } from "./vec";

export const MU_KM3_S2 = EARTH_MU_KM3_S2;
export const RADIUS_KM = EARTH_EQUATORIAL_RADIUS_KM;
/** Second zonal harmonic, EGM2008. */
export const J2 = 1.08262668e-3;

export type GravityModel = {
  /** Include the J2 term. Off gives pure two-body motion, which tests use. */
  j2: boolean;
  /** Unit vector of the pole, in the frame of the state. */
  pole: Vec3;
};

export const GRAVITY_NAME = "point mass + J2";

/** Acceleration, km/s^2, at GCRF position `r`, km. */
export function acceleration(r: Vec3, model: GravityModel): Vec3 {
  const r2 = dot(r, r);
  const rn = Math.sqrt(r2);
  const k = -MU_KM3_S2 / (r2 * rn);
  let ax = k * r[0];
  let ay = k * r[1];
  let az = k * r[2];
  if (model.j2) {
    // a = 3/2 J2 mu R^2 / r^5 [ (5 z^2 / r^2 - 1) r - 2 z p ], with z the height above the equatorial plane.
    const z = dot(r, model.pole);
    const c = (1.5 * J2 * MU_KM3_S2 * RADIUS_KM * RADIUS_KM) / (r2 * r2 * rn);
    const t = 5 * ((z * z) / r2) - 1;
    ax += c * (t * r[0] - 2 * z * model.pole[0]);
    ay += c * (t * r[1] - 2 * z * model.pole[1]);
    az += c * (t * r[2] - 2 * z * model.pole[2]);
  }
  return [ax, ay, az];
}

/** Specific mechanical energy, km^2/s^2, with the point-mass potential. Conserved by pure two-body motion. */
export function specificEnergy(r: Vec3, v: Vec3): number {
  return 0.5 * dot(v, v) - MU_KM3_S2 / norm(r);
}
