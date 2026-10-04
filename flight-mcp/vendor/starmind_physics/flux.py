"""Orbit-averaged trapped proton/electron flux via aep8 (AE8/AP8)."""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np

from starmind_physics.orbit import ground_track


def _require_aep8():
    try:
        import aep8
        from astropy import units as u
        from astropy.coordinates import EarthLocation
        from astropy.time import Time
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "aep8 (and astropy) are required for flux calculations. "
            "Install with: pip install aep8 astropy"
        ) from exc
    return aep8, EarthLocation, Time, u


def integral_flux_along_track(
    altitude_km: float | np.ndarray,
    lat_deg: np.ndarray,
    lon_deg: np.ndarray,
    times_s: np.ndarray,
    *,
    particle: str,
    energy_MeV: float,
    solar: str,
    epoch_utc: str,
) -> np.ndarray:
    """Pointwise integral flux (cm^-2 s^-1). Invalid IRBEM values → NaN.

    ``altitude_km`` is a scalar or a per-sample array broadcast to ``lon_deg``.
    """
    aep8, EarthLocation, Time, u = _require_aep8()
    loc = EarthLocation.from_geodetic(
        lon_deg * u.deg,
        lat_deg * u.deg,
        np.asarray(altitude_km, dtype=float) * u.km * np.ones_like(lon_deg),
    )
    t0 = Time(epoch_utc)
    tm = t0 + times_s * u.s
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=".*invalid value.*",
            category=RuntimeWarning,
        )
        # aep8/IRBEM may emit invalid-value RuntimeWarnings on empty cells
        flux = (
            aep8.model(solar=solar, particle=particle)
            .integral_flux(loc, tm, energy_MeV * u.MeV)
            .value
        )
    arr = np.asarray(flux, dtype=float)
    # Treat non-finite as missing (outside model / invalid L)
    arr[~np.isfinite(arr)] = np.nan
    # Negative numerical junk → nan
    arr[arr < 0] = np.nan
    return arr


def orbit_averaged_flux(
    altitude_km: float,
    inclination_deg: float,
    params: dict[str, Any],
    *,
    solar: str | None = None,
    solar_phase: float | None = None,
    n_samples: int | None = None,
) -> dict[str, float]:
    """
    Orbit-average >E proton and electron fluxes using nanmean [plan §2].

    Returns mean fluxes in cm^-2 s^-1 plus NaN fractions for transparency.
    """
    flux_p = params["flux"]
    solar = solar or flux_p["solar"]
    lat, lon, tt = ground_track(altitude_km, inclination_deg, params, n_samples=n_samples)
    epoch = params["orbit_sampling"]["epoch_utc"]

    def _track(particle: str, energy: float, sol: str) -> np.ndarray:
        return integral_flux_along_track(
            altitude_km, lat, lon, tt,
            particle=particle, energy_MeV=energy, solar=sol, epoch_utc=epoch,
        )

    e_p = float(flux_p["proton_energy_MeV"])
    e_e = float(flux_p["electron_energy_MeV"])
    if solar_phase is None:
        p = _track("p", e_p, solar)
        e = _track("e", e_e, solar)
    else:
        phi = min(1.0, max(0.0, float(solar_phase)))
        p = (1 - phi) * _track("p", e_p, "min") + phi * _track("p", e_p, "max")
        e = (1 - phi) * _track("e", e_e, "min") + phi * _track("e", e_e, "max")

    return {
        "proton_flux_cm2_s": float(np.nanmean(p)),
        "electron_flux_cm2_s": float(np.nanmean(e)),
        "proton_nan_fraction": float(np.mean(~np.isfinite(p))),
        "electron_nan_fraction": float(np.mean(~np.isfinite(e))),
        "solar": solar if solar_phase is None else f"blend(phase={min(1.0, max(0.0, float(solar_phase))):.2f})",
        "n_samples": int(lat.size),
    }


def latlon_flux_grid(
    altitude_km: float,
    params: dict[str, Any],
    *,
    particle: str = "p",
    energy_MeV: float | None = None,
    solar: str | None = None,
    solar_phase: float | None = None,
    lat_step_deg: float = 5.0,
    lon_step_deg: float = 5.0,
) -> dict[str, Any]:
    """
    Global lat/lon integral-flux grid at fixed altitude (SAA map).

    [T in plan] At 550 km, 10 MeV protons peak in the South Atlantic Anomaly.
    """
    flux_p = params["flux"]
    solar = solar or flux_p["solar"]
    if energy_MeV is None:
        energy_MeV = (
            float(flux_p["proton_energy_MeV"])
            if particle == "p"
            else float(flux_p["electron_energy_MeV"])
        )
    lats = np.arange(-90.0, 90.0 + 0.5 * lat_step_deg, lat_step_deg)
    lons = np.arange(-180.0, 180.0 + 0.5 * lon_step_deg, lon_step_deg)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    flat_lat = lat_grid.ravel()
    flat_lon = lon_grid.ravel()
    times = np.zeros_like(flat_lat)
    epoch = params["orbit_sampling"]["epoch_utc"]
    def _grid(sol: str) -> np.ndarray:
        return integral_flux_along_track(
            altitude_km, flat_lat, flat_lon, times,
            particle=particle, energy_MeV=float(energy_MeV), solar=sol, epoch_utc=epoch,
        )

    if solar_phase is None:
        flux = _grid(solar).reshape(lat_grid.shape)
    else:
        phi = min(1.0, max(0.0, float(solar_phase)))
        flux = ((1 - phi) * _grid("min") + phi * _grid("max")).reshape(lat_grid.shape)

    return {
        "altitude_km": float(altitude_km),
        "particle": particle,
        "energy_MeV": float(energy_MeV),
        "solar": solar if solar_phase is None else f"blend(phase={min(1.0, max(0.0, float(solar_phase))):.2f})",
        "lat_deg": lats.tolist(),
        "lon_deg": lons.tolist(),
        "flux_cm2_s": np.where(np.isfinite(flux), flux, None).tolist(),
        "flux_cm2_s_nanmean": float(np.nanmean(flux)),
        "flux_cm2_s_max": float(np.nanmax(flux)) if np.any(np.isfinite(flux)) else None,
        "notes": (
            "AE8/AP8 via aep8; static solar min/max model, blended by solar_phase when given. "
            "SAA appears as the South Atlantic high-flux region for protons."
        ),
    }


def flux_along_oem(
    oem_path: str,
    params: dict[str, Any],
    *,
    solar: str | None = None,
    solar_phase: float | None = None,
    step_s: float = 10.0,
) -> dict[str, Any]:
    """Mean >E proton/electron flux along the track in a CCSDS OEM file.

    ``solar_phase`` blends the solar-min and solar-max AE8/AP8 models the
    same way as :func:`orbit_averaged_flux` (0 = solar min, 1 = solar max).
    When it is omitted, ``solar`` or ``params["flux"]["solar"]`` selects one model.

    The means cover the OEM window only. A short file is not an orbit
    average and not a lifetime dose. Eclipse and sun geometry are not
    derived from the ephemeris.
    """
    from pathlib import Path

    from starmind_physics.oem import oem_to_track, parse_oem

    flux_p = params["flux"]
    solar = solar or flux_p["solar"]
    oem = parse_oem(Path(oem_path).read_text(encoding="utf-8"))
    lat, lon, alt, tt, epoch = oem_to_track(oem, step_s=step_s)

    e_p = float(flux_p["proton_energy_MeV"])
    e_e = float(flux_p["electron_energy_MeV"])

    def _track(particle: str, energy: float, sol: str) -> np.ndarray:
        return integral_flux_along_track(
            alt,
            lat,
            lon,
            tt,
            particle=particle,
            energy_MeV=energy,
            solar=sol,
            epoch_utc=epoch,
        )

    if solar_phase is None:
        p = _track("p", e_p, solar)
        e = _track("e", e_e, solar)
        solar_label: str = solar
    else:
        phi = min(1.0, max(0.0, float(solar_phase)))
        p = (1 - phi) * _track("p", e_p, "min") + phi * _track("p", e_p, "max")
        e = (1 - phi) * _track("e", e_e, "min") + phi * _track("e", e_e, "max")
        solar_label = f"blend(phase={phi:.2f})"

    return {
        "proton_flux_cm2_s": float(np.nanmean(p)),
        "electron_flux_cm2_s": float(np.nanmean(e)),
        "proton_nan_fraction": float(np.mean(~np.isfinite(p))),
        "electron_nan_fraction": float(np.mean(~np.isfinite(e))),
        "solar": solar_label,
        "n_samples": int(lat.size),
        "mean_altitude_km": float(np.mean(alt)),
        "duration_s": float(tt[-1] - tt[0]),
    }
