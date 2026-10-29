"use client";

import { useEffect, useMemo, useState } from "react";
import type { Deck } from "@overlaysys/core";
import { Button, Dialog, Input, colors, fontSize, radius, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { formatRelative, plural } from "@/lib/listFormat";
import { NewDeckDialog } from "../NewDeckDialog";
import { deckPickerList } from "./slidesRowModel";

/**
 * Choose a deck for a slides row: search by name or tag, recently edited
 * first. "New deck…" creates one (saved on the server first) and picks it.
 * `onOneOff`, when given, adds "One-off slides for this show".
 */
export function DeckPicker({
  open,
  onClose,
  onPick,
  onOneOff,
  title = "Add slides",
}: {
  open: boolean;
  onClose(): void;
  onPick(deckId: string): void;
  onOneOff?(): void;
  title?: string;
}) {
  const toast = useToast();
  const { connected } = useConnection();
  const decks = useStore((s) => s.decks);
  const decksLoaded = useStore((s) => s.decksLoaded);
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    if (connected) getClient().send({ type: "list_decks" });
  }, [open, connected]);

  const list = useMemo(() => deckPickerList(decks, query), [decks, query]);
  const now = new Date();

  const createDeck = async (deck: Deck) => {
    try {
      await sendAndAwaitAck(getClient(), { type: "save_deck", deck }, { op: "save_deck", id: deck.id });
    } catch (e) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });
      return;
    }
    useStore.getState().upsertDeck(deck);
    setNewOpen(false);
    onPick(deck.id);
  };

  let body;
  if (!connected) {
    body = <Empty text="Reconnect to the server to choose a deck." />;
  } else if (!decksLoaded) {
    body = <Empty text="Loading decks…" />;
  } else if (decks.length === 0) {
    body = <Empty text="No decks yet. Create one with New deck…" />;
  } else if (list.length === 0) {
    body = <Empty text="No decks match." />;
  } else {
    body = (
      <ul role="listbox" aria-label="Decks" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {list.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onPick(d.id)}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                width: "100%",
                padding: "7px 10px",
                background: "transparent",
                border: "none",
                borderRadius: radius.md,
                color: colors.text,
                fontSize: fontSize.md,
                textAlign: "left",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.control)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name}
                {d.tags.length > 0 && (
                  <span style={{ marginLeft: 8, color: colors.textMuted, fontSize: fontSize.xs }}>{d.tags.join(" · ")}</span>
                )}
              </span>
              <span style={{ color: colors.textMuted, fontSize: fontSize.xs, whiteSpace: "nowrap" }}>
                {plural(d.slideCount, "slide")} · {formatRelative(d.updatedAt ?? d.createdAt, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <Dialog
        open={open && !newOpen}
        onClose={onClose}
        title={title}
        size="md"
        footer={
          <>
            <Button variant="secondary" size="md" disabled={!connected} onClick={() => setNewOpen(true)}>
              New deck…
            </Button>
            <span style={{ flex: 1 }} />
            <Button variant="secondary" size="md" onClick={onClose}>
              Cancel
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input
            size="md"
            autoFocus
            aria-label="Search decks"
            placeholder="Search decks or tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && list.length > 0) {
                e.preventDefault();
                onPick(list[0]!.id);
              }
            }}
          />
          <div style={{ maxHeight: 340, overflowY: "auto" }}>{body}</div>
          {onOneOff && (
            <button
              type="button"
              onClick={onOneOff}
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                padding: 0,
                color: colors.accent,
                fontSize: fontSize.sm,
                cursor: "pointer",
              }}
            >
              One-off slides for this show
            </button>
          )}
        </div>
      </Dialog>
      <NewDeckDialog open={open && newOpen} onClose={() => setNewOpen(false)} onCreate={createDeck} initialName={query.trim()} />
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ margin: "12px 0", color: colors.textMuted, fontSize: fontSize.sm }}>{text}</p>;
}
