#!/usr/bin/env python3
"""Sample configs and export a Pareto front: lifetime vs mean power vs shielding cost."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

from starmind_physics.evaluate import evaluate


def _shielding_cost(result: dict[str, Any]) -> float:
    """Composite cost [A]: shield mass (kg) + radiator area (m²) as a scalar."""
    return float(result["shield_mass_kg"]) + float(result["radiator_area_m2"])


def brute_force(n_per_dim: int, seed: int) -> list[dict[str, Any]]:
    """Cartesian-ish grid over the FCC envelope + shield/LTAN/preset."""
    altitudes = np.linspace(500.0, 2000.0, n_per_dim)
    ltan = np.linspace(0.0, 12.0, max(3, n_per_dim // 2))
    shields = np.linspace(1.0, 15.0, max(3, n_per_dim // 2))
    inclinations = ["sso", 30.0]
    presets = ["commercial", "rad_hard"]
    load_strategies = ["constant"]

    rows: list[dict[str, Any]] = []
    for h in altitudes:
        for inc in inclinations:
            for lt in ltan:
                for sh in shields:
                    for preset in presets:
                        for load in load_strategies:
                            cfg = {
                                "altitude_km": float(h),
                                "inclination": inc,
                                "ltan_hours": float(lt),
                                "shield_mm_Al": float(sh),
                                "chip_preset": preset,
                                "load_strategy": load,
                                # Fewer aep8 samples for search speed [A]
                                "n_samples": 120,
                            }
                            try:
                                r = evaluate(cfg)
                            except Exception as exc:  # noqa: BLE001 — keep search going
                                rows.append({"config": cfg, "error": str(exc)})
                                continue
                            rows.append(
                                {
                                    "config": {
                                        "altitude_km": float(h),
                                        "inclination": inc,
                                        "ltan_hours": float(lt),
                                        "shield_mm_Al": float(sh),
                                        "chip_preset": preset,
                                        "load_strategy": load,
                                    },
                                    "lifetime_years": r["lifetime_years"],
                                    "mean_power_kW": r["mean_power_kW"],
                                    "shield_mass_kg": r["shield_mass_kg"],
                                    "radiator_area_m2": r["radiator_area_m2"],
                                    "shielding_cost": _shielding_cost(r),
                                    "limiting_mode": r["limiting_mode"],
                                    "eclipse_fraction": r["orbit"]["eclipse_fraction"],
                                }
                            )
    return rows


def nsga2_search(n_gen: int, pop_size: int, seed: int) -> list[dict[str, Any]]:
    """NSGA-II over continuous decision vars (pymoo)."""
    from pymoo.algorithms.moo.nsga2 import NSGA2
    from pymoo.core.problem import ElementwiseProblem
    from pymoo.optimize import minimize
    from pymoo.operators.crossover.sbx import SBX
    from pymoo.operators.mutation.pm import PM
    from pymoo.operators.sampling.rnd import FloatRandomSampling
    from pymoo.termination import get_termination

    class StarmindProblem(ElementwiseProblem):
        # x = [altitude_km, inc_flag, ltan_hours, shield_mm, preset_flag]
        def __init__(self):
            super().__init__(
                n_var=5,
                n_obj=3,
                n_ieq_constr=0,
                xl=np.array([500.0, 0.0, 0.0, 1.0, 0.0]),
                xu=np.array([2000.0, 1.0, 12.0, 15.0, 1.0]),
            )

        def _evaluate(self, x, out, *args, **kwargs):
            alt, inc_f, ltan, shield, preset_f = [float(v) for v in x]
            inc: Any = "sso" if inc_f >= 0.5 else 30.0
            preset = "rad_hard" if preset_f >= 0.5 else "commercial"
            cfg = {
                "altitude_km": alt,
                "inclination": inc,
                "ltan_hours": ltan,
                "shield_mm_Al": shield,
                "chip_preset": preset,
                "load_strategy": "constant",
                "n_samples": 100,
            }
            try:
                r = evaluate(cfg)
                life = r["lifetime_years"]
                power = r["mean_power_kW"]
                cost = _shielding_cost(r)
                if life is None:
                    life = 0.0
            except Exception:  # noqa: BLE001
                life, power, cost = 0.0, 0.0, 1.0e6
            # Maximize life & power, minimize cost → minimize negatives for first two
            out["F"] = [-life, -power, cost]

    problem = StarmindProblem()
    algorithm = NSGA2(
        pop_size=pop_size,
        sampling=FloatRandomSampling(),
        crossover=SBX(prob=0.9, eta=15),
        mutation=PM(eta=20),
        eliminate_duplicates=True,
    )
    res = minimize(
        problem,
        algorithm,
        get_termination("n_gen", n_gen),
        seed=seed,
        verbose=False,
    )

    rows: list[dict[str, Any]] = []
    if res.X is None:
        return rows
    X = np.atleast_2d(res.X)
    F = np.atleast_2d(res.F)
    for x, f in zip(X, F):
        alt, inc_f, ltan, shield, preset_f = [float(v) for v in x]
        inc: Any = "sso" if inc_f >= 0.5 else 30.0
        preset = "rad_hard" if preset_f >= 0.5 else "commercial"
        rows.append(
            {
                "config": {
                    "altitude_km": alt,
                    "inclination": inc,
                    "ltan_hours": ltan,
                    "shield_mm_Al": shield,
                    "chip_preset": preset,
                    "load_strategy": "constant",
                },
                "lifetime_years": float(-f[0]),
                "mean_power_kW": float(-f[1]),
                "shielding_cost": float(f[2]),
                "source": "nsga2",
            }
        )
    return rows


def pareto_front_3d(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Non-dominated set: max lifetime, max power, min shielding_cost."""
    valid = [
        r
        for r in rows
        if "error" not in r
        and r.get("lifetime_years") is not None
        and math.isfinite(float(r["lifetime_years"]))
        and math.isfinite(float(r["mean_power_kW"]))
        and math.isfinite(float(r["shielding_cost"]))
    ]
    front: list[dict[str, Any]] = []
    for a in valid:
        dominated = False
        for b in valid:
            if b is a:
                continue
            better_or_eq = (
                b["lifetime_years"] >= a["lifetime_years"]
                and b["mean_power_kW"] >= a["mean_power_kW"]
                and b["shielding_cost"] <= a["shielding_cost"]
            )
            strictly = (
                b["lifetime_years"] > a["lifetime_years"]
                or b["mean_power_kW"] > a["mean_power_kW"]
                or b["shielding_cost"] < a["shielding_cost"]
            )
            if better_or_eq and strictly:
                dominated = True
                break
        if not dominated:
            front.append(a)
    front.sort(key=lambda r: (-r["lifetime_years"], -r["mean_power_kW"], r["shielding_cost"]))
    return front


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--method",
        choices=("brute", "nsga2", "both"),
        default="brute",
        help="Search method (default: brute grid)",
    )
    ap.add_argument("--n-per-dim", type=int, default=4, help="Brute-force samples per altitude axis")
    ap.add_argument("--n-gen", type=int, default=8, help="NSGA-II generations")
    ap.add_argument("--pop-size", type=int, default=24, help="NSGA-II population")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("pareto_front.json"),
        help="Output JSON path",
    )
    args = ap.parse_args(argv)

    all_rows: list[dict[str, Any]] = []
    if args.method in {"brute", "both"}:
        print(f"Brute-force grid (n_per_dim={args.n_per_dim})...", file=sys.stderr)
        all_rows.extend(brute_force(args.n_per_dim, args.seed))
    if args.method in {"nsga2", "both"}:
        print(f"NSGA-II (pop={args.pop_size}, gen={args.n_gen})...", file=sys.stderr)
        all_rows.extend(nsga2_search(args.n_gen, args.pop_size, args.seed))

    front = pareto_front_3d(all_rows)
    payload = {
        "objectives": {
            "lifetime_years": "maximize",
            "mean_power_kW": "maximize",
            "shielding_cost": "minimize (shield_mass_kg + radiator_area_m2) [A]",
        },
        "method": args.method,
        "n_evaluated": len(all_rows),
        "n_errors": sum(1 for r in all_rows if "error" in r),
        "pareto_front": front,
        "disclaimer": (
            "Ranking under stated assumptions in starmind_physics/params.yaml. "
            "Not a prediction of Starmind flight lifetime."
        ),
    }
    args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(front)} Pareto points from {len(all_rows)} evals → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
