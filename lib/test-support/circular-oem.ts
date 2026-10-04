// Test support: an OEM for a circular orbit, built from the same constants the app uses.
// Used by the reducer and holdout tests. Not imported by the app.

import { EARTH_EQUATORIAL_RADIUS_KM, EARTH_MU_KM3_S2 } from "../frame";
import { serializeOem, type Oem, type OemState, type Vec3 } from "../oem";

export type CircularOrbit = {
  altitudeKm: number;
  inclinationDeg: number;
  /** Radius change added over the file, km. Zero is a circle. */
  radiusDriftKm?: number;
  states?: number;
};

const START = Date.UTC(2026, 9, 3, 18, 0, 0);

export function circularOemText({ altitudeKm, inclinationDeg, radiusDriftKm = 0, states = 12 }: CircularOrbit): string {
  const inclination = (inclinationDeg * Math.PI) / 180;
  const list: OemState[] = [];
  for (let k = 0; k < states; k++) {
    const seconds = k * 60;
    const radius = EARTH_EQUATORIAL_RADIUS_KM + altitudeKm + (radiusDriftKm * k) / Math.max(1, states - 1);
    const speed = Math.sqrt(EARTH_MU_KM3_S2 / radius);
    const angle = (speed / radius) * seconds;
    const position: Vec3 = [
      radius * Math.cos(angle),
      radius * Math.sin(angle) * Math.cos(inclination),
      radius * Math.sin(angle) * Math.sin(inclination),
    ];
    const velocity: Vec3 = [
      -speed * Math.sin(angle),
      speed * Math.cos(angle) * Math.cos(inclination),
      speed * Math.cos(angle) * Math.sin(inclination),
    ];
    const time = START / 1000 + seconds;
    list.push({
      epoch: new Date(time * 1000).toISOString().replace("Z", ""),
      time,
      position,
      velocity,
      acceleration: null,
    });
  }
  const oem: Oem = {
    headerComments: ["Test orbit. Not a flyable trajectory."],
    classification: null,
    creationDate: "2026-10-03T18:00:00",
    originator: "3ROK",
    messageId: null,
    segments: [
      {
        comments: [],
        objectName: "TEST",
        objectId: "UNKNOWN",
        centerName: "EARTH",
        refFrame: "GCRF",
        timeSystem: "UTC",
        startTime: list[0].epoch,
        stopTime: list[list.length - 1].epoch,
        useableStartTime: null,
        useableStopTime: null,
        interpolation: null,
        interpolationDegree: null,
        dataComments: [],
        states: list,
      },
    ],
  };
  return serializeOem(oem);
}
