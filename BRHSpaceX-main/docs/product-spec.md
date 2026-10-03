# 3rok — product spec

The product name is **3rok**. Write it `3rok` in prose and `3ROK` in display type. This file is the current product definition. [docs/mvp-phase-plan.md](mvp-phase-plan.md) is the build order for this spec. The four-promise orbit navigator that used to be in that file is retired. Do not rebuild it, and do not bring back its rule that there is no optimal path.

The hackathon app is aimed at [https://3rok.vercel.app](https://3rok.vercel.app). [https://3rok1.vercel.app](https://3rok1.vercel.app) is a different project.

UI uses the design system already at `3rok-design-system/`. Leave that folder where it is. `starmind-physics/` stays where it is too. Neither folder is the flight artifact this spec defines.

## What 3rok does

3rok takes a large body of chip-testing data that follows [docs/universal-data-input-guidelines.md](universal-data-input-guidelines.md) and asks Grok to produce a flight algorithm for the rocket carrying the chips selected in that data. The goal of the algorithm is to prolong the lifespan of those chips. The algorithm is a deterministic trajectory file. The testing page flies that file on a globe and recommends a SpaceX vehicle class for the physical demands of the path.

## A case, not a project

The saved container is a **case**.

A case is one closed set of chip-test records, the log of what Grok and the editor did with them, and the single flight algorithm those records produced. "Project" already means this hackathon and this repository, and one person will keep many of these containers. Call the container a case in the interface, the routes, the schema, and the chat.

A case contains all of the following:

- All input data for that selection of chips, in the nine record types the guidelines name.
- The AI activity and the chat log, including the instructions sent to Grok and the revisions that came back.
- The optimized algorithm: the trajectory file from the latest Grok revision that the held-out check accepted.
- Editing. A person may edit the working copy by hand, or ask Grok to revise it. A hand edit does not overwrite the optimized file. A Grok revision replaces the optimized file only when the held-out check keeps it.
- Export of the working copy, or of the optimized file when there is no working copy, to the testing page.

The optimized algorithm is the one Grok produced from that case's data. It is not a blend of several cases, and it is not a path the testing page invents.

## How Grok "learns" this data

xAI's API offers retrieval (Collections, and the `file_search` / `collections_search` tools) and has no fine-tuning endpoint. Collections store files and serve search. The data is not used to train the model. Say this in the UI if anyone is tempted to draw a training run.

"Learn from this data" means Grok reads the case's records and proposes or revises a deterministic flight algorithm. Grok's weights do not change. Do not fake a training run, a loss curve, a checkpoint, or a fine-tune job. There is nothing to call.

A separate evaluator, not the model, decides whether a revision is kept. It scores the revised algorithm against outcome records the proposal did not use (`split = holdout` in the guidelines). Keep the revision only when that holdout error drops. Grok proposes. The evaluator disposes. If the case has no holdout outcomes, Grok may still draft a file, but the draft is marked unscored and does not become the optimized algorithm.

The nine record types, their required fields, and the collection metadata (`record_id`, `record_type`, `split`, and the rest) are specified only in [docs/universal-data-input-guidelines.md](universal-data-input-guidelines.md). Do not invent a tenth type or rename those fields. Numbers stay in CSV or JSON. A source PDF may ride along under the same `record_id`.

Retrieval is per case, so one chip's records do not bleed into another case. Putting the case's structured records directly in the request is also fine. Either way, Grok is reading.

## The flight file

The saved algorithm is a **CCSDS Orbit Ephemeris Message (OEM)** in keyword-value notation, version 3.0, as specified by [CCSDS 502.0-B-3, Orbit Data Messages, Blue Book, Issue 3, May 2023](https://ccsds.org/Pubs/502x0b3e1.pdf) (section 5, syntax in section 7). That is the international standard agencies and operators use to exchange a spacecraft trajectory. The file extension is `.oem`. Do not invent a JSON schema, a Python script, or a custom column for the artifact. Chat text is not the flight.

The reference frame for every 3rok OEM is **GCRF** (Geocentric Celestial Reference Frame), Earth-centered. `CENTER_NAME = EARTH`. `TIME_SYSTEM = UTC`. GCRF is on the standard's approved `REF_FRAME` list, and its definition is intrinsic, so `REF_FRAME_EPOCH` is omitted. The globe converts each state from GCRF to Earth-fixed coordinates for drawing. Earth-fixed display is a view, not a second file.

Units are fixed by the standard and are not printed on the data lines (section 7.7.2): position in km, velocity in km/s, and optional acceleration in km/s².

A minimal valid 3rok OEM has the mandatory header and one metadata block, then at least two ephemeris lines so the path has a start and an end. `START_TIME` is the first epoch. `STOP_TIME` is the last. `OBJECT_ID` is `UNKNOWN` until the case has a real international designator.

```text
CCSDS_OEM_VERS = 3.0
CREATION_DATE = 2026-10-03T18:00:00
ORIGINATOR = 3ROK
META_START
OBJECT_NAME = CASE-CHIPSET
OBJECT_ID = UNKNOWN
CENTER_NAME = EARTH
REF_FRAME = GCRF
TIME_SYSTEM = UTC
START_TIME = 2026-10-03T18:05:00.000
STOP_TIME = 2026-10-03T18:20:00.000
META_STOP
2026-10-03T18:05:00.000  -1045.0  -5512.0  3298.0  -1.20  3.40  6.10
2026-10-03T18:20:00.000  -2120.0  -2440.0  6205.0  -3.10  6.55  2.40
```

The numbers above are only a shape example, not a flyable Starship trajectory. A real file uses the states Grok produced and the evaluator kept.

Rules the writer and the parser both enforce:

- Header keywords, in order: `CCSDS_OEM_VERS`, optional `COMMENT`, optional `CLASSIFICATION`, `CREATION_DATE`, `ORIGINATOR`, optional `MESSAGE_ID`. `CREATION_DATE` is UTC.
- Metadata is wrapped in `META_START` and `META_STOP`. Required keywords, in the standard's order: `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `TIME_SYSTEM`, `START_TIME`, `STOP_TIME`.
- Each ephemeris line is one epoch and six numbers: `X Y Z X_DOT Y_DOT Z_DOT`. Three more numbers, `X_DDOT Y_DDOT Z_DDOT`, are optional and are the inertial acceleration in km/s². If any line includes acceleration, every line in that block does.
- `ORIGINATOR = 3ROK` is what this app writes. 3ROK is not a SANA-registered agency abbreviation. Do not borrow `NASA/JPL` or another agency's name to silence a strict registry check.
- If `INTERPOLATION` is present, `INTERPOLATION_DEGREE` is required. Prefer `LINEAR` and degree `1` unless the writer has a reason to name Hermite or Lagrange. Absent those keywords, the testing page interpolates linearly between samples.
- A later `META_START` block starts a new ephemeris segment. Do not interpolate across that boundary. The standard uses this for a burn or any other discontinuity. `TIME_SYSTEM` stays `UTC` for the whole file. `REF_FRAME` stays `GCRF`.
- `COMMENT` lines may record which case and which revision produced the file. Comments are not flight data. Do not hide thrust, mass, or a pitch program there and then parse it back out.

OEM has position, velocity, and optional acceleration. It does not have a thrust column, and force in newtons is not an OEM field. The Orbit Comprehensive Message in the same Blue Book can carry maneuver thrust, but a minimal OCM is not required to contain a trajectory at all. 3rok's artifact has to be the path, so the file is an OEM.

The algorithm is deterministic. Same file in, same path out. The testing page samples the OEM. It does not ask Grok for the next state.

## Testing page

Algorithms arrive by import from the cases page. The testing page does not start from a blank upload.

The globe is **CesiumJS**, in a client-only Next.js component, which already ships on Vercel. Copy Cesium's `Workers`, `Assets`, `Widgets`, and `ThirdParty` into `public/cesium` at build time, set `window.CESIUM_BASE_URL` to `/cesium` before the library loads, and load the component with `ssr: false`. A Cesium ion access token (`NEXT_PUBLIC_CESIUM_ION_TOKEN`) is a browser imagery token, not a secret. If the token is missing, use an ellipsoid terrain and a static imagery layer so the path still draws. Do not depend on Cesium for Unreal, a self-hosted terrain pipeline, or a Webpack copy plugin. Resium is optional and not required.

First, before any other testing-page work:

- The flight-path line on the globe, from the OEM states, converted GCRF to Earth-fixed for display.
- Animation of a marker along that line, driven by the OEM epochs.
- Industry-standard position and the physics that can be read from the file. At the scrubbed epoch, show GCRF position (km) and velocity (km/s), and acceleration (km/s²) when the line includes it. Next to those, show derived geodetic altitude, inertial speed, flight-path angle, and specific mechanical energy, each labeled as derived from the OEM. Force in newtons is shown only when the case states a vehicle mass and the OEM includes acceleration, as mass times acceleration, and it is labeled an estimate. Do not display a thrust the file does not contain.

Launch specs and position specs sit beside the globe, not instead of it. Launch specs are the first epoch, the derived geodetic latitude, longitude, and height of the first state, and a pad name only when the user picks one. Position specs are the live state described above. Named pads are labels. The coordinates come from the OEM.

Later, after the line, the animation, and those readouts work:

- A vehicle model on the path.
- Drawn force or acceleration vectors in the scene.
- Dynamic pressure, Mach, throttle, propellant, booster return, and payload-door timing. Those are not in an OEM. They appear only when a separate physics model produces them, and they stay labeled as estimates.
- Anything that asks Grok to fly the vehicle.

## Rocket recommendation

The testing page recommends a SpaceX vehicle class by how well it fits the physical demands of the algorithm: payload mass, energy of the terminal state, fairing envelope, and destination. The classes are the public ones: Falcon 9, Falcon Heavy, and Starship. Every figure on this panel is an **estimate**. A published class number is not a mission quote, and the OEM is not a performance guarantee.

Use these published class figures, and cite them as published:

| Class | Published figure | Source |
|---|---|---|
| Falcon 9 | 22,800 kg to LEO. Standard fairing 5.2 m outer diameter, 13.2 m overall height. | [Falcon 9](https://www.spacex.com/vehicles/falcon-9/), [Falcon User's Guide, 9 May 2025](https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf) |
| Falcon Heavy | 63,800 kg to LEO. Same 5.2 m fairing. | [Falcon Heavy](https://www.spacex.com/vehicles/falcon-heavy/) |
| Starship | Initial public user's guide: over 100 t to LEO on a single launch with full reuse (reference up to 500 km circular, up to 98.9° inclination); 9 m outer-diameter fairing; 8 m payload dynamic envelope; extended volume up to 22 m height. | Starship Users Guide, initial release |

Fit, in order:

1. Destination, from the terminal OEM state: a low-Earth orbit, a transfer that still needs large apogee-raising energy, or an escape. Match the class whose published table includes that kind of destination.
2. Mass, from the case, when the case states the selected chips' mass plus support mass. If mass is missing, say so and do not rank on mass.
3. Fairing, when the case states a payload envelope. Falcon's published fairing is 5.2 m; Starship's published dynamic envelope is 8 m inside a 9 m fairing.
4. Energy of the terminal state, as a check that the destination bin is honest.

The panel shows the class, the published number it was compared with, and the case value it was compared against. It does not invent engine-out capability, a throttle history, or a price.

## Product philosophy

These four sentences are the UI rules.

- The path is the picture. The testing page is the globe and the line. Specs are readings of that line.
- The data is visible. The nine record types stay in the case and open beside the algorithm. A number on the path can be traced to a record, or it is labeled derived or estimated.
- Edits are logged. A hand edit and a Grok revision are both entries in the case log. A revision becomes the optimized algorithm only when the holdout error drops.
- The exported file is the artifact. What leaves the case and what the testing page flies is the `.oem` file. The chat is not the flight.

There is an optimized path: the OEM in the case, produced so the selected chips last longer, and kept only when the held-out check says it is better.

## Screens

Three screens. The design system stays at `3rok-design-system/`. Copy its rule file to the app's `.cursor/rules/` and import `tokens.css` and `components/bundle.css` once. Dark theme. Barlow for words, IBM Plex Mono for every measured value. One solid button on a screen; the rest are ghost or quiet. The wordmark is `3ROK`.

**Cases** (`/cases`). The list of saved cases. Each row shows the name, the selected chip family, whether an optimized OEM exists, whether that OEM is scored, and the time of the last log entry. Creating a case starts an empty container. Opening one goes to the case screen.

**Case** (`/cases/[id]`). One container, four regions.

- Data. The input records, grouped by the nine types. Upload, replace, and inspect. Show `value_status` and `split`. Do not hide holdout rows from the person; do withhold them from the proposal prompt.
- Activity. The chat and the activity log: instructions, Grok's proposed file, the holdout score, and whether the revision was kept.
- Algorithm. The optimized OEM, read-only, and the working copy, editable as text. Actions: edit by hand, ask Grok to revise, and export to testing. The optimized file changes only when a revision is kept.
- Score. The last holdout error, or the word unscored.

**Testing** (`/test`). Import chooses a case and loads its exported OEM. Then the globe, the line, the animation, the launch and position specs, and the rocket recommendation. A fixture OEM may be used until import is wired, and the screen must say when it is showing a fixture.

## What can be built in parallel

Share one contract, `lib/case.ts`: the case id, the selected chip ids, the record list (type, `record_id`, `split`, raw text or object), the chat and activity log, the optimized OEM text, the working-copy text, and the last holdout score. After that file is on `main`, change a field only in a commit that updates every lane that reads it.

Persistence for the hackathon is one case document in the browser (IndexedDB). The Grok route does not own storage. `XAI_API_KEY` stays on the server.

| Lane | Owns | May build against | May not |
|---|---|---|---|
| Cases | `/cases`, `/cases/[id]`, the case document | The contract and fixture records | Cesium, the Grok HTTP call |
| Ingest | Mapping an upload onto the nine record types | The guidelines file | A new schema, the globe |
| Grok | `app/api/grok/route.ts`: read train records, ask for an OEM revision, append the log | A fixture case | A fine-tune call, a fake training UI, the globe |
| OEM | `lib/oem.ts` and its tests: parse, validate, serialize version 3.0 KVN | The minimal file in this spec | React, Cesium |
| Holdout | `lib/holdout.ts`: score a candidate OEM against holdout outcomes; keep it only when the error drops | Fixture outcomes | Calling Grok, drawing the path |
| Globe | `/test`, client-only CesiumJS, line, animation, position readout | A fixture `.oem` | Grok, record ingestion |
| Fit | `lib/fit.ts`: the vehicle-class estimate | A terminal state plus optional mass and envelope | Animation, unpublished vehicle numbers |

Cases, OEM, Globe, and Fit do not depend on each other once the contract and a fixture OEM exist. Ingest feeds Cases. Grok needs OEM validation and the holdout gate before a revision can be marked optimized. Globe and Fit can ship on fixtures. Wire import last: the cases screen exports, and the testing screen reads that same OEM text.

## Out of scope

- Rebuilding the retired four-promise orbit navigator.
- Training, fine-tuning, or any UI that implies Grok's weights changed.
- A flight-file format other than CCSDS OEM 3.0 KVN.
- Moving `3rok-design-system/` or treating `starmind-physics/` as the saved algorithm.
