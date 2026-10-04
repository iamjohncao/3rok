"""Total ionizing dose behind Al shielding (exponential fallback)."""

from __future__ import annotations

import math
from typing import Any


def dose_rate_krad_per_year(
    proton_flux_cm2_s: float,
    electron_flux_cm2_s: float,
    shield_mm_Al: float,
    params: dict[str, Any],
) -> dict[str, float]:
    """
    Exponential dose-depth fallback [A] — not SHIELDOSE-2.

    dose_rate = k_p Φ_p exp(-t/λ_p) + k_e Φ_e exp(-t/λ_e)   [krad(Si)/yr]
    Coefficients live in params.yaml and are labelled assumptions.
    """
    d = params["dose"]
    t = max(0.0, float(shield_mm_Al))
    p_term = (
        float(d["k_p_krad_yr_per_flux"])
        * float(proton_flux_cm2_s)
        * math.exp(-t / float(d["lambda_p_mm"]))
    )
    e_term = (
        float(d["k_e_krad_yr_per_flux"])
        * float(electron_flux_cm2_s)
        * math.exp(-t / float(d["lambda_e_mm"]))
    )
    total = p_term + e_term
    return {
        "dose_rate_krad_Si_per_year": total,
        "dose_rate_proton_term": p_term,
        "dose_rate_electron_term": e_term,
        "model": "exponential_fallback_not_SHIELDOSE2",
    }


def lifetime_tid_years(dose_limit_krad_Si: float, dose_rate_krad_per_year: float) -> float:
    """L_TID = D_limit / Dose_rate [plan §3.2]."""
    if dose_rate_krad_per_year <= 0.0 or not math.isfinite(dose_rate_krad_per_year):
        return float("inf")
    return float(dose_limit_krad_Si) / float(dose_rate_krad_per_year)


def seu_rate_and_availability(
    proton_flux_cm2_s: float,
    params: dict[str, Any],
    *,
    R_ref_upsets_per_bit_day: float | None = None,
    bits: float | None = None,
    t_recovery_s: float | None = None,
) -> dict[str, float]:
    """
    SEU rate scaled from proton flux [A hackathon shortcut]:
      R = R_ref · (Φ_p / Φ_ref)
      availability = 1 − R · bits · t_recovery   (clamped)

    Optional overrides come from the AI chip database when a chip_id is set.
    """
    s = params["seu"]
    phi_ref = float(s["Phi_ref_p_cm2_s"])
    scale = float(proton_flux_cm2_s) / phi_ref if phi_ref > 0 else 0.0
    R_ref = float(
        s["R_ref_upsets_per_bit_day"]
        if R_ref_upsets_per_bit_day is None
        else R_ref_upsets_per_bit_day
    )
    R = R_ref * scale  # upsets / bit / day
    n_bits = float(s["bits"] if bits is None else bits)
    t_rec = float(s["t_recovery_s"] if t_recovery_s is None else t_recovery_s)
    t_rec_days = t_rec / 86400.0
    # Fractional downtime ≈ event_rate * recovery_time
    downtime = R * n_bits * t_rec_days
    availability = max(0.0, min(1.0, 1.0 - downtime))
    return {
        "seu_rate_per_bit_day": R,
        "seu_events_per_day": R * n_bits,
        "availability": availability,
        "downtime_fraction": min(1.0, downtime),
        "R_ref_upsets_per_bit_day": R_ref,
        "bits": n_bits,
    }


def lifetime_seu_years(availability: float, params: dict[str, Any]) -> float:
    """
    SEU as availability / downtime budget [A], not a physics wear-out law.

    Below min_availability → 0 years. Else years to spend downtime_budget.
    """
    s = params["seu"]
    if availability < float(s["min_availability"]):
        return 0.0
    downtime = 1.0 - availability
    if downtime <= 0.0:
        return float("inf")
    return float(s["downtime_budget_years"]) / downtime
