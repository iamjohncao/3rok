"""Flux/dose tests that need aep8 (skip cleanly if unavailable)."""

from __future__ import annotations

import pytest

aep8 = pytest.importorskip("aep8")

from starmind_physics.config import load_params  # noqa: E402
from starmind_physics.dose import dose_rate_krad_per_year  # noqa: E402
from starmind_physics.evaluate import evaluate  # noqa: E402
from starmind_physics.flux import orbit_averaged_flux  # noqa: E402
from starmind_physics.orbit import sso_inclination_deg  # noqa: E402


@pytest.mark.aep8
def test_proton_flux_and_dose_rise_with_altitude():
    """Plan table: dose/flux rises sharply from ~550 km to ~2000 km."""
    p = load_params()
    low_h, high_h = 550.0, 2000.0
    inc_low = sso_inclination_deg(low_h, p)
    inc_high = sso_inclination_deg(high_h, p)

    f_low = orbit_averaged_flux(low_h, inc_low, p, n_samples=80)
    f_high = orbit_averaged_flux(high_h, inc_high, p, n_samples=80)

    assert f_high["proton_flux_cm2_s"] > 5.0 * f_low["proton_flux_cm2_s"]

    d_low = dose_rate_krad_per_year(
        f_low["proton_flux_cm2_s"], f_low["electron_flux_cm2_s"], 5.0, p
    )
    d_high = dose_rate_krad_per_year(
        f_high["proton_flux_cm2_s"], f_high["electron_flux_cm2_s"], 5.0, p
    )
    assert d_high["dose_rate_krad_Si_per_year"] > 5.0 * d_low["dose_rate_krad_Si_per_year"]


@pytest.mark.aep8
def test_evaluate_returns_core_fields():
    r = evaluate(
        {
            "altitude_km": 800.0,
            "inclination": "sso",
            "ltan_hours": 6.0,
            "shield_mm_Al": 5.0,
            "chip_preset": "commercial",
            "n_samples": 60,
        }
    )
    for key in ("lifetime_years", "mean_power_kW", "radiator_area_m2", "shield_mass_kg"):
        assert key in r
        assert r[key] is None or r[key] >= 0
    assert r["orbit"]["eclipse_fraction"] < 0.05
    assert "breakdown" in r
