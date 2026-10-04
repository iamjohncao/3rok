# flight-mcp

The 3rok flight MCP server. Grok calls it through xAI's remote MCP connector while it revises a flight. It has three tools, and the schemas are the ones in [docs/grok-flight-mcp.md](../docs/grok-flight-mcp.md).

| Tool | What it does | Loads `starmind_physics`? |
|---|---|---|
| `validate_oem` | Checks OEM text against the 3rok profile. Returns errors in sentences. Stores nothing. | No |
| `submit_oem` | Same check. A file that passes is held, as text, for the MCP session that sent it. It is not published and not marked optimized. | No |
| `score_candidate` | Scores one reduced LEO orbit with `starmind_physics.evaluate`. Refuses outside 500–2000 km and outside 30° or sun-synchronous. | Yes, and only this tool |

`POST /score` is the same `score_candidate` as one JSON request (same fields, same envelope, same function, same bearer token), for the app's own evaluator in `lib/holdout.ts`. It is not a second scorer. The tool definitions live in `flight_mcp/tool_schemas.json`, and the Next.js app reads that same file, so the two sides cannot drift.

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

The server needs `numpy`, `astropy` and `aep8`, about 225 MB installed, and about 100 MB of memory while it scores. Every option below has a free tier. All of them were checked here the way the host would run them: a clean install from the host's own file, then calls to `/health`, `/score` and `/mcp`. None was run on the host itself.

| Host | Fits | Notes |
|---|---|---|
| **Vercel** (a second project) | Free Hobby: 2 GB, 300 s, 500 MB Python bundle | Recommended: same account and the same GitHub integration. Wakes in seconds. |
| **Render** (free web service) | 750 hours a month | Builds the Dockerfile from GitHub. Sleeps after 15 idle minutes and takes about a minute to wake. The app wakes it early. |
| **Google Cloud Run** | Free monthly quota | Scales to zero. Needs a billing account on file. |

Not options: **Supabase** runs Edge Functions on Deno, with no Python and no `numpy`. **Cloudflare Workers** cannot load `aep8`. **Koyeb** now asks for a card. Hosts that only run a FastMCP file cannot install the physics package or serve `/score`.

### Vercel

1. In Vercel, **Add New → Project**, import the same GitHub repository (`iamjohncao/3rok`), and set **Root Directory** to `flight-mcp`. Name it something other than `3rok` and `3rok1`.
2. Application preset: **Python**. Not FastAPI (the FastAPI preset looks for a FastAPI instance, and this is a Starlette app), and not Other. `flight-mcp/vercel.json` also sets `"framework": "python"`, so the dashboard choice cannot override it. Vercel finds `app.py`, installs `requirements.txt`, and runs the stateless `app` in it. Leave the build and output settings empty.
3. Add the environment variable `FLIGHT_MCP_TOKEN` (any long random string).
4. Deploy, then open `https://<project>.vercel.app/health`. It should answer `{"ok": true, ...}`. Use the production domain, not a preview URL: previews sit behind Vercel's login.
5. On the `3rok` project, set `FLIGHT_MCP_URL` to `https://<project>.vercel.app/mcp` and `FLIGHT_MCP_TOKEN` to the same string.

`app.py` runs without sessions, answers in plain JSON, and does not depend on a startup event. It imports `starmind_physics` from `vendor/`, a copy of `../starmind-physics/starmind_physics` without the optimizer scripts, because the rest of the repository is not in the bundle. After a change to `starmind-physics`, run `python scripts/sync_vendor.py` and commit `vendor/`. A test fails until you do.

### Render or Cloud Run

Build from the repository root, with the Dockerfile at `flight-mcp/Dockerfile`:

```bash
docker build -f flight-mcp/Dockerfile -t 3rok-flight-mcp .
docker run -p 8000:8000 -e FLIGHT_MCP_TOKEN=... 3rok-flight-mcp
```

On Render: **New → Web Service**, connect the repository, language **Docker**, Dockerfile path `flight-mcp/Dockerfile`, instance type **Free**, and the same environment variables. Then set `FLIGHT_MCP_URL` (`https://<host>/mcp`) and `FLIGHT_MCP_TOKEN` on the Vercel project.

Until `FLIGHT_MCP_URL` is set, the app leaves the `mcp` tool out of the Grok request and validates in-process, and a revision stays unscored.

## The two validators

`oem_profile.py` is the same profile as `lib/oem.ts`. They share `fixtures/oem-profile-cases.json`, and `fixtures/oem-profile-expected.json` holds the exact result `lib/oem.ts` gives for every case. `tests/test_oem_profile.py` and `lib/oem.test.ts` both compare against it, sentence for sentence. Change a rule or a sentence in both files, then:

```bash
node --experimental-strip-types scripts/update-oem-golden.mjs
```

and read the diff.

## What a score means

`score_candidate` returns a ranking under the package's own assumptions, always with `value_status: "derived"` and the package's `assumptions_note`. The chip block repeats the provenance the chip database gives (`sourced` or `assumed`) and never relabels it. At the time of writing the Jetson AGX Orin row is `assumed`, so an Orin lifetime rests on an assumed dose limit, not on the 42 krad(Si) beam result. It is not a Starmind or Rubin flight lifetime.
