# Handoff: bringing 3rok's globes and page structure into `aipstotra-ui/BRHSpaceX`

This brief is for whoever (a Claude Code session, or a person) does the port. It describes what to take from `iamjohncao/3rok` and what to build new. **Nothing in it was checked against the target repo**: when this was written the target could not be read, so every statement about it below is a question, not a fact.

## The ask

1. The **particle globe** and the **3D-to-2D fold** (both globes fold flat into a map).
2. The **page structure**: creating and editing a case is a different page from the testing page, with a clear way between them.
3. **Progressive disclosure for data inputs**: detail and data stay hidden until expanded.
4. A **hero / landing page**.
5. The app is named **3rok**, and the **3rok logo is a link that goes to the landing page**.
6. The **same design system**. No new colours, fonts or tokens.

Work on a branch of the target repo and open a pull request for its owner. Do not push to its `main`.

## 1. The globes (the easy part: the renderer is almost standalone)

Source: `iamjohncao/3rok`, `lib/globe/` and `components/globe/FlightGlobe.tsx`. WebGL2 only. No library.

| File | What it does | Outside imports to cut or satisfy |
|---|---|---|
| `lib/globe/renderer.ts` | The scene: realistic and particle looks, the fold, wide and chase cameras, path, marker, heat | none beyond the files below |
| `lib/globe/shaders.ts` | GLSL. `foldPoint()` must stay the same arithmetic as `projection.ts` | none |
| `lib/globe/camera.ts` | Wide and chase rigs, the 3D-to-2D blend, keeps the satellite centred | `Vec3`, `lib/engine/vec.ts` |
| `lib/globe/mat4.ts` | Matrices | `Vec3`, `lib/engine/vec.ts` |
| `lib/globe/projection.ts` | lon/lat/alt to a sphere point, a map point, or a point between | `Vec3`, one constant: `EARTH_EQUATORIAL_RADIUS_KM = 6378.137` |
| `lib/globe/particles.ts` | 40,000 Fibonacci dots, a fold delay each, the land mask | none |
| `lib/globe/path-geometry.ts` | The path as line instances, cut at the date line; the graticule | `RADIUS_KM` from `projection.ts` |
| `lib/globe/heat.ts`, `tokens.ts`, `earth-image.ts` | Heat colours, design tokens read from CSS, the Earth image loader | none |
| `public/earth/natural-earth-ii.jpg` (+ `README.txt`) | 2048x1024 equirectangular Earth. Public domain | none |
| `components/globe/FlightGlobe.tsx` | The React wrapper and the three switches | the flight engine (see below) |
| `app/app.css` | `.globe`, `.globe__canvas`, `.globe-controls`, `.seg`, `.heat-legend` | design tokens only |

To port the particle globe and the fold, copy those files, copy `lib/engine/vec.ts`, define `Vec3 = [number, number, number]`, and add the one constant. The renderer reads its colours from the page's CSS custom properties (`--surface-100`, `--ink`, `--ink-muted`, `--ink-subtle`, `--line-strong`, `--accent`, `--thermal-3` to `--thermal-5`), so the same design system works untouched.

**What the renderer needs from its host:**

```ts
const renderer = new GlobeRenderer(canvas, readGlobeTokens());
renderer.setEarth(await loadEarthImage());          // texture and land mask
renderer.setPath(pathInstances([[{ t, lon, lat, altKm }, ...]])); // radians, km, t in seconds from the start
renderer.setSatellite({ lon, lat, altKm, headEast, headNorth }); // or null
renderer.setNow(secondsFromStart);                   // the bright part of the path
renderer.setStyle("realistic" | "particles");
renderer.setShape("globe" | "map");                  // animated fold
renderer.setFollow("wide" | "chase");                // animated
```

`FlightGlobe.tsx` gets its path and satellite from a flight engine (`lib/engine/`, `lib/globe/satellite.ts`). **The target may not have an engine.** If it has its own ephemeris or sample data, feed `setPath` and `setSatellite` from that and drop the engine import. If it has no trajectory at all, the globe can still run with an empty path and no satellite, which makes a good landing-page backdrop.

Skip `flux-grid.ts`, `public/flux/` and the heat layer unless the target has chip data. They need the physics package's radiation grid.

**Acceptance.** Port `lib/globe/globe.test.ts` with it. It checks the fold endpoints, that chase view keeps the satellite exactly at screen centre at every point of the fold, that the whole sphere and map fit in wide view, the particle set, and the date-line cut. It was also driven in a real browser (software WebGL): the marker reads exactly `0.0000,0.0000` in chase view in all four combinations of look and shape.

## 2. Page structure

How 3rok separates the work:

| Route | Job |
|---|---|
| `/` | Landing (new, section 4) |
| `/cases` | The list of cases and `Create case` |
| `/cases/[id]` | One case: **Data**, **Activity**, **Algorithm**, **Score** |
| `/test` | The testing page: the globe, with the readouts beside it |

The bridge: on a case, **Export to testing** logs the export and opens `/test?case=<id>`. On `/test`, **Import case** lists the signed-in account's cases and opens one. With no case in the address, `/test` flies a fixture and says so. Create and edit live in one place; flying and reading live in another.

Files to read for the pattern: `components/ui/AppNav.tsx`, `app/layout.tsx`, `app/cases/`, `app/test/page.tsx`, `components/CaseList.tsx`, `components/CaseScreen.tsx`, `components/TestScreen.tsx`, `components/CaseFlight.tsx`, `components/ImportCase.tsx`.

The design system allows `Tabs`. Decide with the target's owner whether the top level is a nav bar of pages (as 3rok has) or tabs on one page. Pages are the better default: each has its own address, so a person can link to the testing page.

**Nav.** Items: Cases, Testing, Account. One solid button per screen.

## 3. Progressive disclosure for data inputs (new work)

3rok already has a little of this: each record is a `<details>` row, the upload previews before it saves, and the log collapses long text. It does not yet go far. The goal here:

- **Summary first.** A group of records shows its name, a count, and the `value_status` and `split` counts. Nothing else until opened.
- **Expand to detail.** One record opens to its fields. A record's long `body` opens a second level.
- **Advanced fields hide.** On an input form, the required fields show. Optional and advanced ones sit under `More fields`.
- **Never hide what honesty needs.** `value_status` and `split` stay visible on every row, even collapsed. A holdout row is visible to the person. A derived or assumed figure keeps its word.
- Native `<details>`/`<summary>` is enough, and it is keyboard-accessible. Use design tokens only.

Source to read: `components/case/DataRegion.tsx`, `DataUpload.tsx`, `ActivityRegion.tsx`, `lib/ingest.ts` (what a record needs), and `docs/universal-data-input-guidelines.md`.

## 4. Landing page (new work)

The design system **does ship a Hero** (`.rok-hero`, `.rok-hero__grid`, `__body`, `__eyebrow`, `__title`, `__text`, `__actions` in `3rok-design-system/components/bundle.css`; the props are in `components/index.d.ts`). 3rok itself avoids it, because its plan says the home screen is not a marketing page. The target wants one, so use the design system's own.

Suggested content, in the product's own words:

- Eyebrow `3ROK`. Title: what it does, in one line, for example *Chip-test data in. A flight file out. Flown on a globe.*
- One sentence of plain explanation: you give 3rok a chip's test data, it proposes a CCSDS OEM trajectory and keeps it only if it scores better on outcomes it hasn't seen.
- **One solid button**: `Create a case` to `/cases`. One ghost button: `Open the testing page` to `/test`.
- The **particle globe as the backdrop**, with `setShape` wired to a scroll or a small control so it folds to a map. Reduce the dot count or draw a still image when `prefers-reduced-motion` is set.
- A short **how it works** in three steps (Data, Algorithm, Test), each expandable (section 3).
- Honest labels. Do not claim a Rubin or Starmind lifetime. Do not show a loss curve, a training run, or the word "trained". The platform proposes and an evaluator keeps. Estimates say estimated.

## 5. Name and logo

The nav mark reads `3ROK` and is a link to `/`, the landing page. In 3rok today it links to `/cases`, so this is a change: `components/ui/AppNav.tsx`, the `Link` with class `rok-nav__mark`. Set the page `<title>` and the site name to `3rok`.

## Rules carried over from 3rok (check them against the target)

- Design tokens only: no hex, `rgb()` or `hsl()` in app code. One `solid` button per screen. Barlow for words, IBM Plex Mono for measured values. Dark theme.
- Do not edit the design system folder. Do not load `bundle.js`; port the small components.
- Never call the saved container a "project": 3rok calls it a **case**.
- No third-party globe library.
- The flight file is a CCSDS OEM 3.0 KVN file, never JSON or CSV.

## Licence

`iamjohncao/3rok`'s `LICENSE` is MIT, copyright holder `aipstotra-ui`. If that account owns the target, the design system came from there; check it is not duplicated. MIT permits reuse with the notice kept.

## Questions to answer from the target repo before building

1. The stack: Next.js (which router) or plain React, and its styling approach?
2. Where does the design system live, and is it the same tokens and `bundle.css`?
3. What routes and pages exist? Is there already a case, a list, a testing view?
4. Does it have an ephemeris or trajectory data the globe can draw?
5. How is it deployed, and what is its branch and pull-request convention?
6. Does the owner want the change as one pull request or several?
