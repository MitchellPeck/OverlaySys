import type { ReactNode } from "react";
import { colors } from "@overlaysys/ui";

/** Header + left rail + main (+ optional right rail). The song editor passes no `right`. */
export function EditorFrame(p: {
  header: ReactNode;
  left: ReactNode;
  main: ReactNode;
  right?: ReactNode;
  leftWidth?: string;
  rightWidth?: string;
}) {
  const cols = `${p.leftWidth ?? "26%"} minmax(0, 1fr)${p.right ? ` ${p.rightWidth ?? "300px"}` : ""}`;
  const pane = { minHeight: 0, overflow: "auto" as const };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flex: "none", borderBottom: `1px solid ${colors.border}` }}>{p.header}</div>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: cols }}>
        <div style={{ ...pane, borderRight: `1px solid ${colors.border}` }}>{p.left}</div>
        <div style={pane}>{p.main}</div>
        {p.right && <div style={{ ...pane, borderLeft: `1px solid ${colors.border}` }}>{p.right}</div>}
      </div>
    </div>
  );
}
