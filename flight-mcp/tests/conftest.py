from __future__ import annotations

import socket
import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

import pytest
import uvicorn


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "aep8: needs the aep8 radiation belt model")


def fake_evaluate(calls: list[dict[str, Any]] | None = None, **overrides: Any):
    """Stands in for starmind_physics.evaluate.evaluate and records the config it was given."""

    def run(config: dict[str, Any]) -> dict[str, Any]:
        if calls is not None:
            calls.append(config)
        base: dict[str, Any] = {
            "lifetime_years": 21.07,
            "mean_power_kW": 61.7,
            "radiator_area_m2": 158.2,
            "shield_mass_kg": 540.0,
            "limiting_mode": "tid",
            "orbit": {
                "altitude_km": config["altitude_km"],
                "inclination_deg": 97.99,
                "ltan_hours": config["ltan_hours"],
                "period_min": 97.7,
                "beta_deg": -82.0,
                "eclipse_fraction": 0.0,
                "sunlight_fraction": 1.0,
            },
            "dose": {
                "dose_rate_krad_Si_per_year": 0.0949,
                "model": "exponential_fallback_not_SHIELDOSE2",
                "dose_limit_krad_Si": 2.0,
                "dose_limit_provenance": "assumed",
                "dose_limit_basis": "commercial_analogue_trillium",
            },
            "chip": {
                "id": "nvidia_jetson_agx_orin",
                "vendor": "NVIDIA",
                "product": "Jetson AGX Orin",
                "category": "edge_ai",
                "dose_limit_krad_Si": 2.0,
                "dose_limit_provenance": "assumed",
                "seu_provenance": "assumed",
            },
            "breakdown": {"L_tid_years": 21.07, "L_thermal_years": None, "L_power_years": 43.2, "L_seu_availability_years": 583.4},
            "assumptions_note": "A ranking under assumed coefficients.",
            "flux": {"proton_flux_cm2_s": 49.4},
        }
        base.update(overrides)
        return base

    return run


@contextmanager
def running(app: Any) -> Iterator[str]:
    """Serves an ASGI app on a free local port and yields its base URL."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.02)
    assert server.started, "the test server did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
