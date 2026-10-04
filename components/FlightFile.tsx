"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FLIGHT_SOURCE_LABELS, type FlightSource } from "../lib/export";
import { FlightEngine, meanAltitudeKm } from "../lib/engine/flight";
import { formatIssue, parseOem, type Oem } from "../lib/oem";
import { EnginePanel } from "./EnginePanel";
import { HeatPanel } from "./HeatPanel";
import { useHeatLayer, type HeatSource } from "./useHeatLayer";
import { FitPanel } from "./FitPanel";
import { FlightGlobe } from "./globe/FlightGlobe";
import { ImportCase } from "./ImportCase";
import { LaunchSpecs } from "./LaunchSpecs";
import { OemReadout } from "./OemReadout";
import { PhysicsPanel } from "./PhysicsPanel";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import { epochText } from "./ui/Readout";

const SPEEDS = [1, 10, 60, 300] as const;
const FIXTURE_NAME = "fixtures/minimal.oem";

/** Where the file on the globe came from. A case names itself and says which OEM string it is. */
export type FlightOrigin =
  | { kind: "fixture" }
  | {
      kind: "case";
      caseId: string;
      caseName: string;
      source: FlightSource;
      holdoutError: number | null;
      /** The case's shield for the placement layer, or the sentence that says why it has none. */
      heat: HeatSource;
    };

function FixtureBanner() {
  return (
    <p className="fixture-banner body-sm" role="status">
      <span className="eyebrow">Showing a fixture</span> {FIXTURE_NAME}. Its numbers show the file shape only.
      This is not a flyable trajectory.
    </p>
  );
}

function CaseBanner({ origin }: { origin: Extract<FlightOrigin, { kind: "case" }> }) {
  const scored =
    origin.source === "workingOem"
      ? "A working copy is never scored."
      : origin.holdoutError === null
        ? "This case is unscored."
        : `Last holdout error ${origin.holdoutError.toFixed(3)} years.`;
  return (
    <p className="case-banner body-sm" role="status">
      <span className="eyebrow">Case</span>
      <Link href={`/cases/${origin.caseId}`}>{origin.caseName}</Link>{" "}
      <span className="tag data-sm">{FLIGHT_SOURCE_LABELS[origin.source]}</span> {scored}
    </p>
  );
}

function OriginBanner({ origin }: { origin: FlightOrigin }) {
  return origin.kind === "fixture" ? <FixtureBanner /> : <CaseBanner origin={origin} />;
}

// The OEM that passed lib/oem.ts, drawn and read at the scrubbed epoch. Scrubbing and
// playing change nothing in the file and write nothing to any case.
function FlightView({ oem, origin }: { oem: Oem; origin: FlightOrigin }) {
  const engine = useMemo(() => new FlightEngine(oem), [oem]);
  const { start, stop } = useMemo(() => engine.bounds(), [engine]);
  const [time, setTime] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(60);
  const timeRef = useRef(start);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(timeRef.current + ((now - last) / 1000) * speed, stop);
      last = now;
      timeRef.current = next;
      setTime(next);
      if (next >= stop) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, stop]);

  function scrubTo(next: number) {
    timeRef.current = next;
    setTime(next);
  }

  function togglePlay() {
    if (!playing && timeRef.current >= stop) scrubTo(start);
    setPlaying((value) => !value);
  }

  const sample = useMemo(() => engine.sample(time), [engine, time]);
  const report = useMemo(() => engine.report(), [engine]);
  const altitudeKm = useMemo(() => meanAltitudeKm(oem), [oem]);
  const heat = useHeatLayer(altitudeKm, origin.kind === "case" ? origin.heat : null);
  const first = oem.segments[0].states[0];
  const lastSegment = oem.segments[oem.segments.length - 1];
  const terminal = useMemo(() => {
    const last = lastSegment.states[lastSegment.states.length - 1];
    return { position: last.position, velocity: last.velocity };
  }, [lastSegment]);

  return (
    <>
      <section aria-label="Globe" className="frame globe-frame">
        <FlightGlobe engine={engine} time={time} heat={heat.status === "ready" ? heat.placement.field : null} />
      </section>

      <aside aria-label="Specs" className="specs">
        <OriginBanner origin={origin} />

        <div className="controls">
          <div className="controls__row">
            <Button variant="solid" onClick={togglePlay}>
              {playing ? "Pause path" : "Play path"}
            </Button>
            <ImportCase current={origin.kind === "case" ? origin.caseId : null} />
          </div>
          <label className="scrubber">
            <span className="eyebrow">Epoch</span>
            <input
              type="range"
              min={0}
              max={stop - start}
              step="any"
              value={time - start}
              aria-label="Scrub the path by epoch"
              aria-valuetext={`${epochText(time)} UTC`}
              onChange={(event) => {
                setPlaying(false);
                scrubTo(start + Number(event.target.value));
              }}
            />
          </label>
          <p className="data-sm">{epochText(time)} UTC</p>
          <div className="rok-field">
            <label className="rok-field__label eyebrow" htmlFor="speed">
              Speed
            </label>
            <select
              id="speed"
              className="rok-field__input body"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value) as (typeof SPEEDS)[number])}
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}× real time
                </option>
              ))}
            </select>
          </div>
        </div>

        <OemReadout sample={sample} />
        <LaunchSpecs first={first} />
        <EnginePanel report={report} />
        <PhysicsPanel caseId={origin.kind === "case" ? origin.caseId : null} />
        <HeatPanel state={heat} />
        <FitPanel terminal={terminal} />
      </aside>
    </>
  );
}

// The fixture, or the file a case exports. A file that fails lib/oem.ts is never drawn: the
// validator's sentences are shown instead. The text is parsed here and nowhere is it rewritten.
export function FlightFile({ text, origin }: { text: string; origin: FlightOrigin }) {
  const parsed = useMemo(() => parseOem(text), [text]);

  if (!parsed.ok) {
    return (
      <>
        <section aria-label="Globe" className="frame frame--empty globe-frame">
          <div role="alert">
            <p className="body">This file does not pass the OEM profile, so it is not drawn.</p>
            <ul className="validation-list body-sm">
              {parsed.errors.map((error) => (
                <li key={formatIssue(error)}>{formatIssue(error)}</li>
              ))}
            </ul>
          </div>
        </section>
        <aside aria-label="Specs" className="specs">
          <OriginBanner origin={origin} />
          <div className="controls__row">
            <ImportCase current={origin.kind === "case" ? origin.caseId : null} />
          </div>
          <Panel id="readings" title="Readings" eyebrow="At the scrubbed epoch">
            <p className="body-sm rok-muted">There is no path to read.</p>
          </Panel>
        </aside>
      </>
    );
  }

  return <FlightView oem={parsed.oem} origin={origin} />;
}
