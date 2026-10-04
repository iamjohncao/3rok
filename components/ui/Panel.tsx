import type { ReactNode } from "react";

type PanelProps = {
  id: string;
  title: string;
  eyebrow?: string;
  className?: string;
  children?: ReactNode;
};

// A labeled region. `id` names the heading so the section is a landmark.
export function Panel({ id, title, eyebrow, className, children }: PanelProps) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={["rok-panel", className].filter(Boolean).join(" ")}
    >
      {eyebrow ? <p className="rok-panel__eyebrow eyebrow">{eyebrow}</p> : null}
      <h2 id={`${id}-title`} className="rok-panel__title heading-md">
        {title}
      </h2>
      {children}
    </section>
  );
}
