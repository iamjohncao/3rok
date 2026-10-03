"""Orbit / eclipse unit tests (no aep8 required)."""

from __future__ import annotations

import math

from starmind_physics.config import load_params
from starmind_physics.orbit import (
    beta_angle_deg,
    eclipse_fraction,
    sso_inclination_deg,
    sso_inclination_wikipedia_deg,
)


def test_sso_inclination_near_97_6_at_550_km():
    """Plan checkpoint: SSO inclination ≈97.6° at 550 km [T]."""
    p = load_params()
    inc = sso_inclination_deg(550.0, p)
    assert 97.0 < inc < 98.5, f"unexpected SSO i={inc}"
    # Wikipedia rule-of-thumb should be in the same ballpark
    inc_w = sso_inclination_wikipedia_deg(550.0, p)
    assert abs(inc - inc_w) < 1.5


def test_dawn_dusk_sso_eclipse_near_zero():
    """Dawn-dusk SSO (LTAN 06:00) should have eclipse fraction near 0."""
    p = load_params()
    h = 800.0
    inc = sso_inclination_deg(h, p)
    beta = beta_angle_deg(inc, ltan_hours=6.0)
    f_e = eclipse_fraction(h, beta, p)
    assert f_e < 0.02, f"expected near-zero eclipse for dawn-dusk SSO, got {f_e} (beta={beta})"


def test_noon_sso_has_nonzero_eclipse():
    """Noon SSO (LTAN 12:00) should see a clear eclipse season (β≈0)."""
    p = load_params()
    h = 800.0
    inc = sso_inclination_deg(h, p)
    beta = beta_angle_deg(inc, ltan_hours=12.0)
    f_e = eclipse_fraction(h, beta, p)
    assert abs(beta) < 5.0
    assert f_e > 0.2, f"expected substantial eclipse at LTAN=12, got {f_e}"


def test_eclipse_fraction_bounded():
    p = load_params()
    for h in (500.0, 1200.0, 2000.0):
        for beta in (0.0, 20.0, 60.0, 89.0):
            f = eclipse_fraction(h, beta, p)
            assert 0.0 <= f <= 0.5 + 1e-9
            assert math.isfinite(f)
