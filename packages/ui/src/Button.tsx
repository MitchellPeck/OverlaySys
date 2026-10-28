import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { fontWeight, type ControlSize } from "./tokens";
import { sizeStyle, variantStyle, type ButtonVariant } from "./buttonStyles";

export type { ButtonVariant } from "./buttonStyles";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  /** `sm` 24 px, `md` 28 px (`lg` 32 px still accepted). */
  size?: ControlSize;
  block?: boolean;
  /** Leading icon, usually a lucide icon at size 14. */
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  icon,
  type = "button",
  style,
  disabled,
  children,
  ...rest
}: Props) {
  const base: CSSProperties = {
    display: block ? "flex" : "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontWeight: fontWeight.semibold,
    lineHeight: 1,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    flexShrink: 0,
    ...(block ? { width: "100%" } : null),
    ...sizeStyle(size),
    ...variantStyle(variant, !!disabled),
  };
  return (
    <button {...rest} type={type} disabled={disabled} style={{ ...base, ...style }}>
      {icon != null ? (
        <span aria-hidden style={{ display: "inline-flex", flexShrink: 0 }}>
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
