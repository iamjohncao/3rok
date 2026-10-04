// Classical orbital elements from a GCRF state. For readings labeled derived. The elements are
// osculating: they describe the two-body orbit that fits this one state, not a mean orbit.

import type { Vec3 } from "../oem";
import { MU_KM3_S2, RADIUS_KM } from "./gravity";
import { cross, dot, norm, scale, sub } from "./vec";

export type Elements = {
  /** Semi-major axis, km. Null on a parabola. Negative on a hyperbola. */
  semiMajorAxisKm: number | null;
  eccentricity: number;
  inclinationDeg: number;
  /** Right ascension of the ascending node, degrees. Null when the orbit is equatorial. */
  raanDeg: number | null;
  /** Argument of perigee, degrees. Null on a circle or when the node is undefined. */
  argumentOfPerigeeDeg: number | null;
  trueAnomalyDeg: number | null;
  /** Orbital period, seconds. Null unless the orbit is closed. */
  periodS: number | null;
  /** Perigee and apogee heights above the equatorial radius, km. Apogee is null unless the orbit is closed. */
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number | null;
};

const EPS = 1e-11;
const deg = (radians: number) => (radians * 180) / Math.PI;
const wrap = (angle: number) => (angle < 0 ? angle + 2 * Math.PI : angle);

export function elementsOf(r: Vec3, v: Vec3): Elements {
  const rn = norm(r);
  const h = cross(r, v);
  const hn = norm(h);
  const node: Vec3 = [-h[1], h[0], 0];
  const nn = norm(node);
  const eVec = sub(scale(r, dot(v, v) / MU_KM3_S2 - 1 / rn), scale(v, dot(r, v) / MU_KM3_S2));
  const e = norm(eVec);
  const energy = 0.5 * dot(v, v) - MU_KM3_S2 / rn;

  const closed = energy < -EPS;
  const a = Math.abs(energy) < EPS ? null : -MU_KM3_S2 / (2 * energy);
  const perigeeRadius = hn * hn / (MU_KM3_S2 * (1 + e));

  const equatorial = nn < 1e-9 * hn;
  const circular = e < 1e-9;

  const raan = equatorial ? null : deg(wrap(Math.atan2(node[1], node[0])));
  let argPerigee: number | null = null;
  if (!equatorial && !circular) {
    const c = dot(node, eVec) / (nn * e);
    argPerigee = deg(eVec[2] >= 0 ? Math.acos(Math.max(-1, Math.min(1, c))) : 2 * Math.PI - Math.acos(Math.max(-1, Math.min(1, c))));
  }
  let trueAnomaly: number | null = null;
  if (!circular) {
    const c = dot(eVec, r) / (e * rn);
    const angle = Math.acos(Math.max(-1, Math.min(1, c)));
    trueAnomaly = deg(dot(r, v) >= 0 ? angle : 2 * Math.PI - angle);
  }

  return {
    semiMajorAxisKm: a,
    eccentricity: e,
    inclinationDeg: deg(Math.acos(Math.max(-1, Math.min(1, h[2] / hn)))),
    raanDeg: raan,
    argumentOfPerigeeDeg: argPerigee,
    trueAnomalyDeg: trueAnomaly,
    periodS: closed && a !== null ? 2 * Math.PI * Math.sqrt((a * a * a) / MU_KM3_S2) : null,
    perigeeAltitudeKm: perigeeRadius - RADIUS_KM,
    apogeeAltitudeKm: closed && a !== null ? a * (1 + e) - RADIUS_KM : null,
  };
}
