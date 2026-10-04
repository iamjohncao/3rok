import type { FlightReport } from "../lib/engine/flight";
import { Panel } from "./ui/Panel";
import { Measure, ReadoutRow, Readouts, epochText } from "./ui/Readout";

const MAX_INTERVALS_SHOWN = 12;

// What the flight engine did with the file, and how far gravity alone is from it. The mismatch is
// how far the earlier state, flown by gravity alone, lands from the later state. A large number
// means the file is not a coasting orbit. The engine does not say why.
export function EnginePanel({ report }: { report: FlightReport }) {
  const shown = report.intervals.slice(0, MAX_INTERVALS_SHOWN);
  return (
    <Panel id="engine" title="Flight engine" eyebrow="Gravity only">
      <p className="body-sm rok-subtle">
        Between two states the engine flies {report.gravity}. Nothing else acts on the satellite here, nothing is
        read from the file&apos;s comments, and the file is never changed.
      </p>
      <Readouts>
        <ReadoutRow label="States in the file" source="from file">
          <span className="data-sm">{report.stateCount}</span>
        </ReadoutRow>
        {report.intervals.length === 0 ? null : (
          <>
            <ReadoutRow label="Largest position mismatch" source="derived">
              <Measure value={report.maxPositionKm} digits={report.maxPositionKm < 1 ? 6 : 3} unit="km" />
            </ReadoutRow>
            <ReadoutRow label="Largest velocity mismatch" source="derived">
              <Measure value={report.maxVelocityKmS} digits={report.maxVelocityKmS < 1e-3 ? 9 : 5} unit="km/s" />
            </ReadoutRow>
            {report.intervals.length > 1 ? (
              <ReadoutRow label="Root mean square, position" source="derived">
                <Measure value={report.rmsPositionKm} digits={report.rmsPositionKm < 1 ? 6 : 3} unit="km" />
              </ReadoutRow>
            ) : null}
          </>
        )}
      </Readouts>
      {report.intervals.length === 0 ? (
        <p className="body-sm rok-muted">The file has one state in each segment, so there is no interval to compare.</p>
      ) : (
        <details>
          <summary className="body-sm">
            {report.intervals.length} interval{report.intervals.length === 1 ? "" : "s"}
          </summary>
          <ul className="engine-intervals">
            {shown.map((interval) => (
              <li key={`${interval.segmentIndex}-${interval.fromTime}`} className="body-sm">
                <span className="data-sm">
                  {epochText(interval.fromTime)} to {epochText(interval.toTime)}
                </span>
                <span className="data-sm rok-muted">
                  {" "}
                  {interval.positionKm < 1 ? interval.positionKm.toExponential(2) : interval.positionKm.toFixed(2)} km
                </span>
              </li>
            ))}
          </ul>
          {report.intervals.length > shown.length ? (
            <p className="body-sm rok-subtle">and {report.intervals.length - shown.length} more.</p>
          ) : null}
        </details>
      )}
      <p className="body-sm rok-subtle">
        A mismatch near zero means the file is a gravity-only orbit. A large one means it is not a coasting
        orbit. This panel does not say why.
      </p>
    </Panel>
  );
}
