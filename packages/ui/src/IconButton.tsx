import type { ButtonHTMLAttributes, CSSProperties } from "react";
import { colors, fontSize, radius } from "./tokens";

export type IconButtonTone = "default" | "danger";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-label"> & {
  /**
   * Accessible name. Contract: required. Kept optional at the type level only
   * until the plan 2a/2b call sites that pass just `title` are migrated; a
   * missing label warns in development.
   */
  "aria-label"?: string;
  size?: number;
  tone?: IconButtonTone;
  type?: "button" | "submit" | "reset";
};

const warned = new Set<string>();

export function IconButton({
  size = 28,
  tone = "default",
  type = "button",
  style,
  disabled,
  ...rest
}: Props) {
  const label = rest["aria-label"];
  if (!label && process.env.NODE_ENV !== "production") {
    const key = String(rest.title ?? "(untitled)");
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`IconButton without aria-label (title: ${key}). Pass aria-label.`);
    }
  }
  const base: CSSProperties = {
    width: size,
    height: size,
    background: "transparent",
    color: disabled ? colors.textMuted : tone === "danger" ? colors.dangerText : colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: fontSize.base,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    flexShrink: 0,
    boxSizing: "border-box",
    opacity: 1,
  };
  return (
    <button
      {...rest}
      // Fall back to the tooltip text as the accessible name.
      aria-label={label ?? (typeof rest.title === "string" ? rest.title : undefined)}
      type={type}
      disabled={disabled}
      style={{ ...base, ...style }}
    />
  );
}
