"""The server over real streaming HTTP, driven by the official MCP client."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import anyio
import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

pytest.importorskip("starmind_physics")

from flight_mcp.server import TOOL_NAMES, TOOLS, CandidateStore, create_app  # noqa: E402

from conftest import fake_evaluate, running  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
MINIMAL = (ROOT / "fixtures" / "minimal.oem").read_text(encoding="utf-8")
BAD = MINIMAL.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000")
SCORE_ARGS = {"altitude_km": 650, "inclination": "sso", "ltan_hours": 6, "shield_mm_Al": 5, "chip_id": "nvidia_jetson_agx_orin"}


def drive(url: str, work: Any, headers: dict[str, str] | None = None) -> Any:
    """Opens an MCP session at /mcp and runs `work(session, session_id)` in it."""

    async def run() -> Any:
        async with streamablehttp_client(f"{url}/mcp", headers=headers) as (read, write, get_session_id):
            async with ClientSession(read, write) as session:
                await session.initialize()
                return await work(session, get_session_id())

    return anyio.run(run)


def body(result: Any) -> dict[str, Any]:
    assert result.content, "the tool returned no content"
    return json.loads(result.content[0].text)


@pytest.fixture()
def served():
    store = CandidateStore()
    calls: list[dict[str, Any]] = []
    app = create_app(evaluate=fake_evaluate(calls), candidates=store)
    with running(app) as url:
        yield url, store, calls


class TestTheToolSurface:
    def test_exactly_the_three_allowed_tools(self, served: Any) -> None:
        url, _, _ = served

        async def work(session: ClientSession, _: str | None) -> list[str]:
            return [tool.name for tool in (await session.list_tools()).tools]

        assert drive(url, work) == ["validate_oem", "submit_oem", "score_candidate"] == list(TOOL_NAMES)

    def test_every_schema_is_closed_so_nothing_extra_is_accepted(self, served: Any) -> None:
        url, _, _ = served

        async def work(session: ClientSession, _: str | None) -> dict[str, Any]:
            return {tool.name: tool.inputSchema for tool in (await session.list_tools()).tools}

        schemas = drive(url, work)
        for name, schema in schemas.items():
            assert schema["additionalProperties"] is False, name
        assert schemas["validate_oem"]["required"] == ["oem"]
        assert schemas["submit_oem"]["required"] == ["oem"]
        assert schemas["score_candidate"]["required"] == ["altitude_km", "inclination", "ltan_hours", "shield_mm_Al"]

    def test_the_score_schema_has_no_epoch_position_velocity_or_split(self) -> None:
        properties = set(next(t for t in TOOLS if t.name == "score_candidate").inputSchema["properties"])
        assert properties == {"altitude_km", "inclination", "ltan_hours", "shield_mm_Al", "chip_id", "chip_preset", "radiator_area_m2", "load_strategy"}

    def test_no_tool_reads_a_case_a_split_or_an_outcome(self) -> None:
        text = json.dumps([t.model_dump() for t in TOOLS]).lower()
        for word in ("split", "outcome", "case_id", "records", "optimized"):
            assert word not in text.replace("holdout data", "")


class TestValidateOem:
    def test_a_valid_file_has_the_documented_result(self, served: Any) -> None:
        url, store, _ = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("validate_oem", {"oem": MINIMAL})

        result = drive(url, work)
        assert result.isError is False
        assert body(result) == {
            "valid": True,
            "errors": [],
            "segment_count": 1,
            "state_count": 2,
            "start_time": "2026-10-03T18:05:00.000",
            "stop_time": "2026-10-03T18:20:00.000",
            "has_acceleration": False,
        }
        assert store._items == {}, "validate_oem must not store the file"

    def test_a_bad_file_is_a_normal_result_with_sentences_not_a_tool_error(self, served: Any) -> None:
        url, _, _ = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("validate_oem", {"oem": BAD})

        result = drive(url, work)
        assert result.isError is False
        assert body(result)["valid"] is False
        assert "REF_FRAME must be GCRF" in body(result)["errors"][0]

    def test_a_call_with_no_oem_is_rejected_before_any_code_runs(self, served: Any) -> None:
        url, _, _ = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("validate_oem", {})

        result = drive(url, work)
        assert result.isError is True and "validation" in result.content[0].text.lower()


class TestSubmitOem:
    def test_a_valid_file_is_held_for_this_session_as_the_same_text(self, served: Any) -> None:
        url, store, _ = served

        async def work(session: ClientSession, session_id: str | None) -> Any:
            return await session.call_tool("submit_oem", {"oem": MINIMAL}), session_id

        result, session_id = drive(url, work)
        data = body(result)
        assert data["accepted"] is True and data["held"] is True and data["valid"] is True
        assert len(data["candidate_sha256"]) == 64
        assert session_id is not None
        held = store.held(session_id)
        assert held == MINIMAL and isinstance(held, str), "the held candidate is the OEM text and nothing else"

    def test_a_failing_file_stores_nothing_and_does_not_replace_an_earlier_candidate(self, served: Any) -> None:
        url, store, _ = served

        async def work(session: ClientSession, session_id: str | None) -> Any:
            await session.call_tool("submit_oem", {"oem": MINIMAL})
            return await session.call_tool("submit_oem", {"oem": BAD}), session_id

        result, session_id = drive(url, work)
        data = body(result)
        assert data["accepted"] is False and data["held"] is False and data["candidate_sha256"] is None
        assert data["errors"]
        assert store.held(session_id or "") == MINIMAL

    def test_one_session_cannot_read_another_sessions_candidate(self, served: Any) -> None:
        url, store, _ = served

        async def work(session: ClientSession, session_id: str | None) -> str | None:
            await session.call_tool("submit_oem", {"oem": MINIMAL})
            return session_id

        first = drive(url, work)
        second = drive(url, lambda s, sid: _return(sid))
        assert first != second
        assert store.held(first or "") == MINIMAL and store.held(second or "") is None

    def test_a_stateless_server_validates_and_holds_nothing(self) -> None:
        store = CandidateStore()
        with running(create_app(stateless=True, candidates=store, evaluate=fake_evaluate())) as url:

            async def work(session: ClientSession, _: str | None) -> Any:
                return await session.call_tool("submit_oem", {"oem": MINIMAL})

            data = body(drive(url, work))
        assert data["accepted"] is True and data["held"] is False
        assert store._items == {}

    def test_it_never_marks_anything_optimized(self, served: Any) -> None:
        url, _, _ = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("submit_oem", {"oem": MINIMAL})

        keys = set(body(drive(url, work)))
        assert not {"optimizedOem", "optimized", "workingOem", "log", "holdout_error"} & keys


async def _return(value: Any) -> Any:
    return value


class TestScoreCandidate:
    def test_a_score_has_the_documented_fields(self, served: Any) -> None:
        url, _, calls = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("score_candidate", SCORE_ARGS)

        result = drive(url, work)
        assert result.isError is False
        data = body(result)
        assert data["refused"] is False and data["value_status"] == "derived"
        assert data["assumptions_note"] and data["chip"]["dose_limit_provenance"] == "assumed"
        assert calls and calls[0]["chip_id"] == "nvidia_jetson_agx_orin"
        assert result.structuredContent == data

    def test_400_km_is_refused_with_no_lifetime(self, served: Any) -> None:
        url, _, calls = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("score_candidate", {**SCORE_ARGS, "altitude_km": 400})

        data = body(drive(url, work))
        assert data["refused"] is True and "lifetime_years" not in data
        assert calls == []

    @pytest.mark.parametrize("extra", [{"epoch": "2026-10-03T18:05:00"}, {"position": [1, 2, 3]}, {"velocity": [1, 2, 3]}, {"split": "holdout"}])
    def test_epochs_positions_velocities_and_splits_are_rejected_by_the_schema(self, served: Any, extra: dict[str, Any]) -> None:
        url, _, calls = served

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("score_candidate", {**SCORE_ARGS, **extra})

        result = drive(url, work)
        assert result.isError is True
        assert "additional properties" in result.content[0].text.lower()
        assert calls == []

    def test_a_missing_chip_is_a_tool_error_the_model_can_fix(self, served: Any) -> None:
        url, _, calls = served
        args = {k: v for k, v in SCORE_ARGS.items() if k != "chip_id"}

        async def work(session: ClientSession, _: str | None) -> Any:
            return await session.call_tool("score_candidate", args)

        result = drive(url, work)
        assert result.isError is True and "exactly one of chip_id or chip_preset" in result.content[0].text
        assert calls == []

    def test_a_package_failure_is_an_error_and_never_a_made_up_lifetime(self) -> None:
        def broken(_: dict[str, Any]) -> dict[str, Any]:
            raise RuntimeError("boom")

        with running(create_app(evaluate=broken)) as url:

            async def work(session: ClientSession, _: str | None) -> Any:
                return await session.call_tool("score_candidate", SCORE_ARGS)

            result = drive(url, work)
        assert result.isError is True
        assert "No lifetime is returned" in result.content[0].text
        assert "boom" not in result.content[0].text


class TestAccess:
    def test_with_a_token_a_call_without_it_or_with_the_wrong_one_is_refused(self) -> None:
        with running(create_app(token="s3cret", evaluate=fake_evaluate())) as url:
            assert httpx.post(f"{url}/mcp", json={}).status_code == 401
            assert httpx.post(f"{url}/mcp", json={}, headers={"Authorization": "Bearer wrong"}).status_code == 401
            assert httpx.post(f"{url}/mcp", json={}, headers={"Authorization": "s3cret"}).status_code == 401

            async def work(session: ClientSession, _: str | None) -> list[str]:
                return [t.name for t in (await session.list_tools()).tools]

            assert drive(url, work, headers={"Authorization": "Bearer s3cret"}) == list(TOOL_NAMES)

    def test_health_is_open_and_names_the_tools(self) -> None:
        with running(create_app(token="s3cret")) as url:
            response = httpx.get(f"{url}/health")
        assert response.status_code == 200
        assert response.json() == {"ok": True, "server": "3rok-flight", "tools": list(TOOL_NAMES)}

    def test_without_a_token_the_server_is_open(self, served: Any) -> None:
        url, _, _ = served
        assert httpx.get(f"{url}/health").status_code == 200


class TestWhereTheServerReaches:
    def test_validate_and_submit_never_load_the_physics_package(self) -> None:
        """A fresh interpreter imports the server and runs both text tools through the real
        handlers. The physics package must not be loaded by either."""
        code = (
            "import asyncio, json, sys\n"
            "import mcp.types as types\n"
            "from flight_mcp.server import build_server\n"
            "server, _ = build_server()\n"
            "handler = server.request_handlers[types.CallToolRequest]\n"
            f"text = open({str(ROOT / 'fixtures' / 'minimal.oem')!r}).read()\n"
            "async def go():\n"
            "    await server.request_handlers[types.ListToolsRequest](types.ListToolsRequest(method='tools/list'))\n"
            "    for name in ('validate_oem', 'submit_oem'):\n"
            "        req = types.CallToolRequest(method='tools/call', params=types.CallToolRequestParams(name=name, arguments={'oem': text}))\n"
            "        await handler(req)\n"
            "asyncio.run(go())\n"
            "loaded = [m for m in sys.modules if m == 'starmind_physics' or m.startswith('starmind_physics.')]\n"
            "print(json.dumps(loaded))\n"
        )
        done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=False)
        assert done.returncode == 0, done.stderr
        assert json.loads(done.stdout.strip().splitlines()[-1]) == []

    def test_only_scoring_imports_the_physics_package(self) -> None:
        for path in (Path(__file__).resolve().parents[1] / "flight_mcp").glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            names = [
                alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names
            ] + [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
            touches = any(name.startswith("starmind_physics") for name in names)
            assert touches is (path.name == "scoring.py"), path.name
