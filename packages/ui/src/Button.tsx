import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { colors, control, fontWeight, lineHeight, type ControlSize } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destructive" | "success";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  block?: boolean;
  type?: "button" | "submit" | "reset";
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  type = "button",
  style,
  disabled,
  ...rest
}: Props) {
  const c = control[size];
  const base: CSSProperties = {
    padding: `${c.padY}px ${c.padX}px`,
    fontSize: c.fontSize,
    borderRadius: c.radius,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.tight,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    background: "transparent",
    color: colors.text,
    opacity: disabled ? 0.6 : 1,
    ...(block ? { width: "100%" } : null),
    ...variantStyle(variant),
  };
  return <button {...rest} type={type} disabled={disabled} style={{ ...base, ...style }} />;
}

function variantStyle(v: ButtonVariant): CSSProperties {
  switch (v) {
    case "primary":
      return { background: colors.accent, color: "#fff", borderColor: colors.accent };
    case "secondary":
      return { background: colors.panel2, color: colors.text, borderColor: colors.border };
    case "ghost":
      return { background: "transparent", color: colors.text, borderColor: colors.border };
    case "danger":
      return { background: "transparent", color: colors.red, borderColor: colors.red };
    case "destructive":
      return { background: colors.red, color: "#fff", borderColor: colors.red };
    case "success":
      return { background: colors.ok, color: "#04231a", borderColor: colors.ok };
  }
}
