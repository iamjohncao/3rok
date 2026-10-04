"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatIssue, parseOem, type Oem } from "../lib/oem";
import { oemTimeBounds, sampleOem } from "../lib/oem-sample";
import { FitPanel } from "./FitPanel";
import { GlobeView } from "./GlobeLoader";
import { LaunchSpecs } from "./LaunchSpecs";
import { OemReadout } from "./OemReadout";
import { PhysicsPanel } from "./PhysicsPanel";
import { Button } from "./ui/Button";
import { Panel } from "./ui/Panel";
import { epochText } from "./ui/Readout";

const SPEEDS = [1, 10, 60, 300] as const;
const FIXTURE_NAME = "fixtures/minimal.oem";

function FixtureBanner() {
  return (
    <p className="fixture-banner body-sm" role="status">
      <span className="eyebrow">Showing a fixture</span> {FIXTURE_NAME}. Its numbers show the file shape only.
      This is not a flyable trajectory.
    </p>
  );
}

// The OEM that passed lib/oem.ts, drawn and read at the scrubbed epoch. Scrubbing and
// playing change nothing in the file and write nothing to any case.
function FlightView({ oem }: { oem: Oem }) {
  const { start, stop } = useMemo(() => oemTimeBounds(oem), [oem]);
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

  const sample = useMemo(() => sampleOem(oem, time), [oem, time]);
  const first = oem.segments[0].states[0];
  const lastSegment = oem.segments[oem.segments.length - 1];
  const terminal = useMemo(() => {
    const last = lastSegment.states[lastSegment.states.length - 1];
    return { position: last.position, velocity: last.velocity };
  }, [lastSegment]);

  return (
    <>
      <section aria-label="Globe" className="frame globe-frame">
        <GlobeView oem={oem} time={time} />
      </section>

      <aside aria-label="Specs" className="specs">
        <FixtureBanner />

        <div className="controls">
          <div className="controls__row">
            <Button variant="solid" onClick={togglePlay}>
              {playing ? "Pause path" : "Play path"}
            </Button>
            <Button disabled title="Import opens when export from a case is wired up.">
              Import case
            </Button>
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
        <PhysicsPanel />
        <FitPanel terminal={terminal} />
      </aside>
    </>
  );
}

// Phase 8 loads the fixture. Phase 9 loads the file a case exports. A file that fails
// lib/oem.ts is never drawn: the validator's sentences are shown instead.
export function TestScreen({ fixtureOem }: { fixtureOem: string }) {
  const parsed = useMemo(() => parseOem(fixtureOem), [fixtureOem]);

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
          <FixtureBanner />
          <Panel id="readings" title="Readings" eyebrow="At the scrubbed epoch">
            <p className="body-sm rok-muted">There is no path to read.</p>
          </Panel>
        </aside>
      </>
    );
  }

  return <FlightView oem={parsed.oem} />;
}
