"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { detachSlidesRow, setDeck, rowSlideIds, type Deck, type SlidesRow } from "@overlaysys/core";
import { Button, colors, fontSize, useConfirm } from "@overlaysys/ui";
import { plural } from "@/lib/listFormat";
import { useDeckFor } from "@/lib/slidesRowView";
import { FormRow } from "@/app/shows/edit/forms/ItemCommonFields";
import { DeckPicker } from "./DeckPicker";
import { LocalSlidesEditor } from "./LocalSlidesEditor";
import { DesignRow, LinkButton, SlideText, SlidesList, linkStyle, newSlideId } from "./slidesRowParts";
import { detachConfirm, slideCountText } from "./slidesRowModel";

export { textFieldKeys } from "./slidesRowParts";

/**
 * Inspector for a slides row in the show editor: the deck, this week's slides
 * (subset, order, repeats), this week's design and text, and Detach. Every
 * edit goes through `onChange` with the whole row; nothing is saved here.
 */
export function SlidesRowInspector({ row, onChange }: { row: SlidesRow; onChange(row: SlidesRow): void }) {
  const deck = useDeckFor(row);
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  // Edits made from async callbacks (confirm) land on the latest row.
  const rowRef = useRef(row);
  rowRef.current = row;

  // Back to the first slide when another row (or deck) is shown.
  useEffect(() => setSelected(0), [row.id, row.deckId]);

  const oneOff = !row.deckId;
  // One-off rows edit their own slides with the same ops.
  const source: Pick<Deck, "slides"> | null = oneOff ? { slides: row.localSlides ?? [] } : deck ?? null;

  const deckLine = (() => {
    if (oneOff) return <DeckLine name="One-off slides" detail={countDetail(row, source, true)} />;
    if (deck === undefined) return <DeckLine name="Loading deck…" />;
    if (deck === null) return <DeckLine name="Missing deck" detail="Deck deleted or not synced" warn />;
    return <DeckLine name={deck.name} detail={countDetail(row, deck)} />;
  })();

  const switchDeck = async (deckId: string) => {
    const cur = rowRef.current;
    if (deckId === cur.deckId) return;
    if (!cur.deckId && (cur.localSlides ?? []).length > 0) {
      const ok = await confirm({
        title: "Replace these slides?",
        message: "This item's own slides are replaced by the deck's slides.",
        confirmLabel: "Use deck",
      });
      if (!ok) return;
    }
    onChange(setDeck(rowRef.current, deckId));
  };

  const detach = async () => {
    if (!deck) return;
    if (!(await confirm(detachConfirm(deck.name, deck.licensing.kind === "ccli")))) return;
    onChange(detachSlidesRow(rowRef.current, deck, newSlideId));
  };

  return (
    <>
      <FormRow label="Deck">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {deckLine}
          <div style={{ display: "flex", gap: 12 }}>
            <LinkButton onClick={() => setPickerOpen(true)}>{oneOff ? "Use a deck" : "Change deck"}</LinkButton>
            {row.deckId && deck && (
              <Link href={`/slides/edit?id=${encodeURIComponent(row.deckId)}`} style={linkStyle}>
                Edit deck
              </Link>
            )}
          </div>
        </div>
      </FormRow>

      {oneOff ? (
        <LocalSlidesEditor row={row} selected={selected} onSelect={setSelected} onChange={onChange} />
      ) : (
        deck && (
          <>
            <SlidesList row={row} source={deck} oneOff={false} selected={selected} onSelect={setSelected} onChange={onChange} />
            <DesignRow row={row} deck={deck} source={deck} oneOff={false} onChange={onChange} />
            <SlideText row={row} source={deck} deck={deck} oneOff={false} position={selected} onChange={onChange} />
          </>
        )
      )}

      {row.deckId && deck && (
        <FormRow label="">
          <div>
            <Button variant="secondary" size="sm" onClick={() => void detach()}>
              Detach to this show
            </Button>
          </div>
        </FormRow>
      )}

      <DeckPicker
        open={pickerOpen}
        title={oneOff ? "Use a deck" : "Change deck"}
        onClose={() => setPickerOpen(false)}
        onPick={(deckId) => {
          setPickerOpen(false);
          void switchDeck(deckId);
        }}
      />
    </>
  );
}

/** Deck rows: "n of m slides" (distinct deck slides used). One-off rows: how many slides play. */
function countDetail(row: SlidesRow, source: Pick<Deck, "slides"> | null, oneOff = false): string {
  if (!source) return "";
  const byId = new Set(source.slides.map((s) => s.id));
  const ids = rowSlideIds(row, source).filter((id) => byId.has(id));
  if (oneOff) return plural(ids.length, "slide");
  return slideCountText(new Set(ids).size, source.slides.length);
}

function DeckLine({ name, detail, warn }: { name: string; detail?: string; warn?: boolean }) {
  return (
    <div style={{ fontSize: fontSize.md, color: warn ? colors.warn : colors.text, paddingTop: 4 }}>
      <span style={{ fontWeight: 600 }}>{name}</span>
      {detail && <span style={{ color: colors.textMuted }}> · {detail}</span>}
    </div>
  );
}

