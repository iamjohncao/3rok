"""Norris–Landzberg / Coffin–Manson thermal-cycling wear and radiator sizing."""

from __future__ import annotations

import math
from typing import Any


def delta_T_K(eclipse_fraction: float, load_strategy: str, params: dict[str, Any]) -> float:
    """Map eclipse + load strategy to a field ΔT [A]."""
    th = params["thermal"]
    if eclipse_fraction <= 0.0:
        return float(th["dT_no_eclipse_K"])
    if load_strategy == "load_follow_sun":
        return float(th["dT_eclipse_load_follow_K"])
    if load_strategy == "constant":
        return float(th["dT_eclipse_constant_load_K"])
    raise ValueError(f"Unknown load_strategy={load_strategy!r}")


def cycles_per_year(period_s: float, eclipse_fraction: float) -> float:
    """One thermal cycle per orbit that enters eclipse [A]."""
    if eclipse_fraction <= 0.0 or period_s <= 0.0:
        return 0.0
    orbits_per_year = (365.25 * 86400.0) / float(period_s)
    return orbits_per_year


def lifetime_thermal_years(
    period_s: float,
    eclipse_fraction: float,
    load_strategy: str,
    params: dict[str, Any],
) -> dict[str, float]:
    """
    Simplified Norris–Landzberg / Coffin–Manson [plan §3.5]:
      N_f = N_ref · (ΔT_ref / ΔT)^n
      L = N_f / cycles_per_year
    n from solder literature [S]; N_ref, ΔT_ref are [A].
    """
    th = params["thermal"]
    dT = delta_T_K(eclipse_fraction, load_strategy, params)
    cpy = cycles_per_year(period_s, eclipse_fraction)
    if dT <= 0.0 or cpy <= 0.0:
        return {
            "delta_T_K": dT,
            "cycles_per_year": cpy,
            "N_f_cycles": float("inf"),
            "lifetime_thermal_years": float("inf"),
        }
    n = float(th["n_coffin_manson"])
    N_f = float(th["N_ref_cycles"]) * (float(th["dT_ref_K"]) / dT) ** n
    life = N_f / cpy
    return {
        "delta_T_K": dT,
        "cycles_per_year": cpy,
        "N_f_cycles": N_f,
        "lifetime_thermal_years": life,
    }


def radiator_area_m2(heat_load_W: float, params: dict[str, Any]) -> dict[str, float]:
    """
    Required radiator area from Stefan–Boltzmann [plan §3.7]:
      A = Q / (ε σ (T^4 − T_sink^4))
    """
    r = params["radiator"]
    eps = float(r["epsilon"])
    sigma = float(r["sigma_W_m2_K4"])
    T = float(r["T_rad_K"])
    Ts = float(r["T_sink_K"])
    denom = eps * sigma * (T**4 - Ts**4)
    if denom <= 0.0:
        raise ValueError("Invalid radiator temperatures / emissivity")
    area = float(heat_load_W) / denom
    return {
        "radiator_area_m2": area,
        "heat_load_W": float(heat_load_W),
        "T_rad_K": T,
        "epsilon": eps,
    }


def heat_rejectable_W(area_m2: float, params: dict[str, Any]) -> float:
    """Inverse: max heat for a given radiator area."""
    r = params["radiator"]
    eps = float(r["epsilon"])
    sigma = float(r["sigma_W_m2_K4"])
    T = float(r["T_rad_K"])
    Ts = float(r["T_sink_K"])
    return float(area_m2) * eps * sigma * (T**4 - Ts**4)


def shield_mass_kg(shield_mm_Al: float, surface_m2: float, params: dict[str, Any]) -> float:
    """m = ρ_Al · t · A_surface [A surface area]."""
    rho = float(params["shielding"]["rho_Al_kg_m3"])
    t_m = float(shield_mm_Al) * 1.0e-3
    return rho * t_m * float(surface_m2)
