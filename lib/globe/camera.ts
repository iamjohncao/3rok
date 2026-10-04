// The camera for both globes and the map. Two things move it: `chase`, from 0 (the whole globe or
// map in view) to 1 (the satellite in the middle of the screen, followed), and `fold`, from 0 (a
// sphere) to 1 (a map). Both are animated by the renderer. This file only turns them into matrices.

import type { Vec3 } from "../oem";
import { add, norm, scale, unit } from "../engine/vec";
import { lookAt, multiply, perspective, type Mat4 } from "./mat4";
import { altitudeUnits, foldPoint, smoothstep, spherePoint, surfaceNormal } from "./projection";

export const FOV_Y_RAD = (35 * Math.PI) / 180;
const NEAR = 0.01;
const FAR = 60;
/** Wide view of the globe: the whole sphere with room around it. */
const GLOBE_DISTANCE = 3.9;
/** Chase view of the globe: how far behind and above the satellite the camera sits, in Earth radii. */
const CHASE_DISTANCE = 0.75;
/** Chase view of the map: how much longitude it shows, half-width in radians. */
const CHASE_MAP_HALF_WIDTH = 0.5;
const MAP_MARGIN = 1.05;

export type SatelliteView = {
  lon: number;
  lat: number;
  altKm: number;
  /** The way the ground track points at the satellite: east and north parts, unit length together. */
  headEast: number;
  headNorth: number;
};

export type CameraState = {
  /** 0 sphere, 1 map. Eased inside. */
  flat: number;
  /** 0 wide, 1 chase. Eased inside. */
  chase: number;
  aspect: number;
  /** Wide view of the globe looks at this longitude and latitude, radians. */
  centerLon: number;
  centerLat: number;
  /** Wide view of the map is centred here, radians. */
  panX: number;
  panY: number;
  /** Multiplies the wide view's distance and the chase view's distance. 1 is the default; larger is closer. */
  zoom: number;
  chaseZoom: number;
  satellite: SatelliteView | null;
};

export type CameraFrame = {
  eye: Vec3;
  target: Vec3;
  up: Vec3;
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
};

function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const theta = Math.acos(d);
  if (theta < 1e-6) return a;
  if (Math.PI - theta < 1e-6) return unit(add(scale(a, 1 - t), scale(b, t)));
  const sa = Math.sin((1 - t) * theta) / Math.sin(theta);
  const sb = Math.sin(t * theta) / Math.sin(theta);
  return unit(add(scale(a, sa), scale(b, sb)));
}

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type Rig = { direction: Vec3; distance: number; up: Vec3 };

function globeRig(state: CameraState, chase: number): Rig {
  const wide: Rig = {
    direction: surfaceNormal(state.centerLon, state.centerLat),
    distance: GLOBE_DISTANCE / state.zoom,
    up: [0, 1, 0],
  };
  const sat = state.satellite;
  if (!sat || chase === 0) return wide;

  const radial = surfaceNormal(sat.lon, sat.lat);
  const east: Vec3 = [Math.cos(sat.lon), 0, -Math.sin(sat.lon)];
  const north: Vec3 = [-Math.sin(sat.lat) * Math.sin(sat.lon), Math.cos(sat.lat), -Math.sin(sat.lat) * Math.cos(sat.lon)];
  const heading = unit(add(scale(east, sat.headEast), scale(north, sat.headNorth)));
  const chaseRig: Rig = {
    direction: unit(add(scale(heading, -0.8), scale(radial, 0.6))),
    distance: CHASE_DISTANCE / state.chaseZoom,
    up: radial,
  };
  return {
    direction: slerpUnit(wide.direction, chaseRig.direction, chase),
    distance: Math.exp(lerp(Math.log(wide.distance), Math.log(chaseRig.distance), chase)),
    up: unit(lerp3(wide.up, chaseRig.up, chase)),
  };
}

function fitMapDistance(aspect: number, halfWidth: number, halfHeight: number): number {
  const t = Math.tan(FOV_Y_RAD / 2);
  return Math.max(halfWidth / (aspect * t), halfHeight / t);
}

function mapRig(state: CameraState, chase: number): Rig {
  const wideDistance = fitMapDistance(state.aspect, Math.PI * MAP_MARGIN, (Math.PI / 2) * MAP_MARGIN) / state.zoom;
  const sat = state.satellite;
  if (!sat || chase === 0) return { direction: [0, 0, 1], distance: wideDistance, up: [0, 1, 0] };
  const half = CHASE_MAP_HALF_WIDTH / state.chaseZoom;
  const chaseDistance = fitMapDistance(state.aspect, half, half / state.aspect);
  return {
    direction: [0, 0, 1],
    distance: Math.exp(lerp(Math.log(wideDistance), Math.log(chaseDistance), chase)),
    up: [0, 1, 0],
  };
}

export function cameraFrame(state: CameraState): CameraFrame {
  const fold = smoothstep(state.flat);
  const chase = smoothstep(state.chase);
  const globe = globeRig(state, chase);
  const map = mapRig(state, chase);

  // Wide: the middle of the globe, or the middle of the map. Chase: the point where the satellite is
  // drawn at this fold, so the marker stays in the middle of the screen while the globe folds.
  const wideTarget = lerp3([0, 0, 0], [state.panX, state.panY, 0], fold);
  const chaseTarget = state.satellite ? satelliteWorldPoint(state.satellite, state.flat) : wideTarget;
  const target = lerp3(wideTarget, chaseTarget, chase);

  const direction = slerpUnit(globe.direction, map.direction, fold);
  const distance = Math.exp(lerp(Math.log(globe.distance), Math.log(map.distance), fold));
  const up = unit(lerp3(globe.up, map.up, fold));
  const eye = add(target, scale(direction, distance));
  const view = lookAt(eye, target, up);
  const proj = perspective(FOV_Y_RAD, state.aspect, NEAR, FAR);
  return { eye, target, up, view, proj, viewProj: multiply(proj, view) };
}

/** Where the satellite is drawn at this fold. The camera's chase target, and what the marker uses. */
export function satelliteWorldPoint(sat: SatelliteView, flat: number): Vec3 {
  return foldPoint(sat.lon, sat.lat, altitudeUnits(sat.altKm), smoothstep(flat), 0.04);
}

/** The point on the globe a longitude and latitude point to, for tests and hit-testing. */
export const globePoint = (lon: number, lat: number): Vec3 => spherePoint(lon, lat, 0);

export { norm };
