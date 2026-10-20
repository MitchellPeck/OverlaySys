import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, space } from "./tokens";

/** The one panel header style used across the shell and console. */
export function PanelHeader({
  title,
  right,
  style,
}: {
  title: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        height: 32,
        flexShrink: 0,
        padding: `0 ${space[3]}px`,
        borderBottom: `1px solid ${colors.border}`,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: colors.textDim,
        ...style,
      }}
    >
      <span>{title}</span>
      {right !== undefined && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: space[2], fontWeight: fontWeight.regular }}>
          {right}
        </div>
      )}
    </div>
  );
}
