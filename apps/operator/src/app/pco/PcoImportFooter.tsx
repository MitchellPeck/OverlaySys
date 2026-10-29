"use client";

import { Button, colors } from "@overlaysys/ui";

/** Sticky bottom bar: what will be imported, and the primary Import action. */
export function PcoImportFooter({
  summary,
  canImport,
  importing,
  onImport,
}: {
  summary: string;
  canImport: boolean;
  importing: boolean;
  onImport: () => void;
}) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 12px",
        background: colors.surface2,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
      }}
    >
      <span style={{ color: colors.textDim, fontSize: 13 }}>{summary}</span>
      <Button variant="primary" disabled={!canImport} onClick={onImport}>
        {importing ? "Importing…" : "Import"}
      </Button>
    </div>
  );
}
