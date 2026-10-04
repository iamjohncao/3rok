"use client";

import { useId, useState } from "react";
import type { Verdict } from "../../lib/grok-revision";

export type AskResult = { verdict: Verdict; reason: string };

const LEAD: Record<Verdict, string> = {
  kept: "Kept.",
  rejected: "Not kept.",
  unscored: "Not scored.",
  failed: "No candidate.",
};

// The instruction field. Its submit button is the solid "Ask Grok" in the page header, tied to this
// form by id, so the screen keeps one solid button. Grok reads the case and proposes a file. The
// evaluator decides whether the file is kept, and the log below shows what it was given.
export function AskGrokForm({
  asking,
  error,
  result,
  onAsk,
}: {
  asking: boolean;
  error: string | null;
  result: AskResult | null;
  onAsk: (instruction: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const fieldId = useId();

  return (
    <form
      id="ask-grok-form"
      className="ask-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (await onAsk(text)) setText("");
      }}
    >
      <label className="rok-field__label eyebrow" htmlFor={fieldId}>
        Instruction for Grok
      </label>
      <textarea
        id={fieldId}
        className="rok-field__input body"
        rows={3}
        maxLength={4000}
        required
        disabled={asking}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="For example: choose a dawn-dusk orbit that keeps the chip out of the South Atlantic Anomaly."
      />
      <p className="body-sm rok-subtle">
        Grok reads this case&apos;s train records and proposes an OEM file. Its weights do not change. A separate
        evaluator keeps the file only when the holdout error drops.
      </p>
      {asking ? (
        <p role="status" className="body-sm">
          Grok is reading this case. This can take a few minutes. Leave this page open.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="body-sm save-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="body-sm">
          {LEAD[result.verdict]} {result.reason}
        </p>
      ) : null}
    </form>
  );
}
