"""``score_candidate``: one reduced LEO orbit in, a derived score out.

This is the only module in the server that imports the physics package, and the only call it
makes into the package's scoring is ``starmind_physics.evaluate.evaluate``. It never reaches the
optimizer (``starmind_physics.scripts``). It takes no epochs, positions or velocities, and it
returns no trajectory. It has no idea what a case, a split or a holdout outcome is.

The package ranks configurations inside a filed envelope: 500 to 2000 km, and an inclination of
30 degrees or sun-synchronous. ``evaluate`` does not enforce that. This function does, and
refuses (``refused: true`` and no lifetime) outside it.
"""

from __future__ import annotations

import math
from typing import Any, Callable

ALTITUDE_RANGE_KM = (500.0, 2000.0)
ENVELOPE_INCLINATION_DEG = 30.0
INCLINATION_TOLERANCE_DEG = 2.0
CHIP_PRESETS = ("commercial", "rad_hard")
LOAD_STRATEGIES = ("constant",)

ALLOWED_FIELDS = (
    "altitude_km",
    "inclination",
    "ltan_hours",
    "shield_mm_Al",
    "chip_id",
    "chip_preset",
    "radiator_area_m2",
    "load_strategy",
)
REQUIRED_FIELDS = ("altitude_km", "inclination", "ltan_hours", "shield_mm_Al")


class InputError(ValueError):
    """The call was malformed. The model can fix it and call again. Not a refusal."""


class PhysicsUnavailable(RuntimeError):
    """The physics package could not be loaded or run."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _clean(value: Any) -> Any:
    """JSON has no NaN or infinity. A value that is not a finite number becomes null."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


def parse_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Checks the call. Nothing is filled in: a missing field is an error, not a default."""
    unknown = sorted(set(arguments) - set(ALLOWED_FIELDS))
    if unknown:
        raise InputError(
            f"Unknown field {', '.join(unknown)}. This tool takes {', '.join(ALLOWED_FIELDS)}. "
            "It does not accept epochs, position or velocity, and it does not return a trajectory."
        )
    for key in REQUIRED_FIELDS:
        if key not in arguments or arguments[key] is None:
            raise InputError(f"{key} is required. It is not filled in with a default.")

    altitude = arguments["altitude_km"]
    if not _is_number(altitude):
        raise InputError("altitude_km must be a number of kilometres.")

    inclination = arguments["inclination"]
    if inclination != "sso" and not (_is_number(inclination) and 0 <= inclination <= 180):
        raise InputError('inclination must be "sso" or a number of degrees from 0 to 180.')

    ltan = arguments["ltan_hours"]
    if not (_is_number(ltan) and 0 <= ltan < 24):
        raise InputError("ltan_hours must be a number from 0 up to, but not including, 24.")

    shield = arguments["shield_mm_Al"]
    if not (_is_number(shield) and shield >= 0):
        raise InputError("shield_mm_Al must be a number of millimetres of aluminium, 0 or more.")

    chip_id = arguments.get("chip_id")
    chip_preset = arguments.get("chip_preset")
    if (chip_id is None) == (chip_preset is None):
        raise InputError("Give exactly one of chip_id or chip_preset.")
    if chip_id is not None and not (isinstance(chip_id, str) and chip_id.strip()):
        raise InputError("chip_id must be a chip id from ai_chips.yaml.")
    if chip_preset is not None and chip_preset not in CHIP_PRESETS:
        raise InputError(f"chip_preset must be one of {', '.join(CHIP_PRESETS)}.")

    radiator = arguments.get("radiator_area_m2")
    if radiator is not None and not (_is_number(radiator) and radiator > 0):
        raise InputError("radiator_area_m2 must be null, to size the radiator, or a number of square metres above 0.")

    load = arguments.get("load_strategy", "constant")
    if load not in LOAD_STRATEGIES:
        raise InputError(f"load_strategy must be {', '.join(LOAD_STRATEGIES)}.")

    return {
        "altitude_km": float(altitude),
        "inclination": inclination if inclination == "sso" else float(inclination),
        "ltan_hours": float(ltan),
        "shield_mm_Al": float(shield),
        "chip": {"chip_id": chip_id.strip()} if chip_id is not None else {"chip_preset": chip_preset},
        "radiator_area_m2": None if radiator is None else float(radiator),
        "load_strategy": load,
    }


def _sso_inclination_deg(altitude_km: float) -> float:
    try:
        from starmind_physics.config import load_params
        from starmind_physics.orbit import sso_inclination_deg
    except ImportError as error:  # pragma: no cover - depends on the install
        raise PhysicsUnavailable(f"starmind_physics is not installed: {error}") from error
    return float(sso_inclination_deg(altitude_km, load_params()))


def envelope_refusal(altitude_km: float, inclination: str | float) -> str | None:
    """The sentence that says why this orbit is outside the filed envelope, or None when inside."""
    low, high = ALTITUDE_RANGE_KM
    if altitude_km < low or altitude_km > high:
        return f"The altitude is {altitude_km:g} km. The ranker scores {low:g} to {high:g} km."
    if inclination == "sso":
        return None
    sso = _sso_inclination_deg(altitude_km)
    inclination = float(inclination)
    if abs(inclination - ENVELOPE_INCLINATION_DEG) <= INCLINATION_TOLERANCE_DEG or abs(inclination - sso) <= INCLINATION_TOLERANCE_DEG:
        return None
    return (
        f"The inclination is {inclination:g} degrees. The ranker scores {ENVELOPE_INCLINATION_DEG:g} degrees "
        f"(within {INCLINATION_TOLERANCE_DEG:g}) or sun-synchronous ({sso:.1f} degrees at this altitude, within {INCLINATION_TOLERANCE_DEG:g})."
    )


def _default_evaluate() -> Callable[[dict[str, Any]], dict[str, Any]]:
    try:
        from starmind_physics.evaluate import evaluate
    except ImportError as error:
        raise PhysicsUnavailable(f"starmind_physics could not be loaded: {error}") from error
    return evaluate


def score_candidate(
    arguments: dict[str, Any],
    evaluate: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Scores one reduced orbit. ``evaluate`` is injectable so the mapping can be tested without
    the radiation belt model."""
    call = parse_arguments(arguments)

    why = envelope_refusal(call["altitude_km"], call["inclination"])
    if why is not None:
        return {
            "refused": True,
            "reason": why,
            "envelope": {
                "altitude_km": list(ALTITUDE_RANGE_KM),
                "inclination": f"{ENVELOPE_INCLINATION_DEG:g} degrees or sun-synchronous, each within {INCLINATION_TOLERANCE_DEG:g} degrees",
            },
        }

    # Only these keys reach the package. No oem_path, no sample count, no dose-limit override.
    config: dict[str, Any] = {
        "altitude_km": call["altitude_km"],
        "inclination": call["inclination"],
        "ltan_hours": call["ltan_hours"],
        "shield_mm_Al": call["shield_mm_Al"],
        "radiator_area_m2": call["radiator_area_m2"],
        "load_strategy": call["load_strategy"],
        **call["chip"],
    }
    run = evaluate or _default_evaluate()
    try:
        result = run(config)
    except KeyError as error:  # an unknown chip_id
        raise InputError(str(error.args[0]) if error.args else "Unknown chip.") from error

    chip = result.get("chip")
    dose = result.get("dose") or {}
    orbit = result.get("orbit") or {}
    return _clean(
        {
            "refused": False,
            "lifetime_years": result.get("lifetime_years"),
            "mean_power_kW": result.get("mean_power_kW"),
            "radiator_area_m2": result.get("radiator_area_m2"),
            "shield_mass_kg": result.get("shield_mass_kg"),
            "limiting_mode": result.get("limiting_mode"),
            "breakdown": result.get("breakdown"),
            "value_status": "derived",
            "assumptions_note": result.get("assumptions_note"),
            # The chip row's own provenance, as ai_chips.yaml marks it: sourced or assumed. Never relabeled.
            "chip": None
            if chip is None
            else {
                "id": chip.get("id"),
                "vendor": chip.get("vendor"),
                "product": chip.get("product"),
                "requested_as": call["chip"],
                "dose_limit_krad_Si": chip.get("dose_limit_krad_Si"),
                "dose_limit_provenance": chip.get("dose_limit_provenance"),
                "seu_provenance": chip.get("seu_provenance"),
            },
            "dose": {
                "rate_krad_Si_per_year": dose.get("dose_rate_krad_Si_per_year"),
                "limit_krad_Si": dose.get("dose_limit_krad_Si"),
                "limit_provenance": dose.get("dose_limit_provenance"),
                "limit_basis": dose.get("dose_limit_basis"),
                "model": dose.get("model"),
            },
            # Scalars that describe the reduced orbit the ranker used. Not a state, not a path.
            "orbit": {
                key: orbit.get(key)
                for key in ("altitude_km", "inclination_deg", "ltan_hours", "period_min", "beta_deg", "eclipse_fraction")
            },
        }
    )
