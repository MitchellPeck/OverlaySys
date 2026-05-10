import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { colors, fontSize, radius } from "./tokens";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  size?: number;
  type?: "button" | "submit" | "reset";
};

export function IconButton({
  size = 28,
  type = "button",
  style,
  disabled,
  ...rest
}: Props) {
  const base: CSSProperties = {
    width: size,
    height: size,
    background: "transparent",
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: fontSize.base,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    opacity: disabled ? 0.6 : 1,
  };
  return <button {...rest} type={type} disabled={disabled} style={{ ...base, ...style }} />;
}
