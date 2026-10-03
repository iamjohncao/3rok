# 3rok — MVP phase plan

The product name is **3rok**. Write it `3rok` in prose and `3ROK` in display type. This file is the build order for [docs/product-spec.md](product-spec.md). The four-promise orbit navigator that used to live here is retired. Do not rebuild it.

The app is aimed at [https://3rok.vercel.app](https://3rok.vercel.app). [https://3rok1.vercel.app](https://3rok1.vercel.app) is a different project.

Read these before writing code. They are the contracts. This plan says who builds them and when a phase is done.

| File | What it locks |
|---|---|
| [docs/product-spec.md](product-spec.md) | What 3rok is: a case, an OEM, a testing page, a vehicle-class estimate. |
| [docs/universal-data-input-guidelines.md](universal-data-input-guidelines.md) | The nine record types, their fields, and the collection metadata. The note at the top of that file is stale: the file is in this repo, and it is the data contract. |
| [docs/flight-algorithm-oem.md](flight-algorithm-oem.md) | The CCSDS OEM 3.0 profile the writer and the parser both enforce. |
| [docs/grok-flight-mcp.md](grok-flight-mcp.md) | The xAI request, the three MCP tools, and what the route does after Grok answers. |
| [starmind-physics/README.md](../starmind-physics/README.md) | `evaluate()`. A ranking under stated assumptions. Not the saved algorithm, and not a Starmind or Rubin lifetime. |

`starmind-physics/` and `3rok-design-system/` stay where they are.

## What the MVP ships

A person signs in, keeps many **cases**, and loads each case with the nine record types. Grok reads that case's train records through xAI retrieval and proposes a CCSDS OEM. A separate evaluator keeps the file only when the holdout error drops. The testing page imports that file, draws it on a Cesium globe, and shows physics from `starmind-physics` beside the line. The person can download the OEM and a case bundle.

The saved container is a case. "Project" means this hackathon and this repository. Do not call the container a project in the interface, the routes, the schema, or the chat.

xAI has retrieval and no fine-tuning endpoint. Grok's weights do not change. The UI must not show a training run, a loss curve, a checkpoint, or a fine-tune job.

## Philosophy gates

These five checks apply to every phase. A phase is not done if any check that phase lists fails.

1. **The path is the picture.** The testing page is the globe and the line. Specs are readings of that line.
2. **The data is visible.** The nine record types stay in the case and open beside the algorithm. A number on the path traces to a record, or it is labeled derived or estimated.
3. **Edits are logged.** A hand edit and a Grok revision are both entries in the case log. A revision becomes the optimized algorithm only when the holdout error drops.
4. **The exported file is the artifact.** What leaves the case, and what the testing page flies, is the `.oem` file. The chat is not the flight.
5. **Grok reads. The evaluator keeps.** Retrieval proposes a deterministic file. The evaluator decides. Nothing in the phase pretends the model was trained.

## Lanes

Merge Phase 0 first. After `lib/case.ts` is on `main`, change a field only in a commit that updates this plan and every lane that reads the field.

| Lane | Owns | May not |
|---|---|---|
| Shell | Phase 0 files, design-system import, copied Cursor rule | Physics formulas, Cesium imagery keys in source |
| OEM | `lib/oem.ts`, `lib/oem.test.ts` | React, Cesium, Grok |
| Cases | `/cases`, `/cases/[id]`, the four regions | The Grok HTTP call, Cesium |
| Accounts | `/account`, session, `lib/account.ts`, `lib/case-store.ts` server implementation | Parsing OEM, drawing the globe |
| Ingest | `lib/ingest.ts`, upload mapping onto the nine types | A tenth record type, the globe |
| Physics | `flight-mcp/` and the call into `starmind_physics.evaluate` | A new lifetime formula, moving `starmind-physics/` |
| Holdout | `lib/holdout.ts`, `lib/oem-reduce.ts` | Calling Grok, drawing the path |
| Grok | `app/api/grok/route.ts` | Fine-tune calls, storing the case, the globe |
| Globe | `/test`, client-only Cesium, line, animation, OEM readouts | Grok, ingestion, inventing the next state |
| Fit | `lib/fit.ts` | Unpublished vehicle numbers, animation |
| Export | Download and the import slot the testing page reads | A second flight format |

## What runs in parallel

```
Phase 0  shell + lib/case.ts
    │
    ├── OEM library
    ├── Cases screen (IndexedDB draft)
    ├── Accounts (server store)
    ├── Physics service (flight-mcp)
    └── Globe + fit, on a fixture OEM
            │
            ├── Ingest (nine types into the case)
            └── Holdout (fixture outcomes + oem-reduce)
                    │
                    └── Grok route (RAG + MCP)
                            │
                            └── Export and import wire
```

OEM, the cases screen, accounts, the physics service, and the globe do not wait on each other once Phase 0 and a fixture OEM exist. Ingest needs the case document. Holdout needs OEM validation and the physics envelope check. The Grok route is not done until OEM validation and the holdout gate both run after the response. Wire import last.

## Hard dependencies

- Any flight the globe draws is OEM text that passed `lib/oem.ts`. A file that fails validation never reaches Cesium.
- The globe samples the file. It does not call `/api/grok` to move the marker.
- `score_candidate` is the only path into `starmind_physics.evaluate`. `validate_oem` and `submit_oem` do not import the physics package.
- The holdout function is not an MCP tool. Grok cannot see `split = holdout` records. Withholding them from the collection is the guarantee. A line in the prompt is not.
- A hand edit updates the working copy and the log. It does not replace the optimized OEM.
- A Grok revision replaces the optimized OEM only when the holdout error drops. No holdout outcomes means the draft stays unscored.
- `starmind-physics` does not write the next state. Dynamic pressure, Mach, throttle, propellant, booster return, and payload-door timing stay off the page until a model in that package actually returns them. It does not, today.
- Do not apply `params.yaml` defaults (800 km, SSO, 6 h LTAN, 5 mm, commercial) when a case field is missing. Missing inputs refuse the score.

## UI

Copy `3rok-design-system/.cursor/rules/3rok-design-system.mdc` to `.cursor/rules/`. Do not edit the copy inside `3rok-design-system/`. Import once in `app/layout.tsx`:

```tsx
import "../3rok-design-system/tokens.css";
import "../3rok-design-system/components/bundle.css";
```

Dark theme on the app. Barlow for words, IBM Plex Mono (`data-xl`, `data-md`, `data-sm`) for every measured value. One `solid` button on a screen. The rest are `ghost` or `quiet`. Re-implement the components you need as local `.tsx` files that reuse `bundle.css`. Do not load `bundle.js`.

| Screen | Solid button |
|---|---|
| `/account` | `Sign in` (the create form uses `Create account`) |
| `/cases` | `Create case` |
| `/cases/[id]` | `Ask Grok` |
| `/test` | `Import case` until a file is loaded, then `Play path` |

Do not use `Hero`. Do not use `ProgressBar` as a loss curve. `PlacementMap` is allowed only for record 7, the chip's location in the vehicle. Cell color there is that record's thermal coupling, with its `value_status` on the cell. It is not a second lifetime model.

The design-system examples `Run prediction`, `YR`, and `KRAD` are not labels to copy. Lifetime and dose appear only when a record or `evaluate` returned them, with the unit from that source, and with the word estimated or the record's `value_status`.

## Shared contract

`lib/case.ts` is the only case shape.

```ts
export type RecordType =
  | "chip-identity"
  | "tid"
  | "see"
  | "thermal-wear"
  | "trajectory"
  | "environment"
  | "placement"
  | "outcome"
  | "provenance";

export type Split = "train" | "holdout";
export type ValueStatus = "measured" | "derived" | "assumed" | "not_observable";

export type CaseRecord = {
  record_id: string;
  record_type: RecordType;
  chip_family: string;
  part_number: string;
  test_or_model: string;
  particle_or_stress: string | null;
  split: Split;
  source_url: string;
  value_status: ValueStatus;
  body: string; // CSV or JSON. Numbers live here, not in a PDF.
  source_filename: string | null;
};

export type LogKind =
  | "instruction"
  | "proposal"
  | "score"
  | "kept"
  | "rejected"
  | "hand_edit"
  | "export";

export type LogEntry = {
  at: string; // UTC
  kind: LogKind;
  text: string;
  oem: string | null;
  holdout_error: number | null;
};

export type CaseDocument = {
  id: string;
  accountId: string | null;
  name: string;
  chipIds: string[]; // chip_id values selected from record 1, matched to ai_chips.yaml when possible
  records: CaseRecord[];
  log: LogEntry[];
  optimizedOem: string | null;
  workingOem: string | null;
  holdoutError: number | null; // null means unscored
  updatedAt: string;
};
```

Do not add a dose field that varies outside record 6 and record 8, a dollar field, a team id, or a tenth `record_type`. Provenance fields sit on every record. A row with `record_type: "provenance"` is only for a source document that is itself a record.

`lib/case-store.ts` exports this interface. Callers do not talk to IndexedDB or Postgres directly.

```ts
export interface CaseStore {
  list(accountId: string): Promise<CaseSummary[]>;
  get(accountId: string, id: string): Promise<CaseDocument | null>;
  save(accountId: string, doc: CaseDocument): Promise<void>;
}
```

`CaseSummary` is the `/cases` row: id, name, chip family from the chip-identity records, whether `optimizedOem` is set, whether `holdoutError` is set, and `updatedAt`.

Fixture OEM, checked into `fixtures/minimal.oem`, is the shape example in the product spec. The header comment in that file says the numbers are not a flyable trajectory. Fixture case `fixtures/orin-case/` uses the public Jetson Orin figures already cited in the data guidelines, with `value_status: "measured"` only on figures those citations support. Predictions for that case are labeled Jetson-class. Do not fill an H100 or Rubin lifetime from those rows.

---

## Phase 0 — Shell and contract

**What is being built.** A Next.js (App Router) TypeScript app that builds, shows the 3ROK wordmark, and exports `lib/case.ts`. Three empty routes: `/cases`, `/cases/[id]`, `/test`, plus `/account`. `npm test` and `npm run build` exist.

**Owns.** `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx` (redirects to `/cases`), the four routes as empty instrument frames, `lib/case.ts`, `fixtures/minimal.oem`, and the copied Cursor rule.

**Done.** The frames use `var(--surface-100)` and the design-system type. No hex colors. The home screen is not a marketing hero. `npm run build` passes.

**Out.** Parsing, uploads, Grok, Cesium, accounts that persist, physics calls.

**Parallel.** Nothing else merges before this.

### Gates

**The path is the picture.** `/test` is an empty globe region that is most of the viewport, with a specs column beside it. **Not done if** `/test` is a form or a chat.

**The data is visible.** `/cases/[id]` has four labeled regions: Data, Activity, Algorithm, Score. **Not done if** a region is missing or the score region is a progress bar.

**Edits are logged.** The case type has `log`, `optimizedOem`, and `workingOem` as separate fields. **Not done if** one string is both the chat and the flight.

**The exported file is the artifact.** The type has no flight field except the two OEM strings. **Not done if** the schema can store a Python script or a JSON trajectory as the algorithm.

**Grok reads. The evaluator keeps.** The type has `holdoutError: number | null` and no training-run fields. **Not done if** the schema has an epoch, a loss, or a checkpoint id.

---

## Phase 1 — Flight file

**What is being built.** The OEM profile in [docs/flight-algorithm-oem.md](flight-algorithm-oem.md), as a parser, a validator, and a serializer.

**Owns.** `lib/oem.ts`, `lib/oem.test.ts`.

**Done.** `npm test` accepts `fixtures/minimal.oem` and rejects each of these: wrong `REF_FRAME`, wrong `CENTER_NAME`, wrong `TIME_SYSTEM`, `ORIGINATOR` other than `3ROK` on a file this app writes, fewer than two states, acceleration on some lines of a segment only, a time that goes backwards inside a segment, `INTERPOLATION` without `INTERPOLATION_DEGREE`, and a `REF_FRAME_EPOCH` on GCRF. Round-trip serialize then parse keeps the states. Comments are preserved and are not read back as thrust, mass, or a pitch program.

**Out.** React, the globe, Grok, choosing a "better" trajectory inside the parser.

**Parallel.** Starts when Phase 0 is merged. Does not wait on the screens.

### Gates

**The path is the picture.** The parser returns epochs and GCRF position, velocity, and acceleration when present, so a line can be drawn. **Not done if** the only output is a pass/fail flag.

**The data is visible.** Validation errors name the keyword and the rule in plain language. **Not done if** a failure is a numeric code with no sentence.

**Edits are logged.** This phase does not write the case log. The serializer does not stamp a file "optimized." **Not done if** `lib/oem.ts` sets a kept or rejected status.

**The exported file is the artifact.** The serializer writes CCSDS OEM 3.0 keyword-value notation and nothing else. **Not done if** it emits JSON, CSV, or a script.

**Grok reads. The evaluator keeps.** The library has no network call and does not import the AI SDK. **Not done if** validation depends on a model.

---

## Phase 2 — Cases

**What is being built.** The organization system for algorithms. The list and the case screen, saved as the spec describes for the hackathon: one case document in IndexedDB, behind `CaseStore`.

**Owns.** `app/cases/page.tsx`, `app/cases/[id]/page.tsx`, `lib/case-store.ts` (the interface and the IndexedDB implementation), `components/CaseList.tsx`, `components/CaseScreen.tsx`.

**Done.** Create case, rename it, and reopen it after a reload. The list row shows name, chip family, whether an optimized OEM exists, whether it is scored, and the time of the last log entry. The case screen shows the four regions. The Algorithm region shows the optimized OEM read-only and the working copy as editable text. Saving a hand edit appends a `hand_edit` log entry and does not change `optimizedOem`. The Score region shows the last holdout error, or the word `unscored`.

**Out.** The real Grok call (the button can be disabled until Phase 6), Cesium, a container named project.

**Parallel.** Starts after Phase 0. Uses fixture records before ingest exists. The working copy can be `fixtures/minimal.oem` pasted by hand.

### Gates

**The path is the picture.** The algorithm region shows the OEM text, not a chart of chip life. **Not done if** the case screen's primary view is a ranking plot.

**The data is visible.** Records already on the document are grouped by the nine types, with `value_status` and `split` on each row. Holdout rows are visible to the person. **Not done if** holdout rows are hidden in the UI.

**Edits are logged.** A hand edit is a log line with the time and the text that changed. Reloading shows that line. **Not done if** the working copy can change with an empty log.

**The exported file is the artifact.** This phase does not download yet. The working copy and the optimized file stay two strings. **Not done if** saving the editor overwrites `optimizedOem`.

**Grok reads. The evaluator keeps.** The score region has no loss curve. **Not done if** the screen says the model was trained, or a button says `Run training`.

---

## Phase 3 — Accounts

**What is being built.** Sign-in, and a saved case that belongs to one person. The spec's "one person, many cases" survives a different browser. The Grok route can load the case without trusting the browser to omit holdout rows.

**Owns.** `app/account/page.tsx`, `app/api/account/route.ts`, `app/api/cases/route.ts`, `app/api/cases/[id]/route.ts`, `lib/account.ts`, and the server `CaseStore`. Postgres via `DATABASE_URL`. Two tables: `account (id, email, password_hash, created_at)` and `case_doc (id, account_id, document jsonb, updated_at)`. Session cookie `3rok_session`, httpOnly, signed with `SESSION_SECRET`. Passwords stored only as a hash (scrypt or argon2).

**Done.** Create account, sign in, sign out. `/cases` lists only that account's cases. Account A cannot read or save account B's case (the test uses two accounts). The server store is the saved document. IndexedDB from Phase 2 remains the cache for the unsaved working copy, so a keystroke does not round-trip. `accountId` on a saved case is the signed-in account. A saved case with `accountId: null` is rejected.

**Out.** Teams, roles, sharing a case, OAuth, and any UI that merges two cases into one algorithm.

**Parallel.** The account routes can be built against the Phase 0 type before the case screen is pretty. The case screen is not done for the MVP until it reads and writes the server store.

**Secrets, added because this phase needs them.** `DATABASE_URL` and `SESSION_SECRET`, beside `XAI_API_KEY`. `NEXT_PUBLIC_CESIUM_ION_TOKEN` is a browser imagery token, not a secret.

### Gates

**The path is the picture.** The account screen is a sign-in form, not a second flight viewer. **Not done if** `/account` draws a trajectory.

**The data is visible.** After sign-in, the person's cases and their scored or unscored state are on `/cases`. **Not done if** cases exist only in an admin table the person cannot open.

**Edits are logged.** Switching accounts does not rewrite another account's log. **Not done if** a save from account A changes account B's document.

**The exported file is the artifact.** The server stores the case document, including both OEM strings. It does not store a private flight format. **Not done if** the database has a trajectory column that is not the OEM text.

**Grok reads. The evaluator keeps.** The account API does not call xAI. **Not done if** sign-in triggers a model call or a training job.

---

## Phase 4 — Data input

**What is being built.** Upload and replace for the nine record types in the guidelines. Mapping, not a new schema.

**Owns.** `lib/ingest.ts`, `lib/ingest.test.ts`, the Data region of the case screen.

**Done.** A CSV or JSON file becomes `CaseRecord` rows. Required metadata is `record_id`, `record_type`, `chip_family`, `part_number`, `test_or_model`, `split`, `source_url`, and `value_status`. `particle_or_stress` may be empty. A missing required field rejects the file with the field name. A missing `split` is an error. It is not coerced to `train`. `value_status` accepts only `measured`, `derived`, `assumed`, and `not_observable`. `record_type` accepts only the nine ids in `lib/case.ts`.

The minimum fields inside `body`, by type, match the guidelines table:

| `record_type` | Body must include |
|---|---|
| `chip-identity` | part number, family, node, die area, level tested, memory or ECC, serials, date code |
| `tid` | source and energy, dose rate, bias, temperature, dose steps, failure dose and mode, anneal |
| `see` | particle, energy, LET or effective LET, tilt, flux, fluence, events by type, cross-section with a confidence interval, power mode, workload, SDC count or `not_observable` |
| `thermal-wear` | junction temperature, power, voltage, current density where known, cycle profile, time or cycles to failure, mechanism, activation energy |
| `trajectory` | an OEM header and states, or OMM elements, plus epoch and duration |
| `environment` | model and version, mode, percentile, energies, shielding, flux or fluence or dose with units |
| `placement` | location (grid cell or x, y, z), shielding (material and thickness, or a sector description), thermal coupling |
| `outcome` | time window, position reference, dose if a dosimeter flew, upsets, resets, uncorrectable ECC, temperatures, failure time or a censor time |
| `provenance` | source, standard, facility, date, units |

XLSX and Markdown are accepted when they carry the same fields. A PDF rides along under an existing `record_id`. It does not become a record by itself. Files over 100 MB are rejected. Numbers stay in the CSV or JSON body.

The chip selector writes `chipIds` from the chip-identity rows the person checks. The case list's chip family comes from those rows.

**Out.** A tenth type, renaming metadata fields, sending holdout rows to Grok (that wire is Phase 6, and this phase's store already marks `split`).

**Parallel.** Mapping functions start from the guidelines as soon as Phase 0 has the type. The screen work lands on the Phase 2 Data region.

### Gates

**The path is the picture.** Ingest does not draw a globe. A trajectory record stores the OEM or the elements. It does not preview a private path format. **Not done if** upload invents a trajectory the file did not contain.

**The data is visible.** Each saved row shows its type, `value_status`, and `split`, and opens the body. **Not done if** an assumed value is displayed as a measurement.

**Edits are logged.** Replace appends a log entry naming the `record_id` and the type. **Not done if** a new upload silently overwrites a row.

**The exported file is the artifact.** Ingest never writes `optimizedOem`. **Not done if** a trajectory upload becomes the optimized algorithm without the evaluator.

**Grok reads. The evaluator keeps.** Holdout rows are stored and shown, and this phase does not put them in a collection. **Not done if** ingest calls xAI, or marks a file trained.

---

## Phase 5 — Physics service

**What is being built.** The flight MCP server that scores one reduced orbit by calling the package already in the repo. The testing page and the holdout lane call this same server. They do not reimplement dose, power, or thermal math.

**Owns.** `flight-mcp/` (Python, imports `starmind_physics`). Tools: `validate_oem`, `submit_oem`, `score_candidate`, with the schemas in [docs/grok-flight-mcp.md](grok-flight-mcp.md). `validate_oem` and `submit_oem` call the same profile as `lib/oem.ts`. Share one fixture file in the tests so the two validators cannot drift. `score_candidate` calls `starmind_physics.evaluate` and nothing else in that package's optimizer.

**Done.** `score_candidate` returns `lifetime_years`, `mean_power_kW`, `radiator_area_m2`, `shield_mass_kg`, `limiting_mode`, `breakdown`, and `value_status: "derived"`, plus the package's `assumptions_note`. Outside 500–2000 km, or with an inclination that is neither 30° (within 2°) nor sun-synchronous for that altitude, the tool returns `refused: true` and no lifetime. One of `chip_id` or `chip_preset` is required. `radiator_area_m2: null` asks the package to size the radiator. The tool does not accept epochs, position, or velocity, and it does not return a trajectory. `pytest` in `starmind-physics/` still passes (`pytest -m "not aep8"` when `aep8` is absent). A new test hits the refusal at 400 km.

**Out.** Rewriting `evaluate`, a Pareto search on the testing page, SAA grids in the UI, SHIELDOSE-2, and any claim that the number is a flown Starmind or Rubin lifetime.

**Parallel.** Starts as soon as the package is on `main`. It does not wait on the Next.js screens. Deploy the HTTPS streaming-HTTP or SSE URL as `FLIGHT_MCP_URL`. Until that URL is set, Grok omits the `mcp` tool entry rather than calling a dead server. The testing page then shows `Physics unavailable` instead of a made-up lifetime.

### Gates

**The path is the picture.** This service does not draw and does not propagate. **Not done if** a tool returns the next position or velocity.

**The data is visible.** The result carries `assumptions_note` and `value_status: "derived"`. Chip dose provenance from `ai_chips.yaml` is included when a `chip_id` was used. **Not done if** a lifetime is returned with no note, or an assumed chip limit is labeled measured.

**Edits are logged.** `submit_oem` holds a candidate for the current request. It does not mark the file optimized and it does not write the case log. **Not done if** the tool updates `optimizedOem`.

**The exported file is the artifact.** The tools accept and return OEM text or a score object. **Not done if** the server's stored candidate is a JSON ephemeris.

**Grok reads. The evaluator keeps.** `score_candidate` cannot see holdout outcomes. **Not done if** the physics server takes a `split` field or an outcome table.

---

## Phase 6 — Holdout

**What is being built.** The evaluator that decides whether a candidate OEM is kept. One function, so two lanes cannot invent two scores.

**Owns.** `lib/holdout.ts`, `lib/oem-reduce.ts`, and their tests.

**Reduction.** `reduceOem` reads states from a validated OEM and returns either a refusal or:

- `altitude_km` = mean |position| minus 6378.137 km, labeled derived.
- `inclination_deg` from the angular-momentum vector, labeled derived.
- Refuse when the position magnitude varies by 50 km or more across samples (not one LEO the ranker can score), when altitude is outside 500–2000 km, or when inclination is neither within 2° of 30° nor within 2° of sun-synchronous at that altitude.
- `ltan_hours` and `shield_mm_Al` come from the case's trajectory and placement records. If either record is missing, refuse. Do not fill 6.0 h or 5 mm.
- `chip_id` comes from the case's selected chip. If it is not in `ai_chips.yaml` and the record does not say `commercial` or `rad_hard`, refuse.

**Score.** For each holdout `outcome` row that has a failure time or a censor time, in years:

- Ask the physics service for `lifetime_years` on the reduced orbit. A refusal makes the case error infinite, and the revision is not kept.
- Failure: absolute error `|predicted - observed|`.
- Censored (the chip was still alive): error is 0 when the prediction is at least the censor time, otherwise `censor - predicted`.
- The case error is the mean of those row errors.

Keep the candidate only when that mean is finite and strictly lower than the stored `holdoutError`. The first finite score is kept, because there is no previous error. No holdout outcome rows: return `unscored`, and do not set `optimizedOem`.

**Done.** Tests cover: error drops and the revision is kept; error rises and it is rejected; no holdout rows and the result is unscored; a censored survivor predicted dead adds error; a 400 km file is refused and not kept; the working copy is untouched by this function.

**Out.** Calling Grok, drawing the path, showing the score as a loss curve.

**Parallel.** Fixture outcomes are enough. The live case screen calls this function in Phase 7's route, after Grok returns.

### Gates

**The path is the picture.** The scorer does not invent states. It reduces the OEM it was given. **Not done if** the score replaces the file's coordinates.

**The data is visible.** The score result names the outcome `record_id`s it used and the predicted lifetime it compared. **Not done if** the panel can show an error with no record behind it.

**Edits are logged.** The function returns kept or rejected and the error. The route writes the log. This library does not append the log itself, so a test can run it twice. **Not done if** a rejected revision still returns the candidate as the optimized text.

**The exported file is the artifact.** The input is OEM text. **Not done if** the scorer accepts a chat transcript as the trajectory.

**Grok reads. The evaluator keeps.** The library does not import the AI SDK. **Not done if** the model is asked whether the error is good enough.

---

## Phase 7 — Grok, retrieval, and MCP

**What is being built.** `POST /api/grok` on the case screen. Grok reads the case and proposes an OEM. The route then runs Phase 6.

**Owns.** `app/api/grok/route.ts`, `lib/brief-prompt.ts` is the wrong name and must not be created. The system text lives in `lib/grok-instructions.ts` and matches the seven instructions in [docs/grok-flight-mcp.md](grok-flight-mcp.md).

**What the route sends.** `POST https://api.x.ai/v1/responses` with `XAI_API_KEY` on the server. Model `grok-4.7`, or a later Grok 4-family model that supports remote MCP and `file_search`. Tools:

- `file_search` on this case's train collection only. `max_num_results` 20.
- `mcp` with `server_url` = `FLIGHT_MCP_URL`, `server_label` = `flight`, `allowed_tools` = `validate_oem`, `submit_oem`, `score_candidate`. Omit `mcp` when `FLIGHT_MCP_URL` is unset. Do not point it at a dead host. When it is unset, the route still validates and submits in-process with the same schemas.

The user message is the editor's request plus the working OEM if one exists. Train records may also be inlined in that message. Holdout records are in neither place. The collection metadata fields are the ones in the guidelines, marked as that document says (`record_id` unique, `record_type` and the chip fields injected into chunks).

**After the response, the route does this and the model does not:**

1. Take the last OEM that `submit_oem` accepted. If there is none, the revision fails and the log says so. An OEM that appears only in the chat is ignored.
2. Validate that text again with `lib/oem.ts`.
3. Score it with `lib/holdout.ts`.
4. Append the instruction, the candidate, the score, and kept or rejected to the log.
5. Replace `optimizedOem` only when the revision is kept. The working copy changes only when the person edits it.

**Done.** A fixture case with train rows and holdout rows produces a log entry of one of those two outcomes. A question that asks for a chip lifetime inside the OEM is rejected by validation if the model puts it in a `COMMENT` and the parser is asked to treat comments as data — the instructions forbid that, and a test fixture with thrust hidden in a comment does not gain a thrust field. The browser never receives `XAI_API_KEY`.

**Out.** A fine-tune call, a training screen, the globe.

**Hard dependency.** Phases 1, 3, 5, and 6. Accounts must already scope the case, so the route loads the document for the signed-in account and cannot be pointed at another account's id.

### Gates

**The path is the picture.** The activity region shows the proposed OEM as a file, under the chat. **Not done if** the only record of the revision is a paragraph.

**The data is visible.** The log stores the instructions sent and which collection was searched. **Not done if** the person cannot see what Grok was given.

**Edits are logged.** Kept and rejected are both log kinds. The optimized file changes only on kept. **Not done if** every grammatically valid OEM becomes the optimized file.

**The exported file is the artifact.** The candidate saved on a keep is the `submit_oem` text, after the second in-process validation. **Not done if** the route stores the model's prose as `optimizedOem`.

**Grok reads. The evaluator keeps.** The screen copy says Grok is reading the case, not training on it. There is no loss chart. **Not done if** the route calls a fine-tune endpoint, or the UI says the weights changed.

---

## Phase 8 — Testing page

**What is being built.** The globe that flies an OEM, the readings, the physics panel, and the vehicle-class estimate. Import of a live case is Phase 9. Until then the screen loads `fixtures/minimal.oem` and says `Showing a fixture`.

**Owns.** `app/test/page.tsx`, `components/Globe.tsx` (`ssr: false`), `components/OemReadout.tsx`, `components/PhysicsPanel.tsx`, `lib/fit.ts`, `lib/frame.ts` (GCRF to Earth-fixed, for drawing only).

**Cesium.** Copy `Workers`, `Assets`, `Widgets`, and `ThirdParty` into `public/cesium` at build time. Set `window.CESIUM_BASE_URL` to `/cesium` before the library loads. If `NEXT_PUBLIC_CESIUM_ION_TOKEN` is missing, use an ellipsoid and a static imagery layer so the path still draws. Resium is not required. Do not take a dependency on Cesium for Unreal or a self-hosted terrain pipeline.

**First, and required for this phase to be done:**

- The polyline from the OEM states, converted GCRF to Earth-fixed for display only. The file is not rewritten.
- A marker animated along that line by the OEM epochs, and a scrubber.
- At the scrubbed epoch: GCRF position (km) and velocity (km/s), and acceleration (km/s²) when the line has it.
- Beside those, labeled derived: geodetic latitude, longitude, and altitude (WGS84 after the rotation; the rotation uses Earth rotation angle and labels UT1 ≈ UTC), inertial speed, flight-path angle, and specific mechanical energy \(v^2/2 - \mu/r\) with \(\mu = 398600.4418\,\mathrm{km}^3/\mathrm{s}^2\).
- Launch specs from the first epoch: that epoch, and the derived geodetic latitude, longitude, and height. A pad name appears only when the person picks one. The coordinates come from the file.
- Do not interpolate across a `META_START` boundary. Inside a segment, interpolate linearly. Prefer the file's `INTERPOLATION` when it is present and valid.

**Then, still this phase, after those readouts work:**

- Physics panel. Call the Phase 5 service with `reduceOem` on the loaded file and the case's shield, LTAN, and chip. Show lifetime, mean power, radiator area, shield mass, and the limiting mode, each labeled estimated, with `assumptions_note` visible. A refusal shows the refusal sentence and no lifetime.
- Vehicle class. `lib/fit.ts` recommends Falcon 9, Falcon Heavy, or Starship by the order in the product spec: destination from the terminal state, mass only when the case states chip mass plus support mass, fairing only when the case states an envelope, then terminal specific energy as a check. Show the class, the published figure, the source URL from the spec, and the case value. Every figure on this panel is an estimate. If mass is missing, say so and do not rank on mass. Do not invent a price, an engine-out case, or a throttle history.

**Out.** A vehicle model, drawn force vectors, dynamic pressure, Mach, throttle, propellant, booster return, payload-door timing, and any control that asks Grok to fly the next state. Those wait until a physics function returns them, and they are not this MVP.

**Parallel.** The globe and `lib/fit.ts` start from `fixtures/minimal.oem` and a made-up terminal state as soon as Phase 1 can parse the fixture. The physics panel waits on Phase 5. Live import waits on Phase 9.

### Gates

**The path is the picture.** The globe and the line fill the screen. Specs sit beside the line and follow the scrubber. **Not done if** the page leads with the vehicle recommendation or a chat.

**The data is visible.** Each derived number says derived. Each physics number says estimated and shows the assumptions note. The fit panel shows the published number and the case value. **Not done if** a geodetic height is presented as a column that was in the file, or a lifetime is presented as a measurement.

**Edits are logged.** Scrubbing and playing do not write the case log and do not change the OEM. **Not done if** the testing page saves a new trajectory.

**The exported file is the artifact.** The polyline is the OEM. A fixture banner is visible when the fixture is loaded. **Not done if** the marker moves by calling Grok, or the page blends two cases.

**Grok reads. The evaluator keeps.** `/test` does not call `/api/grok`. **Not done if** the globe route can propose a new file.

---

## Phase 9 — Export and import

**What is being built.** The way a case leaves the editor and becomes the file on the globe, plus the downloadable record of the case.

**Owns.** The export actions on the case screen, `lib/export.ts`, and the import control on `/test`.

**Done.**

- `Export to testing` sends the working copy, or the optimized OEM when the working copy is empty. The testing page loads that text, drops the fixture banner, and shows whether the file is the working copy or the optimized file.
- `Download OEM` saves that same text as `CASE-<id>.oem`. A test checks the bytes match what the globe parsed.
- `Download case` saves one JSON bundle: the nine record types, the log, both OEM strings, and the last holdout score. A field `flight_artifact` names which OEM string was exported. The bundle says the chat is not the flight.
- The case log gains an `export` entry for each of these actions.
- Import is account-scoped. One account cannot import another's case id.
- A file that fails `lib/oem.ts` is not drawn. The testing page shows the validator's sentences.

The printable case view uses `data-theme="light"` because the design system reserves the light theme for exported reports. The app screens stay dark.

**Out.** A format other than OEM for the flight, a blend of cases, emailing the file, and a public unauthenticated import link.

**Hard dependency.** Phases 2, 3, and 8. Phase 7 must already be writing optimized files, or the export of an optimized file has nothing to send. The globe's fixture path from Phase 8 must keep working when import is empty.

### Gates

**The path is the picture.** After import, the line on the globe is the exported OEM, and the readout matches a scrub of that file. **Not done if** import shows a summary card and never the line.

**The data is visible.** The testing page names the case and whether the file is the working copy or the optimized OEM. The bundle contains the records. **Not done if** the download strips `value_status` or `split`.

**Edits are logged.** Each export appends a log entry. **Not done if** export is silent.

**The exported file is the artifact.** The globe and the downloaded `.oem` are the same text. **Not done if** the download is a JSON ephemeris, or the globe flies the chat.

**Grok reads. The evaluator keeps.** Export does not call the model and does not re-score. **Not done if** downloading triggers a new "optimized" file.

---

## MVP done when

One person who did not write the lane walks this on the deployed app:

1. Create an account and sign in. A second account cannot see the first account's cases.
2. Create a case and load `fixtures/orin-case/`. The nine types are grouped, holdout rows are visible, and each value shows `value_status`.
3. Ask Grok to propose a trajectory. The activity log shows the instruction, the candidate OEM, the holdout score, and kept or rejected. The screen does not say the model trained. If the case's holdout set is removed, the draft stays `unscored` and does not become the optimized file.
4. Edit the working copy by hand. The optimized file stays put, and the log records the edit.
5. Export to testing. The globe draws that file, the marker follows the epochs, and the readouts are the OEM state plus the derived quantities. Physics shows an estimate with the assumptions note, or a refusal with no lifetime. The vehicle panel names a class, a published figure, and the case value, and calls itself an estimate.
6. Download the `.oem`. It parses with `lib/oem.ts` and matches the line on the globe.
7. Block `/api/grok`. Steps 5 and 6 still work from the file already in the case.

## Not in any phase

- The retired four-promise navigator.
- Fine-tuning, or any control that implies Grok's weights changed.
- A flight format other than CCSDS OEM 3.0 keyword-value notation.
- Moving `3rok-design-system/` or `starmind-physics/`, or saving the physics package's JSON as the algorithm.
- Treating `starmind-optimize` or the SAA grid as the testing page.
- Dynamic pressure, Mach, throttle, propellant, booster return, payload-door timing, a 3D vehicle, and drawn force vectors.
- Teams, shared cases, prices, and a public case that is not signed in.
- Filling an H100, Rubin, or Starmind lifetime from Jetson Orin or Trillium rows. Those rows stay labeled as the chips they are.
