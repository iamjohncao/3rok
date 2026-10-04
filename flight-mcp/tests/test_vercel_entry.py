"""The Vercel deployment: app.py with the vendored physics, and no ASGI lifespan."""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
from pathlib import Path

import httpx
import pytest

pytest.importorskip("starmind_physics")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sync_vendor  # noqa: E402

from flight_mcp.server import TOOL_NAMES, create_app  # noqa: E402

from conftest import fake_evaluate  # noqa: E402

HERE = Path(__file__).resolve().parents[1]
SCORE = {"altitude_km": 650, "inclination": "sso", "ltan_hours": 6, "shield_mm_Al": 5, "chip_id": "nvidia_jetson_agx_orin"}
MCP_HEADERS = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


class TestTheVendoredPhysics:
    def test_it_is_identical_to_the_package_it_copies(self) -> None:
        assert sync_vendor.differences() == [], "Run `python scripts/sync_vendor.py` in flight-mcp and commit vendor/."

    def test_it_has_no_optimizer_to_reach(self) -> None:
        assert not (HERE / "vendor" / "starmind_physics" / "scripts").exists()
        assert (HERE / "vendor" / "starmind_physics" / "evaluate.py").exists()
        assert (HERE / "vendor" / "starmind_physics" / "params.yaml").exists()
        assert (HERE / "vendor" / "starmind_physics" / "data" / "ai_chips.yaml").exists()

    def test_the_check_sees_a_difference(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        copy = tmp_path / "starmind_physics"
        copy.mkdir()
        (copy / "evaluate.py").write_text("changed", encoding="utf-8")
        monkeypatch.setattr(sync_vendor, "TARGET", copy)
        problems = sync_vendor.differences()
        assert "differs: evaluate.py" in problems and any(p.startswith("missing from vendor") for p in problems)


class TestTheVercelProjectSettings:
    def test_the_project_is_pinned_to_the_python_preset(self) -> None:
        settings = json.loads((HERE / "vercel.json").read_text())
        # Not "fastapi": that preset looks for a FastAPI instance, and this app is Starlette.
        assert settings["framework"] == "python"

    def test_the_entrypoint_is_the_stateless_app(self) -> None:
        assert 'entrypoint = "app:app"' in (HERE / "pyproject.toml").read_text()
        assert (HERE / "app.py").exists()


class TestTheDependencyLists:
    def test_requirements_and_pyproject_name_the_same_runtime_packages(self) -> None:
        requirements = {line.split(">=")[0].strip() for line in (HERE / "requirements.txt").read_text().splitlines() if line and not line.startswith("#")}
        pyproject = (HERE / "pyproject.toml").read_text()
        for name in requirements:
            assert f'"{name}' in pyproject, name

    def test_the_optimizer_stack_is_in_neither(self) -> None:
        text = (HERE / "requirements.txt").read_text() + (HERE / "pyproject.toml").read_text()
        for heavy in ("pymoo", "scipy", "matplotlib"):
            assert heavy not in text

    def test_the_physics_package_no_longer_requires_the_optimizer_stack(self) -> None:
        text = (HERE.parent / "starmind-physics" / "pyproject.toml").read_text()
        dependencies = text.split("dependencies = [", 1)[1].split("]", 1)[0]
        assert "pymoo" not in dependencies
        assert "optimize = [" in text


class TestNoLifespan:
    """A Vercel Function does not send ASGI lifespan events. httpx's ASGI transport does not either."""

    def test_the_mcp_endpoint_answers_with_no_startup(self) -> None:
        import asyncio

        async def run() -> tuple[dict, dict]:
            app = create_app(stateless=True, json_response=True, evaluate=fake_evaluate())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
                listed = await client.post("/mcp", headers=MCP_HEADERS, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
                called = await client.post(
                    "/mcp", headers=MCP_HEADERS,
                    json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "score_candidate", "arguments": SCORE}},
                )
                assert listed.headers["content-type"].startswith("application/json")
                return listed.json(), called.json()

        listed, called = asyncio.run(run())
        assert [t["name"] for t in listed["result"]["tools"]] == list(TOOL_NAMES)
        assert json.loads(called["result"]["content"][0]["text"])["refused"] is False

    def test_a_second_request_works_too(self) -> None:
        import asyncio

        async def run() -> list[int]:
            app = create_app(stateless=True, json_response=True, evaluate=fake_evaluate())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
                return [(await client.post("/mcp", headers=MCP_HEADERS, json={"jsonrpc": "2.0", "id": i, "method": "tools/list"})).status_code for i in range(3)]

        assert asyncio.run(run()) == [200, 200, 200]

    def test_the_other_routes_need_no_startup_either(self) -> None:
        import asyncio

        async def run() -> tuple[int, int]:
            app = create_app(stateless=True, json_response=True, evaluate=fake_evaluate())
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
                return (await client.get("/health")).status_code, (await client.post("/score", json=SCORE)).status_code

        assert asyncio.run(run()) == (200, 200)


@pytest.mark.aep8
class TestAppPyOnVercel:
    """Runs app.py in a fresh interpreter where the installed starmind_physics cannot be imported, as on
    Vercel, so the vendored copy is what scores."""

    def test_it_scores_with_the_vendored_copy(self) -> None:
        code = textwrap.dedent(
            """
            import json, sys
            # Hide the installed starmind_physics (an editable install here), the way Vercel's bundle has none.
            sys.meta_path = [f for f in sys.meta_path if "starmind" not in repr(f).lower()]
            sys.path = [p for p in sys.path if "starmind-physics" not in p]
            import asyncio, httpx
            import app as entry
            import starmind_physics
            where = starmind_physics.__file__.replace("\\\\", "/")
            assert "/vendor/starmind_physics/" in where, where

            async def run():
                transport = httpx.ASGITransport(app=entry.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
                    ok = await client.post("/score", json=%(score)s)
                    refused = await client.post("/score", json={**%(score)s, "altitude_km": 400})
                    return ok.json(), refused.json()

            ok, refused = asyncio.run(run())
            print(json.dumps({"where": where, "lifetime": ok["lifetime_years"], "refused": refused["refused"], "note": bool(ok["assumptions_note"])}))
            """
        ) % {"score": json.dumps(SCORE)}
        done = subprocess.run([sys.executable, "-c", code], cwd=HERE, capture_output=True, text=True, check=False)
        assert done.returncode == 0, done.stderr
        result = json.loads(done.stdout.strip().splitlines()[-1])
        assert "/vendor/starmind_physics/" in result["where"]
        assert result["lifetime"] == pytest.approx(21.07, abs=0.05)
        assert result["refused"] is True and result["note"] is True

    def test_it_asks_for_the_token_when_one_is_set(self) -> None:
        code = textwrap.dedent(
            """
            import os
            os.environ["FLIGHT_MCP_TOKEN"] = "s3cret"
            import asyncio, httpx, app as entry

            async def run():
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=entry.app), base_url="http://t") as client:
                    return (await client.get("/health")).status_code, (await client.post("/score", json={})).status_code

            print(asyncio.run(run()))
            """
        )
        done = subprocess.run([sys.executable, "-c", code], cwd=HERE, capture_output=True, text=True, check=False)
        assert done.returncode == 0, done.stderr
        assert done.stdout.strip().splitlines()[-1] == "(200, 401)"
