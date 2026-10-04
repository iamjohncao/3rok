import { useId, type InputHTMLAttributes } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
  mono?: boolean;
};

export function Field({ label, hint, error, mono, className, id, ...rest }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const message = error ?? hint;

  return (
    <div
      className={["rok-field", error && "rok-field--error", className]
        .filter(Boolean)
        .join(" ")}
    >
      <label className="rok-field__label eyebrow" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className={["rok-field__input", "body", mono && "rok-mono"].filter(Boolean).join(" ")}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? hintId : undefined}
        {...rest}
      />
      {message ? (
        <p id={hintId} className="rok-field__hint body-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
