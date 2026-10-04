"use client";

// The globe on /test: ours, drawn with WebGL2 (lib/globe/renderer.ts). It draws the path the flight
// engine gives, the satellite at the scrubbed epoch, and a heat layer when one is passed in. Three
// switches change how it looks, and none of them writes a case or touches the OEM:
//
//   Realistic | Particles    the Earth as a surface, or as dots
//   Globe | Map              a sphere, or the sphere folded flat
//   Wide | Chase             the whole globe or map, or the satellite kept in the centre

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlightEngine } from "../../lib/engine/flight";
import { loadEarthImage } from "../../lib/globe/earth-image";
import type { HeatField } from "../../lib/globe/heat";
import { pathInstances, type PathVertex } from "../../lib/globe/path-geometry";
import { GlobeRenderer, GlobeUnsupportedError, type GlobeFollow, type GlobeShape, type GlobeStyle } from "../../lib/globe/renderer";
import { satelliteView, trackPoint } from "../../lib/globe/satellite";
import { readGlobeTokens } from "../../lib/globe/tokens";
import { Button } from "../ui/Button";

const PATH_STEP_SECONDS = 5;
const PATH_MAX_POINTS = 4000;

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <Button key={option.value} size="sm" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.text}
        </Button>
      ))}
    </div>
  );
}

export function FlightGlobe({
  engine,
  time,
  heat,
}: {
  engine: FlightEngine;
  /** Seconds since 1970-01-01T00:00:00Z. */
  time: number;
  /** The placement-score layer, or null for none. */
  heat: HeatField | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GlobeRenderer | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [style, setStyle] = useState<GlobeStyle>("realistic");
  const [shape, setShape] = useState<GlobeShape>("globe");
  const [follow, setFollow] = useState<GlobeFollow>("wide");
  const [heatOn, setHeatOn] = useState(true);
  const start = useMemo(() => engine.bounds().start, [engine]);

  // Build the renderer once the Earth's picture is in.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      try {
        const earth = await loadEarthImage();
        if (cancelled) return;
        const created = new GlobeRenderer(element, readGlobeTokens());
        created.setEarth(earth);
        renderer.current = created;
        observer = new ResizeObserver(() => created.resize());
        observer.observe(element);
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        setFailure(
          error instanceof GlobeUnsupportedError
            ? error.message
            : `The globe could not start: ${error instanceof Error ? error.message : "unknown error"}.`,
        );
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      renderer.current?.dispose();
      renderer.current = null;
      setReady(false);
    };
  }, []);

  // The path, drawn from the engine. Rebuilt only when the file changes.
  useEffect(() => {
    const r = renderer.current;
    if (!ready || !r) return;
    const lines: PathVertex[][] = engine.path(PATH_STEP_SECONDS, PATH_MAX_POINTS).map((segment) =>
      segment.map((sample) => {
        const p = trackPoint(sample);
        return { t: sample.time - start, lon: p.lon, lat: p.lat, altKm: p.altKm };
      }),
    );
    r.setPath(pathInstances(lines));
    const first = lines.find((line) => line.length > 0)?.[0];
    if (first) r.lookAt(first.lon, first.lat);
  }, [ready, engine, start]);

  // The satellite and the bright part of the path follow the scrubbed epoch.
  useEffect(() => {
    const r = renderer.current;
    if (!ready || !r) return;
    r.setSatellite(satelliteView(engine, time));
    r.setNow(time - start);
  }, [ready, engine, time, start]);

  useEffect(() => renderer.current?.setStyle(style), [ready, style]);
  useEffect(() => renderer.current?.setShape(shape), [ready, shape]);
  useEffect(() => renderer.current?.setFollow(follow), [ready, follow]);
  useEffect(() => renderer.current?.setHeat(heatOn ? heat : null), [ready, heat, heatOn]);

  // Dragging turns the globe or slides the map. The wheel zooms.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let last: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      element.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      if (!last) return;
      renderer.current?.drag(event.clientX - last.x, event.clientY - last.y);
      last = { x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      last = null;
      element.releasePointerCapture?.(event.pointerId);
      element.style.cursor = "";
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      renderer.current?.zoomBy(Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  return (
    <div className="globe">
      <canvas
        ref={canvas}
        className="globe__canvas"
        role="img"
        aria-label="The satellite's path over the Earth, drawn from the flight file"
      />
      <div className="globe-controls" role="group" aria-label="Globe view">
        <Choice
          label="Globe style"
          value={style}
          options={[
            { value: "realistic", text: "Realistic" },
            { value: "particles", text: "Particles" },
          ]}
          onChange={setStyle}
        />
        <Choice
          label="Shape"
          value={shape}
          options={[
            { value: "globe", text: "Globe" },
            { value: "map", text: "Map" },
          ]}
          onChange={setShape}
        />
        <Choice
          label="View"
          value={follow}
          options={[
            { value: "wide", text: "Wide" },
            { value: "chase", text: "Chase" },
          ]}
          onChange={setFollow}
        />
        {heat ? (
          <Choice
            label="Placement score"
            value={heatOn ? "on" : "off"}
            options={[
              { value: "on", text: "Score on" },
              { value: "off", text: "Score off" },
            ]}
            onChange={(next) => setHeatOn(next === "on")}
          />
        ) : null}
      </div>
      {heat && heatOn ? (
        <div className="heat-legend" role="group" aria-label="Placement score legend">
          <p className="eyebrow">Placement score</p>
          <div className="heat-legend__bar" aria-hidden="true" />
          <p className="heat-legend__ends data-sm">
            <span>0 highest dose rate</span>
            <span>1 a thousand times lower</span>
          </p>
        </div>
      ) : null}
      {failure ? (
        <p className="globe__failure body-sm" role="alert">
          {failure}
        </p>
      ) : null}
      {!ready && !failure ? (
        <p className="globe__loading body rok-muted" role="status">
          Loading globe.
        </p>
      ) : null}
    </div>
  );
}
