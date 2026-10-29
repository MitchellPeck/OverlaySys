"use client";

import type { ReactElement } from "react";
import type { Show } from "@overlaysys/core";
import { colors } from "@overlaysys/ui";
import type { RowLike } from "@/lib/rowLike";

/**
 * Show-editor slot for slides rows (contracts §9). Placeholders created early
 * by P2a.17 so the editor can mount them; P2a.18 owns the file next and P3.16
 * replaces both bodies (SlidesRowInspector, DeckPicker).
 */
/** False while SlidesAddFlow is a placeholder: the "Add item → Slides" entry stays disabled ("Coming soon"). P3.16 sets it true. */
export const slidesAddFlowReady = false;

export type SlidesItemFormProps = { row: RowLike; show: Show; onChange(next: RowLike): void };

export function SlidesItemForm(_p: SlidesItemFormProps): ReactElement {
  return (
    <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>Slides decks aren&apos;t available yet.</p>
  );
}

export function SlidesAddFlow(_p: { open: boolean; onClose(): void; onAdd(row: RowLike): void }): ReactElement | null {
  return null;
}
