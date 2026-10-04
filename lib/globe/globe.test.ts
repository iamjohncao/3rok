import { describe, expect, it } from "vitest";
import { FlightEngine } from "../engine/flight";
import { norm, sub } from "../engine/vec";
import type { Vec3 } from "../oem";
import { circularState, flownStates, oemOf, T0 } from "../test-support/flight-oem";
import { cameraFrame, satelliteWorldPoint, type CameraState, type SatelliteView } from "./camera";
import { HEAT_ALPHA, heatTexture, parseHexColor, particleColors, rampColor, sampleScore, type HeatField, type Ramp } from "./heat";
import { toNdc } from "./mat4";
import { PARTICLE_COUNT, fibonacciParticles, hashUnit, isLandPixel, landMask } from "./particles";
import { INSTANCE_FLOATS, graticuleInstances, pathInstances, type PathVertex } from "./path-geometry";
import { FOLD_BULGE, RADIUS_KM, foldPoint, mapPoint, particleFold, smoothstep, spherePoint, surfaceNormal } from "./projection";
import { satelliteView, trackPoint } from "./satellite";

const near = (a: Vec3, b: Vec3, digits = 9) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], digits);
};

describe("projection", () => {
  it("puts longitude 0 on +Z, longitude 90 east on +X, and north on +Y", () => {
    near(surfaceNormal(0, 0), [0, 0, 1]);
    near(surfaceNormal(Math.PI / 2, 0), [1, 0, 0]);
    near(surfaceNormal(0, Math.PI / 2), [0, 1, 0]);
    expect(norm(surfaceNormal(1.1, -0.4))).toBeCloseTo(1, 12);
  });

  it("lifts a point off the surface by its altitude in Earth radii", () => {
    expect(norm(spherePoint(0.3, 0.2, 650 / RADIUS_KM))).toBeCloseTo(1 + 650 / RADIUS_KM, 12);
  });

  it("is the sphere at fold 0 and the map at fold 1", () => {
    near(foldPoint(0.4, -0.3, 0.1, 0), spherePoint(0.4, -0.3, 0.1));
    near(foldPoint(0.4, -0.3, 0.1, 1, 0.02), mapPoint(0.4, -0.3, 0.02));
  });

  it("peels open through the middle instead of cutting through itself", () => {
    const mid = foldPoint(0.4, 0.2, 0, 0.5);
    const straight: Vec3 = [0, 0, 0].map((_, i) => 0.5 * spherePoint(0.4, 0.2, 0)[i] + 0.5 * mapPoint(0.4, 0.2, 0)[i]) as Vec3;
    const lift = sub(mid, straight);
    const n = surfaceNormal(0.4, 0.2);
    for (let i = 0; i < 3; i++) expect(lift[i]).toBeCloseTo(n[i] * FOLD_BULGE, 12);
  });

  it("gives each particle its own schedule, folding the low delays first", () => {
    expect(particleFold(0, 0.9)).toBe(0);
    expect(particleFold(1, 0.999)).toBe(1);
    expect(particleFold(0.5, 0)).toBeGreaterThan(particleFold(0.5, 0.8));
    let last = -1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const e = particleFold(f, 0.4);
      expect(e).toBeGreaterThanOrEqual(last);
      last = e;
    }
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });
});

describe("the camera", () => {
  const base: CameraState = {
    flat: 0,
    chase: 0,
    aspect: 1.6,
    centerLon: 0.3,
    centerLat: 0.2,
    panX: 0,
    panY: 0,
    zoom: 1,
    chaseZoom: 1,
    satellite: null,
  };
  const sat: SatelliteView = { lon: 1.2, lat: 0.6, altKm: 650, headEast: 0.8, headNorth: 0.6 };

  it("keeps the satellite exactly in the middle of the screen in chase view, at every point of the fold", () => {
    for (const flat of [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1]) {
      const state: CameraState = { ...base, flat, chase: 1, satellite: sat };
      const { viewProj } = cameraFrame(state);
      const p = toNdc(viewProj, satelliteWorldPoint(sat, flat));
      expect(p.x).toBeCloseTo(0, 4);
      expect(p.y).toBeCloseTo(0, 4);
      expect(p.w).toBeGreaterThan(0);
    }
  });

  it("follows the satellite: move it and it is centred again", () => {
    const moved: SatelliteView = { ...sat, lon: -2.4, lat: -0.9 };
    for (const flat of [0, 1]) {
      const { viewProj } = cameraFrame({ ...base, flat, chase: 1, satellite: moved });
      const p = toNdc(viewProj, satelliteWorldPoint(moved, flat));
      expect(Math.abs(p.x)).toBeLessThan(1e-4);
      expect(Math.abs(p.y)).toBeLessThan(1e-4);
    }
  });

  it("shows the whole sphere in wide view", () => {
    const { viewProj } = cameraFrame({ ...base, satellite: sat });
    for (const lon of [0, 1, 2, 3, -1, -2, -3]) {
      for (const lat of [-1.4, -0.7, 0, 0.7, 1.4]) {
        const p = toNdc(viewProj, spherePoint(lon, lat, 0));
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
      }
    }
  });

  it("shows the whole map in wide view, at any window shape", () => {
    for (const aspect of [0.7, 1, 1.6, 2.4]) {
      const { viewProj } = cameraFrame({ ...base, aspect, flat: 1 });
      for (const [x, y] of [[-Math.PI, -Math.PI / 2], [Math.PI, Math.PI / 2], [-Math.PI, Math.PI / 2], [Math.PI, -Math.PI / 2]]) {
        const p = toNdc(viewProj, [x, y, 0]);
        expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("looks down on the satellite from behind and above, with up away from the Earth", () => {
    const { eye, up } = cameraFrame({ ...base, chase: 1, satellite: sat });
    const s = spherePoint(sat.lon, sat.lat, 650 / RADIUS_KM);
    expect(norm(sub(eye, s))).toBeLessThan(1.2);
    expect(norm(eye)).toBeGreaterThan(norm(s));
    expect(up[0] * s[0] + up[1] * s[1] + up[2] * s[2]).toBeGreaterThan(0);
  });

  it("moves smoothly between wide and chase: no step, no NaN", () => {
    let last: Vec3 | null = null;
    for (let c = 0; c <= 1.0001; c += 0.02) {
      const { eye } = cameraFrame({ ...base, flat: 0.4, chase: c, satellite: sat });
      expect(eye.every(Number.isFinite)).toBe(true);
      if (last) expect(norm(sub(eye, last))).toBeLessThan(0.35);
      last = eye;
    }
  });

  it("zoom brings the wide view closer", () => {
    const far = cameraFrame({ ...base }).eye;
    const close = cameraFrame({ ...base, zoom: 2 }).eye;
    expect(norm(close)).toBeLessThan(norm(far));
  });
});

describe("the particles", () => {
  const p = fibonacciParticles();

  it("are the same on every load", () => {
    const again = fibonacciParticles();
    expect(again.lon).toEqual(p.lon);
    expect(again.delay).toEqual(p.delay);
    expect(p.count).toBe(PARTICLE_COUNT);
  });

  it("cover the sphere evenly: equal area in equal bands of sin(latitude)", () => {
    const bands = new Array(10).fill(0);
    for (let i = 0; i < p.count; i++) bands[Math.min(9, Math.floor(((Math.sin(p.lat[i]) + 1) / 2) * 10))]++;
    for (const n of bands) expect(Math.abs(n - p.count / 10)).toBeLessThan(p.count * 0.002);
    expect(Math.max(...p.lat)).toBeLessThanOrEqual(Math.PI / 2);
    expect(Math.min(...p.lon)).toBeGreaterThanOrEqual(-Math.PI);
    expect(Math.max(...p.lon)).toBeLessThan(Math.PI);
  });

  it("each have their own delay, in [0, 1), and the wave starts at the longitude it was told", () => {
    expect(Math.max(...p.delay)).toBeLessThan(1);
    expect(Math.min(...p.delay)).toBeGreaterThanOrEqual(0);
    expect(new Set(p.delay).size).toBeGreaterThan(p.count * 0.9);
    const mean = (pick: (i: number) => boolean) => {
      let s = 0, n = 0;
      for (let i = 0; i < p.count; i++) if (pick(i)) { s += p.delay[i]; n++; }
      return s / n;
    };
    expect(mean((i) => Math.abs(p.lon[i]) < 0.5)).toBeLessThan(mean((i) => Math.abs(p.lon[i]) > 2.6) - 0.3);
  });

  it("hash into [0, 1) with a mean near a half", () => {
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const h = hashUnit(i);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      sum += h;
    }
    expect(sum / 5000).toBeGreaterThan(0.48);
    expect(sum / 5000).toBeLessThan(0.52);
  });

  it("tell land from ocean by the colours Natural Earth II uses", () => {
    expect(isLandPixel(40, 100, 160)).toBe(false);
    expect(isLandPixel(70, 120, 175)).toBe(false);
    expect(isLandPixel(230, 238, 246)).toBe(true);
    expect(isLandPixel(120, 150, 70)).toBe(true);
    expect(isLandPixel(200, 180, 130)).toBe(true);
  });

  it("read a land mask off an image, north at the top", () => {
    const w = 8, h = 4;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const [r, g, b] = y < 2 ? [120, 150, 70] : [40, 100, 160]; // north land, south ocean
        pixels[k] = r; pixels[k + 1] = g; pixels[k + 2] = b; pixels[k + 3] = 255;
      }
    }
    const mask = landMask(pixels, w, h, new Float32Array([0, 0]), new Float32Array([0.8, -0.8]));
    expect(Array.from(mask)).toEqual([1, 0]);
  });
});

describe("the heat colours", () => {
  const ramp: Ramp = { low: [217, 221, 225], mid: [245, 183, 0], high: [255, 106, 69] };

  it("reads a token's hex text and nothing else", () => {
    expect(parseHexColor("#f5b700")).toEqual([245, 183, 0]);
    expect(parseHexColor(" #fb0 ")).toEqual([255, 187, 0]);
    expect(parseHexColor("var(--accent)")).toBeNull();
    expect(parseHexColor("#12")).toBeNull();
    expect(parseHexColor("#gggggg")).toBeNull();
  });

  it("runs white, yellow, red with the score", () => {
    expect(rampColor(0, ramp)).toEqual(ramp.low);
    expect(rampColor(0.5, ramp)).toEqual(ramp.mid);
    expect(rampColor(1, ramp)).toEqual(ramp.high);
    expect(rampColor(-3, ramp)).toEqual(ramp.low);
    expect(rampColor(9, ramp)).toEqual(ramp.high);
    const quarter = rampColor(0.25, ramp);
    expect(quarter[0]).toBeGreaterThan(ramp.low[0]);
    expect(quarter[0]).toBeLessThan(ramp.mid[0]);
    expect(quarter[2]).toBeGreaterThan(ramp.mid[2]);
    expect(quarter[2]).toBeLessThan(ramp.low[2]);
  });

  // A 4 by 3 field: latitudes -90, 0, 90; longitudes -180, -60, 60, 180 (the last repeats the first).
  const field: HeatField = {
    lonStepDeg: 120,
    latStepDeg: 90,
    lonCount: 4,
    latCount: 3,
    scores: new Float32Array([0, 1, 0, 0, /* equator */ 1, 1, 0, 1, /* north */ 0, 0, 0, 0]),
  };

  it("samples a score by bilinear interpolation, wrapping the longitude", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    expect(sampleScore(field, deg(-60), deg(0))).toBeCloseTo(1, 12);
    expect(sampleScore(field, deg(0), deg(0))).toBeCloseTo(0.5, 12);
    expect(sampleScore(field, deg(-180), deg(0))).toBeCloseTo(sampleScore(field, deg(180), deg(0)), 12);
    expect(sampleScore(field, deg(190), deg(0))).toBeCloseTo(sampleScore(field, deg(-170), deg(0)), 12);
    expect(sampleScore(field, deg(0), deg(95))).toBeCloseTo(sampleScore(field, deg(0), deg(90)), 12);
  });

  it("makes a texture with the ramp's colours and one fixed opacity", () => {
    const texture = heatTexture(field, ramp, 12, 6);
    expect(texture.length).toBe(12 * 6 * 4);
    for (let i = 3; i < texture.length; i += 4) expect(texture[i]).toBe(Math.round(255 * HEAT_ALPHA));
    // The row nearest latitude 0, at longitude -60, is the top score.
    const x = 4; // (-60 + 180) / 360 * 12 = 4
    const y = 3; // just north of the equator
    const k = (y * 12 + x) * 4;
    expect(texture[k]).toBeGreaterThan(200);
  });

  it("gives every particle the colour for the score where it is", () => {
    const lon = new Float32Array([(-60 * Math.PI) / 180, (60 * Math.PI) / 180]);
    const lat = new Float32Array([0, 0]);
    const colors = particleColors(field, lon, lat, ramp);
    expect(Array.from(colors.slice(0, 4))).toEqual([...ramp.high, 255]);
    expect(Array.from(colors.slice(4, 8))).toEqual([...ramp.low, 255]);
  });
});

describe("the path", () => {
  const v = (t: number, lonDeg: number, latDeg: number, altKm = 650): PathVertex => ({ t, lon: (lonDeg * Math.PI) / 180, lat: (latDeg * Math.PI) / 180, altKm });

  it("is one instance per pair of neighbours, with altitude in Earth radii and the times of both ends", () => {
    const out = pathInstances([[v(0, 0, 0), v(10, 5, 2), v(20, 9, 4)]]);
    expect(out.length).toBe(2 * INSTANCE_FLOATS);
    expect(out[2]).toBeCloseTo(650 / RADIUS_KM, 6);
    expect([out[6], out[7]]).toEqual([0, 10]);
    expect([out[INSTANCE_FLOATS + 6], out[INSTANCE_FLOATS + 7]]).toEqual([10, 20]);
  });

  it("does not join two segments", () => {
    const out = pathInstances([[v(0, 0, 0), v(10, 5, 2)], [v(100, 40, 9), v(110, 45, 10)]]);
    expect(out.length).toBe(2 * INSTANCE_FLOATS);
  });

  it("cuts a line that crosses the date line in two copies that each run off the edge by one turn", () => {
    const out = pathInstances([[v(0, 170, 10), v(10, -170, 12)]]);
    expect(out.length).toBe(2 * INSTANCE_FLOATS);
    const first = Array.from(out.slice(0, INSTANCE_FLOATS));
    const second = Array.from(out.slice(INSTANCE_FLOATS, 2 * INSTANCE_FLOATS));
    const deg = (r: number) => (r * 180) / Math.PI;
    expect(deg(first[0])).toBeCloseTo(170, 4);
    expect(deg(first[3])).toBeCloseTo(190, 4); // -170 + 360
    expect(deg(second[0])).toBeCloseTo(-190, 4); // 170 - 360
    expect(deg(second[3])).toBeCloseTo(-170, 4);
    expect([first[6], first[7]]).toEqual([0, 10]);
  });

  it("has a graticule of meridians and parallels at 30 degrees", () => {
    const g = graticuleInstances();
    expect(g.length % INSTANCE_FLOATS).toBe(0);
    expect(g.length / INSTANCE_FLOATS).toBe(12 * 36 + 5 * 72);
  });
});

describe("the satellite, read from the engine", () => {
  const start = circularState(650, 51.6);
  const file = oemOf([flownStates(start, [0, 120, 240, 360, 480, 600])]);
  const engine = new FlightEngine(file);

  it("is over the Earth at the file's altitude, and its heading is a unit direction", () => {
    const sat = satelliteView(engine, T0 + 300);
    expect(sat).not.toBeNull();
    expect(sat!.altKm).toBeGreaterThan(600);
    expect(sat!.altKm).toBeLessThan(700);
    expect(Math.hypot(sat!.headEast, sat!.headNorth)).toBeCloseTo(1, 9);
    expect(Math.abs(sat!.lat)).toBeLessThanOrEqual((51.6 * Math.PI) / 180 + 0.05);
  });

  it("has a heading at the ends of the file, where one side has no sample", () => {
    for (const time of [T0, T0 + 600]) {
      const sat = satelliteView(engine, time);
      expect(Math.hypot(sat!.headEast, sat!.headNorth)).toBeCloseTo(1, 9);
    }
  });

  it("has nothing outside the file", () => {
    expect(satelliteView(engine, T0 - 5)).toBeNull();
    expect(satelliteView(engine, T0 + 601)).toBeNull();
  });

  it("agrees with the longitude and latitude of a sample", () => {
    const sample = engine.sample(T0 + 200)!;
    const point = trackPoint(sample);
    const sat = satelliteView(engine, T0 + 200)!;
    expect(sat.lon).toBeCloseTo(point.lon, 12);
    expect(sat.lat).toBeCloseTo(point.lat, 12);
  });
});
