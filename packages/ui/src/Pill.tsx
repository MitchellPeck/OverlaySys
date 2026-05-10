import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { colors, fontSize, fontWeight, radius } from "./tokens";

export type PillTone = "neutral" | "good" | "warn" | "bad" | "accent" | "dim";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  uppercase?: boolean;
  children: ReactNode;
};

const TONE: Record<PillTone, string> = {
  neutral: colors.text,
  dim: colors.textDim,
  good: colors.green,
  warn: colors.warn,
  bad: colors.errorText,
  accent: colors.accent,
};

/**
 * Small status pill with a colored border + label. Replaces the inline STT
 * status pill in AppHeader.tsx and the various status pills in /stt etc.
 */
export function Pill({ tone = "neutral", uppercase = false, style, children, ...rest }: Props) {
  const color = TONE[tone];
  const base: CSSProperties = {
    fontSize: fontSize.xs,
    padding: "3px 10px",
    borderRadius: radius.pill,
    border: `1px solid ${color}`,
    color,
    fontWeight: fontWeight.semibold,
    textTransform: uppercase ? "uppercase" : undefined,
    letterSpacing: uppercase ? 1 : undefined,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    textDecoration: "none",
  };
  return (
    <span {...rest} style={{ ...base, ...style }}>
      {children}
    </span>
  );
}

type DotProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  size?: number;
};

export function StatusDot({ tone = "neutral", size = 8, style, ...rest }: DotProps) {
  const color = TONE[tone];
  const base: CSSProperties = {
    display: "inline-block",
    width: size,
    height: size,
    borderRadius: radius.pill,
    background: color,
  };
  return <span {...rest} aria-hidden style={{ ...base, ...style }} />;
}
