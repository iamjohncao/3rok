"use client";

import { useEffect, useState } from "react";
import type { PhysicsReport } from "../lib/physics-estimate";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts } from "./ui/Readout";

type Load =
  | { status: "loading" }
  | { status: "ready"; report: PhysicsReport }
  | { status: "error"; message: string };

function NotReported() {
  return <span className="data-sm rok-muted">not reported</span>;
}

function Figure({ value, digits, unit }: { value: number | null | undefined; digits: number; unit: string }) {
  return typeof value === "number" ? <Measure value={value} digits={digits} unit={unit} /> : <NotReported />;
}

function Estimate({ report }: { report: Extract<PhysicsReport, { kind: "estimate" }> }) {
  const { estimate, inputs, orbit } = report;
  return (
    <>
      <Readouts>
        <ReadoutRow label="Lifetime" source="estimate">
          <Measure value={report.lifetime_years} digits={2} unit="years" />
        </ReadoutRow>
        <ReadoutRow label="Mean power" source="estimate">
          <Figure value={estimate?.mean_power_kW} digits={2} unit="kW" />
        </ReadoutRow>
        <ReadoutRow label="Radiator area" source="estimate">
          <Figure value={estimate?.radiator_area_m2} digits={1} unit="m²" />
        </ReadoutRow>
        <ReadoutRow label="Shield mass" source="estimate">
          <Figure value={estimate?.shield_mass_kg} digits={1} unit="kg" />
        </ReadoutRow>
        <ReadoutRow label="Limiting mode" source="estimate">
          {estimate?.limiting_mode ? <span className="data-sm">{estimate.limiting_mode}</span> : <NotReported />}
        </ReadoutRow>
      </Readouts>

      {report.assumptions_note ? <p className="body-sm">{report.assumptions_note}</p> : null}
      {estimate?.dose_limit_provenance ? (
        <p className="body-sm rok-subtle">
          The chip&apos;s dose limit is marked <span className="data-sm">{estimate.dose_limit_provenance}</span> in
          the chip table. The lifetime rests on it.
        </p>
      ) : null}

      <p className="eyebrow">What was estimated</p>
      <Readouts>
        <ReadoutRow label="Orbit altitude" source="derived">
          <Measure value={orbit.altitude_km} digits={1} unit="km" />
        </ReadoutRow>
        <ReadoutRow label="Orbit inclination" source="derived">
          <span className="data-sm">
            {orbit.score_inclination === "sso" ? `sun-synchronous, ${orbit.inclination_deg.toFixed(1)}°` : `${orbit.inclination_deg.toFixed(1)}°`}
          </span>
        </ReadoutRow>
        <ReadoutRow label="Chip" source="case value">
          <span className="data-sm">{inputs.chip.value}</span>
        </ReadoutRow>
        <ReadoutRow label="LTAN" source="case value">
          <span className="data-sm">
            {inputs.ltan_hours.value} h · {inputs.ltan_hours.value_status}
          </span>
        </ReadoutRow>
        <ReadoutRow label="Shield" source="case value">
          <span className="data-sm">
            {inputs.shield_mm_Al.value} mm Al · {inputs.shield_mm_Al.value_status}
          </span>
        </ReadoutRow>
      </Readouts>
    </>
  );
}

// Lifetime, mean power, radiator area, shield mass and the limiting mode for the file on the globe,
// from the physics service, on the orbit reduced from that file and the chip, LTAN and shield the
// case states. Each is an estimate, with the package's assumptions note beside it. A refusal shows
// its sentences and no lifetime. A service that cannot be reached shows "Physics unavailable".
// Nothing is estimated in the place of a number the service did not return.
export function PhysicsPanel({ caseId }: { caseId: string | null }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (caseId === null) return;
    let live = true;
    setLoad({ status: "loading" });
    fetch(`/api/physics?case=${encodeURIComponent(caseId)}`, { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        const body: { report?: PhysicsReport; error?: string } | null = await response.json().catch(() => null);
        if (!live) return;
        if (!response.ok || !body?.report) setLoad({ status: "error", message: body?.error ?? `The estimate failed (${response.status}).` });
        else setLoad({ status: "ready", report: body.report });
      })
      .catch(() => {
        if (live) setLoad({ status: "error", message: "The estimate could not be reached." });
      });
    return () => {
      live = false;
    };
  }, [caseId]);

  function body() {
    if (caseId === null) {
      return (
        <p className="body-sm rok-subtle">
          The fixture shows a file&apos;s shape only, so nothing is estimated for it. Import a case to see an
          estimate for its file, with that case&apos;s chip, LTAN and shield.
        </p>
      );
    }
    if (load.status === "loading") return <p className="body-sm rok-muted" role="status">Estimating.</p>;
    if (load.status === "error") {
      return (
        <>
          <p className="body">Physics unavailable.</p>
          <p className="body-sm rok-subtle" role="alert">
            {load.message} No lifetime, mean power, radiator area, or shield mass is shown, and nothing is
            estimated in their place.
          </p>
        </>
      );
    }
    const { report } = load;
    switch (report.kind) {
      case "estimate":
        return <Estimate report={report} />;
      case "refused":
        return (
          <>
            <p className="body">No estimate for this file.</p>
            <ul className="validation-list body-sm" role="status">
              {report.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="body-sm rok-subtle">No lifetime is shown. Nothing is filled in for what the case does not state.</p>
          </>
        );
      case "unavailable":
        return (
          <>
            <p className="body">Physics unavailable.</p>
            <p className="body-sm rok-subtle">
              {report.message} No lifetime, mean power, radiator area, or shield mass is shown, and nothing is
              estimated in their place.
            </p>
          </>
        );
      case "no_flight":
        return <p className="body-sm rok-subtle">This case has no flight file, so there is nothing to estimate.</p>;
    }
  }

  return (
    <Panel id="physics" title="Physics" eyebrow="Estimated, with assumptions">
      {body()}
    </Panel>
  );
}
