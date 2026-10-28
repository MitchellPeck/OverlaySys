import { randomUUID } from "node:crypto";
import type { Deck, DeckMeta } from "@overlaysys/core";
import * as store from "./decksStore";
import { isLive, liveOnly, stampWrite, tombstone } from "./lifecycle";
import { listShowMetas, getShow } from "./shows";

const REGISTRY = new Map<string, Deck>();
let loaded = false;

export async function reloadDecks(): Promise<void> {
  const all = await store.loadAllDecks();
  REGISTRY.clear();
  for (const d of all) REGISTRY.set(d.id, d);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadDecks();
}

/** Number of live shows with at least one slides row on each deck id. */
async function usageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const meta of await listShowMetas()) {
    const show = await getShow(meta.id);
    if (!show) continue;
    const used = new Set<string>();
    for (const r of show.rows) {
      if (r.kind === "slides" && r.deckId) used.add(r.deckId);
    }
    for (const id of used) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function listDeckMetas(): Promise<DeckMeta[]> {
  await ensureLoaded();
  const counts = await usageCounts();
  return liveOnly(REGISTRY.values()).map((d) => ({
    id: d.id,
    name: d.name,
    tags: d.tags,
    slideCount: d.slides.length,
    licensing: d.licensing.kind,
    usedBy: counts.get(d.id) ?? 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

/** Live decks, full objects. */
export async function listDecks(): Promise<Deck[]> {
  await ensureLoaded();
  return liveOnly(REGISTRY.values());
}

export async function getDeck(id: string): Promise<Deck | null> {
  await ensureLoaded();
  const d = REGISTRY.get(id);
  return d && isLive(d) ? d : null;
}

export async function saveDeck(deck: Deck): Promise<Deck> {
  await ensureLoaded();
  // createdAt is stamped only for an id the registry has never seen.
  const existing = REGISTRY.get(deck.id);
  const createdAt = existing ? existing.createdAt : deck.createdAt || new Date().toISOString();
  const stamped = stampWrite({ ...deck, createdAt });
  await store.writeDeck(stamped);
  REGISTRY.set(stamped.id, stamped);
  return stamped;
}

export async function deleteDeck(id: string): Promise<boolean> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || !isLive(current)) return false;
  const dead = tombstone(current);
  await store.writeDeck(dead);
  REGISTRY.set(id, dead);
  return true;
}

export async function restoreDeck(id: string): Promise<Deck | null> {
  await ensureLoaded();
  const current = REGISTRY.get(id);
  if (!current || isLive(current)) return null;
  const restored = stampWrite(current);
  await store.writeDeck(restored);
  REGISTRY.set(id, restored);
  return restored;
}

export async function duplicateDeck(id: string, newId?: string): Promise<Deck | null> {
  await ensureLoaded();
  const src = REGISTRY.get(id);
  if (!src || !isLive(src)) return null;
  const { deletedAt: _d, updatedAt: _u, ...rest } = src;
  void _d;
  void _u;
  const copy: Deck = {
    ...rest,
    id: newId ?? `deck-${randomUUID().slice(0, 8)}`,
    name: `${src.name} copy`,
    slides: src.slides.map((s) => ({ ...s, id: randomUUID() })),
    createdAt: new Date().toISOString(),
  };
  return saveDeck(copy);
}

/** Live decks, synchronous — for stageFeed. */
export function deckRegistrySnapshot(): Map<string, Deck> {
  const out = new Map<string, Deck>();
  for (const [id, d] of REGISTRY) if (isLive(d)) out.set(id, d);
  return out;
}
