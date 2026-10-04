"""Orbit geometry: Kepler period, SSO inclination, beta angle, eclipse fraction."""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def orbital_elements(altitude_km: float, params: dict[str, Any]) -> dict[str, float]:
    """Circular-orbit basics: a, n, period."""
    Re = params["earth"]["R_E_km"]
    mu = params["earth"]["mu_km3_s2"]
    a = Re + float(altitude_km)
    n = math.sqrt(mu / a**3)
    period_s = 2.0 * math.pi / n
    return {"a_km": a, "n_rad_s": n, "period_s": period_s, "period_min": period_s / 60.0}


def sso_inclination_deg(altitude_km: float, params: dict[str, Any]) -> float:
    """
    Sun-synchronous inclination from J2 nodal-rate match.

    cos i = -2 ω_sun / (3 J2 n (Re/a)^2)
    [S] standard SSO / J2 formula; probe.py cross-check ≈97.6° at 550 km.
    Also check Wikipedia form cos i = -(a / 12352 km)^(7/2).
    """
    earth = params["earth"]
    Re = earth["R_E_km"]
    mu = earth["mu_km3_s2"]
    J2 = earth["J2"]
    year_s = earth["year_days"] * 86400.0
    w_sun = 2.0 * math.pi / year_s
    a = Re + float(altitude_km)
    n = math.sqrt(mu / a**3)
    cosi = -2.0 * w_sun / (3.0 * J2 * n * (Re / a) ** 2)
    cosi = float(np.clip(cosi, -1.0, 1.0))
    return math.degrees(math.acos(cosi))


def sso_inclination_wikipedia_deg(altitude_km: float, params: dict[str, Any]) -> float:
    """Wikipedia SSO rule-of-thumb: cos i = -(a / 12352 km)^(7/2) [S]."""
    Re = params["earth"]["R_E_km"]
    a_ref = params["earth"]["sso_a_ref_km"]
    a = Re + float(altitude_km)
    cosi = -((a / a_ref) ** 3.5)
    cosi = float(np.clip(cosi, -1.0, 1.0))
    return math.degrees(math.acos(cosi))


def resolve_inclination_deg(inclination: str | float, altitude_km: float, params: dict[str, Any]) -> float:
    if isinstance(inclination, str) and inclination.lower() in {"sso", "sun-synchronous", "sun_synchronous"}:
        return sso_inclination_deg(altitude_km, params)
    return float(inclination)


def beta_angle_deg(
    inclination_deg: float,
    ltan_hours: float,
    sun_declination_deg: float = 0.0,
) -> float:
    """
    Angle between orbital plane and Sun vector.

    Uses Ω − α_sun from LTAN: (LTAN_h − 12) · π/12  [A geometry mapping].
    β = asin( cos δ · sin i · sin(Ω−α) + sin δ · cos i )
    Default δ=0 (equinox) [A] — seasonal average omitted for hackathon speed.
    """
    i = math.radians(inclination_deg)
    d = math.radians(sun_declination_deg)
    d_omega = (float(ltan_hours) - 12.0) * math.pi / 12.0
    sin_b = math.cos(d) * math.sin(i) * math.sin(d_omega) + math.sin(d) * math.cos(i)
    sin_b = max(-1.0, min(1.0, sin_b))
    return math.degrees(math.asin(sin_b))


def eclipse_fraction(altitude_km: float, beta_deg: float, params: dict[str, Any]) -> float:
    """
    Cylindrical-shadow eclipse fraction [S ERAU eclipse paper / plan §3.6]:
      β* = asin(R_E / a)
      f_E = (1/π) acos( √(h² + 2 R_E h) / (a cos β) )  for |β| < β*, else 0
    """
    Re = params["earth"]["R_E_km"]
    h = float(altitude_km)
    a = Re + h
    beta_star = math.degrees(math.asin(Re / a))
    if abs(beta_deg) >= beta_star:
        return 0.0
    cos_b = math.cos(math.radians(beta_deg))
    if abs(cos_b) < 1e-12:
        return 0.0
    arg = math.sqrt(h * h + 2.0 * Re * h) / (a * cos_b)
    arg = max(-1.0, min(1.0, arg))
    return (1.0 / math.pi) * math.acos(arg)


def ground_track(
    altitude_km: float,
    inclination_deg: float,
    params: dict[str, Any],
    n_samples: int | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Crude spherical ground track for flux averaging [A / plan probe].

    Returns (lat_deg, lon_deg, times_s). No J2 RAAN drift — ranking tool only.
    """
    samp = params["orbit_sampling"]
    earth = params["earth"]
    N = int(n_samples or samp["n_samples"])
    span = float(samp["sample_span_s"])
    els = orbital_elements(altitude_km, params)
    n = els["n_rad_s"]
    tt = np.linspace(0.0, span, N)
    M = n * tt
    i = math.radians(inclination_deg)
    lat = np.arcsin(np.sin(i) * np.sin(M))
    lon = np.arctan2(np.cos(i) * np.sin(M), np.cos(M)) - earth["omega_earth_rad_s"] * tt
    lon = (lon + np.pi) % (2.0 * np.pi) - np.pi
    return np.degrees(lat), np.degrees(lon), tt
