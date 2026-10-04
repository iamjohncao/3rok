"""The Vercel Function entrypoint: a stateless ASGI app. Vercel loads the top-level name `app`.

It is the same server as `flight-mcp` (flight_mcp/server.py), configured for a host with no long-lived
process: no sessions, plain JSON answers, and no dependence on ASGI lifespan events. Set FLIGHT_MCP_TOKEN
in the Vercel project's environment variables, then use https://<project>.vercel.app/mcp as FLIGHT_MCP_URL.

`starmind_physics` is imported from the installed package when there is one (a container, a dev checkout).
On Vercel this directory is the project root and the repository's other folders are not in the bundle, so the
copy in vendor/ is used. `vendor/` is the package without its optimizer scripts, kept identical to
../starmind-physics by scripts/sync_vendor.py, and a test fails if the two differ.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import starmind_physics  # noqa: F401
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))

from flight_mcp.server import create_app  # noqa: E402

app = create_app(token=os.environ.get("FLIGHT_MCP_TOKEN") or None, stateless=True, json_response=True)
