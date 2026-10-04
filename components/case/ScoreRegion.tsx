import type { CaseDocument } from "../../lib/case";
import { Panel } from "../ui/Panel";

// The last holdout error, or the word unscored. Never a progress bar or a curve.
export function ScoreRegion({ doc }: { doc: CaseDocument }) {
  return (
    <Panel id="score" title="Score" eyebrow="Last holdout error">
      {doc.holdoutError === null ? (
        <p className="data-md">unscored</p>
      ) : (
        <p>
          <span className="data-md">{doc.holdoutError.toFixed(3)}</span>{" "}
          <span className="data-sm rok-muted">years, mean error on holdout outcomes</span>
        </p>
      )}
      <p className="body-sm rok-subtle">
        Grok reads this case. Its weights do not change. A separate evaluator scores each revision
        on holdout outcomes that Grok never sees.
      </p>
    </Panel>
  );
}
