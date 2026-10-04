"""The 3rok flight MCP server: ``validate_oem``, ``submit_oem`` and ``score_candidate``.

The schemas are the ones in docs/grok-flight-mcp.md, with ``additionalProperties: false`` so a
call that carries an epoch, a position or a velocity is rejected before any code runs. Transport
is MCP streaming HTTP at ``/mcp``. A stdio server on a laptop is not reachable by xAI.

``validate_oem`` and ``submit_oem`` are pure checks of OEM text (``oem_profile.py``) and never
load the physics package. ``score_candidate`` is the only tool that does (``scoring.py``). The
server has no tool that reads a case, an outcome or a split, and nothing here writes a case.
``submit_oem`` holds the accepted text for the session that sent it and does not publish it.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import logging
import os
import time
from collections import OrderedDict
from importlib import resources
from typing import Any

import mcp.types as types
import uvicorn
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Receive, Scope, Send

from flight_mcp.oem_profile import validate_oem
from flight_mcp.scoring import InputError, PhysicsUnavailable, score_candidate

LOG = logging.getLogger("flight_mcp")

SERVER_NAME = "3rok-flight"
TOOL_NAMES = ("validate_oem", "submit_oem", "score_candidate")

def _load_tools() -> list[types.Tool]:
    """The tool definitions in tool_schemas.json, the one file the app and this server share."""
    text = resources.files("flight_mcp").joinpath("tool_schemas.json").read_text(encoding="utf-8")
    return [types.Tool(name=t["name"], description=t["description"], inputSchema=t["inputSchema"]) for t in json.loads(text)["tools"]]


TOOLS: list[types.Tool] = _load_tools()


class CandidateStore:
    """The OEM text ``submit_oem`` accepted, held per MCP session. Text only, bounded, and it
    expires. Nothing reads it back out through a tool, and it is never a case."""

    def __init__(self, max_entries: int = 256, ttl_seconds: float = 3600.0, clock: Any = time.monotonic) -> None:
        self._items: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._max = max_entries
        self._ttl = ttl_seconds
        self._clock = clock

    def hold(self, key: str, text: str) -> None:
        self._items.pop(key, None)
        self._items[key] = (self._clock(), text)
        while len(self._items) > self._max:
            self._items.popitem(last=False)

    def held(self, key: str) -> str | None:
        item = self._items.get(key)
        if item is None:
            return None
        stored_at, text = item
        if self._clock() - stored_at > self._ttl:
            del self._items[key]
            return None
        return text


def _session_key(server: Server) -> str | None:
    """The MCP session id of the request being served, or None when the server is stateless."""
    try:
        request = server.request_context.request
        return request.headers.get("mcp-session-id") if request is not None else None
    except (LookupError, AttributeError):
        return None


def build_server(candidates: CandidateStore | None = None, evaluate: Any = None) -> tuple[Server, CandidateStore]:
    store = candidates if candidates is not None else CandidateStore()
    server: Server = Server(SERVER_NAME)

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return TOOLS

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
        if name == "validate_oem":
            return validate_oem(arguments["oem"])

        if name == "submit_oem":
            result = validate_oem(arguments["oem"])
            key = _session_key(server)
            held = False
            if result["valid"] and key is not None:
                store.hold(key, arguments["oem"])
                held = True
            return {
                **result,
                "accepted": result["valid"],
                "held": held,
                "candidate_sha256": hashlib.sha256(arguments["oem"].encode("utf-8")).hexdigest() if result["valid"] else None,
            }

        if name == "score_candidate":
            try:
                return score_candidate(arguments, evaluate=evaluate)
            except InputError as error:
                return types.CallToolResult(content=[types.TextContent(type="text", text=f"Input error: {error}")], isError=True)
            except PhysicsUnavailable as error:
                return types.CallToolResult(content=[types.TextContent(type="text", text=f"Physics unavailable: {error}")], isError=True)
            except Exception:  # noqa: BLE001 - a failure here must not take the server down
                LOG.exception("score_candidate failed")
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text="The score could not be computed. No lifetime is returned.")],
                    isError=True,
                )

        return types.CallToolResult(content=[types.TextContent(type="text", text=f"Unknown tool {name}.")], isError=True)

    return server, store


class BearerAuth:
    """Requires ``Authorization: Bearer <token>`` when a token is configured. xAI sends it from the
    ``authorization`` field of the MCP tool entry. ``/health`` stays open."""

    def __init__(self, app: ASGIApp, token: str | None) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self.token and scope["path"] != "/health":
            header = Request(scope).headers.get("authorization", "")
            supplied = header[7:] if header.lower().startswith("bearer ") else ""
            if not hmac.compare_digest(supplied.encode("utf-8"), self.token.encode("utf-8")):
                await JSONResponse({"error": "Unauthorized."}, status_code=401, headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_app(
    token: str | None = None,
    stateless: bool = False,
    json_response: bool = False,
    evaluate: Any = None,
    candidates: CandidateStore | None = None,
) -> Starlette:
    server, _ = build_server(candidates, evaluate)

    if stateless:
        # No sessions, so nothing outlives a request. A manager for each request needs no lifespan event,
        # which lets this run on a host that never sends one (a Vercel Function). It is a few objects, not a connection.
        class MCPEndpoint:
            async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
                manager = StreamableHTTPSessionManager(app=server, stateless=True, json_response=json_response)
                async with manager.run():
                    await manager.handle_request(scope, receive, send)

        lifespan = None
    else:
        manager = StreamableHTTPSessionManager(app=server, stateless=False, json_response=json_response)

        class MCPEndpoint:  # type: ignore[no-redef]
            async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
                await manager.handle_request(scope, receive, send)

        @contextlib.asynccontextmanager
        async def lifespan(_: Starlette) -> Any:  # type: ignore[no-redef]
            async with manager.run():
                yield

    async def health(_: Request) -> Response:
        return JSONResponse({"ok": True, "server": SERVER_NAME, "tools": list(TOOL_NAMES)})

    async def score(request: Request) -> Response:
        """The same ``score_candidate`` as the MCP tool, as one JSON request, for the app's own
        evaluator. It takes the same fields, applies the same envelope and the same checks, and calls
        the same function. It is not a second scorer."""
        try:
            arguments = await request.json()
        except ValueError:
            return JSONResponse({"error": "The request body is not JSON."}, status_code=400)
        if not isinstance(arguments, dict):
            return JSONResponse({"error": "The request body must be a JSON object."}, status_code=400)
        try:
            result = await run_in_threadpool(score_candidate, arguments, evaluate)
        except InputError as error:
            return JSONResponse({"error": str(error)}, status_code=400)
        except PhysicsUnavailable as error:
            return JSONResponse({"error": f"Physics unavailable: {error}"}, status_code=503)
        except Exception:  # noqa: BLE001 - a failure here must not take the server down
            LOG.exception("score failed")
            return JSONResponse({"error": "The score could not be computed. No lifetime is returned."}, status_code=500)
        return JSONResponse(result)

    app = Starlette(
        routes=[
            Route("/health", health, methods=["GET"]),
            Route("/score", score, methods=["POST"]),
            Route("/mcp", MCPEndpoint(), methods=["GET", "POST", "DELETE"]),
        ],
        lifespan=lifespan,
    )
    return BearerAuth(app, token)  # type: ignore[return-value]


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes"}


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    app = create_app(
        token=os.environ.get("FLIGHT_MCP_TOKEN") or None,
        stateless=_truthy(os.environ.get("FLIGHT_MCP_STATELESS")),
        json_response=_truthy(os.environ.get("FLIGHT_MCP_JSON_RESPONSE")),
    )
    if not os.environ.get("FLIGHT_MCP_TOKEN"):
        LOG.warning("FLIGHT_MCP_TOKEN is not set. Anyone who can reach this URL can call the tools.")
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")), log_level="info")


if __name__ == "__main__":
    main()
