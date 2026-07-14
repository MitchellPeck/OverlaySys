import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import writeAtomic from "write-file-atomic";
import {
  TemplateSchema,
  ShowSchema,
  ChannelConfigSchema,
  SongSchema,
  HotcardSchema,
  ProjectSchema,
  SttSpawnerConfigSchema,
  PcoConfigSchema,
  DEFAULT_PROJECT_ID,
  DEFAULT_STT_SPAWNER_CONFIG,
  DEFAULT_PCO_CONFIG,
  type Template,
  type Show,
  type ChannelConfig,
  type Song,
  type Hotcard,
  type Project,
  type SttSpawnerConfig,
  type PcoConfig,
} from "@overlaysys/core";

// Resolve repo root (../../ from server/src). Templates and shows live at <root>/data.
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..", "..");
// In dev / source-run, data lives at <repo>/data. In packaged Electron,
// the host sets OVERLAYSYS_DATA_DIR to a per-user writable location
// (e.g. app.getPath('userData') + '/data') so user content survives
// reinstalls and isn't trapped inside the read-only resources bundle.
/**
 * Filesystem root for user-writable data. Resolves the env var each call
 * rather than at module init so tests can swap `OVERLAYSYS_DATA_DIR`
 * between cases and avoid colliding on the real `data/` tree. The cost is
 * a `process.env` lookup per call — negligible compared to the disk IO
 * that always follows.
 */
export const dataRoot = (): string =>
  process.env["OVERLAYSYS_DATA_DIR"]
    ? path.resolve(process.env["OVERLAYSYS_DATA_DIR"])
    : path.resolve(REPO_ROOT, "data");

const fixturesRoot = (): string =>
  process.env["OVERLAYSYS_FIXTURES_DIR"]
    ? path.resolve(process.env["OVERLAYSYS_FIXTURES_DIR"])
    : dataRoot();

const TEMPLATES_DIR = (): string => path.join(dataRoot(), "templates");
const SHOWS_DIR = (): string => path.join(dataRoot(), "shows");
const CHANNELS_DIR = (): string => path.join(dataRoot(), "channels");
const SONGS_DIR = (): string => path.join(dataRoot(), "songs");
const HOTCARDS_DIR = (): string => path.join(dataRoot(), "hotcards");
const PROJECTS_DIR = (): string => path.join(dataRoot(), "projects");
const STT_DIR = (): string => path.join(dataRoot(), "stt");
const STT_CONFIG_FILE = (): string => path.join(STT_DIR(), "config.json");
const PCO_DIR = (): string => path.join(dataRoot(), "pco");
const PCO_CONFIG_FILE = (): string => path.join(PCO_DIR(), "config.json");

// Fixture directories used to seed empty live folders. In dev they sit
// alongside the live data ({DATA_ROOT}/<kind>/fixtures). In packaged
// Electron, the live data lives in userData but the fixtures ship in
// the app's resources; OVERLAYSYS_FIXTURES_DIR is set by the Electron
// host to that resources path. When unset, fixtures share the same
// root as live data (the existing dev convention).
const TEMPLATE_FIXTURES_DIR = (): string => path.join(fixturesRoot(), "templates", "fixtures");
const SHOW_FIXTURES_DIR = (): string => path.join(fixturesRoot(), "shows", "fixtures");
const CHANNEL_FIXTURES_DIR = (): string => path.join(fixturesRoot(), "channels", "fixtures");
const SONG_FIXTURES_DIR = (): string => path.join(fixturesRoot(), "songs", "fixtures");
const HOTCARD_FIXTURES_DIR = (): string => path.join(fixturesRoot(), "hotcards", "fixtures");

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
  await ensureDir(TEMPLATES_DIR());
  await ensureDir(SHOWS_DIR());
  await ensureDir(CHANNELS_DIR());
  await ensureDir(SONGS_DIR());
  await ensureDir(HOTCARDS_DIR());
  await ensureDir(PROJECTS_DIR());
  await ensureDir(STT_DIR());
  // Seed any fixtures that don't exist as live files yet.
  await copyMissingFixtures(TEMPLATE_FIXTURES_DIR(), TEMPLATES_DIR());
  await copyMissingFixtures(SHOW_FIXTURES_DIR(), SHOWS_DIR());
  await copyMissingFixtures(CHANNEL_FIXTURES_DIR(), CHANNELS_DIR());
  await copyMissingFixtures(SONG_FIXTURES_DIR(), SONGS_DIR());
  await copyMissingFixtures(HOTCARD_FIXTURES_DIR(), HOTCARDS_DIR());
  // Always make sure the default Project exists. New installs land with
  // an empty projects/ dir; legacy installs that pre-date the concept
  // need the slug their shows and hotcards now reference.
  await ensureDefaultProject();
}

async function ensureDefaultProject(): Promise<void> {
  const file = path.join(PROJECTS_DIR(), `${DEFAULT_PROJECT_ID}.json`);
  const exists = await fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
  if (exists) return;
  const now = new Date().toISOString();
  const project: Project = {
    id: DEFAULT_PROJECT_ID,
    name: "Default Project",
    createdAt: now,
    updatedAt: now,
  };
  await writeAtomic(file, JSON.stringify(project, null, 2));
}

export async function loadAllTemplates(): Promise<Template[]> {
  return readJsonFiles(TEMPLATES_DIR(), (raw) => TemplateSchema.parse(raw));
}

export async function loadTemplate(id: string): Promise<Template | null> {
  const file = path.join(TEMPLATES_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return TemplateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveTemplate(template: Template): Promise<void> {
  await ensureDir(TEMPLATES_DIR());
  const file = path.join(TEMPLATES_DIR(), `${template.id}.json`);
  // The caller has already validated against TemplateSchema at the WS
  // boundary — `ClientMessageSchema.parse` covers it for `save_template`.
  // Re-parsing here would run the recursive LayerSchema walk a second
  // time, which on bundle imports with dozens of complex templates can
  // turn a 10s save into a 30s+ save and trip the operator's per-item
  // ack timeout. Trust the type system here.
  await writeAtomic(file, JSON.stringify(template, null, 2));
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const file = path.join(TEMPLATES_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Shows ────────────────────────────────────────────────────────────────────────

export async function loadAllShows(): Promise<Show[]> {
  return readJsonFiles(SHOWS_DIR(), (raw) => ShowSchema.parse(raw));
}

export async function loadShow(id: string): Promise<Show | null> {
  const file = path.join(SHOWS_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return ShowSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveShow(show: Show): Promise<void> {
  await ensureDir(SHOWS_DIR());
  const file = path.join(SHOWS_DIR(), `${show.id}.json`);
  // Trust the WS-layer validation — see saveTemplate for why.
  await writeAtomic(file, JSON.stringify(show, null, 2));
}

export async function deleteShow(id: string): Promise<boolean> {
  const file = path.join(SHOWS_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Channel configs ──────────────────────────────────────────────────────────────

export async function loadAllChannelConfigs(): Promise<ChannelConfig[]> {
  return readJsonFiles(CHANNELS_DIR(), (raw) => ChannelConfigSchema.parse(raw));
}

export async function loadChannelConfig(id: string): Promise<ChannelConfig | null> {
  const file = path.join(CHANNELS_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return ChannelConfigSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveChannelConfig(config: ChannelConfig): Promise<void> {
  await ensureDir(CHANNELS_DIR());
  const file = path.join(CHANNELS_DIR(), `${config.id}.json`);
  const parsed = ChannelConfigSchema.parse(config);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteChannelConfig(id: string): Promise<boolean> {
  const file = path.join(CHANNELS_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Songs ────────────────────────────────────────────────────────────────────────

export async function loadAllSongs(): Promise<Song[]> {
  return readJsonFiles(SONGS_DIR(), (raw) => SongSchema.parse(raw));
}

export async function loadSong(id: string): Promise<Song | null> {
  const file = path.join(SONGS_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return SongSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveSong(song: Song): Promise<void> {
  await ensureDir(SONGS_DIR());
  const file = path.join(SONGS_DIR(), `${song.id}.json`);
  await writeAtomic(file, JSON.stringify(song, null, 2));
}

export async function deleteSong(id: string): Promise<boolean> {
  const file = path.join(SONGS_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Hotcards ─────────────────────────────────────────────────────────────────────

export async function loadAllHotcards(): Promise<Hotcard[]> {
  return readJsonFiles(HOTCARDS_DIR(), (raw) => HotcardSchema.parse(raw));
}

export async function loadHotcard(id: string): Promise<Hotcard | null> {
  const file = path.join(HOTCARDS_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return HotcardSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveHotcard(hotcard: Hotcard): Promise<void> {
  await ensureDir(HOTCARDS_DIR());
  const file = path.join(HOTCARDS_DIR(), `${hotcard.id}.json`);
  await writeAtomic(file, JSON.stringify(hotcard, null, 2));
}

export async function deleteHotcard(id: string): Promise<boolean> {
  const file = path.join(HOTCARDS_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// Projects ─────────────────────────────────────────────────────────────────────

export async function loadAllProjects(): Promise<Project[]> {
  return readJsonFiles(PROJECTS_DIR(), (raw) => ProjectSchema.parse(raw));
}

export async function loadProject(id: string): Promise<Project | null> {
  const file = path.join(PROJECTS_DIR(), `${id}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return ProjectSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  await ensureDir(PROJECTS_DIR());
  const file = path.join(PROJECTS_DIR(), `${project.id}.json`);
  const parsed = ProjectSchema.parse(project);
  await writeAtomic(file, JSON.stringify(parsed, null, 2));
}

export async function deleteProject(id: string): Promise<boolean> {
  const file = path.join(PROJECTS_DIR(), `${id}.json`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}

// STT spawner config ───────────────────────────────────────────────────────────

// Matches the shape of the legacy default command — `whisper-stream` with
// `-m <path> --step <n> --length <n>` and nothing more. When migration
// finds this exact shape we throw the legacy `command` away rather than
// promoting it to `customCommand`, because doing the promotion would
// permanently shadow the new structured dropdowns (buildSttCommand prefers
// customCommand when non-empty). The structured defaults reproduce the
// same command on disk, so users lose nothing.
const LEGACY_DEFAULT_COMMAND_PATTERN =
  /^whisper-stream\s+-m\s+\S+\s+--step\s+\d+\s+--length\s+\d+\s*$/;

export async function loadSttConfig(): Promise<SttSpawnerConfig> {
  await ensureDir(STT_DIR());
  try {
    const raw = await fs.readFile(STT_CONFIG_FILE(), "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    // Migrate pre-dropdown configs that stored a single `command` string.
    // We have two cases:
    //   1. Legacy command matches the default-shaped whisper-stream pattern
    //      → drop it. The new structured fields produce an equivalent command
    //      and giving the user back active dropdowns is more valuable than
    //      preserving a redundant string.
    //   2. Legacy command is genuinely customised (pipes, env vars, cloud
    //      STT, etc.) → preserve it by promoting to customCommand so the
    //      user's existing pipeline keeps working.
    if (
      obj &&
      typeof obj === "object" &&
      typeof obj["command"] === "string" &&
      typeof obj["customCommand"] !== "string"
    ) {
      const cmd = (obj["command"] as string).trim();
      if (!LEGACY_DEFAULT_COMMAND_PATTERN.test(cmd)) {
        obj["customCommand"] = cmd;
      }
    }
    if (obj && typeof obj === "object") delete obj["command"];
    return SttSpawnerConfigSchema.parse(obj);
  } catch {
    return { ...DEFAULT_STT_SPAWNER_CONFIG };
  }
}

export async function saveSttConfig(config: SttSpawnerConfig): Promise<void> {
  await ensureDir(STT_DIR());
  const parsed = SttSpawnerConfigSchema.parse(config);
  await writeAtomic(STT_CONFIG_FILE(), JSON.stringify(parsed, null, 2));
}

// Planning Center config ─────────────────────────────────────────────────────

export async function loadPcoConfig(): Promise<PcoConfig> {
  await ensureDir(PCO_DIR());
  try {
    const raw = await fs.readFile(PCO_CONFIG_FILE(), "utf8");
    return PcoConfigSchema.parse(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PCO_CONFIG };
  }
}

export async function savePcoConfig(config: PcoConfig): Promise<void> {
  await ensureDir(PCO_DIR());
  const parsed = PcoConfigSchema.parse(config);
  await writeAtomic(PCO_CONFIG_FILE(), JSON.stringify(parsed, null, 2));
}
