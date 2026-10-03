// Reference-frame math for the testing page. For drawing and for readings that
// are labeled derived. Nothing here changes the OEM or invents a state.
//
// Earth-fixed position = Rz(-GMST) * mean precession * GCRF position.
// Left out, on purpose and labeled so on the page: nutation (up to about
// 0.5 km at LEO), polar motion (about 0.01 km), and UT1 - UTC (up to about
// 0.4 km). UT1 is taken as UTC.

import type { Vec3 } from "./oem";

export const EARTH_EQUATORIAL_RADIUS_KM = 6378.137; // WGS84 a
export const EARTH_FLATTENING = 1 / 298.257223563; // WGS84 f
export const EARTH_MU_KM3_S2 = 398600.4418;

const E2 = EARTH_FLATTENING * (2 - EARTH_FLATTENING);
const ARCSEC = Math.PI / (180 * 3600);
const TWO_PI = 2 * Math.PI;
const J2000_JD = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

/** Days since J2000.0 (2000-01-01T12:00:00), treating UT1 as UTC. */
function daysSinceJ2000(unixSeconds: number): number {
  return unixSeconds / 86400 + UNIX_EPOCH_JD - J2000_JD;
}

/** Earth rotation angle in radians, in [0, 2pi). IERS Conventions 2010, UT1 taken as UTC. */
export function earthRotationAngle(unixSeconds: number): number {
  const tu = daysSinceJ2000(unixSeconds);
  const turns = (0.779057273264 + 0.00273781191135448 * tu + (tu % 1)) % 1;
  return TWO_PI * (turns < 0 ? turns + 1 : turns);
}

/** Greenwich mean sidereal time in radians: the rotation angle plus its precession terms (IAU 2006). */
export function greenwichMeanSiderealTime(unixSeconds: number): number {
  const t = daysSinceJ2000(unixSeconds) / 36525;
  const arcsec =
    0.014506 +
    t * (4612.156534 + t * (1.3915817 + t * (-0.00000044 + t * (-0.000029956 + t * -0.0000000368))));
  return earthRotationAngle(unixSeconds) + arcsec * ARCSEC;
}

// Active right-handed rotations of a vector.
function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** GCRF to the mean equator and equinox of date: Rz(z) Ry(-theta) Rz(zeta). IAU 1976 precession angles. */
function precess(v: Vec3, unixSeconds: number): Vec3 {
  const t = daysSinceJ2000(unixSeconds) / 36525;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * ARCSEC;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * ARCSEC;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * ARCSEC;
  return rotateZ(rotateY(rotateZ(v, zeta), -theta), z);
}

/** A GCRF position (km) as an approximate Earth-fixed position (km) at a UTC instant, for display. */
export function gcrfToEarthFixed(position: Vec3, unixSeconds: number): Vec3 {
  return rotateZ(precess(position, unixSeconds), -greenwichMeanSiderealTime(unixSeconds));
}

export type Geodetic = {
  /** Degrees, north positive. */
  latitudeDeg: number;
  /** Degrees, east positive, in (-180, 180]. */
  longitudeDeg: number;
  /** Height above the WGS84 ellipsoid, km. */
  altitudeKm: number;
};

/** Earth-fixed position (km) to WGS84 geodetic latitude, longitude, and height. */
export function earthFixedToGeodetic(position: Vec3): Geodetic {
  const [x, y, z] = position;
  const a = EARTH_EQUATORIAL_RADIUS_KM;
  const rho = Math.hypot(x, y);
  let lat = Math.atan2(z, rho * (1 - E2));
  let n = a;
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(lat);
    n = a / Math.sqrt(1 - E2 * s * s);
    const h = Math.abs(lat) < Math.PI / 4 ? rho / Math.cos(lat) - n : z / s - n * (1 - E2);
    lat = Math.atan2(z, rho * (1 - (E2 * n) / (n + h)));
  }
  const s = Math.sin(lat);
  n = a / Math.sqrt(1 - E2 * s * s);
  const altitudeKm = Math.abs(lat) < Math.PI / 4 ? rho / Math.cos(lat) - n : z / s - n * (1 - E2);
  return {
    latitudeDeg: (lat * 180) / Math.PI,
    longitudeDeg: (Math.atan2(y, x) * 180) / Math.PI,
    altitudeKm,
  };
}

/** WGS84 geodetic to Earth-fixed position, km. The inverse of `earthFixedToGeodetic`. */
export function geodeticToEarthFixed(latitudeDeg: number, longitudeDeg: number, altitudeKm: number): Vec3 {
  const lat = (latitudeDeg * Math.PI) / 180;
  const lon = (longitudeDeg * Math.PI) / 180;
  const n = EARTH_EQUATORIAL_RADIUS_KM / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return [
    (n + altitudeKm) * Math.cos(lat) * Math.cos(lon),
    (n + altitudeKm) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - E2) + altitudeKm) * Math.sin(lat),
  ];
}

export function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export type DerivedReadings = {
  /** Distance from the Earth's center, km. */
  radiusKm: number;
  /** Inertial speed, the length of the GCRF velocity, km/s. */
  speedKmS: number;
  /** Angle of the velocity above the local horizontal, degrees. Null when the velocity is zero. */
  flightPathAngleDeg: number | null;
  /** Specific mechanical energy v^2/2 - mu/r, km^2/s^2. */
  specificEnergyKm2S2: number;
};

/** Readings derived from one GCRF state. Every one is labeled derived on the page. */
export function derivedReadings(position: Vec3, velocity: Vec3): DerivedReadings {
  const radiusKm = norm(position);
  const speedKmS = norm(velocity);
  const flightPathAngleDeg =
    speedKmS === 0 || radiusKm === 0
      ? null
      : (Math.asin(Math.max(-1, Math.min(1, dot(position, velocity) / (radiusKm * speedKmS)))) * 180) /
        Math.PI;
  return {
    radiusKm,
    speedKmS,
    flightPathAngleDeg,
    specificEnergyKm2S2: (speedKmS * speedKmS) / 2 - EARTH_MU_KM3_S2 / radiusKm,
  };
}
