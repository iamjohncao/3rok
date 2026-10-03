#!/usr/bin/env python3
"""List / export the Starmind candidate AI-chip database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from starmind_physics.chips import (
    export_json,
    export_sqlite,
    list_chips,
    load_chip_db,
    summarize_chips,
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--category", default=None)
    ap.add_argument("--status", dest="starmind_status", default=None)
    ap.add_argument("--tag", default=None)
    ap.add_argument(
        "--format",
        choices=("table", "json", "sqlite"),
        default="table",
        help="table = stdout summary; json/sqlite = write full DB",
    )
    ap.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output path for json/sqlite (defaults: ai_chips.json / ai_chips.sqlite)",
    )
    args = ap.parse_args(argv)

    chips = list_chips(
        category=args.category,
        starmind_status=args.starmind_status,
        tag=args.tag,
    )

    if args.format == "table":
        rows = summarize_chips(chips)
        print(f"{len(rows)} chips  (schema {load_chip_db()['schema_version']})")
        print(
            f"{'id':<28} {'vendor':<14} {'dose_krad':>9} {'prov':<8} {'status'}"
        )
        for r in rows:
            print(
                f"{r['id']:<28} {str(r['vendor'] or ''):<14} "
                f"{r['dose_limit_krad_Si']!s:>9} "
                f"{str(r['dose_limit_provenance'] or ''):<8} "
                f"{r['starmind_status']}"
            )
        print(
            "\nProvenance: sourced = public anchor; assumed = modelling placeholder. "
            "Do not treat assumed dose limits as Starmind facts.",
            file=sys.stderr,
        )
        return 0

    if args.format == "json":
        out = args.output or Path("ai_chips.json")
        # If filters applied, write filtered summary+chips subset
        if args.category or args.starmind_status or args.tag:
            payload = {"chips": chips, "summary": summarize_chips(chips)}
            out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        else:
            export_json(out)
        print(f"Wrote {out}")
        return 0

    out = args.output or Path("ai_chips.sqlite")
    if args.category or args.starmind_status or args.tag:
        print("SQLite export ignores filters and writes the full DB", file=sys.stderr)
    export_sqlite(out)
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
