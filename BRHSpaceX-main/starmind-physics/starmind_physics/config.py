"""Load the labelled params.yaml and merge user config overlays."""

from __future__ import annotations

from copy import deepcopy
from importlib import resources
from pathlib import Path
from typing import Any

import yaml

from starmind_physics.chips import chip_physics_overrides, resolve_chip

_PARAMS: dict[str, Any] | None = None


def params_path() -> Path:
    return Path(resources.files("starmind_physics").joinpath("params.yaml"))


def load_params(path: str | Path | None = None) -> dict[str, Any]:
    """Return the global assumed/sourced parameter table."""
    global _PARAMS
    if path is None and _PARAMS is not None:
        return deepcopy(_PARAMS)
    p = Path(path) if path is not None else params_path()
    with p.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if path is None:
        _PARAMS = data
    return deepcopy(data)


def resolve_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Merge user config onto defaults from params.yaml.

    User keys (all optional):
      altitude_km, inclination ("sso"|float degrees), ltan_hours,
      shield_mm_Al, radiator_area_m2, chip_preset, chip_id,
      dose_limit_krad_Si, load_strategy, array_area_m2, shield_surface_m2,
      peak_compute_kW, solar ("max"|"min"), solar_phase (0..1), f107_sfu, n_samples,
      oem_path (CCSDS OEM 3.0; flux along that track instead of the synthetic one)

    chip_id selects a row from data/ai_chips.yaml. Legacy chip_preset
    (commercial|rad_hard|custom) still works and aliases into that DB.
    """
    p = load_params()
    cfg = dict(p["defaults"])
    if config:
        cfg.update({k: v for k, v in config.items() if v is not None})

    preset = cfg.get("chip_preset", "commercial")
    chip = resolve_chip(chip_id=cfg.get("chip_id"), chip_preset=preset)
    cfg["_chip"] = chip
    if chip is not None:
        overrides = chip_physics_overrides(chip)
        cfg["chip_id"] = overrides["chip_id"]
        cfg["chip_vendor"] = overrides["chip_vendor"]
        cfg["chip_product"] = overrides["chip_product"]
        cfg["dose_limit_provenance"] = overrides["dose_limit_provenance"]
        cfg["dose_limit_basis"] = overrides["dose_limit_basis"]
        if cfg.get("dose_limit_krad_Si") is None and overrides["dose_limit_krad_Si"] is not None:
            cfg["dose_limit_krad_Si"] = overrides["dose_limit_krad_Si"]
        # Per-chip SEU model knobs (still marked assumed/sourced on the chip row)
        if overrides.get("memory_bits") is not None:
            cfg["seu_bits"] = overrides["memory_bits"]
        if overrides.get("seu_R_ref_upsets_per_bit_day") is not None:
            cfg["seu_R_ref_upsets_per_bit_day"] = overrides["seu_R_ref_upsets_per_bit_day"]
        cfg["seu_provenance"] = overrides.get("seu_provenance")

    presets = p["chip_presets"]
    if cfg.get("dose_limit_krad_Si") is None:
        if preset == "custom":
            cfg["dose_limit_krad_Si"] = presets["custom_default_krad_Si"]
            cfg.setdefault("dose_limit_provenance", "assumed")
            cfg.setdefault("dose_limit_basis", "custom_slider_default")
        elif preset in presets and isinstance(presets[preset], dict):
            # Fallback if chip DB missing an alias target
            cfg["dose_limit_krad_Si"] = presets[preset]["dose_limit_krad_Si"]
            cfg.setdefault("dose_limit_provenance", "assumed")
        else:
            raise ValueError(
                f"Unknown chip_preset={preset!r}; use a chip_id from "
                "starmind_physics.data.ai_chips, commercial|rad_hard|custom, "
                "or pass dose_limit_krad_Si"
            )

    if cfg.get("array_area_m2") is None:
        cfg["array_area_m2"] = p["power"]["default_array_area_m2"]
    if cfg.get("shield_surface_m2") is None:
        cfg["shield_surface_m2"] = p["shielding"]["default_surface_area_m2"]
    if cfg.get("solar") is None:
        cfg["solar"] = p["flux"]["solar"]

    # solar_phase: 0 = solar min, 1 = solar max; derived from F10.7 if given [A]
    if cfg.get("solar_phase") is None and cfg.get("f107_sfu") is not None:
        sw = p["space_weather"]
        lo, hi = float(sw["f107_min_sfu"]), float(sw["f107_max_sfu"])
        cfg["solar_phase"] = max(0.0, min(1.0, (float(cfg["f107_sfu"]) - lo) / (hi - lo)))
        
    cfg["_params"] = p
    return cfg
