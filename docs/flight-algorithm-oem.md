# Flight algorithm

The optimized algorithm in a case is a **CCSDS Orbit Ephemeris Message (OEM), version 3.0, keyword-value notation**. That file is the rocket trajectory. The testing page (`/test`) imports it from the case and flies it. Chat text is not the flight.

This is the profile in [the current product spec](https://github.com/aipstotra-ui/BRHSpaceX/blob/main/docs/product-spec.md). The standard is [CCSDS 502.0-B-3, Orbit Data Messages, Blue Book, Issue 3, May 2023](https://ccsds.org/Pubs/502x0b3e1.pdf), section 5, syntax in section 7. Agencies and operators already exchange spacecraft trajectories in this file. 3rok does not invent a JSON schema, a Python script, or a custom column for the artifact.

Grok writes or revises the file. Grok's weights do not change: xAI has retrieval and no fine-tuning endpoint. A separate evaluator keeps a revision only when the holdout error drops. The rules for the nine input record types stay in the universal data guidelines. This document is only the trajectory file those records produce.

## What the testing page can load

Any OEM that passes the profile below can be flown, whoever wrote it. The page samples the file. It does not ask Grok for the next state. A file that fails validation never reaches the globe.

The 3rok profile is stricter than the Blue Book, so every accepted file is tested the same way:

| Keyword | Required value |
|---|---|
| `CCSDS_OEM_VERS` | `3.0` |
| `CREATION_DATE` | UTC timestamp |
| `ORIGINATOR` | `3ROK` when this app writes the file. 3ROK is not a SANA agency code. Do not borrow another agency's name. |
| `CENTER_NAME` | `EARTH` |
| `REF_FRAME` | `GCRF` |
| `TIME_SYSTEM` | `UTC` |
| `REF_FRAME_EPOCH` | omitted. GCRF does not use one. |
| `START_TIME` | epoch of the first state in that segment |
| `STOP_TIME` | epoch of the last state in that segment |
| Ephemeris | at least two state lines in the file |

`OBJECT_ID` is `UNKNOWN` until the case has a real international designator. `OBJECT_NAME` names the case.

Header order follows the standard: `CCSDS_OEM_VERS`, optional `COMMENT`, optional `CLASSIFICATION`, `CREATION_DATE`, `ORIGINATOR`, optional `MESSAGE_ID`. Metadata sits between `META_START` and `META_STOP`, with the required keywords in the standard's order: `OBJECT_NAME`, `OBJECT_ID`, `CENTER_NAME`, `REF_FRAME`, `TIME_SYSTEM`, `START_TIME`, `STOP_TIME`.

Units are fixed by the standard and are not printed on the data lines: position in km, velocity in km/s, optional acceleration in km/s².

## Minimal file

The numbers below show the shape only. They are not a flyable Starship trajectory. A real file uses the states Grok produced and the evaluator kept.

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

Each ephemeris line is one epoch and six numbers:

```text
EPOCH  X  Y  Z  X_DOT  Y_DOT  Z_DOT
```

Three more numbers, `X_DDOT Y_DDOT Z_DDOT`, are optional inertial acceleration in km/s². If any line in a segment includes acceleration, every line in that segment does.

A later `META_START` begins a new segment. The standard uses that for a burn or any other discontinuity. The testing page does not interpolate across the boundary. `TIME_SYSTEM` stays `UTC` and `REF_FRAME` stays `GCRF` for the whole file.

`COMMENT` lines may name the case and the revision. They are not flight data. Do not hide thrust, mass, or a pitch program in a comment and parse it back out.

If `INTERPOLATION` is present, `INTERPOLATION_DEGREE` is required. Prefer `LINEAR` and degree `1`. If those keywords are absent, the testing page still interpolates linearly between samples inside one segment. Epochs inside a segment increase strictly.

OEM has no thrust column. Force in newtons is not an OEM field. The Orbit Comprehensive Message in the same Blue Book can carry maneuver thrust, and a minimal OCM is not required to contain a trajectory. The artifact has to be the path, so the file stays an OEM.

## How the testing page maps the file

The globe is CesiumJS. It draws an Earth-fixed view. The file stays GCRF. Earth-fixed coordinates are a view, not a second file.

At the scrubbed epoch the page shows the state, then the readings derived from it. Derived readings are labeled derived. They are not extra columns in the file.

| On the OEM line | On the testing page |
|---|---|
| Epoch | Animation clock and the scrubber. |
| `X Y Z` (km, GCRF) | Position readout, in km, still in GCRF. The polyline uses the same vector after a GCRF-to-Earth-fixed rotation used only for drawing. |
| `X_DOT Y_DOT Z_DOT` (km/s, GCRF) | Velocity readout, in km/s. |
| `X_DDOT Y_DDOT Z_DDOT` (km/s²), when present | Acceleration readout, in km/s². |
| First epoch | Launch specs: epoch, and the derived geodetic latitude, longitude, and height of that state. A pad name appears only when the user picks one. The coordinates come from the file. |

Derived readings, each labeled as derived from the OEM:

- Geodetic altitude, latitude, and longitude. Rotate the GCRF state to Earth-fixed for the view, then convert with WGS84. The rotation uses Earth rotation angle from the UTC epoch and labels the approximation UT1 ≈ UTC.
- Inertial speed, the magnitude of the velocity, in km/s.
- Flight-path angle, the angle between the velocity and the local horizontal: the complement of the angle between position and velocity.
- Specific mechanical energy, \(v^2/2 - \mu/r\), with \(\mu = 398600.4418\,\mathrm{km}^3/\mathrm{s}^2\) (WGS84) and \(r\) the magnitude of the GCRF position. Report it in km²/s².

Force in newtons is shown only when the case states a vehicle mass and the OEM includes acceleration, as mass times acceleration, and it is labeled an estimate. The page does not display a thrust the file does not contain.

Dynamic pressure, Mach, throttle, propellant, booster return, and payload-door timing are not in an OEM. They wait until a separate physics model produces them, and they stay labeled as estimates. That model is not allowed to invent the next state. The line on the globe comes from the file.

## What "optimized" means

The optimized algorithm is the OEM from the latest Grok revision that the held-out check accepted. A hand edit changes the working copy and does not overwrite that file. A Grok revision replaces it only when the holdout error drops. If the case has no holdout outcomes, a draft may exist, marked unscored, and it does not become the optimized algorithm.

The testing page imports the working copy, or the optimized file when there is no working copy. It does not invent a path, and it does not blend cases.

The same file in produces the same path out. That is the universal test: parse, sample, draw. Grok is not in the loop.
