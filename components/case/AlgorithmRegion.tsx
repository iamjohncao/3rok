"use client";

import { useId, useMemo, useState } from "react";
import type { CaseDocument } from "../../lib/case";
import { validateOem } from "../../lib/oem";
import { Button } from "../ui/Button";
import { Panel } from "../ui/Panel";

const MAX_ERRORS_SHOWN = 6;

function OemCheck({ text }: { text: string }) {
  const result = useMemo(() => (text.trim() === "" ? null : validateOem(text)), [text]);
  if (result === null) return null;

  if (result.valid) {
    return (
      <p className="body-sm rok-muted" role="status">
        Passes the OEM profile: {result.segment_count} segment{result.segment_count === 1 ? "" : "s"},{" "}
        {result.state_count} states, {result.start_time} to {result.stop_time}.
      </p>
    );
  }
  const shown = result.errors.slice(0, MAX_ERRORS_SHOWN);
  return (
    <div role="status">
      <p className="body-sm rok-muted">This text does not pass the OEM profile yet:</p>
      <ul className="validation-list body-sm">
        {shown.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
      {result.errors.length > shown.length ? (
        <p className="body-sm rok-subtle">and {result.errors.length - shown.length} more.</p>
      ) : null}
    </div>
  );
}

// The optimized OEM is read-only. The working copy is plain text a person edits by hand.
// Saving an edit changes the working copy and logs it. It never replaces the optimized file.
export function AlgorithmRegion({
  doc,
  onHandEdit,
}: {
  doc: CaseDocument;
  onHandEdit: (text: string) => Promise<void>;
}) {
  const saved = doc.workingOem ?? "";
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const textareaId = useId();
  const dirty = draft !== saved;

  async function save() {
    setSaving(true);
    try {
      await onHandEdit(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel id="algorithm" title="Algorithm" eyebrow="CCSDS OEM">
      <div className="oem-stack">
        <div>
          <p className="oem-block__label eyebrow">Optimized</p>
          <pre className="oem-box data-sm" tabIndex={0} aria-label="Optimized OEM, read-only">
            {doc.optimizedOem ?? "None yet."}
          </pre>
          <p className="body-sm rok-subtle">
            Read-only. It is replaced only when a Grok revision lowers the holdout error.
          </p>
        </div>

        <div>
          <label className="oem-block__label eyebrow" htmlFor={textareaId}>
            Working copy
          </label>
          <textarea
            id={textareaId}
            className="oem-box data-sm"
            rows={12}
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste or write an OEM here. Saving logs the edit."
          />
          <OemCheck text={draft} />
          <div className="algorithm-actions">
            <Button size="sm" disabled={!dirty || saving} onClick={save}>
              Save edit
            </Button>
            <Button variant="quiet" size="sm" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              Discard changes
            </Button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
