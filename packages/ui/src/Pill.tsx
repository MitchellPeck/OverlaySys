import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { colors, fontSize, fontWeight, radius } from "./tokens";

export type PillTone =
  | "neutral" | "good" | "warn" | "bad" | "accent" | "dim"
  | "live" | "ready" | "cued" | "off";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: PillTone;
  uppercase?: boolean;
  children: ReactNode;
};

const TONE: Record<PillTone, string> = {
  neutral: colors.text,
  dim: colors.textDim,
  good: colors.ok,
  warn: colors.warn,
  bad: colors.danger,
  accent: colors.brand,
  live: colors.onair,
  ready: colors.ok,
  cued: colors.brand,
  off: colors.textDim,
};

/**
 * Small status pill with a colored border + label. Replaces the inline STT
 * status pill in AppHeader.tsx and the various status pills in /stt etc.
 */
export function Pill({ tone = "neutral", uppercase = false, style, children, ...rest }: Props) {
  const color = TONE[tone];
  const filled = tone === "live";
  const fill =
    tone === "live"
      ? colors.onair
      : tone === "ready"
      ? colors.okSubtle
      : tone === "cued"
      ? colors.brandSubtle
      : "transparent";
  const base: CSSProperties = {
    fontSize: fontSize.xs,
    padding: "3px 10px",
    borderRadius: radius.pill,
    border: `1px solid ${color}`,
    color: filled ? "#fff" : color,
    background: fill,
    boxShadow: filled ? "0 0 12px rgba(255, 51, 65, 0.5)" : undefined,
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
