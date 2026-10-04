// The line the globes draw, as instances: one per pair of neighbouring samples, with the two ends'
// longitude, latitude and altitude and their times. A line that crosses the date line is cut in two
// copies, each running off the edge of the map by the one extra turn, so the map never shows a
// stroke across its whole width. On the globe the extra turn is the same place.

import { RADIUS_KM } from "./projection";

export type PathVertex = {
  /** Seconds from the start of the file. Float32 holds this exactly for any file under a few days. */
  t: number;
  lon: number;
  lat: number;
  altKm: number;
};

/** Floats per instance: lon, lat, altitude (radii) for each end, then the two times. */
export const INSTANCE_FLOATS = 8;
const TWO_PI = 2 * Math.PI;

function push(out: number[], a: PathVertex, aLon: number, b: PathVertex, bLon: number) {
  out.push(aLon, a.lat, a.altKm / RADIUS_KM, bLon, b.lat, b.altKm / RADIUS_KM, a.t, b.t);
}

/** One list of vertices per segment of the file. Segments are never joined. */
export function pathInstances(segments: PathVertex[][]): Float32Array {
  const out: number[] = [];
  for (const line of segments) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const d = b.lon - a.lon;
      if (Math.abs(d) <= Math.PI) {
        push(out, a, a.lon, b, b.lon);
      } else {
        const turn = d > 0 ? TWO_PI : -TWO_PI;
        push(out, a, a.lon, b, b.lon - turn);
        push(out, a, a.lon + turn, b, b.lon);
      }
    }
  }
  return new Float32Array(out);
}

/** Meridians every 30 degrees and parallels every 30, in 5 degree pieces, just above the surface. */
export function graticuleInstances(): Float32Array {
  const out: number[] = [];
  const lift = 0.0015;
  const rad = (d: number) => (d * Math.PI) / 180;
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 5) out.push(rad(lon), rad(lat), lift, rad(lon), rad(lat + 5), lift, 0, 0);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 5) out.push(rad(lon), rad(lat), lift, rad(lon + 5), rad(lat), lift, 0, 0);
  }
  return new Float32Array(out);
}
