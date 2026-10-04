"use client";

import { useId, useState } from "react";
import { earthFixedToGeodetic, gcrfToEarthFixed } from "../lib/frame";
import type { OemState } from "../lib/oem";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts } from "./ui/Readout";

// Pad names are labels the person picks. They never move the coordinates.
const PADS = [
  "LC-39A, Kennedy Space Center",
  "SLC-40, Cape Canaveral",
  "SLC-4E, Vandenberg",
  "Starbase, Boca Chica",
] as const;

// Launch specs come from the first state in the file: its epoch, and the geodetic
// position derived from it.
export function LaunchSpecs({ first }: { first: OemState }) {
  const [pad, setPad] = useState("");
  const selectId = useId();
  const geodetic = earthFixedToGeodetic(gcrfToEarthFixed(first.position, first.time));

  return (
    <Panel id="launch" title="Launch specs" eyebrow="First state in the file">
      <Readouts>
        <ReadoutRow label="Epoch" source="from file">
          <span className="data-sm">{first.epoch} UTC</span>
        </ReadoutRow>
        <ReadoutRow label="Geodetic latitude" source="derived">
          <Measure value={geodetic.latitudeDeg} digits={4} unit="°" />
        </ReadoutRow>
        <ReadoutRow label="Longitude" source="derived">
          <Measure value={geodetic.longitudeDeg} digits={4} unit="°" />
        </ReadoutRow>
        <ReadoutRow label="Height" source="derived">
          <Measure value={geodetic.altitudeKm} digits={3} unit="km" />
        </ReadoutRow>
      </Readouts>

      <div className="rok-field">
        <label className="rok-field__label eyebrow" htmlFor={selectId}>
          Pad label
        </label>
        <select
          id={selectId}
          className="rok-field__input body"
          value={pad}
          onChange={(event) => setPad(event.target.value)}
        >
          <option value="">None chosen</option>
          {PADS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="rok-field__hint body-sm">
          {pad
            ? `Labeled ${pad}. The coordinates above still come from the file.`
            : "A pad name is only a label. The coordinates above come from the file."}
        </p>
      </div>
    </Panel>
  );
}
