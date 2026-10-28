import type { SelectHTMLAttributes, CSSProperties } from "react";
import { colors, control, radius, type ControlSize } from "./tokens";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: ControlSize;
};

/** lucide `chevron-down` in --text-dim (#aaaab0), drawn as a CSS background. */
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aaaab0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function Select({ size = "sm", style, children, ...rest }: Props) {
  const c = control[size];
  const base: CSSProperties = {
    width: "100%",
    height: c.height,
    padding: `0 ${c.padX - 2 + 20}px 0 ${c.padX - 2}px`,
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
    backgroundColor: colors.surface2,
    backgroundImage: CHEVRON,
    backgroundRepeat: "no-repeat",
    backgroundPosition: `right ${c.padX - 4}px center`,
    backgroundSize: "14px 14px",
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    cursor: "pointer",
  };
  return (
    <select {...rest} style={{ ...base, ...style }}>
      {children}
    </select>
  );
}
