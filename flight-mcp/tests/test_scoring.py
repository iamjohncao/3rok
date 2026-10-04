from __future__ import annotations

import ast
import math
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starmind_physics")

from flight_mcp.scoring import (  # noqa: E402
    ALLOWED_FIELDS,
    InputError,
    envelope_refusal,
    parse_arguments,
    score_candidate,
)

from conftest import fake_evaluate  # noqa: E402

GOOD: dict[str, Any] = {"altitude_km": 650, "inclination": "sso", "ltan_hours": 6, "shield_mm_Al": 5, "chip_id": "nvidia_jetson_agx_orin"}


def call(**changes: Any) -> dict[str, Any]:
    args = {**GOOD, **changes}
    return {k: v for k, v in args.items() if v is not ...}


class TestTheCallMustBeComplete:
    @pytest.mark.parametrize("missing", ["altitude_km", "inclination", "ltan_hours", "shield_mm_Al"])
    def test_a_missing_field_is_an_error_not_a_default(self, missing: str) -> None:
        evaluated: list[dict[str, Any]] = []
        with pytest.raises(InputError, match=f"{missing} is required"):
            score_candidate(call(**{missing: ...}), evaluate=fake_evaluate(evaluated))
        assert evaluated == []

    def test_a_null_required_field_is_missing_too(self) -> None:
        with pytest.raises(InputError, match="ltan_hours is required"):
            parse_arguments(call(ltan_hours=None))

    def test_one_of_chip_id_or_chip_preset_is_required(self) -> None:
        with pytest.raises(InputError, match="exactly one of chip_id or chip_preset"):
            parse_arguments(call(chip_id=...))

    def test_not_both_chip_id_and_chip_preset(self) -> None:
        with pytest.raises(InputError, match="exactly one"):
            parse_arguments(call(chip_preset="commercial"))

    def test_a_preset_must_be_commercial_or_rad_hard(self) -> None:
        with pytest.raises(InputError, match="commercial, rad_hard"):
            parse_arguments(call(chip_id=..., chip_preset="custom"))

    @pytest.mark.parametrize(
        "bad",
        [{"altitude_km": "650"}, {"altitude_km": True}, {"altitude_km": math.nan}, {"inclination": "polar"}, {"inclination": -1}, {"inclination": 181},
         {"ltan_hours": 24}, {"ltan_hours": -0.1}, {"shield_mm_Al": -1}, {"radiator_area_m2": 0}, {"load_strategy": "load_follow_sun"}, {"chip_id": " "}],
    )
    def test_values_that_make_no_sense(self, bad: dict[str, Any]) -> None:
        with pytest.raises(InputError):
            parse_arguments(call(**bad))

    @pytest.mark.parametrize("extra", ["epoch", "position", "velocity", "state", "oem_path", "dose_limit_krad_Si", "split", "outcomes"])
    def test_no_epochs_positions_velocities_or_anything_else(self, extra: str) -> None:
        with pytest.raises(InputError, match="does not accept epochs, position or velocity"):
            parse_arguments(call(**{extra: 1}))

    def test_the_allowed_fields_are_the_documented_ones(self) -> None:
        assert set(ALLOWED_FIELDS) == {"altitude_km", "inclination", "ltan_hours", "shield_mm_Al", "chip_id", "chip_preset", "radiator_area_m2", "load_strategy"}


class TestTheEnvelope:
    def test_400_km_is_refused_with_no_lifetime_and_the_package_is_not_called(self) -> None:
        evaluated: list[dict[str, Any]] = []
        result = score_candidate(call(altitude_km=400), evaluate=fake_evaluate(evaluated))
        assert result["refused"] is True
        assert "400 km" in result["reason"] and "500 to 2000 km" in result["reason"]
        assert "lifetime_years" not in result
        assert evaluated == []

    def test_above_2000_km_is_refused(self) -> None:
        assert score_candidate(call(altitude_km=2000.5), evaluate=fake_evaluate())["refused"] is True

    @pytest.mark.parametrize("altitude", [500, 2000])
    def test_the_edges_are_inside(self, altitude: float) -> None:
        assert score_candidate(call(altitude_km=altitude), evaluate=fake_evaluate())["refused"] is False

    def test_an_inclination_that_is_neither_30_nor_sun_synchronous_is_refused_naming_the_sso_one(self) -> None:
        result = score_candidate(call(altitude_km=800, inclination=60), evaluate=fake_evaluate())
        assert result["refused"] is True
        assert "60 degrees" in result["reason"] and "98.6 degrees at this altitude" in result["reason"]
        assert "lifetime_years" not in result

    @pytest.mark.parametrize("inclination", [28, 30, 31.99, 32])
    def test_within_two_degrees_of_30_is_inside(self, inclination: float) -> None:
        assert envelope_refusal(800, inclination) is None

    @pytest.mark.parametrize("inclination", [27.99, 32.01])
    def test_just_outside_is_refused(self, inclination: float) -> None:
        assert envelope_refusal(800, inclination) is not None

    def test_a_number_within_two_degrees_of_sun_synchronous_is_inside(self) -> None:
        assert envelope_refusal(800, 98.6 + 1.9) is None
        assert envelope_refusal(800, 98.6 + 2.2) is not None

    def test_sso_is_inside_at_any_altitude_in_the_range(self) -> None:
        for altitude in (500, 1000, 2000):
            assert envelope_refusal(altitude, "sso") is None

    def test_the_refusal_names_the_envelope(self) -> None:
        result = score_candidate(call(altitude_km=100), evaluate=fake_evaluate())
        assert result["envelope"]["altitude_km"] == [500.0, 2000.0]


class TestWhatReachesThePackage:
    def test_only_the_scoring_inputs_reach_evaluate_and_nothing_is_defaulted(self) -> None:
        evaluated: list[dict[str, Any]] = []
        score_candidate(call(), evaluate=fake_evaluate(evaluated))
        assert evaluated == [
            {
                "altitude_km": 650.0,
                "inclination": "sso",
                "ltan_hours": 6.0,
                "shield_mm_Al": 5.0,
                "radiator_area_m2": None,
                "load_strategy": "constant",
                "chip_id": "nvidia_jetson_agx_orin",
            }
        ]

    def test_a_preset_is_sent_as_chip_preset(self) -> None:
        evaluated: list[dict[str, Any]] = []
        score_candidate(call(chip_id=..., chip_preset="rad_hard"), evaluate=fake_evaluate(evaluated))
        assert evaluated[0]["chip_preset"] == "rad_hard" and "chip_id" not in evaluated[0]

    def test_null_radiator_asks_the_package_to_size_it_and_a_number_is_passed_on(self) -> None:
        evaluated: list[dict[str, Any]] = []
        score_candidate(call(radiator_area_m2=None), evaluate=fake_evaluate(evaluated))
        score_candidate(call(radiator_area_m2=120), evaluate=fake_evaluate(evaluated))
        assert evaluated[0]["radiator_area_m2"] is None and evaluated[1]["radiator_area_m2"] == 120.0

    def test_an_unknown_chip_is_an_input_error_the_model_can_fix(self) -> None:
        def unknown(_: dict[str, Any]) -> dict[str, Any]:
            raise KeyError("Unknown chip_id='nope'. Known: a, b")

        with pytest.raises(InputError, match="Unknown chip_id='nope'"):
            score_candidate(call(chip_id="nope"), evaluate=unknown)

    def test_the_orbit_is_a_number_of_scalars_not_a_trajectory(self) -> None:
        result = score_candidate(call(), evaluate=fake_evaluate())
        assert set(result["orbit"]) == {"altitude_km", "inclination_deg", "ltan_hours", "period_min", "beta_deg", "eclipse_fraction"}
        text = repr(result).lower()
        for word in ("position", "velocity", "ephemeris", "epoch", "states"):
            assert word not in text


class TestTheResult:
    def test_it_carries_the_documented_fields_and_says_derived(self) -> None:
        result = score_candidate(call(), evaluate=fake_evaluate())
        assert result["refused"] is False
        for key in ("lifetime_years", "mean_power_kW", "radiator_area_m2", "shield_mass_kg", "limiting_mode", "breakdown", "value_status", "assumptions_note"):
            assert key in result
        assert result["value_status"] == "derived"
        assert result["assumptions_note"] == "A ranking under assumed coefficients."

    def test_a_chip_limit_the_database_marks_assumed_is_passed_on_as_assumed(self) -> None:
        result = score_candidate(call(), evaluate=fake_evaluate())
        assert result["chip"]["id"] == "nvidia_jetson_agx_orin"
        assert result["chip"]["dose_limit_provenance"] == "assumed"
        assert result["dose"]["limit_provenance"] == "assumed"
        assert result["chip"]["requested_as"] == {"chip_id": "nvidia_jetson_agx_orin"}

    def test_a_lifetime_with_no_bound_is_null_not_infinity_or_nan(self) -> None:
        result = score_candidate(call(), evaluate=fake_evaluate(lifetime_years=math.inf, mean_power_kW=math.nan))
        assert result["lifetime_years"] is None and result["mean_power_kW"] is None

    def test_the_result_is_json_safe(self) -> None:
        import json

        json.dumps(score_candidate(call(), evaluate=fake_evaluate(lifetime_years=math.inf)), allow_nan=False)


class TestWhereTheModuleReaches:
    def _imports(self) -> list[str]:
        tree = ast.parse((Path(__file__).resolve().parents[1] / "flight_mcp" / "scoring.py").read_text(encoding="utf-8"))
        names: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            elif isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
        return names

    def test_it_calls_evaluate_and_never_the_optimizer(self) -> None:
        physics = sorted({name for name in self._imports() if name.startswith("starmind_physics")})
        assert physics == ["starmind_physics.config", "starmind_physics.evaluate", "starmind_physics.orbit"]
        assert not any("scripts" in name or "pymoo" in name for name in self._imports())

    def test_it_knows_nothing_about_cases_splits_or_outcomes(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "flight_mcp" / "scoring.py").read_text(encoding="utf-8").lower()
        for word in ("holdout", "optimizedoem", "workingoem", "case_doc"):
            assert word not in source.replace("holdout outcome", "")


@pytest.mark.aep8
class TestThePackageItself:
    """These run starmind_physics.evaluate. Run `pytest -m "not aep8"` when aep8 is absent."""

    def test_an_orin_score_inside_the_envelope(self) -> None:
        result = score_candidate(call())
        assert result["refused"] is False
        assert result["lifetime_years"] is not None and result["lifetime_years"] > 0
        assert result["limiting_mode"] in {"tid", "thermal_fatigue", "power", "seu_availability", "radiator_capacity", "none_infinite"}
        assert result["value_status"] == "derived"
        assert result["assumptions_note"]
        assert result["chip"]["id"] == "nvidia_jetson_agx_orin"
        # The database marks the Orin dose limit assumed, so the tool says assumed.
        assert result["chip"]["dose_limit_provenance"] == "assumed"
        assert result["orbit"]["inclination_deg"] == pytest.approx(97.99, abs=0.05)

    def test_a_preset_resolves_to_the_chip_it_aliases(self) -> None:
        result = score_candidate(call(chip_id=..., chip_preset="commercial"))
        assert result["chip"]["id"] == "google_trillium_tpu_v6e"
        assert result["chip"]["requested_as"] == {"chip_preset": "commercial"}

    def test_400_km_is_refused_by_the_real_package_path_too(self) -> None:
        result = score_candidate(call(altitude_km=400))
        assert result["refused"] is True and "lifetime_years" not in result

    def test_an_unknown_chip_id_is_an_input_error(self) -> None:
        with pytest.raises(InputError, match="Unknown chip_id"):
            score_candidate(call(chip_id="not_a_chip"))
