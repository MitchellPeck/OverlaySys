import { promises as fs } from "node:fs";
import path from "node:path";
import writeAtomic from "write-file-atomic";
import { MediaItemSchema, type MediaItem } from "@overlaysys/core";
import { dataRoot } from "./storage";
import { recordFile } from "./recordId";

const MEDIA_DIR = (): string => path.join(dataRoot(), "media");

/** Every media item on disk, tombstones included. Unparseable files are skipped. */
export async function loadAllMedia(): Promise<MediaItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(MEDIA_DIR());
  } catch {
    return [];
  }
  const out: MediaItem[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(MEDIA_DIR(), name), "utf8");
      out.push(MediaItemSchema.parse(JSON.parse(raw)));
    } catch {
      // skip corrupt file
    }
  }
  return out;
}

export async function loadMediaItem(id: string): Promise<MediaItem | null> {
  try {
    const raw = await fs.readFile(recordFile(MEDIA_DIR(), id), "utf8");
    return MediaItemSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeMediaItem(d: MediaItem): Promise<void> {
  const file = recordFile(MEDIA_DIR(), d.id);
  await fs.mkdir(MEDIA_DIR(), { recursive: true });
  await writeAtomic(file, JSON.stringify(d, null, 2));
}
