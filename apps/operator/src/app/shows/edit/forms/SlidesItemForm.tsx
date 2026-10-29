"use client";

import type { ReactElement } from "react";
import { v4 as uuid } from "uuid";
import { newOneOffSlidesRow, newSlidesRow, type SlidesRow } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { isCloudMode } from "@/lib/mode";
import type { RowLike } from "@/lib/rowLike";
import { slidesRowViewFor, useDeckFor } from "@/lib/slidesRowView";
import { DeckPicker } from "@/app/slides/row/DeckPicker";
import { SlidesRowInspector, textFieldKeys } from "@/app/slides/row/SlidesRowInspector";
import { defaultDeckTemplateId } from "@/app/slides/libraryConfig";
import { ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import { patchRow } from "./itemFormModel";
import type { ItemFormProps } from "./types";

/**
 * Show-editor slot for slides rows (contracts §9): the row inspector inside
 * the usual item form frame (live preview at the top right), and the
 * "Add item → Slides" flow (deck picker or one-off slides).
 */
/** True: "Add item → Slides" opens SlidesAddFlow. */
export const slidesAddFlowReady = true;

/** Built-in lyric template; used for one-off slides when no template list has loaded. */
const FALLBACK_TEMPLATE_ID = "lyric-default";

export function SlidesItemForm({ row, show, onChange }: ItemFormProps<RowLike>): ReactElement {
  const slides = row as SlidesRow;
  const deck = useDeckFor(row);
  const name = slidesRowViewFor(row, deck)?.title ?? "Slides";
  return (
    <ItemFormFrame row={row} show={show} name={name}>
      <SlidesRowInspector row={slides} onChange={(next) => onChange(next)} />
      <ItemCommonFields
        row={row}
        onChange={(p) => onChange(patchRow(row, p))}
        showSermonNotes
        sets={isCloudMode() ? [] : show.sermonNotes ?? []}
      />
    </ItemFormFrame>
  );
}

export function SlidesAddFlow({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose(): void;
  onAdd(row: RowLike): void;
}): ReactElement | null {
  const templates = useStore((s) => s.templates);
  return (
    <DeckPicker
      open={open}
      onClose={onClose}
      onPick={(deckId) => onAdd(newSlidesRow(uuid(), deckId) as RowLike)}
      onOneOff={() => {
        const templateId = defaultDeckTemplateId(templates) ?? FALLBACK_TEMPLATE_ID;
        // Seed "" per text field so the new, empty slide airs blank (not the design's sample text).
        onAdd(newOneOffSlidesRow(uuid(), templateId, `s-${uuid().slice(0, 8)}`, textFieldKeys(templateId)) as RowLike);
      }}
    />
  );
}
