#!/usr/bin/env python3
"""Builds the placement-score layer's data from the physics package. Not run in the build.

    python scripts/build-flux-grid.py

Needs `starmind_physics` installed with aep8 (`pip install -e "starmind-physics[dev]"`, or the
flight-mcp requirements). Writes:

  public/flux/flux-grid.bin      float32, little-endian, layout [altitude][particle][lat][lon]
  public/flux/flux-grid.json     the axes, the model, and the dose coefficients, with their status
  fixtures/dose-rate-expected.json   the package's own dose_rate_krad_per_year, for the lockstep test

The grid is `starmind_physics.flux.latlon_flux_grid`: AE8/AP8 integral flux (protons above 10 MeV,
electrons above 1 MeV) on a 3 degree longitude and latitude grid, at each altitude from 500 to 2000
km in 100 km steps, solar maximum, at the epoch in params.yaml. Nothing here is fitted or
smoothed. The dose coefficients are the package's, and they are marked [A] (assumed) in params.yaml.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

from starmind_physics.config import load_params
from starmind_physics.dose import dose_rate_krad_per_year
from starmind_physics.flux import latlon_flux_grid

ROOT = Path(__file__).resolve().parents[1]
ALTITUDES_KM = list(range(500, 2001, 100))
STEP_DEG = 3.0
PARTICLES = ("p", "e")


def main() -> int:
    params = load_params()
    slices: list[np.ndarray] = []
    lats = lons = None
    meta_particles: dict[str, float] = {}

    for altitude in ALTITUDES_KM:
        per_particle = []
        for particle in PARTICLES:
            grid = latlon_flux_grid(float(altitude), params, particle=particle, lat_step_deg=STEP_DEG, lon_step_deg=STEP_DEG)
            flux = np.array([[np.nan if v is None else v for v in row] for row in grid["flux_cm2_s"]], dtype=np.float64)
            if not np.all(np.isfinite(flux)):
                raise SystemExit(f"aep8 returned a value that is not finite at {altitude} km, particle {particle}.")
            per_particle.append(flux.astype("<f4"))
            lats, lons = grid["lat_deg"], grid["lon_deg"]
            meta_particles[particle] = grid["energy_MeV"]
        slices.append(np.stack(per_particle))
        print(f"  {altitude} km", file=sys.stderr)

    data = np.stack(slices).astype("<f4")  # [altitude][particle][lat][lon]
    out = ROOT / "public" / "flux"
    out.mkdir(parents=True, exist_ok=True)
    (out / "flux-grid.bin").write_bytes(data.tobytes(order="C"))

    dose = params["dose"]
    meta = {
        "source": "starmind_physics.flux.latlon_flux_grid",
        "model": "AE8/AP8 via aep8",
        "solar": params["flux"]["solar"],
        "epoch_utc": params["orbit_sampling"]["epoch_utc"],
        "altitudes_km": ALTITUDES_KM,
        "lat": {"start_deg": float(lats[0]), "step_deg": STEP_DEG, "count": len(lats)},
        "lon": {"start_deg": float(lons[0]), "step_deg": STEP_DEG, "count": len(lons)},
        "particles": [
            {"key": "p", "energy_MeV": meta_particles["p"], "quantity": "integral flux above the energy, cm^-2 s^-1"},
            {"key": "e", "energy_MeV": meta_particles["e"], "quantity": "integral flux above the energy, cm^-2 s^-1"},
        ],
        "layout": "float32 little-endian, [altitude][particle][lat][lon], latitude from the south, longitude from -180 (the last column repeats the first)",
        "dose": {
            "model": "exponential_fallback_not_SHIELDOSE2",
            "k_p_krad_yr_per_flux": dose["k_p_krad_yr_per_flux"],
            "k_e_krad_yr_per_flux": dose["k_e_krad_yr_per_flux"],
            "lambda_p_mm": dose["lambda_p_mm"],
            "lambda_e_mm": dose["lambda_e_mm"],
            "status": "assumed",
            "note": "These coefficients are labelled [A] in starmind_physics/params.yaml. They are assumptions, not SHIELDOSE-2.",
        },
        "generated_by": "scripts/build-flux-grid.py",
    }
    (out / "flux-grid.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    # The package's dose-rate function on a spread of inputs, for lib/globe/flux-grid.test.ts.
    cases = []
    for proton, electron in [(0.0, 0.0), (3041.0, 0.0), (0.0, 93508.9), (120.5, 4000.0), (3041.0, 93508.9), (1.0, 1.0)]:
        for shield in (0.0, 1.0, 2.5, 5.0, 10.0, 20.0):
            result = dose_rate_krad_per_year(proton, electron, shield, params)
            cases.append(
                {
                    "proton_flux_cm2_s": proton,
                    "electron_flux_cm2_s": electron,
                    "shield_mm_Al": shield,
                    "dose_rate_krad_Si_per_year": result["dose_rate_krad_Si_per_year"],
                }
            )
    expected = {
        "_about": "Written by scripts/build-flux-grid.py from starmind_physics.dose.dose_rate_krad_per_year. lib/globe/flux-grid.test.ts compares lib/globe/flux-grid.ts to it.",
        "coefficients": meta["dose"],
        "cases": cases,
    }
    (ROOT / "fixtures" / "dose-rate-expected.json").write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {data.nbytes} bytes, shape {data.shape}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
