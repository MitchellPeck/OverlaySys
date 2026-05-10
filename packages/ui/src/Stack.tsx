import type { CSSProperties, ReactNode } from "react";
import { space, type SpaceKey } from "./tokens";

type Props = {
  gap?: SpaceKey;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  children: ReactNode;
  style?: CSSProperties;
};

/** Vertical flex container with token-based gap. */
export function Stack({ gap = 2, align, justify, wrap = false, children, style }: Props) {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: space[gap],
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : "nowrap",
  };
  return <div style={{ ...base, ...style }}>{children}</div>;
}

/** Horizontal flex container with token-based gap. */
export function Inline({
  gap = 2,
  align = "center",
  justify,
  wrap = false,
  children,
  style,
}: Props) {
  const base: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    gap: space[gap],
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? "wrap" : "nowrap",
  };
  return <div style={{ ...base, ...style }}>{children}</div>;
}
