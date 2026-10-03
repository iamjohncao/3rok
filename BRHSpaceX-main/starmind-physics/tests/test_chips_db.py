"""AI chip database tests (no aep8 required)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from starmind_physics.chips import (
    export_sqlite,
    get_chip,
    list_chips,
    load_chip_db,
    preset_aliases,
    resolve_chip,
)
from starmind_physics.config import resolve_config


def test_chip_db_loads_and_has_unique_ids():
    db = load_chip_db()
    chips = db["chips"]
    assert len(chips) >= 15
    ids = [c["id"] for c in chips]
    assert len(ids) == len(set(ids))
    for c in chips:
        assert c.get("dose_limit_provenance") in {"sourced", "assumed"}
        assert c.get("dose_limit_krad_Si") is not None


def test_sourced_anchors_match_plan():
    trillium = get_chip("google_trillium_tpu_v6e")
    assert trillium["dose_limit_krad_Si"] == 2.0
    assert trillium["dose_limit_provenance"] == "sourced"
    assert trillium["sources"]

    rad750 = get_chip("bae_rad750")
    assert rad750["dose_limit_krad_Si"] == 200.0
    assert rad750["seu_R_ref_upsets_per_bit_day"] == 1.0e-11
    assert rad750["dose_limit_provenance"] == "sourced"


def test_rubin_is_marked_assumed_not_fact():
    rubin = get_chip("nvidia_vera_rubin_nvl72")
    assert rubin["dose_limit_provenance"] == "assumed"
    assert rubin["starmind_status"] == "reported_first_gen"


def test_preset_aliases_resolve():
    aliases = preset_aliases()
    assert aliases["commercial"] == "google_trillium_tpu_v6e"
    assert aliases["rad_hard"] == "bae_rad750"
    assert resolve_chip(chip_preset="commercial")["id"] == "google_trillium_tpu_v6e"
    assert resolve_chip(chip_id="nvidia_b200")["id"] == "nvidia_b200"


def test_resolve_config_uses_chip_id():
    cfg = resolve_config({"chip_id": "bae_rad750", "chip_preset": "commercial"})
    assert cfg["dose_limit_krad_Si"] == 200.0
    assert cfg["chip_id"] == "bae_rad750"
    assert cfg["dose_limit_provenance"] == "sourced"


def test_list_filter_and_sqlite_export(tmp_path: Path):
    commercial = list_chips(category="commercial_ai")
    assert all(c["category"] == "commercial_ai" for c in commercial)
    assert len(commercial) >= 5

    db_path = export_sqlite(tmp_path / "ai_chips.sqlite")
    conn = sqlite3.connect(db_path)
    n = conn.execute("SELECT COUNT(*) FROM chips").fetchone()[0]
    sourced = conn.execute(
        "SELECT COUNT(*) FROM chips WHERE dose_limit_provenance='sourced'"
    ).fetchone()[0]
    conn.close()
    assert n == len(list_chips())
    assert sourced >= 2
