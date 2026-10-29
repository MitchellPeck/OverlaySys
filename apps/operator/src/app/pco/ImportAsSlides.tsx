"use client";

import { useState } from "react";
import type { Deck, DeckMeta, DeckSuggestion, PcoPlanItem } from "@overlaysys/core";
import { Button, Checkbox, Field, Pill, Select, colors } from "@overlaysys/ui";
import { sendAndAwaitAck } from "@/lib/awaitAck";
import { getClient } from "@/lib/useWs";
import { NewDeckDialog } from "../slides/NewDeckDialog";
import { rememberLabel } from "./slidesImport";

const NEW_DECK = "__new-deck__";
const mutedNote = { color: colors.textDim, fontSize: 12, margin: 0 } as const;

/**
 * Deck picker for an item imported as Slides: the deck, a "Remember" checkbox
 * (on by default), the remembered pill with "Forget", and a name-match hint.
 */
export function ImportAsSlides({
  item,
  decks,
  deckId,
  remember,
  suggestion,
  onDeck,
  onRemember,
  onForget,
}: {
  item: Pick<PcoPlanItem, "title" | "song">;
  decks: DeckMeta[];
  deckId: string;
  remember: boolean;
  suggestion: DeckSuggestion | undefined;
  onDeck: (id: string) => void;
  onRemember: (v: boolean) => void;
  onForget: () => void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRemembered = suggestion?.via === "remembered" && suggestion.deckId === deckId && !!deckId;
  const nameHint = suggestion?.via === "name" && suggestion.deckId !== deckId ? suggestion : null;

  const createDeck = async (deck: Deck) => {
    try {
      await sendAndAwaitAck(getClient(), { type: "save_deck", deck }, { op: "save_deck", id: deck.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the deck.");
      return;
    }
    setError(null);
    setNewOpen(false);
    onDeck(deck.id);
  };

  // A deck just created may not be in the list yet; keep it selectable.
  const known = decks.some((d) => d.id === deckId);

  return (
    <>
      <Field label="Deck">
        <Select
          value={deckId}
          aria-label={`Deck for ${item.title}`}
          onChange={(e) => (e.target.value === NEW_DECK ? setNewOpen(true) : onDeck(e.target.value))}
        >
          <option value="">Choose a deck…</option>
          {!known && deckId && <option value={deckId}>{suggestion?.deckName ?? deckId}</option>}
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={NEW_DECK}>New deck from this item…</option>
        </Select>
      </Field>
      {isRemembered && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill tone="accent">{`Remembered · Slides → ${suggestion!.deckName}`}</Pill>
          <Button size="sm" variant="ghost" onClick={onForget}>
            Forget
          </Button>
        </div>
      )}
      {nameHint && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={mutedNote}>Suggested: {nameHint.deckName}</span>
          <Button size="sm" onClick={() => onDeck(nameHint.deckId)}>
            Use
          </Button>
        </div>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, color: colors.text, fontSize: 12 }}>
        <Checkbox checked={remember} onChange={() => onRemember(!remember)} />
        {rememberLabel(item)}
      </label>
      {error && <p style={{ ...mutedNote, color: colors.danger }}>{error}</p>}
      <NewDeckDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={createDeck}
        initialName={item.title}
      />
    </>
  );
}
