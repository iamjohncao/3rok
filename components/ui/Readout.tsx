import type { ReactNode } from "react";

// How a reading got onto the page. The word is always shown, never only a color.
export type ReadoutSource = "from file" | "interpolated" | "derived" | "estimate" | "case value";

export function Readouts({ children }: { children: ReactNode }) {
  return <dl className="readouts">{children}</dl>;
}

export function ReadoutRow({
  label,
  source,
  children,
}: {
  label: string;
  source: ReadoutSource;
  children: ReactNode;
}) {
  return (
    <div className="readout-row">
      <dt className="body-sm rok-muted">{label}</dt>
      <dd className="readout-row__value">
        {children}
        <span className="tag data-sm">{source}</span>
      </dd>
    </div>
  );
}

/** A number as text, never "-0.000". */
export function formatFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return /^-0\.?0*$/.test(text) ? text.slice(1) : text;
}

export function Vector({ value, digits, unit }: { value: readonly number[]; digits: number; unit: string }) {
  const axes = ["x", "y", "z"] as const;
  return (
    <span className="vector">
      {axes.map((axis, index) => (
        <span key={axis} className="data-sm">
          {axis} {formatFixed(value[index], digits)}
        </span>
      ))}
      <span className="data-sm rok-muted">{unit}</span>
    </span>
  );
}

export function Measure({ value, digits, unit }: { value: number; digits: number; unit: string }) {
  return (
    <span>
      <span className="data-sm">{formatFixed(value, digits)}</span>
      <span className="data-sm rok-muted"> {unit}</span>
    </span>
  );
}

/** `2026-10-03T18:05:00.000`, the way an OEM writes an epoch. */
export function epochText(unixSeconds: number): string {
  return new Date(Math.round(unixSeconds * 1000)).toISOString().replace("Z", "");
}
