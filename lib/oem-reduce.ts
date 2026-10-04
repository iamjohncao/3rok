// Reduces a candidate OEM to the two numbers the ranker takes from an orbit: a mean
// altitude and an inclination. Both are derived from the states the file carries, and
// both are labeled derived. Nothing here writes a state, fills a value the file does not
// give, or looks at a case. LTAN and shield thickness are not in an OEM, so they are not
// read here (lib/holdout.ts reads them from the case's own records).
//
// The envelope is the one the physics service enforces: 500 to 2000 km, and an inclination
// within 2 degrees of 30 or of the sun-synchronous inclination at that altitude. This file
// refuses early so a file the ranker would refuse never costs a service call.

import { EARTH_EQUATORIAL_RADIUS_KM, EARTH_MU_KM3_S2, cross, norm } from "./frame";
import { formatIssue, parseOem, type Vec3 } from "./oem";

export const MIN_ALTITUDE_KM = 500;
export const MAX_ALTITUDE_KM = 2000;
/** A file whose radius moves by this much or more is not one circular LEO. */
export const MAX_RADIUS_SPREAD_KM = 50;
export const ENVELOPE_INCLINATION_DEG = 30;
export const INCLINATION_TOLERANCE_DEG = 2;

// The two constants below are the physics package's own (starmind-physics/params.yaml,
// earth.J2 and earth.year_days). lib/oem-reduce.test.ts reads that file and fails if they
// drift.
export const EARTH_J2 = 1.08263e-3;
export const TROPICAL_YEAR_DAYS = 365.2422;

/** Sun-synchronous inclination for a circular orbit at this altitude, degrees. Same J2 match the package uses. */
export function sunSynchronousInclinationDeg(altitudeKm: number): number {
  const a = EARTH_EQUATORIAL_RADIUS_KM + altitudeKm;
  const n = Math.sqrt(EARTH_MU_KM3_S2 / a ** 3);
  const sunRate = (2 * Math.PI) / (TROPICAL_YEAR_DAYS * 86400);
  const cosI = -(2 * sunRate) / (3 * EARTH_J2 * n * (EARTH_EQUATORIAL_RADIUS_KM / a) ** 2);
  return (Math.acos(Math.min(1, Math.max(-1, cosI))) * 180) / Math.PI;
}

export type ReducedOrbit = {
  /** Mean of |position| minus the equatorial radius, over every state in the file. */
  altitude_km: number;
  /** Mean of the inclinations of the states' angular-momentum vectors, from the GCRF equator. */
  inclination_deg: number;
  /** What the score call asks for: `"sso"` when the orbit is sun-synchronous, else the derived inclination near 30. */
  score_inclination: "sso" | number;
  /** Largest minus smallest |position| across the file, km. */
  radius_spread_km: number;
  state_count: number;
  value_status: "derived";
};

export type ReduceResult = { ok: true; orbit: ReducedOrbit } | { ok: false; refusals: string[] };

const MAX_PROFILE_ISSUES_SHOWN = 3;

const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const km = (value: number) => `${value.toFixed(1)} km`;

/** Reduces OEM text. Refuses a file that fails the OEM profile, or one the ranker would refuse. */
export function reduceOem(text: string): ReduceResult {
  const parsed = parseOem(text, { thisAppWrote: true });
  if (!parsed.ok) {
    const shown = parsed.errors.slice(0, MAX_PROFILE_ISSUES_SHOWN).map(formatIssue);
    const more = parsed.errors.length - shown.length;
    return {
      ok: false,
      refusals: [
        `The file does not pass the OEM profile. ${shown.join(" ")}${more > 0 ? ` And ${more} more.` : ""}`,
      ],
    };
  }

  const states = parsed.oem.segments.flatMap((segment) => segment.states);
  const radii = states.map((state) => norm(state.position));
  const meanRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
  const spread = Math.max(...radii) - Math.min(...radii);
  const altitude = meanRadius - EARTH_EQUATORIAL_RADIUS_KM;

  const refusals: string[] = [];
  if (spread >= MAX_RADIUS_SPREAD_KM) {
    refusals.push(
      `The distance from Earth's center changes by ${km(spread)} across the file. The ranker scores one circular orbit, and this file varies by ${MAX_RADIUS_SPREAD_KM} km or more.`,
    );
  }
  if (altitude < MIN_ALTITUDE_KM || altitude > MAX_ALTITUDE_KM) {
    refusals.push(
      `The mean altitude is ${km(altitude)}. The ranker scores ${MIN_ALTITUDE_KM} to ${MAX_ALTITUDE_KM} km.`,
    );
  }

  const inclinations: number[] = [];
  for (const state of states) {
    const momentum = cross(state.position as Vec3, state.velocity as Vec3);
    const magnitude = norm(momentum);
    if (magnitude === 0) {
      refusals.push("A state has no angular momentum, so the inclination is undefined.");
      return { ok: false, refusals };
    }
    inclinations.push(toDegrees(Math.acos(Math.min(1, Math.max(-1, momentum[2] / magnitude)))));
  }
  const inclination = inclinations.reduce((sum, i) => sum + i, 0) / inclinations.length;

  const sso = sunSynchronousInclinationDeg(altitude);
  const nearEnvelope = Math.abs(inclination - ENVELOPE_INCLINATION_DEG) <= INCLINATION_TOLERANCE_DEG;
  const nearSso = Math.abs(inclination - sso) <= INCLINATION_TOLERANCE_DEG;
  if (!nearEnvelope && !nearSso) {
    refusals.push(
      `The inclination is ${inclination.toFixed(1)} degrees. The ranker scores ${ENVELOPE_INCLINATION_DEG} degrees (within ${INCLINATION_TOLERANCE_DEG}) or sun-synchronous (${sso.toFixed(1)} degrees at this altitude, within ${INCLINATION_TOLERANCE_DEG}).`,
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  return {
    ok: true,
    orbit: {
      altitude_km: altitude,
      inclination_deg: inclination,
      score_inclination: nearEnvelope ? inclination : "sso",
      radius_spread_km: spread,
      state_count: states.length,
      value_status: "derived",
    },
  };
}
