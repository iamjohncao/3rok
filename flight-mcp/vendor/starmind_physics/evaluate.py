"""Public API: evaluate(config) → lifetime, mean power, radiator area, shield mass."""

from __future__ import annotations

import math
from typing import Any

from starmind_physics.config import resolve_config
from starmind_physics.dose import (
    dose_rate_krad_per_year,
    lifetime_seu_years,
    lifetime_tid_years,
    seu_rate_and_availability,
)
from starmind_physics.flux import flux_along_oem, orbit_averaged_flux
from starmind_physics.orbit import (
    beta_angle_deg,
    eclipse_fraction,
    orbital_elements,
    resolve_inclination_deg,
)
from starmind_physics.power import (
    array_dose_rate,
    bol_sunlit_power_W,
    degradation_at_year,
    lifetime_power_years,
    mean_power_W,
)
from starmind_physics.thermal import (
    heat_rejectable_W,
    lifetime_thermal_years,
    radiator_area_m2,
    shield_mass_kg,
)


def _finite(x: float) -> float | None:
    if x is None or not math.isfinite(float(x)):
        return None
    return float(x)


def evaluate(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Evaluate one LEO compute-satellite configuration.

    Parameters (config keys)
    ------------------------
    altitude_km : float
        500–2000 km (SpaceX FCC envelope [S]).
    inclination : "sso" | float
        ~30° or sun-synchronous.
    ltan_hours : float
        Local time of ascending node (hours).
    shield_mm_Al : float
        Aluminum shield thickness (mm).
    radiator_area_m2 : float | None
        If None, size from Stefan–Boltzmann for heat load.
    chip_preset : "commercial" | "rad_hard" | "custom" | chip_id
    chip_id : str | None
        Row id from data/ai_chips.yaml (preferred over preset aliases).
    dose_limit_krad_Si : float | None
        Adjustable dose limit; overrides chip/preset when set.
    load_strategy : "constant" | "load_follow_sun"
    array_area_m2, shield_surface_m2, peak_compute_kW, solar, solar_phase,
    f107_sfu, n_samples : optional
    oem_path : str | None
        CCSDS OEM 3.0 file (GCRF, UTC, km and km/s). When set, trapped flux
        is the nanmean along that track instead of the synthetic ground track.
        Eclipse, beta, and period still use altitude / inclination / LTAN.

    Returns
    -------
    dict with:
      lifetime_years, mean_power_kW, radiator_area_m2, shield_mass_kg,
      limiting_mode, breakdown, assumptions_note
    """
    cfg = resolve_config(config)
    p = cfg["_params"]

    alt = float(cfg["altitude_km"])
    inc = resolve_inclination_deg(cfg["inclination"], alt, p)
    ltan = float(cfg["ltan_hours"])
    shield = float(cfg["shield_mm_Al"])
    load = str(cfg["load_strategy"])

    els = orbital_elements(alt, p)
    beta = beta_angle_deg(inc, ltan)
    f_e = eclipse_fraction(alt, beta, p)

    oem_path = cfg.get("oem_path")
    if oem_path:
        flux = flux_along_oem(
            oem_path,
            p,
            solar=cfg.get("solar"),
            solar_phase=cfg.get("solar_phase"),
        )
    else:
        flux = orbit_averaged_flux(
            alt,
            inc,
            p,
            solar=cfg.get("solar"),
            solar_phase=cfg.get("solar_phase"),
            n_samples=cfg.get("n_samples"),
        )

    dose = dose_rate_krad_per_year(
        flux["proton_flux_cm2_s"],
        flux["electron_flux_cm2_s"],
        shield,
        p,
    )
    L_tid = lifetime_tid_years(float(cfg["dose_limit_krad_Si"]), dose["dose_rate_krad_Si_per_year"])

    seu = seu_rate_and_availability(
        flux["proton_flux_cm2_s"],
        p,
        R_ref_upsets_per_bit_day=cfg.get("seu_R_ref_upsets_per_bit_day"),
        bits=cfg.get("seu_bits"),
    )
    L_seu = lifetime_seu_years(seu["availability"], p)

    therm = lifetime_thermal_years(els["period_s"], f_e, load, p)
    L_th = therm["lifetime_thermal_years"]

    bol_W = bol_sunlit_power_W(float(cfg["array_area_m2"]), p)
    d_array = array_dose_rate(flux["proton_flux_cm2_s"], flux["electron_flux_cm2_s"], p)
    pow_life = lifetime_power_years(bol_W, f_e, d_array, p)
    L_pow = pow_life["lifetime_power_years"]

    # Lifetime = min of dose, thermal-fatigue, power, SEU-availability [A definition]
    modes = {
        "tid": L_tid,
        "thermal_fatigue": L_th,
        "power": L_pow,
        "seu_availability": L_seu,
    }
    # Pick finite minimum
    finite_modes = {k: v for k, v in modes.items() if math.isfinite(v)}
    if not finite_modes:
        lifetime = float("inf")
        limiting = "none_infinite"
    else:
        limiting = min(finite_modes, key=finite_modes.get)
        lifetime = finite_modes[limiting]

    # Mean power at mid-life (or at lifetime if finite)
    t_eval = lifetime if math.isfinite(lifetime) else 5.0
    deg = degradation_at_year(d_array, t_eval, p)
    p_mean_W = mean_power_W(bol_W, f_e, deg)
    # Apply SEU availability as an effective duty/availability cost [A]
    p_mean_W_eff = p_mean_W * seu["availability"]

    heat_frac = float(p["radiator"]["heat_fraction"])
    # Heat load: use peak_compute as proxy for dissipation when given, else electrical mean
    peak_W = float(cfg["peak_compute_kW"]) * 1000.0
    heat_W = heat_frac * min(peak_W, p_mean_W_eff if p_mean_W_eff > 0 else peak_W)

    if cfg.get("radiator_area_m2") is None:
        rad = radiator_area_m2(heat_W, p)
        rad_area = rad["radiator_area_m2"]
        rad_sized = True
    else:
        rad_area = float(cfg["radiator_area_m2"])
        rad_sized = False
        # If fixed radiator cannot reject heat, power-limit lifetime further
        q_max = heat_rejectable_W(rad_area, p)
        if heat_W > q_max and heat_W > 0:
            # Scale usable compute / report cooling shortfall
            cool_scale = q_max / heat_W
            p_mean_W_eff *= cool_scale
            if limiting == "none_infinite" or lifetime > 0:
                # Immediate thermal/power constraint if chronically under-cooled [A]
                if cool_scale < float(p["power"]["p_min_fraction_of_BOL"]):
                    lifetime = 0.0
                    limiting = "radiator_capacity"
                    modes["radiator_capacity"] = 0.0

    m_shield = shield_mass_kg(shield, float(cfg["shield_surface_m2"]), p)

    return {
        "lifetime_years": _finite(lifetime),
        "mean_power_kW": p_mean_W_eff / 1000.0,
        "radiator_area_m2": rad_area,
        "shield_mass_kg": m_shield,
        "limiting_mode": limiting,
        "orbit": {
            "altitude_km": alt,
            "inclination_deg": inc,
            "ltan_hours": ltan,
            "period_min": els["period_min"],
            "beta_deg": beta,
            "eclipse_fraction": f_e,
            "sunlight_fraction": 1.0 - f_e,
        },
        "flux": flux,
        "dose": {
            **dose,
            "dose_limit_krad_Si": float(cfg["dose_limit_krad_Si"]),
            "dose_limit_provenance": cfg.get("dose_limit_provenance"),
            "dose_limit_basis": cfg.get("dose_limit_basis"),
            "chip_preset": cfg["chip_preset"],
            "chip_id": cfg.get("chip_id"),
            "chip_vendor": cfg.get("chip_vendor"),
            "chip_product": cfg.get("chip_product"),
        },
        "chip": None
        if cfg.get("_chip") is None
        else {
            "id": cfg["_chip"]["id"],
            "vendor": cfg["_chip"].get("vendor"),
            "product": cfg["_chip"].get("product"),
            "category": cfg["_chip"].get("category"),
            "starmind_status": cfg["_chip"].get("starmind_status"),
            "dose_limit_krad_Si": cfg["_chip"].get("dose_limit_krad_Si"),
            "dose_limit_provenance": cfg["_chip"].get("dose_limit_provenance"),
            "seu_provenance": cfg["_chip"].get("seu_provenance"),
        },
        "seu": {**seu, "seu_provenance": cfg.get("seu_provenance")},
        "thermal": therm,
        "power": {
            "bol_sunlit_kW": bol_W / 1000.0,
            "mean_power_before_seu_kW": p_mean_W / 1000.0,
            "degradation_at_eval": deg,
            "t_eval_years": t_eval if math.isfinite(t_eval) else None,
            **{k: _finite(v) if isinstance(v, float) else v for k, v in pow_life.items()},
        },
        "cooling": {
            "heat_load_kW": heat_W / 1000.0,
            "radiator_sized_from_stefan_boltzmann": rad_sized,
            "radiator_params_assumed": True,
        },
        "breakdown": {
            "L_tid_years": _finite(L_tid),
            "L_thermal_years": _finite(L_th),
            "L_power_years": _finite(L_pow),
            "L_seu_availability_years": _finite(L_seu),
        },
        "config_resolved": {
            k: v for k, v in cfg.items() if k not in {"_params", "_chip"}
        },
        "assumptions_note": _assumptions_note(bool(oem_path)),
    }


def _assumptions_note(used_oem: bool) -> str:
    note = (
        "Lifetime = min(L_TID, L_thermal, L_power, L_SEU-availability) [A]. "
        "Dose uses exponential Al fallback, not SHIELDOSE-2 [A]. "
        "Chip dose limits come from data/ai_chips.yaml — only rows marked "
        "dose_limit_provenance=sourced are public anchors (Trillium / RAD750); "
        "assumed/[?] values are ranking placeholders, not Starmind/Rubin facts. "
        "Physics coefficients: starmind_physics/params.yaml."
    )
    if used_oem:
        note += (
            " Flux is the nanmean along the OEM window, not a full-orbit average; "
            "eclipse, beta, and period still use altitude/inclination/LTAN [A]."
        )
    return note
