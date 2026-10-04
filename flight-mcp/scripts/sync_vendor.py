"""Copies ../starmind-physics/starmind_physics into vendor/ for the Vercel deployment.

    python scripts/sync_vendor.py          # write vendor/
    python scripts/sync_vendor.py --check  # exit 1 if vendor/ differs (the test runs this)

The optimizer scripts are left out: score_candidate calls evaluate() and nothing else, so the deployed
copy has no optimizer to reach. Nothing is edited. `starmind-physics/` stays where it is and stays the source.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE.parent / "starmind-physics" / "starmind_physics"
TARGET = HERE / "vendor" / "starmind_physics"
LEFT_OUT = {"scripts", "__pycache__"}


def wanted(root: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if path.is_dir() or LEFT_OUT & set(relative.parts) or path.suffix == ".pyc":
            continue
        files[relative.as_posix()] = path.read_bytes()
    return files


def differences() -> list[str]:
    source, target = wanted(SOURCE), wanted(TARGET) if TARGET.exists() else {}
    problems = [f"missing from vendor: {name}" for name in sorted(source.keys() - target.keys())]
    problems += [f"not in starmind_physics: {name}" for name in sorted(target.keys() - source.keys())]
    problems += [f"differs: {name}" for name in sorted(source.keys() & target.keys()) if source[name] != target[name]]
    return problems


def main() -> int:
    if "--check" in sys.argv:
        problems = differences()
        for problem in problems:
            print(problem)
        return 1 if problems else 0
    if TARGET.exists():
        shutil.rmtree(TARGET)
    shutil.copytree(SOURCE, TARGET, ignore=shutil.ignore_patterns(*LEFT_OUT, "*.pyc"))
    print(f"Wrote {len(wanted(TARGET))} files to {TARGET.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
