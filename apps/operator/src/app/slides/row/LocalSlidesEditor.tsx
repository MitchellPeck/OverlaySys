"use client";

import { useRef, useState } from "react";
import { ClipboardPaste, LibraryBig } from "lucide-react";
import { pasteLocalSlides, saveRowToLibrary, splitPastedSlides, type Deck, type SlidesRow } from "@overlaysys/core";
import { Button, Dialog, Textarea, colors, fontSize, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { plural } from "@/lib/listFormat";
import { slideFieldsFor } from "@/app/songs/edit/slides";
import { FormRow } from "@/app/shows/edit/forms/ItemCommonFields";
import { NewDeckDialog } from "../NewDeckDialog";
import { DesignRow, SlideText, SlidesList, newSlideId, textFieldKeys } from "./slidesRowParts";
import { suggestDeckName } from "./slidesRowModel";

/**
 * Editor for a one-off slides row (no deck): add, delete, reorder, text,
 * "Paste text…" (a blank line starts a new slide) and "Save to library…",
 * which saves the slides as a new global deck and points the row at it.
 * Edits go through `onChange`; only "Save to library…" talks to the server,
 * and the row changes only once the deck's save is acknowledged.
 */
export function LocalSlidesEditor({
  row,
  selected,
  onSelect,
  onChange,
}: {
  row: SlidesRow;
  selected: number;
  onSelect(position: number): void;
  onChange(row: SlidesRow): void;
}) {
  const toast = useToast();
  const { connected } = useConnection();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const rowRef = useRef(row);
  rowRef.current = row;
  const source = { slides: row.localSlides ?? [] };

  const paste = (text: string) => {
    const cur = rowRef.current;
    const fields = slideFieldsFor(cur.templateId ? useStore.getState().templateCache[cur.templateId] : null);
    const target = (fields.find((f) => f.multiline) ?? fields[0])?.key ?? "text";
    const before = (cur.slideIds ?? (cur.localSlides ?? []).map((s) => s.id)).length;
    const next = pasteLocalSlides(cur, splitPastedSlides(text), {
      newId: newSlideId,
      fieldKeys: textFieldKeys(cur.templateId),
      targetKey: target,
    });
    onChange(next);
    // Select the first pasted slide (the lone empty slide is filled in place).
    const after = (next.slideIds ?? (next.localSlides ?? []).map((s) => s.id)).length;
    onSelect(after - before === splitPastedSlides(text).length ? before : 0);
    setPasteOpen(false);
  };

  const saveToLibrary = async (built: Deck) => {
    // The dialog supplies id, name, licensing and design; the slides are the row's own.
    const { deck, row: next } = saveRowToLibrary(
      { ...rowRef.current, templateId: built.defaultTemplateId },
      { deckId: built.id, name: built.name, licensing: built.licensing, now: built.createdAt },
    );
    try {
      await sendAndAwaitAck(getClient(), { type: "save_deck", deck }, { op: "save_deck", id: deck.id });
    } catch (e) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });
      return;
    }
    useStore.getState().upsertDeck(deck);
    setSaveOpen(false);
    onChange(next);
    toast({ tone: "ok", message: `Saved "${deck.name}" to the slides library. Save the show to keep this item linked.` });
  };

  return (
    <>
      <SlidesList row={row} source={source} oneOff selected={selected} onSelect={onSelect} onChange={onChange} />
      <FormRow label="">
        <div>
          <Button variant="secondary" size="sm" onClick={() => setPasteOpen(true)}>
            <ClipboardPaste size={13} /> Paste text…
          </Button>
        </div>
      </FormRow>
      <DesignRow row={row} deck={null} source={source} oneOff onChange={onChange} />
      <SlideText row={row} source={source} deck={null} oneOff position={selected} onChange={onChange} />
      <FormRow label="">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
          <Button
            variant="secondary"
            size="sm"
            disabled={!connected}
            title={connected ? undefined : "Reconnect to the server to save to the library"}
            onClick={() => setSaveOpen(true)}
          >
            <LibraryBig size={13} /> Save to library…
          </Button>
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            Makes these slides a deck you can use in other shows.
          </span>
        </div>
      </FormRow>
      <PasteTextDialog open={pasteOpen} onClose={() => setPasteOpen(false)} onPaste={paste} />
      <NewDeckDialog
        open={saveOpen}
        title="Save to library"
        createLabel="Save"
        initialName={suggestDeckName(row)}
        initialTemplateId={row.templateId}
        onClose={() => setSaveOpen(false)}
        onCreate={saveToLibrary}
      />
    </>
  );
}

function PasteTextDialog({ open, onClose, onPaste }: { open: boolean; onClose(): void; onPaste(text: string): void }) {
  const [text, setText] = useState("");
  const n = splitPastedSlides(text).length;
  const close = () => {
    setText("");
    onClose();
  };
  const add = () => {
    if (n === 0) return;
    onPaste(text);
    setText("");
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Paste text"
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" size="md" disabled={n === 0} onClick={add}>
            {n === 0 ? "Add slides" : `Add ${plural(n, "slide")}`}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="paste-slides-text" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
          Text
        </label>
        <Textarea
          id="paste-slides-text"
          autoFocus
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
        />
        <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>A blank line starts a new slide.</span>
      </div>
    </Dialog>
  );
}
