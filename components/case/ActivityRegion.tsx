import type { CaseDocument } from "../../lib/case";
import { formatUtc } from "../../lib/case-ops";
import { Panel } from "../ui/Panel";
import { AskGrokForm, type AskResult } from "./AskGrokForm";

// The case log: every instruction, revision, score, and hand edit, oldest first. The latest proposed
// file is shown open, as a file, under the words about it.
// A proposal's text ends with the instructions that were sent. They are the same seven every time, so
// they sit behind a disclosure. Nothing is dropped: the person can open them on any entry.
const INSTRUCTIONS_MARKER = "Instructions sent (version";

function EntryText({ text, kind }: { text: string; kind: string }) {
  const cut = kind === "proposal" ? text.indexOf(INSTRUCTIONS_MARKER) : -1;
  if (cut === -1) return <pre className="log-entry__text body-sm">{text}</pre>;
  const head = text.slice(0, cut).trimEnd();
  const rest = text.slice(cut);
  // The words Grok wrote follow the instructions. Keep them visible.
  const said = rest.indexOf("\nGrok said:");
  const instructions = said === -1 ? rest : rest.slice(0, said);
  const reply = said === -1 ? "" : rest.slice(said + 1);
  return (
    <>
      <pre className="log-entry__text body-sm">{head}</pre>
      <details>
        <summary className="body-sm">Instructions sent to Grok</summary>
        <pre className="log-entry__text body-sm">{instructions}</pre>
      </details>
      {reply ? <pre className="log-entry__text body-sm">{reply}</pre> : null}
    </>
  );
}

export function ActivityRegion({
  doc,
  asking,
  askError,
  askResult,
  onAsk,
}: {
  doc: CaseDocument;
  asking: boolean;
  askError: string | null;
  askResult: AskResult | null;
  onAsk: (instruction: string) => Promise<boolean>;
}) {
  const lastProposal = doc.log.map((entry) => entry.kind).lastIndexOf("proposal");
  return (
    <Panel id="activity" title="Activity" eyebrow="Instructions and revisions">
      <AskGrokForm asking={asking} error={askError} result={askResult} onAsk={onAsk} />
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
              <EntryText text={entry.text} kind={entry.kind} />
              {entry.holdout_error !== null ? (
                <p className="data-sm">holdout error {entry.holdout_error}</p>
              ) : null}
              {entry.oem !== null ? (
                <details open={index === lastProposal}>
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
