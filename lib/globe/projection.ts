// Where a longitude, latitude and altitude is drawn: a point on a sphere, or a point on a plate
// carree map, or a point partway between. The GLSL in lib/globe/shaders.ts does the same
// arithmetic; the browser test checks that the marker lands where this file says it does.
//
// World axes: +Y is north, +Z points at longitude 0, +X points at longitude 90 east. One unit is
// one Earth radius. On the map x is the longitude in radians and y is the latitude in radians.

import { EARTH_EQUATORIAL_RADIUS_KM } from "../frame";
import type { Vec3 } from "../oem";

export const RADIUS_KM = EARTH_EQUATORIAL_RADIUS_KM;
/** How far the surface lifts off the sphere in the middle of its fold, in Earth radii. */
export const FOLD_BULGE = 0.35;

export const smoothstep = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** A unit vector from the centre of the Earth through this longitude and latitude, radians. */
export function surfaceNormal(lon: number, lat: number): Vec3 {
  return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/** Altitude in kilometres to Earth radii. */
export const altitudeUnits = (altKm: number): number => altKm / RADIUS_KM;

export function spherePoint(lon: number, lat: number, altUnits: number): Vec3 {
  const s = 1 + altUnits;
  const n = surfaceNormal(lon, lat);
  return [s * n[0], s * n[1], s * n[2]];
}

export function mapPoint(lon: number, lat: number, lift: number): Vec3 {
  return [lon, lat, lift];
}

/**
 * The point at fold progress `e` in [0, 1]: 0 is the sphere, 1 is the map. The surface moves in a
 * straight line from one to the other and lifts away from the centre by FOLD_BULGE at the middle, so
 * it peels open and does not cut through itself. `lift` is the layer's height above the map plane.
 */
export function foldPoint(lon: number, lat: number, altUnits: number, e: number, lift = 0): Vec3 {
  const s = spherePoint(lon, lat, altUnits);
  const m = mapPoint(lon, lat, lift);
  const n = surfaceNormal(lon, lat);
  const bulge = FOLD_BULGE * Math.sin(Math.PI * e);
  return [s[0] + (m[0] - s[0]) * e + n[0] * bulge, s[1] + (m[1] - s[1]) * e + n[1] * bulge, s[2] + (m[2] - s[2]) * e + n[2] * bulge];
}

/**
 * One particle's own fold progress. Each folds on its own schedule, so the sphere unrolls as a wave
 * out from the longitude `delay` is measured from and not as one sheet. `delay` is in [0, 1).
 */
export function particleFold(flat: number, delay: number): number {
  return smoothstep((flat - 0.5 * delay) / 0.5);
}
