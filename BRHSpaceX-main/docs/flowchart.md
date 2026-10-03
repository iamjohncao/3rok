# 3rok — Platform flowchart

3rok takes chip-test data, asks Grok for a flight that keeps those chips alive longer, and flies that path on a globe. The saved container is a case. The flight artifact is a CCSDS OEM file. Grok proposes. A separate evaluator disposes.

This follows [product-spec.md](./product-spec.md). The record types are in [universal-data-input-guidelines.md](./universal-data-input-guidelines.md). The file format is in [flight-algorithm-oem.md](./flight-algorithm-oem.md).

## Case loop

```mermaid
flowchart TD
  open(["Open 3rok"]) --> list["Cases: name, chip family, scored OEM, last log"]
  list --> make["Create a case"]
  make --> upload["Upload the nine record types"]
  upload --> hold{"Holdout outcomes in the case?"}

  hold -->|Yes| read["Grok reads the train records"]
  hold -->|No| unscored["Grok may draft an OEM marked unscored"]

  read --> propose["Grok proposes a CCSDS OEM 3.0 file"]
  propose --> parse{"lib/oem accepts the file?"}
  parse -->|No| propose
  parse -->|Yes| score["Evaluator scores the holdout error"]
  score --> better{"Error dropped?"}
  better -->|Yes| kept["This file becomes the optimized OEM"]
  better -->|No| stay["The previous optimized file stays"]

  kept --> work["Working copy"]
  stay --> work
  unscored --> work

  work --> change{"Next edit"}
  change -->|Edit by hand| hand["Working copy changes. Optimized file stays"]
  change -->|Ask Grok to revise| read
  hand --> work

  work --> export["Export the working copy, or the optimized file if there is no working copy"]
  kept --> export
  export --> test["Testing page imports that OEM"]
  test --> globe["Globe draws the path and animates the marker"]
  globe --> specs["Readouts: GCRF state, plus derived altitude, speed, angle, energy"]
  specs --> fit["Estimate a vehicle class: Falcon 9, Falcon Heavy, or Starship"]
```

Hand edits and Grok revisions are both log entries. A revision replaces the optimized file only when the holdout error drops. The testing page samples the OEM. It does not ask Grok for the next state.

## Runtime

Cases live in the browser. The Grok route does not own storage. `XAI_API_KEY` stays on the server. Retrieval is per case, so one chip's records do not bleed into another case.

```mermaid
flowchart LR
  subgraph browser ["Browser"]
    casesUi["/cases and /cases/id"]
    testUi["/test Cesium globe"]
    store[("IndexedDB case")]
  end

  subgraph server ["Next.js"]
    grokApi["/api/grok"]
    oem["lib/oem"]
    holdout["lib/holdout"]
    fitlib["lib/fit"]
  end

  xai["Grok, reading the case"]

  casesUi --> store
  casesUi --> grokApi
  grokApi --> xai
  grokApi --> oem
  grokApi --> holdout
  casesUi -->|export the OEM text| testUi
  testUi --> oem
  testUi --> fitlib
```

## Evaluator gate

Grok's weights do not change. There is no training run. Holdout rows stay visible to the person and out of the proposal prompt.

```mermaid
flowchart TD
  train["Train records, plus the current OEM"] --> grok["Grok returns a revised OEM"]
  grok --> valid{"Header, metadata, and ephemeris lines are valid KVN?"}
  valid -->|No| grok
  valid -->|Yes| score["Score against holdout outcomes"]
  score --> drop{"Holdout error dropped?"}
  drop -->|Yes| opt["Keep the revision as the optimized algorithm"]
  drop -->|No| prev["Discard the revision"]
  none["No holdout outcomes"] --> mark["Draft stays unscored and is not optimized"]
```

## Where the flow lives

| Step | Code | Notes |
|---|---|---|
| Case list and case screen | `/cases`, `/cases/[id]` | Data, activity, algorithm, score |
| Record ingest | Upload mapped to the nine types | Guidelines file is the schema |
| Proposal | `app/api/grok/route.ts` | Reads train records, appends the log |
| Flight file | `lib/oem.ts` | CCSDS OEM 3.0 keyword-value, frame GCRF |
| Keep or discard | `lib/holdout.ts` | Keep only when holdout error drops |
| Globe | `/test` | Client-only CesiumJS, `ssr: false` |
| Vehicle class | `lib/fit.ts` | Published class figures, labeled an estimate |
| Case document | `lib/case.ts` | One contract for every lane |
