"use client";

import type { PcoPlanItem } from "@overlaysys/core";
import { Button, Inline, colors } from "@overlaysys/ui";
import type { ReactNode } from "react";
import { groupItemsUnderHeaders } from "./pcoItemGroups";

/**
 * Items grouped under their PCO headers. A header is a section heading row
 * (no checkbox) because the importer turns headers into show sections.
 * `renderItem` returns the row for one non-header item.
 */
export function PcoItemList({
  items,
  selectedCount,
  selectableCount,
  importedCount,
  onSelectAll,
  renderItem,
}: {
  items: PcoPlanItem[];
  selectedCount: number;
  selectableCount: number;
  importedCount: number;
  onSelectAll: (include: boolean) => void;
  renderItem: (item: PcoPlanItem) => ReactNode;
}) {
  const groups = groupItemsUnderHeaders(items);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Inline gap={2} align="center">
        <strong style={{ color: colors.text, fontSize: 13 }}>
          Items ({selectedCount}/{selectableCount} selected)
        </strong>
        <Button size="sm" onClick={() => onSelectAll(true)} disabled={selectedCount === selectableCount}>
          Select all
        </Button>
        <Button size="sm" onClick={() => onSelectAll(false)} disabled={selectedCount === 0}>
          Deselect all
        </Button>
        {importedCount > 0 && (
          <span style={{ color: colors.textDim, fontSize: 12 }}>
            {importedCount} of {selectableCount} already imported
          </span>
        )}
      </Inline>
      {groups.map((g, gi) => (
        <div key={g.header?.id ?? `lead-${gi}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {g.header && (
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                marginTop: 6,
                paddingBottom: 4,
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 13, color: colors.text }}>{g.header.title}</h3>
              <span style={{ color: colors.textDim, fontSize: 12 }}>Becomes a section</span>
            </div>
          )}
          {g.items.map((it) => renderItem(it))}
        </div>
      ))}
    </div>
  );
}
