// The satellite as the globes need it: where it is over the Earth, and which way its ground track
// is pointing. Read from the flight engine. Nothing here writes a state.

import { earthFixedToGeodetic, gcrfToEarthFixed } from "../frame";
import type { FlightEngine, FlightSample } from "../engine/flight";
import type { SatelliteView } from "./camera";

const DEG = Math.PI / 180;

export type TrackPoint = { lon: number; lat: number; altKm: number };

/** Longitude and latitude in radians and altitude in km, for one engine sample. */
export function trackPoint(sample: FlightSample): TrackPoint {
  const g = earthFixedToGeodetic(gcrfToEarthFixed(sample.position, sample.time));
  return { lon: g.longitudeDeg * DEG, lat: g.latitudeDeg * DEG, altKm: g.altitudeKm };
}

function wrapPi(a: number): number {
  let x = (a + Math.PI) % (2 * Math.PI);
  if (x < 0) x += 2 * Math.PI;
  return x - Math.PI;
}

/** The satellite at `time`, or null when the file has no state then. The heading is from one second either side. */
export function satelliteView(engine: FlightEngine, time: number): SatelliteView | null {
  const here = engine.sample(time);
  if (here === null) return null;
  const point = trackPoint(here);

  const before = engine.sample(time - 1);
  const after = engine.sample(time + 1);
  const a = trackPoint(before ?? here);
  const b = trackPoint(after ?? here);
  const east = wrapPi(b.lon - a.lon) * Math.cos(point.lat);
  const north = b.lat - a.lat;
  const length = Math.hypot(east, north);
  return {
    lon: point.lon,
    lat: point.lat,
    altKm: point.altKm,
    headEast: length === 0 ? 1 : east / length,
    headNorth: length === 0 ? 0 : north / length,
  };
}
