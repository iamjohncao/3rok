"""Read a CCSDS OEM ephemeris and turn it into lat/lon/alt/time arrays for flux.py.

Supported profile: OEM 3.0, ``REF_FRAME = GCRF``, ``TIME_SYSTEM = UTC``, state
rows in km and km/s. GCRF is evaluated as GCRS (the frames agree far below
the AE8/AP8 grid). One metadata segment only; a later ``META_START`` is a
discontinuity and is rejected rather than Hermite-bridged.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from astropy import units as u
from astropy.coordinates import (
    CartesianDifferential,
    CartesianRepresentation,
    EarthLocation,
    GCRS,
    ITRS,
)
from astropy.time import Time


def parse_oem(text: str) -> dict[str, Any]:
    """Parse a CCSDS OEM (KVN) file: header keys plus state rows (km, km/s)."""
    meta: dict[str, str] = {}
    times: list[str] = []
    states: list[list[float]] = []
    n_meta = 0
    in_covariance = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("COMMENT"):
            continue
        if line == "COVARIANCE_START":
            in_covariance = True
            continue
        if line == "COVARIANCE_STOP":
            in_covariance = False
            continue
        if in_covariance:
            continue
        if line == "META_START":
            n_meta += 1
            if n_meta > 1 and states:
                raise ValueError(
                    "OEM has more than one ephemeris segment; refusing to "
                    "interpolate across a META boundary. Split the file."
                )
            continue
        if line == "META_STOP":
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            meta[k.strip()] = v.strip()
            continue
        parts = line.split()
        if len(parts) >= 7 and "T" in parts[0]:
            times.append(parts[0])
            states.append([float(x) for x in parts[1:7]])
    if not states:
        raise ValueError("no state rows found in OEM")
    vers = meta.get("CCSDS_OEM_VERS")
    if vers is not None and vers != "3.0":
        raise ValueError(f"only CCSDS OEM 3.0 is supported, got {vers!r}")
    frame = meta.get("REF_FRAME")
    if frame != "GCRF":
        raise ValueError(f"REF_FRAME must be GCRF, got {frame!r}")
    time_system = meta.get("TIME_SYSTEM")
    if time_system != "UTC":
        raise ValueError(f"TIME_SYSTEM must be UTC, got {time_system!r}")
    center = meta.get("CENTER_NAME")
    if center is not None and center != "EARTH":
        raise ValueError(f"CENTER_NAME must be EARTH, got {center!r}")
    return {"meta": meta, "epochs": times, "states": np.asarray(states, dtype=float)}


def hermite_resample(
    t_s: np.ndarray, states: np.ndarray, step_s: float
) -> tuple[np.ndarray, np.ndarray]:
    """Cubic Hermite interpolation of position using the given velocities (km, km/s)."""
    if step_s <= 0:
        raise ValueError(f"step_s must be positive, got {step_s}")
    if t_s.size < 2:
        raise ValueError("Hermite interpolation needs at least two states")
    if np.any(np.diff(t_s) <= 0):
        raise ValueError("OEM epochs must be strictly increasing")
    t_new = np.arange(t_s[0], t_s[-1] + 0.5 * step_s, step_s)
    t_new = t_new[t_new <= t_s[-1] + 1e-9]
    if t_new.size == 0 or t_new[-1] < t_s[-1] - 1e-6:
        t_new = np.append(t_new, t_s[-1])
    out = np.empty((t_new.size, 6))
    idx = np.clip(np.searchsorted(t_s, t_new, side="right") - 1, 0, len(t_s) - 2)
    for j, (t, i) in enumerate(zip(t_new, idx)):
        h = t_s[i + 1] - t_s[i]
        s = (t - t_s[i]) / h
        p0, v0 = states[i, :3], states[i, 3:]
        p1, v1 = states[i + 1, :3], states[i + 1, 3:]
        h00, h10 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s
        h01, h11 = -2 * s**3 + 3 * s**2, s**3 - s**2
        out[j, :3] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1
        d00, d10 = 6 * s**2 - 6 * s, 3 * s**2 - 4 * s + 1
        d01, d11 = -6 * s**2 + 6 * s, 3 * s**2 - 2 * s
        out[j, 3:] = (d00 * p0 + d10 * h * v0 + d01 * p1 + d11 * h * v1) / h
    return t_new, out


def oem_to_track(
    oem: dict[str, Any], step_s: float = 10.0
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]:
    """Return ``(lat_deg, lon_deg, alt_km, times_s, epoch_utc)`` from a parsed OEM.

    Positions are GCRF treated as GCRS, rotated to ITRS, then converted to
    WGS84 geodetic latitude, longitude in [-180, 180], and height in km.
    ``times_s`` is seconds since the first state. ``epoch_utc`` is that
    first epoch in ISOT, so flux sampling can do ``epoch + times_s``.
    """
    epochs = Time(oem["epochs"], scale="utc")
    t_s = (epochs - epochs[0]).to(u.s).value
    t_new, st = hermite_resample(np.asarray(t_s, dtype=float), oem["states"], step_s)
    tm = epochs[0] + t_new * u.s
    rep = CartesianRepresentation(
        st[:, 0] * u.km,
        st[:, 1] * u.km,
        st[:, 2] * u.km,
        differentials=CartesianDifferential(
            st[:, 3] * u.km / u.s,
            st[:, 4] * u.km / u.s,
            st[:, 5] * u.km / u.s,
        ),
    )
    itrs = GCRS(rep, obstime=tm).transform_to(ITRS(obstime=tm))
    loc = EarthLocation.from_geocentric(itrs.x, itrs.y, itrs.z)
    lon = np.asarray(loc.lon.wrap_at(180 * u.deg).deg, dtype=float)
    lat = np.asarray(loc.lat.deg, dtype=float)
    alt = np.asarray(loc.height.to(u.km).value, dtype=float)
    epoch = epochs[0].isot
    return lat, lon, alt, np.asarray(t_new, dtype=float), epoch
