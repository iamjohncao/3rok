import type { HeatState } from "./useHeatLayer";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts } from "./ui/Readout";

function Latitude({ deg }: { deg: number }) {
  return <>{Math.abs(deg).toFixed(0)}° {deg < 0 ? "S" : "N"}</>;
}
function Longitude({ deg }: { deg: number }) {
  return <>{Math.abs(deg).toFixed(0)}° {deg < 0 ? "W" : "E"}</>;
}

// The placement-score layer, in words and numbers. A score from 0 to 1 that ranks places by the model's
// dose rate at the file's altitude. It is not a probability, and this panel says so.
export function HeatPanel({ state }: { state: HeatState }) {
  return (
    <Panel id="heat" title="Placement score" eyebrow="Derived, from assumed coefficients">
      <Body state={state} />
    </Panel>
  );
}

function Body({ state }: { state: HeatState }) {
  if (state.status === "none") {
    return (
      <p className="body-sm rok-subtle">
        The fixture has no case, so it has no chip shield and no placement layer. Import a case to see where on the
        Earth its file would live longest.
      </p>
    );
  }
  if (state.status === "loading") return <p className="body-sm rok-muted" role="status">Loading the radiation grid.</p>;
  if (state.status === "error") {
    return (
      <p className="body-sm" role="alert">
        {state.message} No layer is drawn.
      </p>
    );
  }
  if (state.status === "refused") {
    return (
      <>
        <p className="body">No placement layer for this file.</p>
        <p className="body-sm rok-subtle" role="status">
          {state.reason}
        </p>
        <p className="body-sm rok-subtle">Nothing is filled in for a value the case does not state.</p>
      </>
    );
  }

  const { placement, meta, shield } = state;
  return (
    <>
      <p className="body-sm rok-subtle">
        Where a satellite at this altitude would last longest against total dose if it stayed in one place. It ranks
        places. It is a score, not a probability of anything.
      </p>
      <Readouts>
        <ReadoutRow label="Altitude" source="derived">
          <Measure value={placement.altitudeKm} digits={1} unit="km" />
        </ReadoutRow>
        <ReadoutRow label="Shield" source="case value">
          <span className="data-sm">
            {placement.shieldMm} mm Al · {shield.valueStatus}
          </span>
        </ReadoutRow>
        <ReadoutRow label="Highest dose rate on this map" source="estimate">
          <span className="data-sm">
            {placement.maxDoseKradPerYear < 0.01 ? placement.maxDoseKradPerYear.toExponential(2) : placement.maxDoseKradPerYear.toFixed(2)}{" "}
            <span className="rok-muted">krad(Si)/yr</span>
          </span>
        </ReadoutRow>
        <ReadoutRow label="Where" source="derived">
          <span className="data-sm">
            <Latitude deg={placement.worst.latDeg} />, <Longitude deg={placement.worst.lonDeg} />
          </span>
        </ReadoutRow>
        <ReadoutRow label="Earth with no model flux" source="derived">
          <Measure value={placement.noFluxAreaFraction * 100} digits={0} unit="% of the area" />
        </ReadoutRow>
      </Readouts>
      <p className="body-sm">
        0 is the highest dose rate on this map. 1 is {10 ** placement.decades} times lower, or less. White is 0,
        yellow is the middle, red is 1. A place the model gives no trapped flux scores 1: the model has no value
        there, which is not proof that it is safe.
      </p>
      <p className="body-sm rok-subtle">
        Trapped flux: {meta.model}, protons above {meta.particles[0].energy_MeV} MeV and electrons above{" "}
        {meta.particles[1].energy_MeV} MeV, solar {meta.solar}, epoch {meta.epoch_utc}, a 3° grid, interpolated between
        100 km altitude steps. Dose rate: the physics package&apos;s exponential shield model. Its coefficients are{" "}
        <span className="data-sm">{meta.dose.status}</span> in params.yaml, so every dose rate here is an estimate.
      </p>
    </>
  );
}
