import type { TextareaHTMLAttributes, CSSProperties } from "react";
import { colors, control, radius, type ControlSize } from "./tokens";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  size?: ControlSize;
  invalid?: boolean;
  mono?: boolean;
};

export function Textarea({ size = "sm", invalid = false, mono = false, style, ...rest }: Props) {
  const c = control[size];
  const base: CSSProperties = {
    width: "100%",
    padding: `${size === "sm" ? 6 : c.padY}px ${c.padX - 2}px`,
    background: colors.panel2,
    border: `1px solid ${invalid ? colors.red : colors.border}`,
    borderRadius: size === "sm" ? radius.sm : radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    outline: "none",
    fontFamily: mono ? "ui-monospace, monospace" : undefined,
    resize: "vertical",
    boxSizing: "border-box",
    lineHeight: 1.4,
  };
  return <textarea {...rest} style={{ ...base, ...style }} />;
}
