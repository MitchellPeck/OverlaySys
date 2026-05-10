import type { InputHTMLAttributes, CSSProperties } from "react";
import { colors, control, radius, type ControlSize } from "./tokens";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: ControlSize;
  invalid?: boolean;
};

export function Input({ size = "sm", invalid = false, style, ...rest }: Props) {
  const c = control[size];
  // sm input historically uses a tighter radius (3) and 4px vertical pad —
  // FieldInput.tsx had `padding: "4px 8px"` and `borderRadius: 3`. We lift
  // vertical pad to 6 (control.sm) for a few pixels of breathing room.
  const base: CSSProperties = {
    width: "100%",
    padding: `${size === "sm" ? 4 : c.padY}px ${c.padX - 2}px`,
    background: colors.panel2,
    border: `1px solid ${invalid ? colors.red : colors.border}`,
    borderRadius: size === "sm" ? radius.sm : radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    outline: "none",
    boxSizing: "border-box",
  };
  return <input {...rest} style={{ ...base, ...style }} />;
}
