import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import writeAtomic from "write-file-atomic";
import {
  TemplateSchema,
  ShowSchema,
  ChannelConfigSchema,
  SongSchema,
  type Template,
  type Show,
  type ChannelConfig,
  type Song,
} from "@overlaysys/core";

// Resolve repo root (../../ from server/src). Templates and shows live at <root>/data.
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
const DATA_ROOT = path.resolve(REPO_ROOT, "data");
const TEMPLATES_DIR = path.join(DATA_ROOT, "templates");
const SHOWS_DIR = path.join(DATA_ROOT, "shows");
const CHANNELS_DIR = path.join(DATA_ROOT, "channels");
const SONGS_DIR = path.join(DATA_ROOT, "songs");
const TEMPLATE_FIXTURES_DIR = path.join(TEMPLATES_DIR, "fixtures");
const SHOW_FIXTURES_DIR = path.join(SHOWS_DIR, "fixtures");
const CHANNEL_FIXTURES_DIR = path.join(CHANNELS_DIR, "fixtures");
const SONG_FIXTURES_DIR = path.join(SONGS_DIR, "fixtures");

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function readJsonFiles<T>(dir: string, parse: (raw: unknown) => T): Promise<T[]> {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: T[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const full = path.join(dir, entry.name);
    try {
      const raw = await fs.readFile(full, "utf8");
      out.push(parse(JSON.parse(raw)));
    } catch (err) {
      console.warn(`[storage] failed to load ${full}:`, err);
    }
  }
  return out;
}

// Templates ────────────────────────────────────────────────────────────────────

async function copyMissingFixtures(srcDir: string, dstDir: string): Promise<void> {
  const srcEntries = await fs.readdir(srcDir, { withFileTypes: true }).catch(() => []);
  for (const e of srcEntries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const dst = path.join(dstDir, e.name);
    const exists = await fs
      .stat(dst)
      .then(() => true)
      .catch(() => false);
    if (exists) continue;
    const src = path.join(srcDir, e.name);
    const content = await fs.readFile(src, "utf8");
    await writeAtomic(dst, content);
    console.log(`[storage] seeded ${path.relative(REPO_ROOT, dst)} from fixture`);
  }
}

export async function ensureSeeded(): Promise<void> {
  await ensureDir(TEMPLATES_DIR);
  await ensureDir(SHOWS_DIR);
  await ensureDir(CHANNELS_DIR);
  await ensureDir(SONGS_DIR);
  // Seed any fixtures that don't exist as live files yet.
  await copyMissingFixtures(TEMPLATE_FIXTURES_DIR, TEMPLATES_DIR);
  await copyMissingFixtures(SHOW_FIXTURES_DIR, SHOWS_DIR);
  await copyMissingFixtures(CHANNEL_FIXTURES_DIR, CHANNELS_DIR);
  await copyMissingFixtures(SONG_FIXTURES_DIR, SONGS_DIR);
}

export async function loadAllTemplates(): Promise<Template[]> {
  return readJsonFiles(TEMPLATES_DIR, (raw) => TemplateSchema.parse(raw));
}

export async function loadTemplate(id: string): Promise<Template | null> {
  const file = path.join(TEMPLATES_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return TemplateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTemplate(template: Template): Promise<void> {
  await ensureDir(TEMPLATES_DIR);
  const file = path.join(TEMPLATES_DIR, `${template.id}.json`);
  // Validate before writing — reject malformed templates rather than corrupt disk.
  const parsed = TemplateSchema.parse(template);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const file = path.join(TEMPLATES_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Shows ────────────────────────────────────────────────────────────────────────

export async function loadAllShows(): Promise<Show[]> {
  return readJsonFiles(SHOWS_DIR, (raw) => ShowSchema.parse(raw));
}

export async function loadShow(id: string): Promise<Show | null> {
  const file = path.join(SHOWS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return ShowSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveShow(show: Show): Promise<void> {
  await ensureDir(SHOWS_DIR);
  const file = path.join(SHOWS_DIR, `${show.id}.json`);
  const parsed = ShowSchema.parse(show);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteShow(id: string): Promise<boolean> {
  const file = path.join(SHOWS_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Channel configs ──────────────────────────────────────────────────────────────

export async function loadAllChannelConfigs(): Promise<ChannelConfig[]> {
  return readJsonFiles(CHANNELS_DIR, (raw) => ChannelConfigSchema.parse(raw));
}

export async function loadChannelConfig(id: string): Promise<ChannelConfig | null> {
  const file = path.join(CHANNELS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return ChannelConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveChannelConfig(config: ChannelConfig): Promise<void> {
  await ensureDir(CHANNELS_DIR);
  const file = path.join(CHANNELS_DIR, `${config.id}.json`);
  const parsed = ChannelConfigSchema.parse(config);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteChannelConfig(id: string): Promise<boolean> {
  const file = path.join(CHANNELS_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Songs ────────────────────────────────────────────────────────────────────────

export async function loadAllSongs(): Promise<Song[]> {
  return readJsonFiles(SONGS_DIR, (raw) => SongSchema.parse(raw));
}

export async function loadSong(id: string): Promise<Song | null> {
  const file = path.join(SONGS_DIR, `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return SongSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveSong(song: Song): Promise<void> {
  await ensureDir(SONGS_DIR);
  const file = path.join(SONGS_DIR, `${song.id}.json`);
  const parsed = SongSchema.parse(song);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteSong(id: string): Promise<boolean> {
  const file = path.join(SONGS_DIR, `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}
