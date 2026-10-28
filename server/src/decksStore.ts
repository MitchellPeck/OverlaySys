import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import { DeckSchema, type Deck } from "@overlaysys/core";
import { dataRoot } from "./storage";

const DECKS_DIR = (): string => path.join(dataRoot(), "decks");

/** Every deck on disk, tombstones included. Unparseable files are skipped. */
export async function loadAllDecks(): Promise<Deck[]> {
  let names: string[];
  try {
    names = await fs.readdir(DECKS_DIR());
  } catch {
    return [];
  }
  const out: Deck[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DECKS_DIR(), name), "utf8");
      out.push(DeckSchema.parse(JSON.parse(raw)));
    } catch {
      // skip corrupt file
    }
  }
  return out;
}

export async function loadDeck(id: string): Promise<Deck | null> {
  try {
    const raw = await fs.readFile(path.join(DECKS_DIR(), `${id}.json`), "utf8");
    return DeckSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeDeck(d: Deck): Promise<void> {
  await fs.mkdir(DECKS_DIR(), { recursive: true });
  await writeAtomic(path.join(DECKS_DIR(), `${d.id}.json`), JSON.stringify(d, null, 2));
}
