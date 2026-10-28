import type { TextareaHTMLAttributes, CSSProperties } from "react";
import { colors, control, fontFamily, radius, type ControlSize } from "./tokens";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  size?: ControlSize;
  invalid?: boolean;
  mono?: boolean;
};

export function Textarea({ size = "sm", invalid = false, mono = false, style, ...rest }: Props) {
  const c = control[size];
  const base: CSSProperties = {
    width: "100%",
    padding: `6px ${c.padX - 2}px`,
    background: colors.surface2,
    border: `1px solid ${invalid ? colors.danger : colors.border}`,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    outline: "none",
    fontFamily: mono ? fontFamily.mono : "inherit",
    resize: "vertical",
    boxSizing: "border-box",
    lineHeight: 1.4,
  };
  return <textarea {...rest} style={{ ...base, ...style }} />;
}
