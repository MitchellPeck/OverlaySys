import type { SelectHTMLAttributes, CSSProperties } from "react";
import { colors, control, radius, type ControlSize } from "./tokens";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: ControlSize;
};

export function Select({ size = "sm", style, children, ...rest }: Props) {
  const c = control[size];
  const base: CSSProperties = {
    width: "100%",
    padding: `${size === "sm" ? 4 : c.padY}px ${c.padX - 2}px`,
    background: colors.panel2,
    border: `1px solid ${colors.border}`,
    borderRadius: size === "sm" ? radius.sm : radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    outline: "none",
    boxSizing: "border-box",
  };
  return (
    <select {...rest} style={{ ...base, ...style }}>
      {children}
    </select>
  );
}
