"use client";

import { useMemo } from "react";
import { fitVehicleClass, type Envelope, type FitInput } from "../lib/fit";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts, formatFixed } from "./ui/Readout";

const DESTINATIONS = {
  leo: "Low Earth orbit",
  transfer: "Transfer orbit",
  escape: "Escape",
  suborbital: "Not on an orbit",
} as const;

function coverage(value: boolean | null, stated: boolean): string {
  if (!stated) return "not stated in the case";
  if (value === null) return "published figure is a lower bound";
  return value ? "covered" : "not covered";
}

function envelopeText(envelope: Envelope): string {
  return `${envelope.diameterM} m wide${envelope.heightM != null ? `, ${envelope.heightM} m tall` : ""}`;
}

// The vehicle-class estimate. It shows the class, the published figure with its source, and the
// value the case states (or that it states none). Every figure here is an estimate.
export function FitPanel({ terminal, massKg, envelope }: FitInput) {
  const fit = useMemo(
    () => fitVehicleClass({ terminal, massKg, envelope }),
    [terminal, massKg, envelope],
  );
  const massStated = fit.caseValues.massKg !== null;
  const envelopeStated = fit.caseValues.envelope !== null;

  return (
    <Panel id="fit" title="Vehicle class" eyebrow="Estimate">
      <p className="body-sm rok-subtle">
        Every figure here is an estimate. A published class number is not a mission quote, and the OEM is not
        a performance guarantee.
      </p>

      <p className="fit-pick heading-md">{fit.recommended ?? "No class"}</p>
      <p className="body-sm">{fit.reason}</p>

      <Readouts>
        <ReadoutRow label="Terminal destination" source="derived">
          <span className="data-sm">{DESTINATIONS[fit.orbit.destination]}</span>
        </ReadoutRow>
        {fit.orbit.destination === "suborbital" ? null : (
          <ReadoutRow label="Perigee altitude" source="derived">
            <Measure value={fit.orbit.perigeeAltitudeKm} digits={1} unit="km" />
          </ReadoutRow>
        )}
        {fit.orbit.apogeeAltitudeKm === null ? null : (
          <ReadoutRow label="Apogee altitude" source="derived">
            <Measure value={fit.orbit.apogeeAltitudeKm} digits={1} unit="km" />
          </ReadoutRow>
        )}
        <ReadoutRow label="Case mass" source="case value">
          <span className="data-sm">
            {massStated ? `${formatFixed(fit.caseValues.massKg as number, 0)} kg` : "not stated"}
          </span>
        </ReadoutRow>
        <ReadoutRow label="Case envelope" source="case value">
          <span className="data-sm">
            {envelopeStated ? envelopeText(fit.caseValues.envelope as Envelope) : "not stated"}
          </span>
        </ReadoutRow>
      </Readouts>

      <p className="body-sm rok-subtle">{fit.energyCheck.text}</p>

      <ul className="class-list">
        {fit.rows.map((row) => (
          <li
            key={row.name}
            className={row.name === fit.recommended ? "class-row class-row--picked" : "class-row"}
          >
            <p className="class-row__name eyebrow">
              {row.name}
              {row.name === fit.recommended ? " · recommended" : ""}
            </p>
            <p className="body-sm">{row.published}</p>
            <p className="body-sm rok-subtle">
              Mass: {coverage(row.coversMass, massStated)}. Envelope: {coverage(row.coversEnvelope, envelopeStated)}.
            </p>
            <p className="body-sm">
              Source:{" "}
              {row.sources.map((source, index) => (
                <span key={source.label}>
                  {index > 0 ? ", " : ""}
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.label}
                    </a>
                  ) : (
                    source.label
                  )}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
      <p className="body-sm rok-subtle">
        Falcon&apos;s published width is the fairing&apos;s outer diameter, so a payload envelope close to it
        needs checking against the user&apos;s guide.
      </p>
    </Panel>
  );
}
