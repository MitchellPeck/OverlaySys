import { nextFolderOrder, type Deck, type LiveFolderFile } from "@overlaysys/core";

/** Pure edits on a live-folder deck's saved play order. Every op returns a new order, or the same one when nothing changes. */

export type FolderOrder = NonNullable<Deck["folderOrder"]>;

/** A new live-folder deck: no slides of its own, every graphic held 8 s, looping. */
export const FOLDER_DECK_HOLD_SEC = 8;

export function newFolderDeck(i: { name: string; folderId: string; templateId: string; deckId: string; now: string }): Deck {
  return {
    id: i.deckId,
    name: i.name.trim(),
    tags: [],
    defaultTemplateId: i.templateId,
    licensing: { kind: "own" },
    slides: [],
    createdAt: i.now,
    liveFolderId: i.folderId,
    defaultHoldSec: FOLDER_DECK_HOLD_SEC,
    loop: true,
  };
}

/**
 * Moves file `from` to where file `to` sits. Per-file holds travel with the
 * file; saved slots of missing files stay in the order, so they come back
 * where they were.
 */
export function moveFolderFile(order: FolderOrder, from: string, to: string): FolderOrder {
  const i = order.findIndex((o) => o.file === from);
  const j = order.findIndex((o) => o.file === to);
  if (i < 0 || j < 0 || i === j) return order;
  const next = order.slice();
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved!);
  return next;
}

/** One file's own hold; `undefined` falls back to the deck's. A file not in the order yet joins the end. */
export function setFolderFileHold(order: FolderOrder, file: string, sec: number | undefined): FolderOrder {
  const entry = sec !== undefined && Number.isFinite(sec) && sec > 0 ? { file, holdSec: sec } : { file };
  const i = order.findIndex((o) => o.file === file);
  if (i < 0) return [...order, entry];
  const next = order.slice();
  next[i] = entry;
  return next;
}

export type FolderDeckEntry = { file: string; mediaType?: "image" | "video"; holdSec?: number };

/**
 * What the folder deck's editor lists. On the show computer (`configured`):
 * the files present now, in play order (new files at the end). Elsewhere the
 * files can't be seen, so every saved file by name.
 */
export function folderDeckEntries(order: Deck["folderOrder"], files: LiveFolderFile[], configured: boolean): FolderDeckEntry[] {
  if (!configured) return (order ?? []).map((o) => ({ file: o.file, ...(o.holdSec !== undefined ? { holdSec: o.holdSec } : {}) }));
  const present = new Map(files.map((f) => [f.name, f]));
  const out: FolderDeckEntry[] = [];
  for (const o of nextFolderOrder(order, files)) {
    const f = present.get(o.file);
    if (f) out.push({ file: o.file, mediaType: f.mediaType, ...(o.holdSec !== undefined ? { holdSec: o.holdSec } : {}) });
  }
  return out;
}
