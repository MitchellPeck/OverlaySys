import type { CSSProperties } from "react";
import { colors, control, type ControlSize } from "./tokens";

/**
 * `destructive` and `success` are deprecated aliases kept for existing call
 * sites: `destructive` is the filled red confirm button, `success` renders as
 * `secondary` (green is reserved for preview / next).
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "onair"
  | "destructive"
  | "success";

const common: CSSProperties = {
  whiteSpace: "nowrap",
  opacity: 1,
  borderWidth: 1,
  borderStyle: "solid",
};

const secondary: CSSProperties = {
  ...common,
  background: colors.surface2,
  color: colors.text,
  borderColor: colors.border,
};

/**
 * Colours for a button variant. A disabled button never fades: filled and
 * outline variants render as `secondary` in muted text at full opacity, so a
 * disabled Take reads grey, not red.
 */
export function variantStyle(variant: ButtonVariant, disabled: boolean): CSSProperties {
  if (disabled) {
    if (variant === "ghost") {
      return { ...common, background: "transparent", color: colors.textMuted, borderColor: "transparent" };
    }
    return { ...secondary, color: colors.textMuted };
  }
  switch (variant) {
    case "primary":
      return { ...common, background: colors.brandFill, color: "#fff", borderColor: colors.brandFill };
    case "onair":
      return { ...common, background: colors.onairFill, color: "#fff", borderColor: colors.onairFill };
    case "danger":
      return { ...common, background: "transparent", color: colors.dangerText, borderColor: colors.danger };
    case "destructive":
      // Same red as on-air: the AA fill under white text.
      return { ...common, background: colors.onairFill, color: "#fff", borderColor: colors.onairFill };
    case "ghost":
      return { ...common, background: "transparent", color: colors.text, borderColor: "transparent" };
    case "secondary":
    case "success":
      return secondary;
  }
}

/** Fixed-height box for a control size (sm 24, md 28, lg 32). */
export function sizeStyle(size: ControlSize): CSSProperties {
  const c = control[size];
  return {
    height: c.height,
    padding: `0 ${c.padX}px`,
    fontSize: c.fontSize,
    borderRadius: c.radius,
    boxSizing: "border-box",
  };
}
