# 3rok

Chip-test data in, a CCSDS OEM flight file out, flown on a globe. Read `docs/mvp-phase-plan.md` before writing code. It is the build order and the contract. `docs/product-spec.md` says what the product is.

## Commands

- `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`. Run `npm test` and `npm run typecheck` before every push.
- Python (`starmind-physics/`): `pip install -e ".[dev]"`, then `pytest -m "not aep8"` when `aep8` is absent.
- Python (`flight-mcp/`): `pip install -e ../starmind-physics -e ".[dev]"`, then `pytest -m "not aep8"` the same way. After a change to an OEM rule or sentence, edit both `lib/oem.ts` and `flight-mcp/flight_mcp/oem_profile.py`, then run `node --experimental-strip-types scripts/update-oem-golden.mjs` and read the diff.

## Rules that are easy to break

- The saved container is a **case**. Never call it a project in the UI, routes, schema, or chat.
- `lib/case.ts` is the only case shape. Change a field only in a commit that also updates `docs/mvp-phase-plan.md` and every lane that reads it. No tenth record type, no training-run fields, no flight field except `optimizedOem` and `workingOem`.
- Grok reads and proposes. The evaluator keeps. The UI never shows a training run, loss curve, checkpoint, or fine-tune job. xAI has no fine-tuning endpoint.
- The flight artifact is a CCSDS OEM 3.0 KVN file (GCRF, EARTH, UTC, `ORIGINATOR = 3ROK`). Never JSON, CSV, or a script. Never read thrust, mass, or a pitch program back out of `COMMENT` lines.
- Do not apply `starmind-physics/params.yaml` defaults when a case field is missing. Missing input refuses the score.
- Holdout rows are visible to the person and never reach Grok.
- Dynamic pressure, Mach, throttle, propellant, booster return and payload-door timing stay off the page until a physics function returns them.
- The globes and the flight engine are ours (`lib/engine/`, `lib/globe/`). Do not add Cesium or another globe library. The OEM is the flight: the engine fills in between its states and never writes one. The heat layer is a score from AP8/AE8 flux and the package's assumed dose coefficients. Never call it a probability.

## UI

- Follow `.cursor/rules/3rok-design-system.mdc`. Design tokens only: no hex, `rgb()` or `hsl()` in app code.
- One `solid` button per screen. Barlow for words, IBM Plex Mono for measured values. Dark theme.
- Never edit `3rok-design-system/` or `starmind-physics/`'s location. Do not load `bundle.js`. Do not use `Hero`.
- `tests/design-gates.test.ts` enforces the machine-checkable rules.

## Secrets and hosting

- Vercel project `3rok` serves https://3rok.vercel.app from `main`. `3rok1.vercel.app` is a different project: leave it alone.
- `vercel.json` must stay. It sets `"framework": "nextjs"`. Without it Vercel sees `starmind-physics/pyproject.toml` and builds the repo as Python ("No python entrypoint found").
- Keys go in Vercel environment variables. Never commit one, and never echo one into chat or logs. `XAI_API_KEY` is server only.
- Supabase Auth and Postgres from Phase 3. Row-level security is on. The app never uses the service-role key.

## Workflow

- One pull request per phase, branch `claude/compassionate-dijkstra-4c8vhe`. After a phase PR merges, restart that branch from the latest `main`.
- Do not merge your own pull request unless asked.
- Phase status is in the PR history. The plan file is the source of truth for what a phase owns and when it is done.
