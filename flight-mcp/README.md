# flight-mcp

The 3rok flight MCP server. Grok calls it through xAI's remote MCP connector while it revises a flight. It has three tools, and the schemas are the ones in [docs/grok-flight-mcp.md](../docs/grok-flight-mcp.md).

| Tool | What it does | Loads `starmind_physics`? |
|---|---|---|
| `validate_oem` | Checks OEM text against the 3rok profile. Returns errors in sentences. Stores nothing. | No |
| `submit_oem` | Same check. A file that passes is held, as text, for the MCP session that sent it. It is not published and not marked optimized. | No |
| `score_candidate` | Scores one reduced LEO orbit with `starmind_physics.evaluate`. Refuses outside 500–2000 km and outside 30° or sun-synchronous. | Yes, and only this tool |

It has no tool that reads a case, a split, or an outcome, and it writes nothing. The holdout evaluator is not here. It is `lib/holdout.ts`, in the app.

## Run it

`starmind-physics` is the package in this repository, not a PyPI project, so install it first.

```bash
pip install -e ../starmind-physics -e ".[dev]"
flight-mcp                      # http://0.0.0.0:8000/mcp, health at /health
pytest -m "not aep8"            # when aep8 is absent; plain `pytest` runs everything
```

| Variable | Meaning |
|---|---|
| `PORT`, `HOST` | Default `8000` and `0.0.0.0`. |
| `FLIGHT_MCP_TOKEN` | When set, every call to `/mcp` needs `Authorization: Bearer <token>`. Set it on any public URL. xAI sends it from the `authorization` field of the MCP tool entry. `/health` stays open. |
| `FLIGHT_MCP_STATELESS` | `1` runs without sessions, which lets several instances share one URL. Then `submit_oem` validates and holds nothing, and the app takes the candidate from the tool call itself. |
| `FLIGHT_MCP_JSON_RESPONSE` | `1` answers with plain JSON instead of an event stream. |

xAI connects only to streaming HTTP or SSE over HTTPS. A stdio server will not connect.

## Deploy

The image needs the whole scientific stack (`numpy`, `astropy`, `aep8`), so use a container host. A serverless Python function is too small for it. Build from the repository root:

```bash
docker build -f flight-mcp/Dockerfile -t 3rok-flight-mcp .
docker run -p 8000:8000 -e FLIGHT_MCP_TOKEN=... 3rok-flight-mcp
```

Then set `FLIGHT_MCP_URL` (`https://<host>/mcp`) and `FLIGHT_MCP_TOKEN` as environment variables on the Vercel project. Until `FLIGHT_MCP_URL` is set, the app leaves the `mcp` tool out of the Grok request and validates in-process.

## The two validators

`oem_profile.py` is the same profile as `lib/oem.ts`. They share `fixtures/oem-profile-cases.json`, and `fixtures/oem-profile-expected.json` holds the exact result `lib/oem.ts` gives for every case. `tests/test_oem_profile.py` and `lib/oem.test.ts` both compare against it, sentence for sentence. Change a rule or a sentence in both files, then:

```bash
node --experimental-strip-types scripts/update-oem-golden.mjs
```

and read the diff.

## What a score means

`score_candidate` returns a ranking under the package's own assumptions, always with `value_status: "derived"` and the package's `assumptions_note`. The chip block repeats the provenance the chip database gives (`sourced` or `assumed`) and never relabels it. At the time of writing the Jetson AGX Orin row is `assumed`, so an Orin lifetime rests on an assumed dose limit, not on the 42 krad(Si) beam result. It is not a Starmind or Rubin flight lifetime.
