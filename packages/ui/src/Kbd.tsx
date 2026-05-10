import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { colors, fontSize, radius } from "./tokens";

type Props = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
};

/** Inline keyboard hint chip. */
export function Kbd({ style, children, ...rest }: Props) {
  const base: CSSProperties = {
    display: "inline-block",
    padding: "1px 6px",
    background: colors.panel2,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    color: colors.textDim,
    fontFamily: "ui-monospace, monospace",
    fontSize: fontSize.xs,
    lineHeight: 1.4,
  };
  return (
    <kbd {...rest} style={{ ...base, ...style }}>
      {children}
    </kbd>
  );
}
