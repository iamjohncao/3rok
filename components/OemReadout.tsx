import { derivedReadings, earthFixedToGeodetic, gcrfToEarthFixed } from "../lib/frame";
import { elementsOf } from "../lib/engine/elements";
import type { FlightSample } from "../lib/engine/flight";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts, Vector, epochText } from "./ui/Readout";

// The state at the scrubbed epoch, as the file has it, then what can be derived from it.
// Nothing here is a column the file does not have unless it is labeled derived.
export function OemReadout({ sample }: { sample: FlightSample | null }) {
  if (sample === null) {
    return (
      <Panel id="state" title="State" eyebrow="At the scrubbed epoch">
        <p className="body rok-muted">
          The file has no state at this instant. The time falls between two segments.
        </p>
      </Panel>
    );
  }

  const stateSource = sample.atState ? "from file" : "propagated";
  const geodetic = earthFixedToGeodetic(gcrfToEarthFixed(sample.position, sample.time));
  const derived = derivedReadings(sample.position, sample.velocity);
  const elements = elementsOf(sample.position, sample.velocity);

  return (
    <>
      <Panel id="state" title="State" eyebrow="GCRF, at the scrubbed epoch">
        <p className="data-sm">{epochText(sample.time)} UTC</p>
        <Readouts>
          <ReadoutRow label="Position" source={stateSource}>
            <Vector value={sample.position} digits={3} unit="km" />
          </ReadoutRow>
          <ReadoutRow label="Velocity" source={stateSource}>
            <Vector value={sample.velocity} digits={5} unit="km/s" />
          </ReadoutRow>
        </Readouts>
        {sample.atState ? null : (
          <p className="body-sm rok-subtle">
            This instant is between two states in the file. The flight engine flew gravity (point mass plus J2)
            forward from the earlier state and backward from the later one and blended the two, so the line
            passes through every state in the file.
          </p>
        )}
      </Panel>

      <Panel id="derived" title="Derived" eyebrow="Computed from the state">
        <Readouts>
          <ReadoutRow label="Geodetic latitude" source="derived">
            <Measure value={geodetic.latitudeDeg} digits={4} unit="°" />
          </ReadoutRow>
          <ReadoutRow label="Longitude" source="derived">
            <Measure value={geodetic.longitudeDeg} digits={4} unit="°" />
          </ReadoutRow>
          <ReadoutRow label="Altitude" source="derived">
            <Measure value={geodetic.altitudeKm} digits={3} unit="km" />
          </ReadoutRow>
          <ReadoutRow label="Inertial speed" source="derived">
            <Measure value={derived.speedKmS} digits={5} unit="km/s" />
          </ReadoutRow>
          <ReadoutRow label="Flight-path angle" source="derived">
            {derived.flightPathAngleDeg === null ? (
              <span className="data-sm">undefined at rest</span>
            ) : (
              <Measure value={derived.flightPathAngleDeg} digits={3} unit="°" />
            )}
          </ReadoutRow>
          <ReadoutRow label="Specific energy" source="derived">
            <Measure value={derived.specificEnergyKm2S2} digits={3} unit="km²/s²" />
          </ReadoutRow>
          <ReadoutRow label="Inclination" source="derived">
            <Measure value={elements.inclinationDeg} digits={3} unit="°" />
          </ReadoutRow>
          <ReadoutRow label="Perigee altitude" source="derived">
            <Measure value={elements.perigeeAltitudeKm} digits={1} unit="km" />
          </ReadoutRow>
          <ReadoutRow label="Apogee altitude" source="derived">
            {elements.apogeeAltitudeKm === null ? (
              <span className="data-sm">open orbit</span>
            ) : (
              <Measure value={elements.apogeeAltitudeKm} digits={1} unit="km" />
            )}
          </ReadoutRow>
          <ReadoutRow label="Period" source="derived">
            {elements.periodS === null ? <span className="data-sm">open orbit</span> : <Measure value={elements.periodS / 60} digits={2} unit="min" />}
          </ReadoutRow>
        </Readouts>
        <p className="body-sm rok-subtle">
          Latitude, longitude, and altitude are approximate. They rotate the GCRF state to Earth-fixed with
          sidereal time and mean precession, take UT1 as UTC, and leave out nutation and polar motion. Inclination,
          altitudes and period are osculating: they describe the two-body orbit that fits this one state.
        </p>
      </Panel>
    </>
  );
}
