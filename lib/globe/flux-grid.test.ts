import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { meanAltitudeKm } from "../engine/flight";
import { parseOem } from "../oem";
import {
  SCORE_DECADES,
  altitudeRangeKm,
  decodeFluxGrid,
  doseRateKradPerYear,
  placementScores,
  type DoseCoefficients,
  type FluxGrid,
  type FluxMeta,
} from "./flux-grid";
import { sampleScore } from "./heat";

const root = fileURLToPath(new URL("../..", import.meta.url));
const meta = JSON.parse(readFileSync(`${root}public/flux/flux-grid.json`, "utf8")) as FluxMeta;
const bin = readFileSync(`${root}public/flux/flux-grid.bin`);
const grid = decodeFluxGrid(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const deg = (d: number) => (d * Math.PI) / 180;

describe("the shipped radiation grid", () => {
  it("has the size and the axes its description says", () => {
    expect(grid.data.length).toBe(meta.altitudes_km.length * 2 * meta.lat.count * meta.lon.count);
    expect(meta.altitudes_km[0]).toBe(500);
    expect(meta.altitudes_km.at(-1)).toBe(2000);
    expect(meta.lat.start_deg).toBe(-90);
    expect(meta.lat.start_deg + (meta.lat.count - 1) * meta.lat.step_deg).toBe(90);
    expect(meta.lon.start_deg).toBe(-180);
    expect(meta.lon.start_deg + (meta.lon.count - 1) * meta.lon.step_deg).toBe(180);
    expect(meta.particles.map((p) => p.key)).toEqual(["p", "e"]);
    expect(meta.model).toBe("AE8/AP8 via aep8");
  });

  it("has only finite, non-negative flux", () => {
    for (const v of grid.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("repeats the first longitude in the last column, so the map has no seam", () => {
    const { lat, lon } = meta;
    for (const a of [0, 3, 7]) {
      for (const j of [5, 30, 55]) {
        const row = (a * 2) * lat.count * lon.count + j * lon.count;
        const first = grid.data[row];
        const last = grid.data[row + lon.count - 1];
        expect(Math.abs(first - last)).toBeLessThanOrEqual(1e-6 * Math.max(1, first));
      }
    }
  });

  it("puts the proton peak at 650 km in the South Atlantic Anomaly, where the physics says it is", () => {
    const result = placementScores(grid, 650, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.worst.latDeg).toBeGreaterThanOrEqual(-50);
    expect(result.worst.latDeg).toBeLessThanOrEqual(-15);
    expect(result.worst.lonDeg).toBeGreaterThanOrEqual(-70);
    expect(result.worst.lonDeg).toBeLessThanOrEqual(10);
    // Most of the Earth has no trapped flux at this height: no >10 MeV protons and no >1 MeV electrons.
    expect(result.noFluxAreaFraction).toBeGreaterThan(0.5);
    expect(result.noFluxAreaFraction).toBeLessThan(0.9);
  });

  it("has a bigger and wider anomaly higher up", () => {
    const low = placementScores(grid, 600, 5);
    const high = placementScores(grid, 1500, 5);
    if (!low.ok || !high.ok) throw new Error("both altitudes are in range");
    expect(high.noFluxAreaFraction).toBeLessThan(low.noFluxAreaFraction);
  });
});

describe("the dose rate", () => {
  const expected = JSON.parse(readFileSync(`${root}fixtures/dose-rate-expected.json`, "utf8")) as {
    coefficients: DoseCoefficients & { status: string };
    cases: { proton_flux_cm2_s: number; electron_flux_cm2_s: number; shield_mm_Al: number; dose_rate_krad_Si_per_year: number }[];
  };

  it("is the package's, on every case the package computed", () => {
    expect(expected.cases.length).toBeGreaterThan(20);
    for (const c of expected.cases) {
      const ours = doseRateKradPerYear(c.proton_flux_cm2_s, c.electron_flux_cm2_s, c.shield_mm_Al, meta.dose);
      expect(ours).toBeCloseTo(c.dose_rate_krad_Si_per_year, 12);
    }
  });

  it("carries the package's coefficients, marked assumed", () => {
    expect(meta.dose.status).toBe("assumed");
    expect(meta.dose.k_p_krad_yr_per_flux).toBe(expected.coefficients.k_p_krad_yr_per_flux);
    expect(meta.dose.lambda_p_mm).toBe(expected.coefficients.lambda_p_mm);
  });

  it("falls with the shield", () => {
    let last = Infinity;
    for (const t of [0, 1, 2, 5, 10, 20]) {
      const d = doseRateKradPerYear(1000, 50000, t, meta.dose);
      expect(d).toBeLessThan(last);
      last = d;
    }
  });
});

describe("the placement score", () => {
  it("is 0 at the highest dose rate and 1 when it is a thousand times lower or less, on a log scale", () => {
    expect(SCORE_DECADES).toBe(3);
    const result = placementScores(grid, 650, 5);
    if (!result.ok) throw new Error("in range");
    const { field } = result;
    let min = 1;
    let max = 0;
    for (const s of field.scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
    // At the worst cell the score is exactly 0.
    const worstScore = sampleScore(field, deg(result.worst.lonDeg), deg(result.worst.latDeg));
    expect(worstScore).toBeCloseTo(0, 6);
  });

  it("scores a cell with no model flux 1, and says what share of the Earth that is", () => {
    const result = placementScores(grid, 650, 5);
    if (!result.ok) throw new Error("in range");
    expect(sampleScore(result.field, deg(120), deg(0))).toBe(1);
    expect(result.noFluxAreaFraction).toBeGreaterThan(0);
    expect(result.noFluxAreaFraction).toBeLessThan(1);
  });

  it("is lower where the dose rate is higher, in step with the log scale", () => {
    const result = placementScores(grid, 650, 5);
    if (!result.ok) throw new Error("in range");
    const { field, maxDoseKradPerYear } = result;
    // A cell whose dose rate is a tenth of the maximum scores 1/3.
    const target = 10 ** (Math.log10(maxDoseKradPerYear) - 1);
    let found = false;
    for (let j = 0; j < field.latCount && !found; j++) {
      for (let i = 0; i < field.lonCount - 1 && !found; i++) {
        const score = field.scores[j * field.lonCount + i];
        if (Math.abs(score - 1 / 3) < 1e-4) {
          const rate = maxDoseKradPerYear * 10 ** (-score * SCORE_DECADES);
          expect(Math.abs(rate - target) / target).toBeLessThan(0.01);
          found = true;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("changes with the shield: thicker aluminium takes the score up where protons dominate", () => {
    const thin = placementScores(grid, 800, 1);
    const thick = placementScores(grid, 800, 20);
    if (!thin.ok || !thick.ok) throw new Error("in range");
    expect(thick.maxDoseKradPerYear).toBeLessThan(thin.maxDoseKradPerYear);
  });

  it("interpolates between altitude slices and agrees with the slice at a slice", () => {
    const at700 = placementScores(grid, 700, 5);
    const at750 = placementScores(grid, 750, 5);
    const at800 = placementScores(grid, 800, 5);
    if (!at700.ok || !at750.ok || !at800.ok) throw new Error("in range");
    expect(at750.maxDoseKradPerYear).toBeGreaterThan(Math.min(at700.maxDoseKradPerYear, at800.maxDoseKradPerYear) * 0.99);
    expect(at750.maxDoseKradPerYear).toBeLessThan(Math.max(at700.maxDoseKradPerYear, at800.maxDoseKradPerYear) * 1.01);
  });

  it("refuses an altitude outside the grid and a shield that is not a number, with the sentence", () => {
    const [low, high] = altitudeRangeKm(grid);
    expect([low, high]).toEqual([500, 2000]);
    for (const altitude of [499.9, 2000.1, NaN, 358]) {
      const r = placementScores(grid, altitude, 5);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/radiation grid covers 500 to 2000 km/);
    }
    for (const shield of [NaN, -1, Infinity]) expect(placementScores(grid, 650, shield).ok).toBe(false);
  });

  it("scores everything 1 when the model has no flux anywhere, and does not divide by zero", () => {
    const emptyMeta: FluxMeta = { ...meta, altitudes_km: [500, 600] };
    const empty: FluxGrid = { meta: emptyMeta, data: new Float32Array(2 * 2 * meta.lat.count * meta.lon.count) };
    const r = placementScores(empty, 550, 5);
    if (!r.ok) throw new Error("in range");
    expect(r.maxDoseKradPerYear).toBe(0);
    expect(Array.from(r.field.scores).every((s) => s === 1)).toBe(true);
    expect(r.noFluxAreaFraction).toBe(1);
  });

  it("refuses a grid whose size does not match its description", () => {
    expect(() => decodeFluxGrid(meta, new ArrayBuffer(16))).toThrow();
  });
});

describe("the mean altitude of a file", () => {
  it("is the mean of |position| less the equatorial radius, as the reducer defines it", () => {
    const text = readFileSync(`${root}fixtures/minimal.oem`, "utf8");
    const parsed = parseOem(text);
    if (!parsed.ok) throw new Error("fixture parses");
    const [a, b] = parsed.oem.segments[0].states;
    const mean = (Math.hypot(...a.position) + Math.hypot(...b.position)) / 2 - 6378.137;
    expect(meanAltitudeKm(parsed.oem)).toBeCloseTo(mean, 9);
  });
});
