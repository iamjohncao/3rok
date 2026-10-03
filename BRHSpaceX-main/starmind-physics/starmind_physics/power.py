"""Solar-array power and degradation-limited lifetime."""

from __future__ import annotations

import math
from typing import Any

from starmind_physics.dose import dose_rate_krad_per_year


def bol_sunlit_power_W(array_area_m2: float, params: dict[str, Any]) -> float:
    """P0 = S · A · η_BOL · cosθ  [A efficiencies; S textbook solar constant]."""
    pw = params["power"]
    return (
        float(pw["solar_constant_W_m2"])
        * float(array_area_m2)
        * float(pw["eta_BOL"])
        * float(pw["cos_theta"])
    )


def mean_power_W(
    bol_sunlit_W: float,
    eclipse_fraction: float,
    degradation: float,
) -> float:
    """P̄ = P0 · (1 − f_E) · (1 − deg)  [A; ignores battery discharge detail]."""
    deg = max(0.0, min(1.0, float(degradation)))
    return float(bol_sunlit_W) * (1.0 - float(eclipse_fraction)) * (1.0 - deg)


def array_dose_rate(
    proton_flux_cm2_s: float,
    electron_flux_cm2_s: float,
    params: dict[str, Any],
) -> float:
    """Thin-shield dose proxy for the array [A cover-glass thickness]."""
    t = float(params["power"]["array_shield_mm_Al"])
    return dose_rate_krad_per_year(proton_flux_cm2_s, electron_flux_cm2_s, t, params)[
        "dose_rate_krad_Si_per_year"
    ]


def degradation_at_year(dose_rate_array_krad_yr: float, t_years: float, params: dict[str, Any]) -> float:
    """Linear fluence/dose proxy [A]: deg = min(deg_max, k · Ḋ · t)."""
    pw = params["power"]
    raw = float(pw["k_deg_per_krad"]) * float(dose_rate_array_krad_yr) * float(t_years)
    return min(float(pw["deg_max"]), max(0.0, raw))


def lifetime_power_years(
    bol_sunlit_W: float,
    eclipse_fraction: float,
    dose_rate_array_krad_yr: float,
    params: dict[str, Any],
) -> dict[str, float]:
    """
    Years until mean power falls below p_min_fraction · BOL sunlit·(1−f_E).

    Solve: (1 − k Ḋ t) = f_min  →  t = (1 − f_min) / (k Ḋ)
    """
    pw = params["power"]
    f_min = float(pw["p_min_fraction_of_BOL"])
    k = float(pw["k_deg_per_krad"])
    # If already can't meet floor at BOL (shouldn't), lifetime 0
    p_bol_mean = bol_sunlit_W * (1.0 - eclipse_fraction)
    if p_bol_mean <= 0.0:
        return {
            "lifetime_power_years": 0.0,
            "p_min_W": 0.0,
            "array_dose_rate_krad_yr": dose_rate_array_krad_yr,
        }
    p_min = f_min * p_bol_mean
    if dose_rate_array_krad_yr <= 0.0 or k <= 0.0:
        life = float("inf")
    else:
        # Need 1 - k D t >= f_min
        life = (1.0 - f_min) / (k * dose_rate_array_krad_yr)
        if life < 0.0:
            life = 0.0
        # Cap by deg_max: once deg hits deg_max, power floors
        deg_max = float(pw["deg_max"])
        p_at_cap = p_bol_mean * (1.0 - deg_max)
        if p_at_cap >= p_min:
            # Never crosses floor from degradation alone
            life = float("inf")
    return {
        "lifetime_power_years": life,
        "p_min_W": p_min,
        "array_dose_rate_krad_yr": dose_rate_array_krad_yr,
    }


def finite_or_none(x: float) -> float | None:
    if x is None or not math.isfinite(x):
        return None
    return float(x)
