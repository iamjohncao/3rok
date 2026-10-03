import type { CaseDocument } from "../../lib/case";
import { formatUtc } from "../../lib/case-ops";
import { Panel } from "../ui/Panel";

// The case log: every instruction, revision, score, and hand edit, oldest first.
export function ActivityRegion({ doc }: { doc: CaseDocument }) {
  return (
    <Panel id="activity" title="Activity" eyebrow="Instructions and revisions">
      {doc.log.length === 0 ? (
        <p className="body rok-muted">No activity yet.</p>
      ) : (
        <ol className="log-list">
          {doc.log.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="log-entry">
              <p className="log-entry__head eyebrow">
                <span>{entry.kind.replace("_", " ")}</span>
                <span className="data-sm">{formatUtc(entry.at)}</span>
              </p>
              <pre className="log-entry__text body-sm">{entry.text}</pre>
              {entry.holdout_error !== null ? (
                <p className="data-sm">holdout error {entry.holdout_error}</p>
              ) : null}
              {entry.oem !== null ? (
                <details>
                  <summary className="body-sm">OEM file for this entry</summary>
                  <pre className="oem-box data-sm">{entry.oem}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
