import type { InputHTMLAttributes, CSSProperties } from "react";
import { colors, control, radius, type ControlSize } from "./tokens";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: ControlSize;
  invalid?: boolean;
};

export function Input({ size = "sm", invalid = false, style, ...rest }: Props) {
  const c = control[size];
  const base: CSSProperties = {
    width: "100%",
    height: c.height,
    padding: `0 ${c.padX - 2}px`,
    background: colors.surface2,
    border: `1px solid ${invalid ? colors.danger : colors.border}`,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };
  return <input {...rest} style={{ ...base, ...style }} />;
}
