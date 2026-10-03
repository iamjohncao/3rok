import { describe, expect, it } from "vitest";
import {
  EARTH_EQUATORIAL_RADIUS_KM,
  EARTH_MU_KM3_S2,
  derivedReadings,
  earthFixedToGeodetic,
  earthRotationAngle,
  geodeticToEarthFixed,
  gcrfToEarthFixed,
  greenwichMeanSiderealTime,
  norm,
} from "./frame";
import { epochToSeconds } from "./oem";
import type { Vec3 } from "./oem";

const seconds = (epoch: string) => epochToSeconds(epoch) as number;
const distance = (a: Vec3, b: Vec3) => norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
const deg = (radians: number) => (radians * 180) / Math.PI;

describe("Earth rotation angle", () => {
  it("is 280.46 degrees at J2000.0, the known sidereal angle for that instant", () => {
    const era = deg(earthRotationAngle(seconds("2000-01-01T12:00:00")));
    expect(era).toBeCloseTo(280.46061837, 4);
  });

  it("advances one sidereal turn plus 0.9856 degrees per solar day", () => {
    const a = earthRotationAngle(seconds("2026-10-03T00:00:00"));
    const b = earthRotationAngle(seconds("2026-10-04T00:00:00"));
    const advance = (deg(b - a) + 360) % 360;
    expect(advance).toBeCloseTo(0.9856, 3);
  });

  it("stays in [0, 2pi) before and after J2000", () => {
    for (const epoch of ["1990-06-15T03:00:00", "2000-01-01T12:00:00", "2026-10-03T18:05:00", "2060-01-01T00:00:00"]) {
      const era = earthRotationAngle(seconds(epoch));
      expect(era).toBeGreaterThanOrEqual(0);
      expect(era).toBeLessThan(2 * Math.PI);
    }
  });

  it("gives GMST within a few arcseconds of the rotation angle at J2000", () => {
    const t = seconds("2000-01-01T12:00:00");
    expect(deg(greenwichMeanSiderealTime(t) - earthRotationAngle(t))).toBeCloseTo(0.014506 / 3600, 8);
  });
});

describe("GCRF to Earth-fixed", () => {
  // Vallado, Fundamentals of Astrodynamics and Applications, worked example 3-15:
  // 2004-04-06 07:51:28.386009 UTC. The published answer includes nutation, polar
  // motion, and UT1 - UTC = -0.44 s, which this approximation leaves out, so it
  // should agree to a fraction of a kilometre and not exactly. Measured: 0.14 km.
  const epoch = seconds("2004-04-06T07:51:28.386009");
  const gcrf: Vec3 = [5102.508958, 6123.011401, 6378.136928];
  const published: Vec3 = [-1033.479383, 7901.2952754, 6380.3565958];

  it("agrees with the published reduction to better than half a kilometre", () => {
    const fixed = gcrfToEarthFixed(gcrf, epoch);
    expect(distance(fixed, published)).toBeLessThan(0.5);
  });

  it("is far better than rotating by the Earth rotation angle alone (3.5 km off here)", () => {
    const cos = Math.cos(earthRotationAngle(epoch));
    const sin = Math.sin(earthRotationAngle(epoch));
    const eraOnly: Vec3 = [cos * gcrf[0] + sin * gcrf[1], -sin * gcrf[0] + cos * gcrf[1], gcrf[2]];
    expect(distance(eraOnly, published)).toBeGreaterThan(3);
    expect(distance(gcrfToEarthFixed(gcrf, epoch), published)).toBeLessThan(distance(eraOnly, published) / 10);
  });

  it("keeps the length of the vector", () => {
    for (const epochText of ["2004-04-06T07:51:28", "2026-10-03T18:05:00", "2026-10-03T18:20:00"]) {
      expect(norm(gcrfToEarthFixed(gcrf, seconds(epochText)))).toBeCloseTo(norm(gcrf), 9);
    }
  });

  it("turns with the Earth: the same inertial point moves west by about 15 degrees an hour", () => {
    const a = earthFixedToGeodetic(gcrfToEarthFixed([7000, 0, 0], seconds("2026-10-03T18:00:00")));
    const b = earthFixedToGeodetic(gcrfToEarthFixed([7000, 0, 0], seconds("2026-10-03T19:00:00")));
    const west = (a.longitudeDeg - b.longitudeDeg + 360) % 360;
    expect(west).toBeCloseTo(15.04, 1);
  });
});

describe("geodetic conversion", () => {
  it("reads a point on the equator at 400 km", () => {
    const g = earthFixedToGeodetic([EARTH_EQUATORIAL_RADIUS_KM + 400, 0, 0]);
    expect(g.latitudeDeg).toBeCloseTo(0, 9);
    expect(g.longitudeDeg).toBeCloseTo(0, 9);
    expect(g.altitudeKm).toBeCloseTo(400, 6);
  });

  it("uses the flattened Earth: the polar radius is about 21 km shorter", () => {
    const polarRadius = 6356.752314245;
    const g = earthFixedToGeodetic([0, 0, polarRadius + 100]);
    expect(g.latitudeDeg).toBeCloseTo(90, 9);
    expect(g.altitudeKm).toBeCloseTo(100, 6);
  });

  it("round-trips latitude, longitude, and altitude, including the poles and high altitude", () => {
    const cases: [number, number, number][] = [
      [0, 0, 0],
      [28.5, -80.6, 0.01],
      [-45, 170, 550],
      [89.9, 10, 800],
      [-89.9, -120, 2000],
      [90, 0, 400],
      [-90, 0, 400],
      [10, 179.9, 35786],
      [51.6, -0.1, 408],
    ];
    for (const [lat, lon, alt] of cases) {
      const back = earthFixedToGeodetic(geodeticToEarthFixed(lat, lon, alt));
      expect(back.latitudeDeg, `lat ${lat}`).toBeCloseTo(lat, 7);
      expect(back.altitudeKm, `alt ${alt}`).toBeCloseTo(alt, 5);
      if (Math.abs(lat) < 90) expect(back.longitudeDeg, `lon ${lon}`).toBeCloseTo(lon, 7);
    }
  });

  it("puts the fixture's first state at a plausible place", () => {
    // fixtures/minimal.oem, first state, at its own epoch.
    const fixed = gcrfToEarthFixed([-1045.0, -5512.0, 3298.0], seconds("2026-10-03T18:05:00.000"));
    const g = earthFixedToGeodetic(fixed);
    expect(g.latitudeDeg).toBeGreaterThan(20);
    expect(g.latitudeDeg).toBeLessThan(40);
    expect(g.altitudeKm).toBeGreaterThan(50);
    expect(g.altitudeKm).toBeLessThan(200);
  });
});

describe("derived readings", () => {
  const r = 7000;
  const circular = Math.sqrt(EARTH_MU_KM3_S2 / r);

  it("reads a circular orbit: level flight, energy of -mu / 2r", () => {
    const d = derivedReadings([r, 0, 0], [0, circular, 0]);
    expect(d.speedKmS).toBeCloseTo(circular, 9);
    expect(d.flightPathAngleDeg).toBeCloseTo(0, 9);
    expect(d.specificEnergyKm2S2).toBeCloseTo(-EARTH_MU_KM3_S2 / (2 * r), 9);
    expect(d.radiusKm).toBe(r);
  });

  it("reads climbing, falling, and straight-up flight", () => {
    expect(derivedReadings([r, 0, 0], [1, 1, 0]).flightPathAngleDeg).toBeCloseTo(45, 9);
    expect(derivedReadings([r, 0, 0], [-1, 1, 0]).flightPathAngleDeg).toBeCloseTo(-45, 9);
    expect(derivedReadings([r, 0, 0], [3, 0, 0]).flightPathAngleDeg).toBeCloseTo(90, 9);
  });

  it("has no flight-path angle for a state at rest", () => {
    const d = derivedReadings([r, 0, 0], [0, 0, 0]);
    expect(d.flightPathAngleDeg).toBeNull();
    expect(d.specificEnergyKm2S2).toBeCloseTo(-EARTH_MU_KM3_S2 / r, 9);
  });

  it("gives zero energy at escape speed", () => {
    const escape = Math.sqrt((2 * EARTH_MU_KM3_S2) / r);
    expect(derivedReadings([r, 0, 0], [0, escape, 0]).specificEnergyKm2S2).toBeCloseTo(0, 9);
  });
});
