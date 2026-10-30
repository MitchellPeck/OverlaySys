"use client";

import { useEffect, useState } from "react";
import type { Deck } from "@overlaysys/core";
import { Input, NumberInput, Switch, colors, fontSize } from "@overlaysys/ui";
import { FOLDER_DECK_HOLD_SEC } from "./folderDeckOps";
import { parseHoldText, setDefaultHold, setLoop } from "./deckDraftOps";

const labelStyle = { fontSize: fontSize.sm, color: colors.textDim } as const;

/** The hold a slide falls back to, for a per-slide field's placeholder. */
export const holdPlaceholder = (deck: Deck) =>
  deck.defaultHoldSec !== undefined ? `Deck default (${deck.defaultHoldSec} s)` : "Waits for the operator";

/** The deck's Timing settings: auto-advance with a default hold, and Loop. */
export function DeckTimingFields({ deck, onChange }: { deck: Deck; onChange(fn: (d: Deck) => Deck): void }) {
  const auto = deck.defaultHoldSec !== undefined;
  return (
    <>
      <Switch
        label="Auto-advance"
        checked={auto}
        onChange={(on) => onChange((d) => setDefaultHold(d, on ? FOLDER_DECK_HOLD_SEC : undefined))}
      />
      {auto && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="deck-hold" style={labelStyle}>
            Hold each slide
          </label>
          <NumberInput
            id="deck-hold"
            value={deck.defaultHoldSec!}
            min={0.5}
            step={1}
            precision={1}
            suffix="s"
            onCommit={(v) => onChange((d) => setDefaultHold(d, v))}
          />
        </div>
      )}
      <Switch label="Loop" checked={deck.loop === true} onChange={(on) => onChange((d) => setLoop(d, on))} />
      <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
        {deck.loop ? "After the last slide it starts again." : "It stops on the last slide."}
      </div>
    </>
  );
}

/** Seconds as typed; blank falls back to the deck's hold. Commits on blur or Enter. */
export function HoldField({
  id,
  label,
  value,
  placeholder,
  onCommit,
}: {
  id: string;
  label: string;
  value: number | undefined;
  placeholder: string;
  onCommit(sec: number | undefined): void;
}) {
  const shown = value === undefined ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const sec = parseHoldText(text);
    if (sec !== value) onCommit(sec);
    else setText(shown);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}
