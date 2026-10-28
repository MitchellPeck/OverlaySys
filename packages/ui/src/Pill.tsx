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
  // Brand as text uses brandText (#6366f1 is under 4:1 on the surfaces).
  accent: colors.brandText,
  live: colors.onair,
  ready: colors.ok,
  cued: colors.brandText,
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
      ? colors.onairFill
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

type DotProps = {
  tone?: PillTone;
  size?: number;
  /** Text shown after the dot. Without it the dot renders bare (legacy). */
  label?: ReactNode;
  title?: string;
  /** Makes the dot+label a button (e.g. opens a status menu). */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: CSSProperties;
};

export function StatusDot({ tone = "neutral", size = 8, label, title, onClick, style }: DotProps) {
  const dot: CSSProperties = {
    display: "inline-block",
    width: size,
    height: size,
    borderRadius: radius.pill,
    background: TONE[tone],
    flexShrink: 0,
  };
  if (label === undefined && !onClick) {
    return <span aria-hidden title={title} style={{ ...dot, ...style }} />;
  }
  const wrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: fontSize.sm,
    color: colors.textDim,
    whiteSpace: "nowrap",
    ...style,
  };
  const inner = (
    <>
      <span aria-hidden style={dot} />
      {label}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{ ...wrap, background: "transparent", border: "none", padding: "2px 4px", borderRadius: radius.sm, cursor: "pointer" }}
      >
        {inner}
      </button>
    );
  }
  return (
    <span title={title} style={wrap}>
      {inner}
    </span>
  );
}
