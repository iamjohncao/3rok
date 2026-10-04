"""The Python validator against the cases it shares with lib/oem.ts.

fixtures/oem-profile-cases.json is the case list and fixtures/oem-profile-expected.json is the
exact result lib/oem.ts gives for each one. If either validator changes a rule or a sentence, a
test here or in lib/oem.test.ts fails until both agree again.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

from flight_mcp.oem_profile import epoch_to_seconds, validate_oem

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "fixtures" / "oem-profile-cases.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((ROOT / "fixtures" / "oem-profile-expected.json").read_text(encoding="utf-8"))["expected"]
BASE = (ROOT / CASES["base"]).read_text(encoding="utf-8")


def apply_edits(base: str, edits: list[dict]) -> str:
    """The same edit rules as lib/oem.test.ts. Each `replace` must hit exactly one line."""
    lines = base.removesuffix("\n").split("\n")
    for edit in edits:
        if "append" in edit:
            lines = [*lines, *edit["append"].split("\n")]
            continue
        hits = sum(1 for line in lines if line == edit["replace"])
        assert hits == 1, f"Edit matched {hits} lines, expected 1: {edit['replace']}"
        out: list[str] = []
        for line in lines:
            if line != edit["replace"]:
                out.append(line)
            elif edit["with"] is not None:
                out.extend(edit["with"].split("\n"))
        lines = out
    return "\n".join(lines) + "\n"


EDIT_CASES = [(c["name"], apply_edits(BASE, c["edits"]), c) for c in CASES["cases"]]
TEXT_CASES = [(c["name"], c["text"], c) for c in CASES["text_cases"]]
ALL_CASES = EDIT_CASES + TEXT_CASES


def test_the_case_list_and_the_expected_results_name_the_same_cases() -> None:
    assert sorted(EXPECTED) == sorted(name for name, _, _ in ALL_CASES)


@pytest.mark.parametrize("name,text,case", ALL_CASES, ids=[name for name, _, _ in ALL_CASES])
def test_shared_case(name: str, text: str, case: dict) -> None:
    result = validate_oem(text, this_app_wrote=case.get("this_app_wrote", False))
    assert result["valid"] is case["valid"], "\n".join(result["errors"])
    assert (len(result["errors"]) > 0) is (not case["valid"])
    for phrase in case.get("errors_mention", []):
        assert any(phrase in error for error in result["errors"]), f'expected "{phrase}" in:\n' + "\n".join(result["errors"])


@pytest.mark.parametrize("name,text,case", ALL_CASES, ids=[name for name, _, _ in ALL_CASES])
def test_same_result_as_lib_oem_ts_sentence_for_sentence(name: str, text: str, case: dict) -> None:
    result = validate_oem(text, this_app_wrote=case.get("this_app_wrote", False))
    assert result == EXPECTED[name]


def test_every_failure_is_a_sentence() -> None:
    import re

    for name, text, case in ALL_CASES:
        if case["valid"]:
            continue
        for error in validate_oem(text, this_app_wrote=case.get("this_app_wrote", False))["errors"]:
            assert re.match(r'^(Line \d+: )?[A-Z"].+\.$', error), error
            assert len(error.split()) > 4, error


def test_the_tool_default_requires_originator_3rok() -> None:
    other = BASE.replace("ORIGINATOR = 3ROK", "ORIGINATOR = NASA/JPL")
    assert validate_oem(other)["valid"] is False
    assert validate_oem(other, this_app_wrote=False)["valid"] is True


def test_the_minimal_fixture_has_the_result_shape_in_the_docs() -> None:
    assert validate_oem(BASE) == {
        "valid": True,
        "errors": [],
        "segment_count": 1,
        "state_count": 2,
        "start_time": "2026-10-03T18:05:00.000",
        "stop_time": "2026-10-03T18:20:00.000",
        "has_acceleration": False,
    }


class TestEpochs:
    def test_calendar_and_day_of_year_and_z_are_the_same_instant(self) -> None:
        calendar = epoch_to_seconds("2026-10-03T18:05:00.000")
        assert calendar is not None
        assert epoch_to_seconds("2026-276T18:05:00.000") == calendar
        assert epoch_to_seconds("2026-10-03T18:05:00.000Z") == calendar

    def test_the_unix_epoch_is_zero_and_a_leap_day_counts(self) -> None:
        assert epoch_to_seconds("1970-01-01T00:00:00") == 0
        assert epoch_to_seconds("2028-03-01T00:00:00") - epoch_to_seconds("2028-02-28T00:00:00") == 2 * 86400
        assert epoch_to_seconds("2026-03-01T00:00:00") - epoch_to_seconds("2026-02-28T00:00:00") == 86400

    def test_fractions_are_added(self) -> None:
        assert epoch_to_seconds("2026-10-03T18:05:00.250") - epoch_to_seconds("2026-10-03T18:05:00") == pytest.approx(0.25)

    @pytest.mark.parametrize(
        "bad",
        ["", "2026-10-03", "2026-13-01T00:00:00", "2026-02-29T00:00:00", "2026-10-03T24:00:00", "2026-10-03T00:60:00", "2026-10-03T00:00:60", "2026-000T00:00:00", "2026-366T00:00:00", "٢٠٢٦-10-03T18:00:00"],
    )
    def test_not_an_instant(self, bad: str) -> None:
        assert epoch_to_seconds(bad) is None


def test_the_validator_does_not_import_the_physics_package() -> None:
    """validate_oem and submit_oem are pure checks of text."""
    code = "import sys, flight_mcp.oem_profile; sys.exit(1 if any(m == 'starmind_physics' or m.startswith('starmind_physics.') for m in sys.modules) else 0)"
    assert subprocess.run([sys.executable, "-c", code], check=False).returncode == 0
    tree = ast.parse((Path(__file__).resolve().parents[1] / "flight_mcp" / "oem_profile.py").read_text(encoding="utf-8"))
    imported = [
        alias.name if isinstance(node, ast.Import) else (node.module or "")
        for node in ast.walk(tree)
        if isinstance(node, (ast.Import, ast.ImportFrom))
        for alias in (node.names if isinstance(node, ast.Import) else [ast.alias(name=node.module or "")])
    ]
    assert not any(name.startswith("starmind_physics") for name in imported)
