"""CCSDS OEM track parsing, and flux along that track when aep8 is installed."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from starmind_physics.oem import parse_oem, oem_to_track

SAMPLE = Path(__file__).parent / "data" / "sample.oem"


def test_parse_and_track():
    oem = parse_oem(SAMPLE.read_text())
    assert oem["meta"]["REF_FRAME"] == "GCRF"
    assert oem["states"].shape == (2, 6)
    lat, lon, alt, tt, epoch = oem_to_track(oem, step_s=60.0)
    assert lat.shape == lon.shape == alt.shape == tt.shape
    assert np.all(np.abs(lat) <= 90) and np.all(np.abs(lon) <= 180)
    assert np.all(alt > 0)
    assert epoch.startswith("2026-10-03T18:05:00")
    # Placeholder states, WGS84 geodetic: ~135 km, then ~635 km, 15 minutes later.
    # The first velocity does not carry the vehicle to the second state.
    assert alt[0] == pytest.approx(135.1, abs=1.0)
    assert alt[-1] == pytest.approx(635.1, abs=1.0)
    assert tt[-1] - tt[0] == pytest.approx(15.0 * 60.0, abs=1e-6)


def test_parse_rejects_non_gcrf_and_multi_segment():
    text = SAMPLE.read_text()
    with pytest.raises(ValueError, match="REF_FRAME"):
        parse_oem(text.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000"))
    second = (
        "\nMETA_START\n"
        "OBJECT_NAME = CASE-CHIPSET\n"
        "OBJECT_ID = UNKNOWN\n"
        "CENTER_NAME = EARTH\n"
        "REF_FRAME = GCRF\n"
        "TIME_SYSTEM = UTC\n"
        "START_TIME = 2026-10-03T18:25:00.000\n"
        "STOP_TIME = 2026-10-03T18:30:00.000\n"
        "META_STOP\n"
        "2026-10-03T18:25:00.000  -3000.0  -1000.0  6000.0  -1.0  1.0  1.0\n"
        "2026-10-03T18:30:00.000  -3200.0  -800.0  6100.0  -1.0  1.0  1.0\n"
    )
    with pytest.raises(ValueError, match="segment"):
        parse_oem(text + second)


@pytest.mark.aep8
def test_flux_along_oem_sample():
    """Mean flux along the sample window. Skips cleanly when aep8 is absent."""
    pytest.importorskip("aep8")
    from starmind_physics.config import load_params
    from starmind_physics.evaluate import evaluate
    from starmind_physics.flux import flux_along_oem

    params = load_params()
    out = flux_along_oem(SAMPLE, params, step_s=60.0)
    assert out["n_samples"] >= 2
    assert out["duration_s"] == pytest.approx(15.0 * 60.0, abs=1e-6)
    assert out["mean_altitude_km"] > 0
    assert out["solar"] == params["flux"]["solar"]
    assert 0.0 <= out["proton_nan_fraction"] <= 1.0
    assert 0.0 <= out["electron_nan_fraction"] <= 1.0
    for key in ("proton_flux_cm2_s", "electron_flux_cm2_s"):
        assert np.isnan(out[key]) or out[key] >= 0.0

    # solar_phase 0 is the solar-min model; 1 is solar max. Same blend as
    # orbit_averaged_flux (phase is clamped into [0, 1]).
    solar_min = flux_along_oem(SAMPLE, params, solar="min", step_s=300.0)
    blend_lo = flux_along_oem(SAMPLE, params, solar_phase=0.0, step_s=300.0)
    blend_hi = flux_along_oem(SAMPLE, params, solar_phase=1.0, step_s=300.0)
    solar_max = flux_along_oem(SAMPLE, params, solar="max", step_s=300.0)
    assert blend_lo["solar"] == "blend(phase=0.00)"
    assert blend_hi["solar"] == "blend(phase=1.00)"
    for key in ("proton_flux_cm2_s", "electron_flux_cm2_s"):
        assert _flux_close(blend_lo[key], solar_min[key])
        assert _flux_close(blend_hi[key], solar_max[key])

    # f107_sfu is mapped to solar_phase by resolve_config before the call.
    ranked = evaluate(
        {
            "altitude_km": 800.0,
            "inclination": "sso",
            "ltan_hours": 6.0,
            "shield_mm_Al": 5.0,
            "chip_preset": "commercial",
            "oem_path": str(SAMPLE),
            "f107_sfu": 70.0,
            "n_samples": 16,
        }
    )
    assert "mean_altitude_km" in ranked["flux"]
    assert ranked["flux"]["solar"].startswith("blend(")
    assert ranked["orbit"]["eclipse_fraction"] < 0.05
    assert "OEM window" in ranked["assumptions_note"]


def _flux_close(a: float, b: float) -> bool:
    if np.isnan(a) and np.isnan(b):
        return True
    return a == pytest.approx(b, rel=1e-5, abs=1e-8)
