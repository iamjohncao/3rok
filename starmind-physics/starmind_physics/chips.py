"""AI chip catalogue for Starmind-class orbital compute candidates."""

from __future__ import annotations

import json
import sqlite3
from copy import deepcopy
from importlib import resources
from pathlib import Path
from typing import Any, Iterable

import yaml

_DB: dict[str, Any] | None = None

# Maps legacy chip_preset names → chip ids (also declared in YAML)
_FALLBACK_PRESET_ALIASES = {
    "commercial": "google_trillium_tpu_v6e",
    "rad_hard": "bae_rad750",
}


def chips_db_path() -> Path:
    return Path(resources.files("starmind_physics").joinpath("data/ai_chips.yaml"))


def load_chip_db(path: str | Path | None = None) -> dict[str, Any]:
    """Load the full chip database document."""
    global _DB
    if path is None and _DB is not None:
        return deepcopy(_DB)
    p = Path(path) if path is not None else chips_db_path()
    with p.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if path is None:
        _DB = data
    return deepcopy(data)


def list_chips(
    *,
    category: str | None = None,
    starmind_status: str | None = None,
    tag: str | None = None,
) -> list[dict[str, Any]]:
    """Return chip records, optionally filtered."""
    chips = load_chip_db()["chips"]
    out: list[dict[str, Any]] = []
    for c in chips:
        if category and c.get("category") != category:
            continue
        if starmind_status and c.get("starmind_status") != starmind_status:
            continue
        if tag and tag not in (c.get("tags") or []):
            continue
        out.append(deepcopy(c))
    return out


def get_chip(chip_id: str) -> dict[str, Any]:
    """Return one chip by id or raise KeyError."""
    for c in load_chip_db()["chips"]:
        if c["id"] == chip_id:
            return deepcopy(c)
    known = ", ".join(sorted(c["id"] for c in load_chip_db()["chips"]))
    raise KeyError(f"Unknown chip_id={chip_id!r}. Known: {known}")


def preset_aliases() -> dict[str, str | None]:
    db = load_chip_db()
    aliases = dict(_FALLBACK_PRESET_ALIASES)
    aliases.update(db.get("preset_aliases") or {})
    return aliases


def resolve_chip(
    *,
    chip_id: str | None = None,
    chip_preset: str | None = None,
) -> dict[str, Any] | None:
    """
    Resolve a concrete chip record from chip_id or legacy chip_preset.

    Returns None for chip_preset='custom' (caller supplies dose_limit).
    """
    if chip_id:
        return get_chip(chip_id)
    if not chip_preset:
        return None
    if chip_preset == "custom":
        return None
    aliases = preset_aliases()
    if chip_preset in aliases:
        target = aliases[chip_preset]
        if target is None:
            return None
        return get_chip(target)
    # Allow using a chip id directly as chip_preset
    try:
        return get_chip(chip_preset)
    except KeyError as exc:
        raise ValueError(
            f"Unknown chip_preset={chip_preset!r}; use a chip id from "
            "starmind_physics.data.ai_chips, commercial|rad_hard|custom, "
            "or pass chip_id=..."
        ) from exc


def chip_physics_overrides(chip: dict[str, Any]) -> dict[str, Any]:
    """Fields the physics core can consume from a chip row."""
    out: dict[str, Any] = {
        "chip_id": chip["id"],
        "chip_vendor": chip.get("vendor"),
        "chip_product": chip.get("product"),
        "dose_limit_krad_Si": chip.get("dose_limit_krad_Si"),
        "dose_limit_provenance": chip.get("dose_limit_provenance"),
        "dose_limit_basis": chip.get("dose_limit_basis"),
        "memory_bits": chip.get("memory_bits"),
        "seu_R_ref_upsets_per_bit_day": chip.get("seu_R_ref_upsets_per_bit_day"),
        "seu_provenance": chip.get("seu_provenance"),
    }
    return out


def summarize_chips(chips: Iterable[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Compact table for CLIs / UI."""
    rows = []
    for c in chips if chips is not None else list_chips():
        rows.append(
            {
                "id": c["id"],
                "vendor": c.get("vendor"),
                "product": c.get("product"),
                "category": c.get("category"),
                "starmind_status": c.get("starmind_status"),
                "dose_limit_krad_Si": c.get("dose_limit_krad_Si"),
                "dose_limit_provenance": c.get("dose_limit_provenance"),
                "seu_R_ref_upsets_per_bit_day": c.get("seu_R_ref_upsets_per_bit_day"),
                "seu_provenance": c.get("seu_provenance"),
            }
        )
    return rows


def export_json(path: str | Path) -> Path:
    """Write the full database (plus a summary table) as JSON."""
    db = load_chip_db()
    payload = {
        **db,
        "summary": summarize_chips(db["chips"]),
    }
    out = Path(path)
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out


def export_sqlite(path: str | Path) -> Path:
    """
    Materialize a simple SQLite DB for ad-hoc queries.

    Tables: chips, chip_sources, chip_tags. Provenance columns preserved.
    """
    db = load_chip_db()
    out = Path(path)
    if out.exists():
        out.unlink()
    conn = sqlite3.connect(out)
    try:
        conn.executescript(
            """
            CREATE TABLE meta (
              key TEXT PRIMARY KEY,
              value TEXT
            );
            CREATE TABLE chips (
              id TEXT PRIMARY KEY,
              vendor TEXT,
              product TEXT,
              category TEXT,
              role TEXT,
              starmind_status TEXT,
              starmind_status_note TEXT,
              memory TEXT,
              memory_bits REAL,
              tdp_w_per_gpu REAL,
              rack_tdp_kw REAL,
              dose_limit_krad_Si REAL,
              dose_limit_hard_fail_krad_Si REAL,
              expected_mission_dose_krad_Si REAL,
              dose_limit_basis TEXT,
              dose_limit_provenance TEXT,
              seu_R_ref_upsets_per_bit_day REAL,
              seu_provenance TEXT
            );
            CREATE TABLE chip_sources (
              chip_id TEXT,
              url TEXT,
              claim TEXT,
              tag TEXT,
              FOREIGN KEY (chip_id) REFERENCES chips(id)
            );
            CREATE TABLE chip_tags (
              chip_id TEXT,
              tag TEXT,
              FOREIGN KEY (chip_id) REFERENCES chips(id)
            );
            """
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("schema_version", str(db.get("schema_version"))),
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("updated", str(db.get("updated"))),
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("notes", str(db.get("notes"))),
        )
        for c in db["chips"]:
            conn.execute(
                """
                INSERT INTO chips VALUES (
                  ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                )
                """,
                (
                    c["id"],
                    c.get("vendor"),
                    c.get("product"),
                    c.get("category"),
                    c.get("role"),
                    c.get("starmind_status"),
                    c.get("starmind_status_note"),
                    c.get("memory"),
                    c.get("memory_bits"),
                    c.get("tdp_w_per_gpu"),
                    c.get("rack_tdp_kw"),
                    c.get("dose_limit_krad_Si"),
                    c.get("dose_limit_hard_fail_krad_Si"),
                    c.get("expected_mission_dose_krad_Si"),
                    c.get("dose_limit_basis"),
                    c.get("dose_limit_provenance"),
                    c.get("seu_R_ref_upsets_per_bit_day"),
                    c.get("seu_provenance"),
                ),
            )
            for src in c.get("sources") or []:
                conn.execute(
                    "INSERT INTO chip_sources VALUES (?,?,?,?)",
                    (c["id"], src.get("url"), src.get("claim"), src.get("tag")),
                )
            for tag in c.get("tags") or []:
                conn.execute(
                    "INSERT INTO chip_tags VALUES (?,?)",
                    (c["id"], tag),
                )
        conn.commit()
    finally:
        conn.close()
    return out
