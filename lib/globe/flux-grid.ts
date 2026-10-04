// The placement-score layer's numbers. The trapped-radiation flux grid comes from the physics
// package (scripts/build-flux-grid.py runs starmind_physics.flux.latlon_flux_grid and writes
// public/flux/). This file reads it, turns a cell's fluxes into a dose rate behind the case's shield
// with the package's own coefficients, and turns the dose rates into a score from 0 to 1.
//
// The coefficients are marked [A], assumed, in params.yaml, and they stay marked here. The score is
// a score. It ranks places by the model's dose rate. It is not a probability of anything.

import type { HeatField } from "./heat";

export type DoseCoefficients = {
  k_p_krad_yr_per_flux: number;
  k_e_krad_yr_per_flux: number;
  lambda_p_mm: number;
  lambda_e_mm: number;
};

export type FluxMeta = {
  source: string;
  model: string;
  solar: string;
  epoch_utc: string;
  altitudes_km: number[];
  lat: { start_deg: number; step_deg: number; count: number };
  lon: { start_deg: number; step_deg: number; count: number };
  particles: { key: "p" | "e"; energy_MeV: number; quantity: string }[];
  layout: string;
  dose: DoseCoefficients & { model: string; status: "assumed"; note: string };
};

export type FluxGrid = { meta: FluxMeta; data: Float32Array };

/** A score of 0 is the highest dose rate on the map. A score of 1 is this many decades lower, or more. */
export const SCORE_DECADES = 3;

export function decodeFluxGrid(meta: FluxMeta, buffer: ArrayBuffer): FluxGrid {
  const expected = meta.altitudes_km.length * 2 * meta.lat.count * meta.lon.count;
  const data = new Float32Array(buffer);
  if (data.length !== expected) {
    throw new Error(`The flux grid has ${data.length} values and its description says ${expected}.`);
  }
  if (meta.particles.length !== 2 || meta.particles[0].key !== "p" || meta.particles[1].key !== "e") {
    throw new Error("The flux grid must hold protons and then electrons.");
  }
  return { meta, data };
}

let loading: Promise<FluxGrid> | null = null;

/** Fetches the shipped grid once per page. Browser only. */
export function loadFluxGrid(): Promise<FluxGrid> {
  loading ??= (async () => {
    const [metaResponse, binResponse] = await Promise.all([fetch("/flux/flux-grid.json"), fetch("/flux/flux-grid.bin")]);
    if (!metaResponse.ok || !binResponse.ok) throw new Error("The radiation grid could not be loaded.");
    return decodeFluxGrid((await metaResponse.json()) as FluxMeta, await binResponse.arrayBuffer());
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function altitudeRangeKm(grid: FluxGrid): [number, number] {
  const a = grid.meta.altitudes_km;
  return [a[0], a[a.length - 1]];
}

/** Flux, cm^-2 s^-1, for every cell at one altitude, interpolated between the two slices around it. */
function fluxSlice(grid: FluxGrid, altitudeKm: number, particle: 0 | 1): Float32Array {
  const { altitudes_km: alts, lat, lon } = grid.meta;
  const cells = lat.count * lon.count;
  let i1 = alts.findIndex((a) => a >= altitudeKm);
  if (i1 < 0) i1 = alts.length - 1;
  const i0 = Math.max(0, i1 - 1);
  const t = i1 === i0 ? 0 : (altitudeKm - alts[i0]) / (alts[i1] - alts[i0]);
  const at = (alt: number) => grid.data.subarray((alt * 2 + particle) * cells, (alt * 2 + particle + 1) * cells);
  const a = at(i0);
  const b = at(i1);
  const out = new Float32Array(cells);
  for (let k = 0; k < cells; k++) {
    // Flux changes by factors between slices, so interpolate its logarithm where both are above zero.
    out[k] = a[k] > 0 && b[k] > 0 ? Math.exp(Math.log(a[k]) + (Math.log(b[k]) - Math.log(a[k])) * t) : a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** The package's exponential dose-depth fallback, krad(Si) per year. Kept in step with dose.py by a fixture. */
export function doseRateKradPerYear(protonFlux: number, electronFlux: number, shieldMm: number, c: DoseCoefficients): number {
  const t = Math.max(0, shieldMm);
  return c.k_p_krad_yr_per_flux * protonFlux * Math.exp(-t / c.lambda_p_mm) + c.k_e_krad_yr_per_flux * electronFlux * Math.exp(-t / c.lambda_e_mm);
}

export type Placement = {
  ok: true;
  field: HeatField;
  altitudeKm: number;
  shieldMm: number;
  /** The highest dose rate on the map, krad(Si) per year, and where it is. */
  maxDoseKradPerYear: number;
  worst: { latDeg: number; lonDeg: number };
  /** The share of the Earth's area where the model has no trapped flux, so the dose rate is zero. */
  noFluxAreaFraction: number;
  decades: number;
};
export type PlacementRefusal = { ok: false; reason: string };

/**
 * Scores every cell of the map for one altitude and one shield thickness. The score is
 * log10(highest dose rate / this cell's dose rate) over SCORE_DECADES, held between 0 and 1. A cell the
 * model gives no flux scores 1. That means the model has no trapped flux there, not that the place is safe.
 */
export function placementScores(grid: FluxGrid, altitudeKm: number, shieldMm: number): Placement | PlacementRefusal {
  const [low, high] = altitudeRangeKm(grid);
  if (!Number.isFinite(altitudeKm) || altitudeKm < low || altitudeKm > high) {
    return { ok: false, reason: `The mean altitude of this file is ${Number.isFinite(altitudeKm) ? `${altitudeKm.toFixed(1)} km` : "not a number"}. The radiation grid covers ${low} to ${high} km, so no layer is drawn.` };
  }
  if (!Number.isFinite(shieldMm) || shieldMm < 0) {
    return { ok: false, reason: "The shield thickness is not a number of millimetres, 0 or more, so no layer is drawn." };
  }
  const { lat, lon, dose } = grid.meta;
  const protons = fluxSlice(grid, altitudeKm, 0);
  const electrons = fluxSlice(grid, altitudeKm, 1);
  const cells = lat.count * lon.count;
  const rates = new Float64Array(cells);
  let max = 0;
  let worst = 0;
  for (let k = 0; k < cells; k++) {
    rates[k] = doseRateKradPerYear(protons[k], electrons[k], shieldMm, dose);
    if (rates[k] > max) {
      max = rates[k];
      worst = k;
    }
  }

  const scores = new Float32Array(cells);
  let areaTotal = 0;
  let areaNoFlux = 0;
  for (let j = 0; j < lat.count; j++) {
    const weight = Math.cos(((lat.start_deg + j * lat.step_deg) * Math.PI) / 180);
    for (let i = 0; i < lon.count; i++) {
      const k = j * lon.count + i;
      const rate = rates[k];
      scores[k] = rate <= 0 || max <= 0 ? 1 : Math.min(1, Math.max(0, Math.log10(max / rate) / SCORE_DECADES));
      if (i < lon.count - 1) {
        areaTotal += weight;
        if (rate <= 0) areaNoFlux += weight;
      }
    }
  }
  return {
    ok: true,
    field: { lonStepDeg: lon.step_deg, latStepDeg: lat.step_deg, lonCount: lon.count, latCount: lat.count, scores },
    altitudeKm,
    shieldMm,
    maxDoseKradPerYear: max,
    worst: { latDeg: lat.start_deg + Math.floor(worst / lon.count) * lat.step_deg, lonDeg: lon.start_deg + (worst % lon.count) * lon.step_deg },
    noFluxAreaFraction: areaTotal === 0 ? 0 : areaNoFlux / areaTotal,
    decades: SCORE_DECADES,
  };
}
