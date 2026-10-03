#!/usr/bin/env python3
"""Write a lat/lon trapped-particle flux grid (South Atlantic Anomaly map)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from starmind_physics.config import load_params
from starmind_physics.flux import latlon_flux_grid


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--altitude-km", type=float, default=550.0)
    ap.add_argument("--particle", choices=("p", "e"), default="p")
    ap.add_argument("--energy-MeV", type=float, default=None, help="Default: 10 MeV p / 1 MeV e")
    ap.add_argument("--solar", choices=("max", "min"), default="max")
    ap.add_argument("--lat-step", type=float, default=5.0)
    ap.add_argument("--lon-step", type=float, default=5.0)
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("saa_flux_grid.json"),
    )
    args = ap.parse_args(argv)

    params = load_params()
    grid = latlon_flux_grid(
        args.altitude_km,
        params,
        particle=args.particle,
        energy_MeV=args.energy_MeV,
        solar=args.solar,
        lat_step_deg=args.lat_step,
        lon_step_deg=args.lon_step,
    )
    # Highlight SAA sample point from the plan [T]: (-30°, -45°)
    lats = grid["lat_deg"]
    lons = grid["lon_deg"]
    flux = grid["flux_cm2_s"]
    # nearest cell
    i = min(range(len(lats)), key=lambda k: abs(lats[k] - (-30.0)))
    j = min(range(len(lons)), key=lambda k: abs(lons[k] - (-45.0)))
    i0 = min(range(len(lats)), key=lambda k: abs(lats[k] - 0.0))
    j0 = min(range(len(lons)), key=lambda k: abs(lons[k] - 0.0))
    grid["saa_sample"] = {
        "lat_deg": lats[i],
        "lon_deg": lons[j],
        "flux_cm2_s": flux[i][j],
        "note": "Near plan probe point (-30,-45); expect elevated proton flux in SAA",
    }
    grid["equator_sample"] = {
        "lat_deg": lats[i0],
        "lon_deg": lons[j0],
        "flux_cm2_s": flux[i0][j0],
        "note": "Near (0,0); typically much lower than SAA for >10 MeV protons",
    }

    args.output.write_text(json.dumps(grid, indent=2), encoding="utf-8")
    print(
        f"Wrote {len(lats)}×{len(lons)} grid at {args.altitude_km} km → {args.output}\n"
        f"  SAA-ish ({lats[i]}, {lons[j]}): {flux[i][j]} /cm2/s\n"
        f"  Equator ({lats[i0]}, {lons[j0]}): {flux[i0][j0]} /cm2/s"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
