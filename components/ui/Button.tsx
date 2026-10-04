import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "solid" | "ghost" | "quiet";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm";
};

// One `solid` button per screen. The rest are `ghost` or `quiet`.
export function Button({
  variant = "ghost",
  size,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "rok-btn",
    "button",
    variant === "solid" && "rok-btn--solid",
    variant === "quiet" && "rok-btn--quiet",
    size === "sm" && "rok-btn--sm",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
