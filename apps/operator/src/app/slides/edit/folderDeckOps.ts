import { nextFolderOrder, type Deck, type LiveFolderFile, type MediaFit, type MediaPosition } from "@overlaysys/core";
import { applyPlacement, ownPlacement, type PlacementPatch } from "../../../lib/mediaPlacement";
import { validHold } from "./deckDraftOps";

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

type FolderEntry = FolderOrder[number];

/** `order` with file's entry replaced by `fn(entry)`. A file not in the order yet joins the end. */
function mapFolderFile(order: FolderOrder, file: string, fn: (e: FolderEntry) => FolderEntry): FolderOrder {
  const i = order.findIndex((o) => o.file === file);
  if (i < 0) return [...order, fn({ file })];
  const next = order.slice();
  next[i] = fn(order[i]!);
  return next;
}

/** One file's own hold; `undefined` falls back to the deck's. Its size/position are kept. */
export function setFolderFileHold(order: FolderOrder, file: string, sec: number | undefined): FolderOrder {
  const hold = validHold(sec);
  return mapFolderFile(order, file, ({ holdSec: _old, ...rest }) => (hold !== undefined ? { ...rest, holdSec: hold } : rest));
}

/** One file's own size/position; `undefined` goes back to the deck's. */
export function setFolderFilePlacement(order: FolderOrder, file: string, patch: PlacementPatch): FolderOrder {
  return mapFolderFile(order, file, (e) => applyPlacement(e, patch));
}

export type FolderDeckEntry = {
  file: string;
  mediaType?: "image" | "video";
  holdSec?: number;
  fit?: MediaFit;
  position?: MediaPosition;
};

/**
 * What the folder deck's editor lists. On the show computer (`configured`):
 * the files present now, in play order (new files at the end). Elsewhere the
 * files can't be seen, so every saved file by name.
 */
export function folderDeckEntries(order: Deck["folderOrder"], files: LiveFolderFile[], configured: boolean): FolderDeckEntry[] {
  const own = (o: FolderEntry) => ({ ...(o.holdSec !== undefined ? { holdSec: o.holdSec } : {}), ...ownPlacement(o) });
  if (!configured) return (order ?? []).map((o) => ({ file: o.file, ...own(o) }));
  const present = new Map(files.map((f) => [f.name, f]));
  const out: FolderDeckEntry[] = [];
  for (const o of nextFolderOrder(order, files)) {
    const f = present.get(o.file);
    if (f) out.push({ file: o.file, mediaType: f.mediaType, ...own(o) });
  }
  return out;
}
