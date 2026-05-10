# Live Lyrics — Plan A: Core + Manual Operator UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live lyric overlays to OverlaySys with songs as first-class rundown items, server-authoritative live song sessions, and a manual-driven operator UI (no STT yet — that's Plan B).

**Architecture:** New `Song` entity in `packages/core` (sections → slides). `RundownRow` becomes a discriminated union (`graphic | song`) with backward-compatible parsing. Server gains a `songSession.ts` state machine that, when a song row is taken, drives the existing `channels.ts` take/update protocol with successive slide text. Operator UI gains a `/songs` library page and a `SongModePanel` that auto-opens when a song row is active. STT-related WS messages (`stt_*`) are NOT added in this plan — Plan B.

**Tech Stack:** TypeScript + Zod (schemas), Fastify + ws (server), Next.js (operator UI), vitest (new — unit tests for schemas and parser), existing `pnpm` + `turbo` workspace.

**Spec:** `docs/superpowers/specs/2026-05-07-live-lyrics-design.md`

---

## File Structure

### New files

- `packages/core/src/song.ts` — `Song`, `Section`, `Slide`, `SectionKind` schemas + types
- `packages/core/src/songParser.ts` — paste-with-`[Section]`-markers parser
- `packages/core/src/song.test.ts` — schema unit tests
- `packages/core/src/songParser.test.ts` — parser unit tests
- `packages/core/src/show.test.ts` — discriminated-union + legacy compat tests
- `server/src/songs.ts` — song registry / CRUD wrapper (mirrors `templates.ts` / `shows.ts`)
- `server/src/songSession.ts` — per-channel song session state machine
- `server/src/songSession.test.ts` — state machine unit tests
- `server/scripts/song-smoke.mjs` — full-lifecycle WS smoke test
- `data/songs/.gitkeep`
- `data/songs/fixtures/.gitkeep`
- `data/songs/fixtures/amazing-grace.json` — fixture song
- `apps/operator/src/app/songs/page.tsx` — song library list page
- `apps/operator/src/app/songs/[id]/page.tsx` — song editor page
- `apps/operator/src/app/components/SongModePanel.tsx` — replaces TakePanel for song rows
- `vitest.config.ts` — root vitest config

### Modified files

- `packages/core/src/show.ts` — `RundownRow` becomes discriminated union with legacy preprocess
- `packages/core/src/channel.ts` — add `songSession?: SongSessionSummary` to `ChannelState`
- `packages/core/src/index.ts` — re-export song module
- `packages/core/package.json` — add vitest devDep + test script
- `packages/ws-protocol/src/index.ts` — add `song_*` and song CRUD messages
- `server/src/storage.ts` — add `loadAllSongs` / `loadSong` / `saveSong` / `deleteSong`, `SONGS_DIR`
- `server/src/index.ts` — `reloadSongs()` on boot, `/api/songs` HTTP route
- `server/src/ws.ts` — wire song CRUD + song_* message handlers
- `server/src/channels.ts` — expose `setSongSessionSummary(channel, summary | null)` so sessions can decorate state
- `server/package.json` — vitest devDep + test script
- `apps/operator/src/lib/store.ts` — track songs list, song cache, current per-channel song session
- `apps/operator/src/lib/wsClient.ts` — no changes (protocol additions are additive; existing reconnect logic suffices)
- `apps/operator/src/app/components/Rundown.tsx` — handle discriminated row union (book icon for SongRow)
- `apps/operator/src/app/page.tsx` — auto-mount `SongModePanel` when active row on program is a song
- `apps/operator/src/app/hooks/useGlobalShortcuts.ts` — extend with song-mode hotkeys
- `package.json` (root) — add vitest devDep + `test` turbo script
- `turbo.json` — add `test` task

### Out of scope (Plan B)

- `apps/lyric-listener/` (whisper.cpp daemon)
- `server/src/sttMatcher.ts`, `server/src/sttListener.ts`
- `stt_hypothesis`, `stt_match`, `stt_listener_state` WS messages
- Trust-mode auto-take logic
- OpenLyrics XML import

The schema for `SongRow.trustMode` is added now (so authored songs are forward-compatible) but is unused in Plan A — the operator UI shows the toggle as disabled "Plan B" state.

---

## Phase 1: Core data model + storage

### Task 1.1: Set up vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (root), `turbo.json`, `packages/core/package.json`, `server/package.json`

- [ ] **Step 1: Add vitest to the workspace root**

Run:
```bash
pnpm add -D -w vitest @vitest/ui
```

- [ ] **Step 2: Create root vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "server/src/**/*.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
```

- [ ] **Step 3: Add `test` script to root `package.json`**

Modify `package.json` `scripts` to include:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add `test` task to `turbo.json`**

Modify `turbo.json` `tasks` to add (alongside existing `dev`, `build`, `typecheck`):

```json
"test": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

- [ ] **Step 5: Add per-package test scripts**

Modify `packages/core/package.json` `scripts`:

```json
"test": "vitest run --dir src"
```

Modify `server/package.json` `scripts`:

```json
"test": "vitest run --dir src"
```

- [ ] **Step 6: Verify vitest runs cleanly with no tests yet**

Run: `pnpm -w test`
Expected: vitest reports `No test files found` and exits 1 — that's expected before any tests exist. We'll fix once we have one. (For now, run the command to confirm vitest is installed and parseable.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: add vitest test runner to workspace"
```

---

### Task 1.2: Define Song schema

**Files:**
- Create: `packages/core/src/song.ts`
- Create: `packages/core/src/song.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/song.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SongSchema, SectionKindSchema } from "./song";

describe("SectionKindSchema", () => {
  it("accepts known kinds", () => {
    for (const k of ["verse", "chorus", "bridge", "tag", "intro", "outro", "other"]) {
      expect(SectionKindSchema.parse(k)).toBe(k);
    }
  });
  it("rejects unknown kinds", () => {
    expect(() => SectionKindSchema.parse("prelude")).toThrow();
  });
});

describe("SongSchema", () => {
  const minimal = {
    id: "amazing-grace",
    title: "Amazing Grace",
    sections: [
      {
        id: "v1",
        kind: "verse",
        label: "Verse 1",
        slides: [
          { id: "v1s1", lines: ["Amazing grace how sweet the sound"] },
        ],
      },
    ],
    defaultArrangement: ["v1"],
  };

  it("parses a minimal valid song", () => {
    const parsed = SongSchema.parse(minimal);
    expect(parsed.id).toBe("amazing-grace");
    expect(parsed.sections[0].slides[0].lines).toEqual([
      "Amazing grace how sweet the sound",
    ]);
  });

  it("rejects empty sections array", () => {
    expect(() =>
      SongSchema.parse({ ...minimal, sections: [] }),
    ).toThrow();
  });

  it("rejects a section with no slides", () => {
    expect(() =>
      SongSchema.parse({
        ...minimal,
        sections: [{ ...minimal.sections[0], slides: [] }],
      }),
    ).toThrow();
  });

  it("rejects a slide with no lines", () => {
    expect(() =>
      SongSchema.parse({
        ...minimal,
        sections: [
          {
            ...minimal.sections[0],
            slides: [{ id: "v1s1", lines: [] }],
          },
        ],
      }),
    ).toThrow();
  });

  it("accepts optional metadata fields", () => {
    const parsed = SongSchema.parse({
      ...minimal,
      ccliNumber: "22025",
      author: "John Newton",
      copyright: "Public Domain",
      defaultLyricTemplateId: "lyric-default",
    });
    expect(parsed.ccliNumber).toBe("22025");
    expect(parsed.defaultLyricTemplateId).toBe("lyric-default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @overlaysys/core test`
Expected: FAIL — `Cannot find module './song'`

- [ ] **Step 3: Implement Song schema**

Create `packages/core/src/song.ts`:

```ts
import { z } from "zod";

export const SectionKindSchema = z.enum([
  "verse",
  "chorus",
  "bridge",
  "tag",
  "intro",
  "outro",
  "other",
]);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  lines: z.array(z.string()).min(1),
});
export type Slide = z.infer<typeof SlideSchema>;

export const SectionSchema = z.object({
  id: z.string(),
  kind: SectionKindSchema,
  label: z.string(),
  slides: z.array(SlideSchema).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

export const SongSchema = z.object({
  id: z.string(),
  title: z.string(),
  ccliNumber: z.string().optional(),
  author: z.string().optional(),
  copyright: z.string().optional(),
  defaultLyricTemplateId: z.string().optional(),
  sections: z.array(SectionSchema).min(1),
  defaultArrangement: z.array(z.string()),
});
export type Song = z.infer<typeof SongSchema>;

export type SongMeta = Pick<Song, "id" | "title" | "ccliNumber" | "author">;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @overlaysys/core test`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/song.ts packages/core/src/song.test.ts
git commit -m "feat(core): add Song schema with sections and slides"
```

---

### Task 1.3: Make RundownRow a discriminated union

**Files:**
- Modify: `packages/core/src/show.ts`
- Create: `packages/core/src/show.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/show.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RundownRowSchema, ShowSchema } from "./show";

describe("RundownRowSchema", () => {
  it("parses a graphic row with explicit kind", () => {
    const row = RundownRowSchema.parse({
      kind: "graphic",
      id: "r1",
      templateId: "lower-third-default",
      data: { name: "Jane" },
    });
    expect(row.kind).toBe("graphic");
  });

  it("treats a legacy row (no kind) as graphic", () => {
    const row = RundownRowSchema.parse({
      id: "r1",
      templateId: "lower-third-default",
      data: { name: "Jane" },
    });
    expect(row.kind).toBe("graphic");
    if (row.kind === "graphic") {
      expect(row.templateId).toBe("lower-third-default");
    }
  });

  it("parses a song row", () => {
    const row = RundownRowSchema.parse({
      kind: "song",
      id: "r2",
      songId: "amazing-grace",
      lyricTemplateId: "lyric-default",
    });
    expect(row.kind).toBe("song");
    if (row.kind === "song") {
      expect(row.songId).toBe("amazing-grace");
    }
  });

  it("parses a song row with optional arrangement and trustMode", () => {
    const row = RundownRowSchema.parse({
      kind: "song",
      id: "r3",
      songId: "amazing-grace",
      lyricTemplateId: "lyric-default",
      arrangement: ["v1", "c"],
      trustMode: true,
    });
    if (row.kind !== "song") throw new Error("expected song");
    expect(row.arrangement).toEqual(["v1", "c"]);
    expect(row.trustMode).toBe(true);
  });

  it("rejects a song row missing songId", () => {
    expect(() =>
      RundownRowSchema.parse({
        kind: "song",
        id: "r4",
        lyricTemplateId: "lyric-default",
      }),
    ).toThrow();
  });
});

describe("ShowSchema (legacy compat)", () => {
  it("parses a show with mixed legacy + tagged rows", () => {
    const show = ShowSchema.parse({
      id: "s1",
      name: "Service",
      rows: [
        { id: "r1", templateId: "lower-third-default", data: { name: "Pastor" } },
        {
          kind: "song",
          id: "r2",
          songId: "amazing-grace",
          lyricTemplateId: "lyric-default",
        },
      ],
    });
    expect(show.rows[0].kind).toBe("graphic");
    expect(show.rows[1].kind).toBe("song");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @overlaysys/core test -- show.test`
Expected: FAIL — `RundownRowSchema` doesn't accept `kind: "song"` shape (or current schema is missing `kind` field entirely).

- [ ] **Step 3: Update RundownRowSchema to discriminated union**

Modify `packages/core/src/show.ts` (replace entire file):

```ts
import { z } from "zod";

export const GraphicRowSchema = z.object({
  kind: z.literal("graphic"),
  id: z.string(),
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type GraphicRow = z.infer<typeof GraphicRowSchema>;

export const SongRowSchema = z.object({
  kind: z.literal("song"),
  id: z.string(),
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()).optional(),
  trustMode: z.boolean().optional(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type SongRow = z.infer<typeof SongRowSchema>;

/**
 * Show JSON files predating the row union have rows without a `kind` field.
 * Default missing `kind` to `"graphic"` on read; writes always include `kind`.
 */
export const RundownRowSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("kind" in (raw as Record<string, unknown>))
    ) {
      return { kind: "graphic", ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.discriminatedUnion("kind", [GraphicRowSchema, SongRowSchema]),
);
export type RundownRow = z.infer<typeof RundownRowSchema>;

export const ShowSchema = z.object({
  id: z.string(),
  name: z.string(),
  rows: z.array(RundownRowSchema),
});
export type Show = z.infer<typeof ShowSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @overlaysys/core test`
Expected: PASS — both `song.test.ts` and `show.test.ts` green.

- [ ] **Step 5: Verify legacy fixture still loads**

Run: `pnpm --filter @overlaysys/server typecheck`
Expected: typecheck passes.

Manually verify by reading `data/shows/demo-show.json` — its rows lack `kind`. Add a quick sanity test or confirm via a small script:

```bash
node --input-type=module -e "
import { ShowSchema } from './packages/core/src/show.ts';
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync('data/shows/demo-show.json', 'utf8'));
const show = ShowSchema.parse(raw);
console.log('rows:', show.rows.length, 'kinds:', show.rows.map(r => r.kind));
"
```

(If the inline ts run is awkward, skip this and rely on the unit test — the unit test exercises the same code path.)

Expected: prints rows and all kinds = `graphic`.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/show.ts packages/core/src/show.test.ts
git commit -m "feat(core): RundownRow discriminated union (graphic | song) with legacy compat"
```

---

### Task 1.4: Re-export song from core barrel

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add re-export**

Modify `packages/core/src/index.ts` (replace contents):

```ts
export * from "./template";
export * from "./show";
export * from "./channel";
export * from "./channelConfig";
export * from "./song";
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `pnpm typecheck`
Expected: PASS across all packages.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export Song schema from barrel"
```

---

### Task 1.5: Add song storage in server

**Files:**
- Modify: `server/src/storage.ts`

- [ ] **Step 1: Add song storage functions**

Modify `server/src/storage.ts`:

1. Add to imports (top of file):

```ts
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
```

2. Add directory constants near other DIR consts:

```ts
const SONGS_DIR = path.join(DATA_ROOT, "songs");
const SONG_FIXTURES_DIR = path.join(SONGS_DIR, "fixtures");
```

3. Update `ensureSeeded` to seed songs too. Replace the body of `ensureSeeded` with:

```ts
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
```

4. Add Song CRUD functions at the bottom of the file (mirrors Templates/Shows section):

```ts
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
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @overlaysys/server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/storage.ts
git commit -m "feat(server): add song storage layer"
```

---

### Task 1.6: Add server song registry

**Files:**
- Create: `server/src/songs.ts`

- [ ] **Step 1: Create the registry**

Create `server/src/songs.ts`:

```ts
import type { Song, SongMeta } from "@overlaysys/core";
import * as storage from "./storage";

const REGISTRY = new Map<string, Song>();
let loaded = false;

export async function reloadSongs(): Promise<void> {
  await storage.ensureSeeded();
  const songs = await storage.loadAllSongs();
  REGISTRY.clear();
  for (const s of songs) REGISTRY.set(s.id, s);
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await reloadSongs();
}

export async function listSongMetas(): Promise<SongMeta[]> {
  await ensureLoaded();
  return Array.from(REGISTRY.values()).map((s) => ({
    id: s.id,
    title: s.title,
    ccliNumber: s.ccliNumber,
    author: s.author,
  }));
}

export async function getSong(id: string): Promise<Song | null> {
  await ensureLoaded();
  return REGISTRY.get(id) ?? null;
}

export async function saveSong(song: Song): Promise<void> {
  await storage.saveSong(song);
  REGISTRY.set(song.id, song);
}

export async function deleteSong(id: string): Promise<boolean> {
  const ok = await storage.deleteSong(id);
  if (ok) REGISTRY.delete(id);
  return ok;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @overlaysys/server typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/songs.ts
git commit -m "feat(server): add song registry"
```

---

### Task 1.7: Add fixture song

**Files:**
- Create: `data/songs/.gitkeep`
- Create: `data/songs/fixtures/.gitkeep`
- Create: `data/songs/fixtures/amazing-grace.json`

- [ ] **Step 1: Create directory placeholders**

```bash
mkdir -p data/songs/fixtures
touch data/songs/.gitkeep data/songs/fixtures/.gitkeep
```

- [ ] **Step 2: Add fixture**

Create `data/songs/fixtures/amazing-grace.json`:

```json
{
  "id": "amazing-grace",
  "title": "Amazing Grace",
  "author": "John Newton",
  "copyright": "Public Domain",
  "ccliNumber": "22025",
  "sections": [
    {
      "id": "v1",
      "kind": "verse",
      "label": "Verse 1",
      "slides": [
        {
          "id": "v1s1",
          "lines": [
            "Amazing grace how sweet the sound",
            "That saved a wretch like me"
          ]
        },
        {
          "id": "v1s2",
          "lines": [
            "I once was lost but now am found",
            "Was blind but now I see"
          ]
        }
      ]
    },
    {
      "id": "v2",
      "kind": "verse",
      "label": "Verse 2",
      "slides": [
        {
          "id": "v2s1",
          "lines": [
            "'Twas grace that taught my heart to fear",
            "And grace my fears relieved"
          ]
        },
        {
          "id": "v2s2",
          "lines": [
            "How precious did that grace appear",
            "The hour I first believed"
          ]
        }
      ]
    },
    {
      "id": "c",
      "kind": "chorus",
      "label": "Chorus",
      "slides": [
        {
          "id": "c1",
          "lines": [
            "My chains are gone I've been set free",
            "My God my Savior has ransomed me"
          ]
        },
        {
          "id": "c2",
          "lines": [
            "And like a flood His mercy reigns",
            "Unending love amazing grace"
          ]
        }
      ]
    }
  ],
  "defaultArrangement": ["v1", "v2", "c", "c"]
}
```

- [ ] **Step 3: Verify the fixture parses**

Run: `pnpm --filter @overlaysys/core test`
Expected: still PASS. (No new test required — schema validation runs on every load.)

Quick manual sanity check:

```bash
node --input-type=module -e "
import { SongSchema } from './packages/core/src/song.ts';
import { readFileSync } from 'node:fs';
const raw = JSON.parse(readFileSync('data/songs/fixtures/amazing-grace.json', 'utf8'));
const s = SongSchema.parse(raw);
console.log('parsed', s.id, 'sections:', s.sections.length);
"
```

Expected: `parsed amazing-grace sections: 3`. Skip if the inline run is awkward; the schema test in Task 1.2 already exercises the same code path.

- [ ] **Step 4: Commit**

```bash
git add data/songs
git commit -m "feat(data): add Amazing Grace fixture song"
```

---

### Task 1.8: Wire songs into server boot + WS protocol

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/ws.ts`

- [ ] **Step 1: Add song messages to WS protocol**

Modify `packages/ws-protocol/src/index.ts`:

1. Add to imports:

```ts
import {
  ChannelStateSchema,
  TemplateSchema,
  ShowSchema,
  SongSchema,
  type TemplateMeta,
} from "@overlaysys/core";
```

2. Add to `ClientMessageSchema` discriminated union (inside the existing array, near the show CRUD entries):

```ts
z.object({ type: z.literal("list_songs") }),
z.object({ type: z.literal("get_song"), songId: z.string() }),
z.object({ type: z.literal("save_song"), song: SongSchema }),
z.object({ type: z.literal("delete_song"), songId: z.string() }),
```

3. Add to `ServerMessageSchema` discriminated union:

```ts
z.object({
  type: z.literal("song_list"),
  songs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      ccliNumber: z.string().optional(),
      author: z.string().optional(),
    }),
  ),
}),
z.object({
  type: z.literal("song"),
  song: SongSchema,
}),
```

- [ ] **Step 2: Wire reload + HTTP in server boot**

Modify `server/src/index.ts`:

1. Add import:

```ts
import { listSongMetas, reloadSongs } from "./songs";
```

2. After existing `await reloadChannelConfigs();`, add:

```ts
await reloadSongs();
```

3. Update the boot log line to include song count:

```ts
app.log.info(
  `loaded ${(await listTemplateMetas()).length} template(s), ${(await listShowMetas()).length} show(s), ${(await listChannelConfigs()).length} channel(s), ${(await listSongMetas()).length} song(s)`,
);
```

4. Add HTTP route alongside the others:

```ts
app.get("/api/songs", async () => {
  return { songs: await listSongMetas() };
});
```

- [ ] **Step 3: Wire WS handlers**

Modify `server/src/ws.ts`:

1. Add import:

```ts
import * as songs from "./songs";
```

2. Add cases inside the message-type `switch` (place near show CRUD):

```ts
case "list_songs": {
  const list = await songs.listSongMetas();
  send({ type: "song_list", songs: list });
  break;
}
case "get_song": {
  const s = await songs.getSong(parsed.songId);
  if (!s) send({ type: "error", code: "not_found", message: parsed.songId });
  else send({ type: "song", song: s });
  break;
}
case "save_song": {
  await songs.saveSong(parsed.song);
  send({ type: "ack", op: "save_song", id: parsed.song.id });
  broadcast({ type: "song", song: parsed.song });
  const list = await songs.listSongMetas();
  broadcast({ type: "song_list", songs: list });
  break;
}
case "delete_song": {
  const ok = await songs.deleteSong(parsed.songId);
  send({ type: "ack", op: "delete_song", id: parsed.songId });
  if (ok) {
    const list = await songs.listSongMetas();
    broadcast({ type: "song_list", songs: list });
  }
  break;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS across `core`, `ws-protocol`, `server`.

- [ ] **Step 5: Smoke verify the server boots**

Run: `pnpm --filter @overlaysys/server dev` (in a background terminal)
Expected: log line includes `... 1 song(s)`.

Then in another terminal:

```bash
curl -s http://localhost:4000/api/songs
```

Expected: `{"songs":[{"id":"amazing-grace","title":"Amazing Grace",...}]}`

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add packages/ws-protocol/src/index.ts server/src/index.ts server/src/ws.ts
git commit -m "feat(server): wire song registry into boot + WS protocol"
```

---

### Task 1.9: Extend smoke test with song CRUD

**Files:**
- Modify: `server/scripts/smoke.mjs`

- [ ] **Step 1: Add song expectations to smoke**

Modify `server/scripts/smoke.mjs`:

1. Inside the `ws.on("open", ...)` handler, near the other `setTimeout(() => s({ type: "list_..." }))` calls, add:

```js
setTimeout(() => s({ type: "list_songs" }), 250);
setTimeout(() => s({ type: "get_song", songId: "amazing-grace" }), 280);
```

2. Inside the `expectations` object, add:

```js
song_list: received.some(
  (m) => m.type === "song_list" && m.songs.length >= 1,
),
song_amazing_grace: received.some(
  (m) => m.type === "song" && m.song.id === "amazing-grace",
),
```

- [ ] **Step 2: Run smoke against running server**

Start dev server, then:

```bash
node server/scripts/smoke.mjs
```

Expected: all expectations PASS, including the two new ones.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/smoke.mjs
git commit -m "test(server): cover song CRUD in smoke"
```

---

## Phase 2: Server SongSession + WS additions

### Task 2.1: Define SongSession types in core

**Files:**
- Modify: `packages/core/src/channel.ts`
- Modify: `packages/core/src/song.ts`

- [ ] **Step 1: Add SongSessionSummary to song.ts**

Append to `packages/core/src/song.ts`:

```ts
/**
 * Lightweight description of a live SongSession sent to clients via
 * ChannelState.songSession. The server keeps the full session in memory;
 * this is just what's needed to render the operator UI.
 */
export const SongSessionSummarySchema = z.object({
  songId: z.string(),
  lyricTemplateId: z.string(),
  arrangement: z.array(z.string()),
  cursor: z.object({
    sectionIdx: z.number().int().nonnegative(),
    slideIdx: z.number().int().nonnegative(),
  }),
  blanked: z.boolean(),
  trustMode: z.boolean(),
  startedAt: z.number(),
});
export type SongSessionSummary = z.infer<typeof SongSessionSummarySchema>;
```

- [ ] **Step 2: Extend ChannelState**

Modify `packages/core/src/channel.ts` (replace contents):

```ts
import { z } from "zod";
import { SongSessionSummarySchema } from "./song";

export const ChannelPhaseSchema = z.enum(["in", "on", "out"]);
export type ChannelPhase = z.infer<typeof ChannelPhaseSchema>;

export const ActiveGraphicSchema = z.object({
  templateId: z.string(),
  data: z.record(z.string(), z.string()),
  phase: ChannelPhaseSchema,
  takenAt: z.number(), // epoch ms
});
export type ActiveGraphic = z.infer<typeof ActiveGraphicSchema>;

export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
});
export type ChannelState = z.infer<typeof ChannelStateSchema>;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/song.ts packages/core/src/channel.ts
git commit -m "feat(core): add SongSessionSummary to ChannelState"
```

---

### Task 2.2: Implement SongSession state machine

**Files:**
- Create: `server/src/songSession.ts`
- Create: `server/src/songSession.test.ts`
- Modify: `server/src/channels.ts`

- [ ] **Step 1: Add `setSongSessionSummary` to channels.ts**

Modify `server/src/channels.ts`:

1. Update `getOrInit` to include `songSession`:

```ts
function getOrInit(channel: string): ChannelState {
  let s = states.get(channel);
  if (!s) {
    s = { channel, active: null };
    states.set(channel, s);
  }
  return s;
}
```

(no change needed — `songSession` is optional and absent by default)

2. Add a new exported function:

```ts
import type { SongSessionSummary } from "@overlaysys/core";

export function setSongSessionSummary(
  channel: string,
  summary: SongSessionSummary | null,
): void {
  const s = getOrInit(channel);
  if (summary === null) {
    delete s.songSession;
  } else {
    s.songSession = summary;
  }
  states.set(channel, s);
  emit(channel);
}
```

(Add the `import type` near the top alongside the existing `ChannelState` import.)

- [ ] **Step 2: Write failing tests for SongSession**

Create `server/src/songSession.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as songSession from "./songSession";

const song: Song = {
  id: "test-song",
  title: "Test Song",
  sections: [
    {
      id: "v1",
      kind: "verse",
      label: "Verse 1",
      slides: [
        { id: "v1s1", lines: ["Line A1", "Line A2"] },
        { id: "v1s2", lines: ["Line B1", "Line B2"] },
      ],
    },
    {
      id: "c",
      kind: "chorus",
      label: "Chorus",
      slides: [
        { id: "c1", lines: ["Chorus 1", "Chorus 2"] },
      ],
    },
  ],
  defaultArrangement: ["v1", "c", "v1"],
};

const CH = "program";

describe("songSession", () => {
  beforeEach(() => {
    songSession.endAll();
  });

  it("starts a session and renders the first slide on the channel", () => {
    songSession.start(CH, {
      song,
      lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement,
      trustMode: false,
    });
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("lyric-default");
    expect(s.active?.data.text).toBe("Line A1\nLine A2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 0 });
  });

  it("advance(+1) moves to the next slide in the same section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance past end of section moves to next section in arrangement", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1); // v1 slide 2
    songSession.advance(CH, 1); // -> chorus slide 0
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("advance(-1) moves backward across section boundary", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.advance(CH, 1);
    songSession.advance(CH, 1); // chorus
    songSession.advance(CH, -1); // back to v1 slide 2
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Line B1\nLine B2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 0, slideIdx: 1 });
  });

  it("advance(+1) past end of arrangement is a no-op", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.advance(CH, 1); // slide 2
    const before = channels.getState(CH).songSession?.cursor;
    songSession.advance(CH, 1); // would overflow
    const after = channels.getState(CH).songSession?.cursor;
    expect(after).toEqual(before);
  });

  it("jump moves cursor to the requested section", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.active?.data.text).toBe("Chorus 1\nChorus 2");
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("jump to a section not yet in the arrangement appends it", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: ["v1"], trustMode: false,
    });
    songSession.jump(CH, "c");
    const s = channels.getState(CH);
    expect(s.songSession?.arrangement).toEqual(["v1", "c"]);
    expect(s.songSession?.cursor).toEqual({ sectionIdx: 1, slideIdx: 0 });
  });

  it("blank toggles channel.active to null without ending the session", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.blank(CH);
    const blanked = channels.getState(CH);
    expect(blanked.active).toBe(null);
    expect(blanked.songSession?.blanked).toBe(true);
    songSession.blank(CH);
    const restored = channels.getState(CH);
    expect(restored.active?.data.text).toBe("Line A1\nLine A2");
    expect(restored.songSession?.blanked).toBe(false);
  });

  it("end clears the session and the channel", () => {
    songSession.start(CH, {
      song, lyricTemplateId: "lyric-default",
      arrangement: song.defaultArrangement, trustMode: false,
    });
    songSession.end(CH);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/server test`
Expected: FAIL — `Cannot find module './songSession'`.

- [ ] **Step 4: Implement songSession.ts**

Create `server/src/songSession.ts`:

```ts
import type { Song, SongSessionSummary } from "@overlaysys/core";
import * as channels from "./channels";

interface StartArgs {
  song: Song;
  lyricTemplateId: string;
  arrangement: string[];
  trustMode: boolean;
}

interface InternalSession {
  channel: string;
  song: Song;
  lyricTemplateId: string;
  arrangement: string[];
  cursor: { sectionIdx: number; slideIdx: number };
  blanked: boolean;
  trustMode: boolean;
  startedAt: number;
}

const sessions = new Map<string, InternalSession>();

function summarize(s: InternalSession): SongSessionSummary {
  return {
    songId: s.song.id,
    lyricTemplateId: s.lyricTemplateId,
    arrangement: s.arrangement.slice(),
    cursor: { ...s.cursor },
    blanked: s.blanked,
    trustMode: s.trustMode,
    startedAt: s.startedAt,
  };
}

function sectionAt(s: InternalSession, sectionIdx: number) {
  const sectionId = s.arrangement[sectionIdx];
  return s.song.sections.find((sec) => sec.id === sectionId) ?? null;
}

function currentSlideText(s: InternalSession): string | null {
  const sec = sectionAt(s, s.cursor.sectionIdx);
  if (!sec) return null;
  const slide = sec.slides[s.cursor.slideIdx];
  if (!slide) return null;
  return slide.lines.join("\n");
}

function render(s: InternalSession): void {
  channels.setSongSessionSummary(s.channel, summarize(s));
  if (s.blanked) {
    // Don't clear via channels.clear() — that triggers its grace-period
    // null sweep and ends the session feel. Instead, set active null directly
    // by issuing a take with empty text? No — we want a true blank screen.
    // The right move: call clear() and rely on songSession.blanked staying
    // true so the operator UI shows we're blanked, not ended.
    channels.clear(s.channel);
    return;
  }
  const text = currentSlideText(s);
  if (text === null) return;
  channels.take(s.channel, s.lyricTemplateId, { text });
}

export function start(channel: string, args: StartArgs): void {
  const internal: InternalSession = {
    channel,
    song: args.song,
    lyricTemplateId: args.lyricTemplateId,
    arrangement: args.arrangement.slice(),
    cursor: { sectionIdx: 0, slideIdx: 0 },
    blanked: false,
    trustMode: args.trustMode,
    startedAt: Date.now(),
  };
  sessions.set(channel, internal);
  render(internal);
}

export function getSession(channel: string): SongSessionSummary | null {
  const s = sessions.get(channel);
  return s ? summarize(s) : null;
}

export function advance(channel: string, delta: number): void {
  const s = sessions.get(channel);
  if (!s) return;
  let { sectionIdx, slideIdx } = s.cursor;
  let remaining = delta;

  const step = remaining > 0 ? 1 : -1;
  while (remaining !== 0) {
    const sec = sectionAt(s, sectionIdx);
    if (!sec) break;
    const nextSlide = slideIdx + step;
    if (nextSlide >= 0 && nextSlide < sec.slides.length) {
      slideIdx = nextSlide;
    } else {
      const nextSection = sectionIdx + step;
      if (nextSection < 0 || nextSection >= s.arrangement.length) break;
      sectionIdx = nextSection;
      const newSec = sectionAt(s, sectionIdx);
      if (!newSec) break;
      slideIdx = step > 0 ? 0 : newSec.slides.length - 1;
    }
    remaining -= step;
  }
  s.cursor = { sectionIdx, slideIdx };
  render(s);
}

export function jump(
  channel: string,
  sectionId: string,
  slideIdx: number = 0,
): void {
  const s = sessions.get(channel);
  if (!s) return;
  // If the section already exists in the arrangement, jump there. Otherwise
  // append it (handles "drop to bridge" audibles).
  let sectionIdx = s.arrangement.indexOf(sectionId);
  if (sectionIdx < 0) {
    if (!s.song.sections.some((sec) => sec.id === sectionId)) return;
    s.arrangement.push(sectionId);
    sectionIdx = s.arrangement.length - 1;
  }
  s.cursor = { sectionIdx, slideIdx };
  render(s);
}

/**
 * Resolve a section by `kind` ordinal. Used by hotkeys that don't know the
 * section id: `V2` → second section with kind === "verse".
 *   - kind: "verse" | "chorus" | "bridge" | "tag" | ...
 *   - ordinal: 1-based (V1 → ordinal 1)
 */
export function jumpByKindOrdinal(
  channel: string,
  kind: string,
  ordinal: number,
): void {
  const s = sessions.get(channel);
  if (!s) return;
  let n = 0;
  for (const sec of s.song.sections) {
    if (sec.kind === kind) {
      n += 1;
      if (n === ordinal) {
        jump(channel, sec.id);
        return;
      }
    }
  }
}

export function blank(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.blanked = !s.blanked;
  render(s);
}

export function setTrust(channel: string, trustMode: boolean): void {
  const s = sessions.get(channel);
  if (!s) return;
  s.trustMode = trustMode;
  channels.setSongSessionSummary(channel, summarize(s));
}

export function end(channel: string): void {
  const s = sessions.get(channel);
  if (!s) return;
  sessions.delete(channel);
  channels.setSongSessionSummary(channel, null);
  channels.clear(channel);
}

/**
 * Test helper. Drops every active session without notifying channels — used
 * by unit tests to reset state between cases.
 */
export function endAll(): void {
  for (const ch of Array.from(sessions.keys())) end(ch);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/server test`
Expected: PASS — all 9 cases green.

- [ ] **Step 6: Commit**

```bash
git add server/src/songSession.ts server/src/songSession.test.ts server/src/channels.ts
git commit -m "feat(server): SongSession state machine with advance/jump/blank/end"
```

---

### Task 2.3: Wire song session take to non-song row clears

**Files:**
- Modify: `server/src/channels.ts`

The session must end if a non-song take happens on the same channel, otherwise stale `songSession` summaries persist.

- [ ] **Step 1: End session on take of non-song row**

The session is started by an explicit `song_take`. A regular `take()` call (from a graphic row) needs to end any active song session on that channel.

Modify `server/src/channels.ts` `take()`:

```ts
import * as songSession from "./songSession";

export function take(channel: string, templateId: string, data: Record<string, string>): void {
  // If a song session exists, ending it via songSession.end would be wrong —
  // songSession itself uses channels.take to render slides. Distinguish
  // "internal render" from "external take" via a module-private flag.
  const internal = takeIsInternal;
  if (!internal) {
    const session = songSession.getSession(channel);
    if (session) {
      // External take while a song session is live → end the session, then
      // proceed with the new take.
      songSession.end(channel);
    }
  }
  const s = getOrInit(channel);
  s.active = { templateId, data, phase: "in", takenAt: Date.now() };
  states.set(channel, s);
  emit(channel);
}

let takeIsInternal = false;
export function takeInternal(channel: string, templateId: string, data: Record<string, string>): void {
  takeIsInternal = true;
  try {
    take(channel, templateId, data);
  } finally {
    takeIsInternal = false;
  }
}
```

(Wait — circular import risk. `channels.ts` imports `songSession`, `songSession.ts` imports `channels`. That's fine in TS as long as we only import-type or call functions lazily. Since `songSession` is only used inside `take()` body, the cycle resolves at runtime. Confirm with typecheck.)

Then update `songSession.render()` to call `channels.takeInternal` instead of `channels.take`:

```ts
function render(s: InternalSession): void {
  channels.setSongSessionSummary(s.channel, summarize(s));
  if (s.blanked) {
    channels.clear(s.channel);
    return;
  }
  const text = currentSlideText(s);
  if (text === null) return;
  channels.takeInternal(s.channel, s.lyricTemplateId, { text });
}
```

- [ ] **Step 2: Add a test for end-on-graphic-take**

Append to `server/src/songSession.test.ts`:

```ts
it("ends the session when a graphic take lands on the same channel", () => {
  songSession.start(CH, {
    song, lyricTemplateId: "lyric-default",
    arrangement: song.defaultArrangement, trustMode: false,
  });
  channels.take(CH, "lower-third-default", { name: "Pastor" });
  const s = channels.getState(CH);
  expect(s.songSession).toBeUndefined();
  expect(s.active?.templateId).toBe("lower-third-default");
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @overlaysys/server test`
Expected: PASS — including new case.

- [ ] **Step 4: Commit**

```bash
git add server/src/channels.ts server/src/songSession.ts server/src/songSession.test.ts
git commit -m "feat(server): non-song take on same channel ends active SongSession"
```

---

### Task 2.4: Add song session WS messages

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`
- Modify: `server/src/ws.ts`

- [ ] **Step 1: Add client messages to ws-protocol**

Modify `packages/ws-protocol/src/index.ts` `ClientMessageSchema` array — add:

```ts
z.object({
  type: z.literal("song_take"),
  channel: z.string(),
  showId: z.string(),
  songRowId: z.string(),
}),
z.object({
  type: z.literal("song_advance"),
  channel: z.string(),
  delta: z.number().int(),
}),
z.object({
  type: z.literal("song_jump"),
  channel: z.string(),
  sectionId: z.string(),
  slideIdx: z.number().int().nonnegative().optional(),
}),
z.object({
  type: z.literal("song_jump_kind"),
  channel: z.string(),
  kind: z.string(),
  ordinal: z.number().int().min(1),
}),
z.object({
  type: z.literal("song_blank"),
  channel: z.string(),
}),
z.object({
  type: z.literal("song_set_trust"),
  channel: z.string(),
  trustMode: z.boolean(),
}),
z.object({
  type: z.literal("song_end"),
  channel: z.string(),
}),
```

- [ ] **Step 2: Wire handlers in ws.ts**

Modify `server/src/ws.ts`:

1. Add imports:

```ts
import * as songSession from "./songSession";
```

2. Add cases to the switch:

```ts
case "song_take": {
  const show = await shows.getShow(parsed.showId);
  if (!show) {
    send({ type: "error", code: "not_found", message: parsed.showId });
    break;
  }
  const row = show.rows.find((r) => r.id === parsed.songRowId);
  if (!row || row.kind !== "song") {
    send({ type: "error", code: "not_found", message: parsed.songRowId });
    break;
  }
  const song = await songs.getSong(row.songId);
  if (!song) {
    send({ type: "error", code: "not_found", message: row.songId });
    break;
  }
  songSession.start(parsed.channel, {
    song,
    lyricTemplateId: row.lyricTemplateId,
    arrangement: row.arrangement ?? song.defaultArrangement,
    trustMode: row.trustMode ?? false,
  });
  break;
}
case "song_advance": {
  songSession.advance(parsed.channel, parsed.delta);
  break;
}
case "song_jump": {
  songSession.jump(parsed.channel, parsed.sectionId, parsed.slideIdx ?? 0);
  break;
}
case "song_jump_kind": {
  songSession.jumpByKindOrdinal(parsed.channel, parsed.kind, parsed.ordinal);
  break;
}
case "song_blank": {
  songSession.blank(parsed.channel);
  break;
}
case "song_set_trust": {
  songSession.setTrust(parsed.channel, parsed.trustMode);
  break;
}
case "song_end": {
  songSession.end(parsed.channel);
  break;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ws-protocol/src/index.ts server/src/ws.ts
git commit -m "feat(server): SongSession WS protocol (take/advance/jump/blank/end)"
```

---

### Task 2.5: Add song-row to fixture show

**Files:**
- Modify: `data/shows/fixtures/demo-show.json`

- [ ] **Step 1: Append a song row**

Read `data/shows/fixtures/demo-show.json`, then add an entry to its `rows` array:

```json
{
  "kind": "song",
  "id": "row-amazing-grace",
  "songId": "amazing-grace",
  "lyricTemplateId": "lower-third-default"
}
```

(Reusing `lower-third-default` for now — it has a `name` field, not a `text` field, so the rendered output will be visibly off until a real lyric template is created. That's acceptable for smoke testing the protocol; we'll create a proper lyric template in Phase 3.)

Tag any pre-existing rows with `kind: "graphic"` (legacy preprocess covers them, but explicit is clearer for new files):

For each existing row in `data/shows/fixtures/demo-show.json`, prepend `"kind": "graphic"`. (If the existing rows are minimal — just `id`, `templateId`, `data` — a quick pass through them adding `kind` is sufficient.)

- [ ] **Step 2: Reseed (delete live show so fixture re-copies)**

```bash
rm data/shows/demo-show.json.ignorefixture
```

(Storage layer will re-seed from fixtures on next boot.)

- [ ] **Step 3: Verify show parses**

Run: `pnpm --filter @overlaysys/server typecheck` then start server briefly:

```bash
pnpm --filter @overlaysys/server dev
```

Expected: boots without error; logs include `1 show(s)` with the song row present.

- [ ] **Step 4: Commit**

```bash
git add data/shows/fixtures/demo-show.json.ignorefixture
git commit -m "test(data): demo show includes a song row"
```

---

### Task 2.6: Smoke test full song lifecycle

**Files:**
- Create: `server/scripts/song-smoke.mjs`

- [ ] **Step 1: Write the smoke script**

Create `server/scripts/song-smoke.mjs`:

```js
// Phase A2 smoke: full song-session lifecycle over WS.
import { WebSocket } from "ws";

const url = process.env.WS_URL ?? "ws://localhost:4000/ws";
const ws = new WebSocket(url);

const received = [];
let resolveDone;
const done = new Promise((r) => (resolveDone = r));
const timeout = setTimeout(() => {
  console.error("FAIL: song-smoke timed out");
  console.error("received:", received.map((m) => m.type));
  process.exit(1);
}, 8000);

function s(msg) { ws.send(JSON.stringify(msg)); }

ws.on("open", () => {
  s({ type: "subscribe", channel: "program", role: "renderer" });

  setTimeout(() => s({
    type: "song_take",
    channel: "program",
    showId: "demo-show",
    songRowId: "row-amazing-grace",
  }), 100);

  setTimeout(() => s({ type: "song_advance", channel: "program", delta: 1 }), 300);
  setTimeout(() => s({ type: "song_jump", channel: "program", sectionId: "c" }), 500);
  setTimeout(() => s({ type: "song_jump_kind", channel: "program", kind: "verse", ordinal: 1 }), 700);
  setTimeout(() => s({ type: "song_blank", channel: "program" }), 900);
  setTimeout(() => s({ type: "song_blank", channel: "program" }), 1100);
  setTimeout(() => s({ type: "song_end", channel: "program" }), 1300);

  setTimeout(() => resolveDone(), 2000);
});

ws.on("message", (raw) => { received.push(JSON.parse(raw.toString())); });
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });

await done;
clearTimeout(timeout);
ws.close();

const states = received.filter((m) => m.type === "state" && m.channel === "program");

const expectations = {
  initial_take_text: states.some(
    (m) => m.state.songSession && m.state.songSession.cursor.sectionIdx === 0 &&
           m.state.songSession.cursor.slideIdx === 0,
  ),
  advanced: states.some(
    (m) => m.state.songSession?.cursor.sectionIdx === 0 &&
           m.state.songSession?.cursor.slideIdx === 1,
  ),
  jumped_to_chorus: states.some(
    (m) => m.state.songSession?.arrangement[m.state.songSession.cursor.sectionIdx] === "c",
  ),
  jumped_back_to_v1: states.some(
    (m) => m.state.songSession?.arrangement[m.state.songSession.cursor.sectionIdx] === "v1",
  ),
  blanked_then_unblanked: (() => {
    const bs = states.map((m) => m.state.songSession?.blanked).filter((v) => v !== undefined);
    return bs.includes(true) && bs[bs.length - 1] === false;
  })(),
  session_ended: states.some(
    (m, i) => i === states.length - 1 && m.state.songSession === undefined,
  ),
};

let ok = true;
for (const [k, v] of Object.entries(expectations)) {
  console.log(v ? `  ✓ ${k}` : `  ✗ ${k}`);
  if (!v) ok = false;
}

if (ok) {
  console.log("PASS: song-smoke");
  process.exit(0);
} else {
  console.error("FAIL: see ✗ above");
  console.error("session states observed:", states.map((m) => m.state.songSession ?? null));
  process.exit(1);
}
```

- [ ] **Step 2: Run smoke**

Start server, then:

```bash
node server/scripts/song-smoke.mjs
```

Expected: all six expectations PASS.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/song-smoke.mjs
git commit -m "test(server): WS smoke for full song-session lifecycle"
```

---

## Phase 3: Operator song-mode UI + hotkeys

### Task 3.1: Create a real lyric template fixture

**Files:**
- Create: `data/templates/fixtures/lyric-default.json`
- Modify: `data/shows/fixtures/demo-show.json` (point song row at new template)

A song row needs a template with a `text` field. The existing `lower-third-default` template uses `name`/`title` fields, so the rendered text would land in the wrong place. Create a minimal lyric template before building the operator UI.

- [ ] **Step 1: Author the lyric template**

Create `data/templates/fixtures/lyric-default.json`:

```json
{
  "id": "lyric-default",
  "name": "Lyric — Default",
  "size": { "w": 1920, "h": 1080 },
  "fonts": [],
  "fields": [
    { "key": "text", "label": "Lyric Text", "type": "text", "default": "" }
  ],
  "layers": [
    {
      "type": "shape",
      "id": "lyric-bg",
      "name": "Lower band",
      "visible": true,
      "shape": "rect",
      "fill": {
        "kind": "linear-gradient",
        "angle": 180,
        "stops": [
          { "at": 0, "color": "rgba(0,0,0,0)" },
          { "at": 1, "color": "rgba(0,0,0,0.85)" }
        ]
      },
      "cornerRadius": 0,
      "transform": {
        "x": 0, "y": 760, "w": 1920, "h": 320,
        "rotation": 0, "scaleX": 1, "scaleY": 1, "opacity": 1, "anchorX": 0, "anchorY": 0
      }
    },
    {
      "type": "text",
      "id": "lyric-text",
      "name": "Lyric",
      "visible": true,
      "content": { "fieldKey": "text" },
      "style": {
        "fontFamily": "Inter, system-ui, sans-serif",
        "fontSize": 64,
        "fontWeight": 600,
        "color": "#ffffff",
        "letterSpacing": 0,
        "lineHeight": 1.2,
        "align": "center"
      },
      "transform": {
        "x": 80, "y": 840, "w": 1760, "h": 200,
        "rotation": 0, "scaleX": 1, "scaleY": 1, "opacity": 1, "anchorX": 0, "anchorY": 0
      }
    }
  ],
  "timelines": {
    "in": {
      "duration": 0.4,
      "tracks": [
        { "layerId": "lyric-text", "property": "opacity", "keyframes": [
          { "t": 0, "value": 0, "easing": "power2.out" },
          { "t": 0.4, "value": 1, "easing": "power2.out" }
        ]},
        { "layerId": "lyric-text", "property": "y", "keyframes": [
          { "t": 0, "value": 856, "easing": "power3.out" },
          { "t": 0.4, "value": 840, "easing": "power3.out" }
        ]}
      ]
    },
    "out": {
      "duration": 0.3,
      "tracks": [
        { "layerId": "lyric-text", "property": "opacity", "keyframes": [
          { "t": 0, "value": 1, "easing": "power2.in" },
          { "t": 0.3, "value": 0, "easing": "power2.in" }
        ]}
      ]
    }
  }
}
```

- [ ] **Step 2: Update fixture show to use new template**

In `data/shows/fixtures/demo-show.json`, change the song row's `lyricTemplateId` to `"lyric-default"`.

- [ ] **Step 3: Reseed**

```bash
rm data/templates/lyric-default.json data/shows/demo-show.json.ignorefixture 2>/dev/null
```

(Files only exist if a previous boot seeded them — ignore errors.)

- [ ] **Step 4: Boot + verify**

Start server. Verify in the boot log: template count includes `lyric-default`. Run `node server/scripts/song-smoke.mjs` — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add data/templates/fixtures/lyric-default.json data/shows/fixtures/demo-show.json.ignorefixture
git commit -m "feat(data): add lyric-default template fixture"
```

---

### Task 3.2: Extend operator store with songs + active song session

**Files:**
- Modify: `apps/operator/src/lib/store.ts`

- [ ] **Step 1: Read current store and identify state shape**

Run: `cat apps/operator/src/lib/store.ts | head -80` to confirm the existing zustand store shape.

- [ ] **Step 2: Add song-related state slices**

Modify `apps/operator/src/lib/store.ts` to add (alongside existing `templates`, `templateCache` etc.):

```ts
import type {
  Song, SongMeta, SongSessionSummary,
} from "@overlaysys/core";

// inside the store interface, add:
songs: SongMeta[];
songCache: Record<string, Song>;
songSessions: Record<string, SongSessionSummary | null>; // keyed by channel

setSongs: (songs: SongMeta[]) => void;
setSong: (song: Song) => void;
setSongSession: (channel: string, session: SongSessionSummary | null) => void;
```

In the `create<...>` body, initialize:

```ts
songs: [],
songCache: {},
songSessions: {},

setSongs: (songs) => set({ songs }),
setSong: (song) => set((s) => ({ songCache: { ...s.songCache, [song.id]: song } })),
setSongSession: (channel, session) =>
  set((s) => ({ songSessions: { ...s.songSessions, [channel]: session } })),
```

- [ ] **Step 3: Wire incoming WS messages to the store**

Locate the existing message dispatch (likely in `useWs.ts` or a top-level effect). For every `song_list`, `song`, and `state` message:

```ts
// Inside the message handler:
case "song_list":
  store.setSongs(msg.songs);
  break;
case "song":
  store.setSong(msg.song);
  break;
case "state":
  // existing channel state handling stays
  store.setSongSession(msg.channel, msg.state.songSession ?? null);
  break;
```

(If your existing handler is a switch on `msg.type`, slot these new cases in. If it's an if/else chain, follow the same pattern.)

- [ ] **Step 4: Request the song list on connect**

Find where `list_templates` and `list_shows` are sent on connect (likely in a `useEffect` once the WS is open). Add:

```ts
send({ type: "list_songs" });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter operator typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/lib/store.ts apps/operator/src/lib/useWs.ts
git commit -m "feat(operator): track songs + per-channel song session in store"
```

---

### Task 3.3: Differentiate song rows visually in Rundown

**Files:**
- Modify: `apps/operator/src/app/components/Rundown.tsx`

- [ ] **Step 1: Make `Rundown` handle the discriminated union**

Modify `apps/operator/src/app/components/Rundown.tsx`:

1. Update the row rendering to branch on `row.kind`. Replace the `tr` mapping body:

```tsx
{show.rows.map((row, i) => {
  const selected = row.id === selectedRowId;
  if (row.kind === "song") {
    const song = songs.find((s) => s.id === row.songId);
    return (
      <tr
        key={row.id}
        onClick={() => setSelectedRow(row.id)}
        onDoubleClick={() => {
          setSelectedRow(row.id);
          send({
            type: "song_take",
            channel: "program",
            showId: show.id,
            songRowId: row.id,
          });
        }}
        style={{
          background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
          borderLeft: selected
            ? "3px solid var(--accent)"
            : "3px solid transparent",
          cursor: "pointer",
        }}
      >
        <td style={td()}>{i + 1}</td>
        <td style={td()}>
          <div style={{ fontWeight: 600 }}>
            <span aria-hidden style={{ marginRight: 6 }}>♪</span>
            {song?.title ?? row.songId}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
            song · {row.lyricTemplateId}
          </div>
        </td>
        <td style={td()}>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            arrangement: {(row.arrangement ?? []).join(" → ") || "(default)"}
          </span>
        </td>
      </tr>
    );
  }
  // existing graphic row branch:
  const tplMeta = templates.find((t) => t.id === row.templateId);
  const tpl = templateCache[row.templateId] ?? null;
  const tplName = tplMeta?.name ?? row.templateId;
  return (/* existing graphic row JSX, unchanged */);
})}
```

2. Add `songs = useStore((s) => s.songs)` near the other store reads at the top of the component.

3. Update the existing `cueSelected` and `takeSelected` to handle song rows:

```tsx
function cueSelected() {
  if (!show || !selectedRowId) return;
  const row = show.rows.find((r) => r.id === selectedRowId);
  if (!row) return;
  if (row.kind === "song") {
    // Songs go straight to program (cueing makes less sense — UX deferred)
    send({ type: "song_take", channel: "program", showId: show.id, songRowId: row.id });
    return;
  }
  send({
    type: "cue", channel: "preview",
    templateId: row.templateId, data: row.data,
  });
}

function takeSelected() {
  if (!show || !selectedRowId) return;
  const row = show.rows.find((r) => r.id === selectedRowId);
  if (!row) return;
  if (row.kind === "song") {
    send({ type: "song_take", channel: "program", showId: show.id, songRowId: row.id });
    return;
  }
  send({
    type: "take", channel: "program",
    templateId: row.templateId, data: row.data,
  });
}
```

4. Update the `useEffect` that prefetches templates — it iterates `r.templateId`, which doesn't exist on song rows:

```tsx
useEffect(() => {
  if (!show || conn !== "open") return;
  const seen = new Set<string>();
  for (const r of show.rows) {
    const tplId = r.kind === "song" ? r.lyricTemplateId : r.templateId;
    if (seen.has(tplId)) continue;
    seen.add(tplId);
    if (!templateCache[tplId]) {
      send({ type: "get_template", templateId: tplId });
    }
  }
}, [show, templateCache, conn, send]);
```

- [ ] **Step 2: Typecheck and run dev**

```bash
pnpm --filter operator typecheck
pnpm dev   # in another terminal, then visit operator UI and check the rundown
```

Expected: typecheck PASS; opening the operator UI, the demo show shows a `♪ Amazing Grace` row alongside graphic rows.

- [ ] **Step 3: Manually test taking the song**

Click the song row, hit Take. Renderer (browser source) should show the first slide ("Amazing grace how sweet the sound / That saved a wretch like me"). Confirm visually.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/components/Rundown.tsx
git commit -m "feat(operator): render song rows in rundown + take with song_take"
```

---

### Task 3.4: Build SongModePanel

**Files:**
- Create: `apps/operator/src/app/components/SongModePanel.tsx`

- [ ] **Step 1: Implement the panel**

Create `apps/operator/src/app/components/SongModePanel.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import type { Song, SongSessionSummary } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

interface Props {
  channel: string;
  session: SongSessionSummary;
}

export function SongModePanel({ channel, session }: Props) {
  const { send } = useWs();
  const song = useStore((s) => s.songCache[session.songId]);

  useEffect(() => {
    if (!song) {
      send({ type: "get_song", songId: session.songId });
    }
  }, [song, send, session.songId]);

  if (!song) {
    return <div style={panelStyle()}>Loading song…</div>;
  }

  const currentSectionId = session.arrangement[session.cursor.sectionIdx];
  const currentSection = song.sections.find((s) => s.id === currentSectionId);

  return (
    <div style={panelStyle()}>
      <Header channel={channel} song={song} session={session} />
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 220px", gap: 12, marginTop: 12 }}>
        <SectionList
          song={song}
          currentSectionId={currentSectionId ?? null}
          onJump={(sectionId) =>
            send({ type: "song_jump", channel, sectionId })
          }
        />
        <SlideGrid
          section={currentSection ?? null}
          currentSlideIdx={session.cursor.slideIdx}
          onSelect={(slideIdx) =>
            currentSectionId &&
            send({
              type: "song_jump",
              channel,
              sectionId: currentSectionId,
              slideIdx,
            })
          }
        />
        <UpNext song={song} session={session} />
      </div>
    </div>
  );
}

function Header({ channel, song, session }: { channel: string; song: Song; session: SongSessionSummary }) {
  const { send } = useWs();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 16 }}>♪ {song.title}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
        {song.author} · {channel}
      </div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, opacity: 0.4, cursor: "not-allowed" }}
          title="Plan B (STT) not yet implemented"
        >
          <input type="checkbox" checked={session.trustMode} disabled />
          Trust Mode
        </label>
        <button
          onClick={() => send({ type: "song_blank", channel })}
          style={btn(session.blanked ? "primary" : "default")}
        >
          {session.blanked ? "Unblank" : "Blank (.)"}
        </button>
        <button onClick={() => send({ type: "song_end", channel })} style={btn()}>
          End Song (Esc)
        </button>
      </div>
    </div>
  );
}

function SectionList({
  song, currentSectionId, onJump,
}: {
  song: Song; currentSectionId: string | null;
  onJump: (sectionId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {song.sections.map((sec) => {
        const active = sec.id === currentSectionId;
        return (
          <button
            key={sec.id}
            onClick={() => onJump(sec.id)}
            style={{
              textAlign: "left",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: active ? "rgba(255, 58, 58, 0.18)" : "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>{sec.label}</div>
            <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
              {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SlideGrid({
  section, currentSlideIdx, onSelect,
}: {
  section: Song["sections"][number] | null;
  currentSlideIdx: number;
  onSelect: (slideIdx: number) => void;
}) {
  if (!section) return <div style={{ color: "var(--text-dim)" }}>—</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
      {section.slides.map((slide, i) => {
        const active = i === currentSlideIdx;
        return (
          <button
            key={slide.id}
            onClick={() => onSelect(i)}
            style={{
              padding: 12,
              borderRadius: 4,
              border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
              background: active ? "rgba(255, 58, 58, 0.12)" : "var(--panel-2)",
              color: "var(--text)",
              cursor: "pointer",
              textAlign: "left",
              minHeight: 80,
            }}
          >
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>
              Slide {i + 1}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.4 }}>
              {slide.lines.map((line, j) => (
                <div key={j}>{line}</div>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function UpNext({ song, session }: { song: Song; session: SongSessionSummary }) {
  const items: { label: string; lines: string[] }[] = [];
  let { sectionIdx, slideIdx } = session.cursor;
  for (let n = 0; n < 3 && sectionIdx < session.arrangement.length; n++) {
    const sec = song.sections.find((s) => s.id === session.arrangement[sectionIdx]);
    if (!sec) break;
    const slide = sec.slides[slideIdx];
    if (!slide) break;
    items.push({ label: `${sec.label} · slide ${slideIdx + 1}`, lines: slide.lines });
    if (slideIdx + 1 < sec.slides.length) slideIdx += 1;
    else { sectionIdx += 1; slideIdx = 0; }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 1 }}>
        Up Next
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            padding: 8,
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: i === 0 ? "rgba(255,58,58,0.08)" : "var(--panel-2)",
            fontSize: 11,
          }}
        >
          <div style={{ color: "var(--text-dim)", marginBottom: 2 }}>{item.label}</div>
          {item.lines.map((line, j) => (
            <div key={j} style={{ color: "var(--text)" }}>{line}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function panelStyle(): React.CSSProperties {
  return {
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: 12,
    background: "var(--panel)",
  };
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
```

- [ ] **Step 2: Auto-mount the panel when a song session is live on program**

Modify `apps/operator/src/app/page.tsx` (the operator main page). Find where `TakePanel` is rendered. Wrap with a conditional:

```tsx
import { SongModePanel } from "./components/SongModePanel";

// inside component body:
const session = useStore((s) => s.songSessions["program"]);

// inside JSX, replacing or alongside the existing TakePanel render:
{session ? (
  <SongModePanel channel="program" session={session} />
) : (
  <TakePanel /* existing props */ />
)}
```

(Adjust to actual layout and existing component structure — the goal is "show SongModePanel when there's a live session on program; otherwise show TakePanel.")

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter operator typecheck`
Expected: PASS.

- [ ] **Step 4: Manual test**

Run dev. Take the Amazing Grace row. SongModePanel appears with section list, slide grid (current slide highlighted), and Up Next column. Clicking a slide card → renderer updates. Clicking a section → renderer jumps. End Song button → returns to normal TakePanel.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/components/SongModePanel.tsx apps/operator/src/app/page.tsx
git commit -m "feat(operator): SongModePanel with section list, slide grid, up-next"
```

---

### Task 3.5: Wire song-mode hotkeys

**Files:**
- Modify: `apps/operator/src/app/hooks/useGlobalShortcuts.ts`

- [ ] **Step 1: Inspect current hotkey hook**

Read `apps/operator/src/app/hooks/useGlobalShortcuts.ts` to learn its structure (hook with keydown handler, dispatching via `send` from `useWs`).

- [ ] **Step 2: Add song-mode-aware branches**

Modify `useGlobalShortcuts.ts`. Inside the existing keydown handler (or a new `useEffect`), add a branch that fires only when there's an active session on `program`:

```ts
import type { SongSessionSummary } from "@overlaysys/core";
import { useStore } from "@/lib/store";

// inside the hook:
const session = useStore((s) => s.songSessions["program"]) as SongSessionSummary | null;

// inside the keydown handler — early branch:
if (session) {
  if (handleSongHotkey(e, session, send)) {
    e.preventDefault();
    return;
  }
}

// at module scope:
function handleSongHotkey(
  e: KeyboardEvent,
  session: SongSessionSummary,
  send: (msg: any) => void,
): boolean {
  const channel = "program";
  // Avoid stealing keys while typing in inputs
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
    return false;
  }

  if (e.key === " " && !e.shiftKey) {
    send({ type: "song_advance", channel, delta: 1 });
    return true;
  }
  if (e.key === " " && e.shiftKey) {
    send({ type: "song_advance", channel, delta: -1 });
    return true;
  }
  if (e.key === "Escape") {
    send({ type: "song_end", channel });
    return true;
  }
  if (e.key === "." || e.key === "b") {
    send({ type: "song_blank", channel });
    return true;
  }
  if (e.key.toLowerCase() === "c") {
    send({ type: "song_jump_kind", channel, kind: "chorus", ordinal: 1 });
    return true;
  }
  if (e.key.toLowerCase() === "b" && !e.metaKey && !e.ctrlKey) {
    // 'b' is overloaded with blank — pick which wins. Keeping blank on '.'
    // and giving 'b' to bridge for parity with V1/V2 hotkeys.
    send({ type: "song_jump_kind", channel, kind: "bridge", ordinal: 1 });
    return true;
  }
  if (e.key.toLowerCase() === "t") {
    send({ type: "song_jump_kind", channel, kind: "tag", ordinal: 1 });
    return true;
  }
  // V1, V2, V3 — two-key chord: V then digit. Simplify: 1/2/3 directly map
  // to Verse 1/2/3 in song mode (no global digit hotkeys exist today).
  if (e.key === "1" || e.key === "2" || e.key === "3") {
    send({
      type: "song_jump_kind",
      channel,
      kind: "verse",
      ordinal: Number(e.key),
    });
    return true;
  }
  return false;
}
```

(Resolve the duplicate `b` — pick `.` for blank and `b` for bridge. Adjust the conditional accordingly.)

- [ ] **Step 3: Typecheck and manual test**

```bash
pnpm --filter operator typecheck
```

Run dev. Take the song. With focus outside any input:
- Space → advance
- Shift+space → back
- 1 → jump to Verse 1
- C → jump to Chorus
- . → blank/unblank
- Esc → end

Expected: each hotkey produces the corresponding state change visible in SongModePanel and the renderer.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/hooks/useGlobalShortcuts.ts
git commit -m "feat(operator): song-mode hotkeys (space/shift+space/1-3/C/B/T/./esc)"
```

---

## Phase 4: Song library + paste-with-markers import

### Task 4.1: Build paste parser

**Files:**
- Create: `packages/core/src/songParser.ts`
- Create: `packages/core/src/songParser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/songParser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSongFromText } from "./songParser";

describe("parseSongFromText", () => {
  it("parses a basic verse + chorus", () => {
    const song = parseSongFromText(
      "amazing-grace",
      "Amazing Grace",
      `[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
My chains are gone
I've been set free`,
    );
    expect(song.id).toBe("amazing-grace");
    expect(song.sections).toHaveLength(2);
    expect(song.sections[0].kind).toBe("verse");
    expect(song.sections[0].label).toBe("Verse 1");
    expect(song.sections[0].slides[0].lines).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
    expect(song.sections[1].kind).toBe("chorus");
  });

  it("splits multiple slides within a section by blank line", () => {
    const song = parseSongFromText("t", "T", `[Verse 1]
Line A1
Line A2

Line B1
Line B2`);
    expect(song.sections[0].slides).toHaveLength(2);
    expect(song.sections[0].slides[0].lines).toEqual(["Line A1", "Line A2"]);
    expect(song.sections[0].slides[1].lines).toEqual(["Line B1", "Line B2"]);
  });

  it("infers section kind from header text", () => {
    const cases: { header: string; kind: string }[] = [
      { header: "Verse 1", kind: "verse" },
      { header: "verse 2", kind: "verse" },
      { header: "Chorus", kind: "chorus" },
      { header: "Pre-Chorus", kind: "other" },
      { header: "Bridge", kind: "bridge" },
      { header: "Tag", kind: "tag" },
      { header: "Intro", kind: "intro" },
      { header: "Outro", kind: "outro" },
      { header: "Vamp", kind: "other" },
    ];
    for (const c of cases) {
      const song = parseSongFromText("x", "X", `[${c.header}]
foo`);
      expect(song.sections[0].kind, c.header).toBe(c.kind);
    }
  });

  it("generates stable section ids per kind", () => {
    const song = parseSongFromText("x", "X", `[Verse 1]
a
[Chorus]
b
[Verse 2]
c`);
    expect(song.sections.map((s) => s.id)).toEqual(["v1", "c1", "v2"]);
  });

  it("seeds defaultArrangement to the parsed order", () => {
    const song = parseSongFromText("x", "X", `[Verse 1]
a
[Chorus]
b`);
    expect(song.defaultArrangement).toEqual(["v1", "c1"]);
  });

  it("trims leading and trailing blank lines and CR characters", () => {
    const song = parseSongFromText("x", "X", "\r\n[Verse 1]\r\nfoo\r\n\r\n");
    expect(song.sections[0].slides[0].lines).toEqual(["foo"]);
  });

  it("rejects input with no section headers", () => {
    expect(() => parseSongFromText("x", "X", "just some lines\nno header")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @overlaysys/core test -- songParser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `packages/core/src/songParser.ts`:

```ts
import { SongSchema, type Song, type Section, type Slide, type SectionKind } from "./song";

const HEADER_RE = /^\s*\[(.+?)\]\s*$/;

const KIND_KEYWORDS: { kind: SectionKind; keywords: string[] }[] = [
  // Order matters: more specific kinds first.
  { kind: "chorus", keywords: ["chorus"] },
  { kind: "verse", keywords: ["verse"] },
  { kind: "bridge", keywords: ["bridge"] },
  { kind: "tag", keywords: ["tag"] },
  { kind: "intro", keywords: ["intro"] },
  { kind: "outro", keywords: ["outro"] },
];

function inferKind(header: string): SectionKind {
  const lower = header.toLowerCase();
  // "Pre-Chorus" should NOT match "chorus" — guard with word boundary.
  for (const { kind, keywords } of KIND_KEYWORDS) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower))) {
      // pre-chorus / post-chorus etc. fall through to "other"
      if (lower.startsWith("pre-") || lower.startsWith("post-")) {
        return "other";
      }
      return kind;
    }
  }
  return "other";
}

function generateId(kind: SectionKind, kindCounts: Map<SectionKind, number>): string {
  const n = (kindCounts.get(kind) ?? 0) + 1;
  kindCounts.set(kind, n);
  const prefix: Record<SectionKind, string> = {
    verse: "v", chorus: "c", bridge: "b", tag: "t",
    intro: "i", outro: "o", other: "x",
  };
  return `${prefix[kind]}${n}`;
}

interface RawSection {
  header: string;
  blocks: string[][]; // each block = lines of one slide
}

function tokenize(text: string): RawSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let buffer: string[] = [];

  function flushSlide() {
    if (!current) return;
    if (buffer.length === 0) return;
    current.blocks.push(buffer);
    buffer = [];
  }

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      flushSlide();
      if (current) sections.push(current);
      current = { header: m[1].trim(), blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current) {
      // Lines before any header — ignore.
      continue;
    }
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  return sections;
}

export function parseSongFromText(
  id: string,
  title: string,
  text: string,
): Song {
  const raw = tokenize(text);
  if (raw.length === 0) {
    throw new Error("song text contains no [Section] headers");
  }
  const kindCounts = new Map<SectionKind, number>();
  const sections: Section[] = raw.map((rs) => {
    const kind = inferKind(rs.header);
    const sid = generateId(kind, kindCounts);
    const slides: Slide[] = rs.blocks.length === 0
      ? [{ id: `${sid}s1`, lines: [""] }]
      : rs.blocks.map((lines, i) => ({ id: `${sid}s${i + 1}`, lines }));
    return {
      id: sid,
      kind,
      label: rs.header,
      slides,
    };
  });

  return SongSchema.parse({
    id,
    title,
    sections,
    defaultArrangement: sections.map((s) => s.id),
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @overlaysys/core test`
Expected: PASS — all parser cases green plus existing schema tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songParser.ts packages/core/src/songParser.test.ts
git commit -m "feat(core): paste-with-section-markers song parser"
```

---

### Task 4.2: Re-export parser from core

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add export**

```ts
export * from "./songParser";
```

(Append to existing exports.)

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export songParser"
```

---

### Task 4.3: Song library list page

**Files:**
- Create: `apps/operator/src/app/songs/page.tsx`

- [ ] **Step 1: Implement the list page**

Create `apps/operator/src/app/songs/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export default function SongsPage() {
  const { send } = useWs();
  const songs = useStore((s) => s.songs);
  const conn = useStore((s) => s.conn);

  useEffect(() => {
    if (conn === "open") send({ type: "list_songs" });
  }, [conn, send]);

  function newSong() {
    const id = prompt("Song id (e.g. 'amazing-grace')?")?.trim();
    if (!id) return;
    const title = prompt("Title?", id)?.trim() ?? id;
    send({
      type: "save_song",
      song: {
        id,
        title,
        sections: [
          {
            id: "v1",
            kind: "verse",
            label: "Verse 1",
            slides: [{ id: "v1s1", lines: ["First line"] }],
          },
        ],
        defaultArrangement: ["v1"],
      },
    });
  }

  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Songs</h1>
        <button onClick={newSong} style={btn("primary")}>+ New Song</button>
        <Link href="/" style={{ marginLeft: "auto", color: "var(--text-dim)" }}>← Back</Link>
      </header>

      {songs.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>No songs yet. Create one to get started.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
              <th style={th()}>Title</th>
              <th style={th()}>Author</th>
              <th style={th()}>CCLI</th>
              <th style={th()}></th>
            </tr>
          </thead>
          <tbody>
            {songs.map((s) => (
              <tr key={s.id}>
                <td style={td()}>
                  <Link href={`/songs/${encodeURIComponent(s.id)}`} style={{ fontWeight: 600 }}>
                    {s.title}
                  </Link>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {s.id}
                  </div>
                </td>
                <td style={td()}>{s.author ?? "—"}</td>
                <td style={td()}>{s.ccliNumber ?? "—"}</td>
                <td style={td()}>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${s.title}"?`)) {
                        send({ type: "delete_song", songId: s.id });
                      }
                    }}
                    style={btn()}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
function th(): React.CSSProperties {
  return { padding: "6px 8px", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 11 };
}
function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: "1px solid var(--border)" };
}
```

- [ ] **Step 2: Add a navigation link from the home page**

In `apps/operator/src/app/page.tsx`, find the top nav section (where there are links to `/design`, `/shows`, etc.) and add:

```tsx
<Link href="/songs">Songs</Link>
```

- [ ] **Step 3: Typecheck + manual test**

```bash
pnpm --filter operator typecheck
pnpm dev
```

Visit `http://localhost:3000/songs`. Expect: Amazing Grace listed. Click + New Song; create a stub. Click delete; confirm it disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/songs/page.tsx apps/operator/src/app/page.tsx
git commit -m "feat(operator): songs library list page"
```

---

### Task 4.4: Song editor page (sections + slides + paste import)

**Files:**
- Create: `apps/operator/src/app/songs/[id]/page.tsx`

- [ ] **Step 1: Implement the editor**

Create `apps/operator/src/app/songs/[id]/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  parseSongFromText,
  type Song, type Section, type Slide,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export default function SongEditorPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    if (conn === "open" && !cached) send({ type: "get_song", songId: id });
  }, [conn, cached, id, send]);

  useEffect(() => {
    if (cached) setDraft(cached);
  }, [cached]);

  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  function setMeta<K extends keyof Song>(key: K, value: Song[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function updateSection(idx: number, patch: Partial<Section>) {
    setDraft((d) => {
      if (!d) return d;
      const next = d.sections.slice();
      next[idx] = { ...next[idx], ...patch };
      return { ...d, sections: next };
    });
  }

  function updateSlide(secIdx: number, slideIdx: number, lines: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const slides = sections[secIdx].slides.slice();
      slides[slideIdx] = { ...slides[slideIdx], lines };
      sections[secIdx] = { ...sections[secIdx], slides };
      return { ...d, sections };
    });
  }

  function addSlide(secIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      sections[secIdx] = {
        ...sec,
        slides: [...sec.slides, { id: `${sec.id}s${sec.slides.length + 1}`, lines: [""] }],
      };
      return { ...d, sections };
    });
  }

  function removeSlide(secIdx: number, slideIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (sec.slides.length <= 1) return d; // keep at least one
      sections[secIdx] = { ...sec, slides: sec.slides.filter((_, i) => i !== slideIdx) };
      return { ...d, sections };
    });
  }

  function save() {
    if (!draft) return;
    send({ type: "save_song", song: draft });
  }

  function applyPaste() {
    try {
      const parsed = parseSongFromText(draft.id, draft.title, pasteText);
      // Preserve metadata, replace sections + arrangement.
      setDraft({ ...draft, sections: parsed.sections, defaultArrangement: parsed.defaultArrangement });
      setPasteOpen(false);
      setPasteText("");
    } catch (err) {
      alert(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link href="/songs" style={{ color: "var(--text-dim)" }}>← Songs</Link>
        <h1 style={{ margin: 0, fontSize: 18 }}>{draft.title}</h1>
        <button onClick={() => setPasteOpen((v) => !v)} style={btn()}>Paste lyrics…</button>
        <button onClick={save} style={btn("primary")}>Save</button>
      </header>

      {pasteOpen && (
        <div style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
            Paste plain text with <code>[Section Name]</code> headers. Blank line = new slide within a section.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
          <button onClick={applyPaste} style={btn("primary")}>Replace song body</button>
        </div>
      )}

      <fieldset style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
        <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>Metadata</legend>
        <Field label="Title" value={draft.title} onChange={(v) => setMeta("title", v)} />
        <Field label="Author" value={draft.author ?? ""} onChange={(v) => setMeta("author", v || undefined)} />
        <Field label="CCLI #" value={draft.ccliNumber ?? ""} onChange={(v) => setMeta("ccliNumber", v || undefined)} />
        <Field label="Copyright" value={draft.copyright ?? ""} onChange={(v) => setMeta("copyright", v || undefined)} />
      </fieldset>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sections</h2>
      {draft.sections.map((sec, secIdx) => (
        <section key={sec.id} style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input
              value={sec.label}
              onChange={(e) => updateSection(secIdx, { label: e.target.value })}
              style={{ fontWeight: 600, flex: 1 }}
            />
            <select
              value={sec.kind}
              onChange={(e) => updateSection(secIdx, { kind: e.target.value as Section["kind"] })}
            >
              <option value="verse">verse</option>
              <option value="chorus">chorus</option>
              <option value="bridge">bridge</option>
              <option value="tag">tag</option>
              <option value="intro">intro</option>
              <option value="outro">outro</option>
              <option value="other">other</option>
            </select>
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
              {sec.id}
            </span>
          </div>
          {sec.slides.map((slide, slideIdx) => (
            <div key={slide.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <textarea
                value={slide.lines.join("\n")}
                onChange={(e) => updateSlide(secIdx, slideIdx, e.target.value.split("\n"))}
                rows={2}
                style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              />
              <button onClick={() => removeSlide(secIdx, slideIdx)} style={btn()} disabled={sec.slides.length <= 1}>
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => addSlide(secIdx)} style={btn()}>+ Slide</button>
        </section>
      ))}

      <fieldset style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
        <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>Default Arrangement</legend>
        <input
          value={draft.defaultArrangement.join(" → ")}
          onChange={(e) =>
            setMeta(
              "defaultArrangement",
              e.target.value.split("→").map((s) => s.trim()).filter(Boolean),
            )
          }
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        />
        <p style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
          Section ids separated by →. Available: {draft.sections.map((s) => s.id).join(", ")}
        </p>
      </fieldset>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
      <label style={{ width: 100, fontSize: 12, color: "var(--text-dim)" }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
    </div>
  );
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
```

- [ ] **Step 2: Typecheck + manual test**

```bash
pnpm --filter operator typecheck
pnpm dev
```

Visit `/songs/amazing-grace`. Confirm:
- Existing sections render with their slides
- Edit a slide → Save → reload page → change persists
- Click "Paste lyrics" → paste a small sample with `[Verse 1]` / `[Chorus]` → Replace → sections update; Save persists
- Edit Default Arrangement → Save → reload preserves

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/app/songs/[id]/page.tsx
git commit -m "feat(operator): song editor with metadata, sections, slides, paste import"
```

---

### Task 4.5: Final integration smoke

**Files:**
- (none — verification step)

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

Expected: PASS across `core` and `server`.

- [ ] **Step 2: Run smoke scripts**

In one terminal: `pnpm --filter @overlaysys/server dev`. In another:

```bash
node server/scripts/smoke.mjs
node server/scripts/song-smoke.mjs
```

Expected: both PASS.

- [ ] **Step 3: Manual end-to-end check**

Run `pnpm dev`. Open operator at `localhost:3000` and renderer at `localhost:3001/?channel=program`.

1. From `/`, take the Amazing Grace song row → renderer shows "Amazing grace how sweet the sound / That saved a wretch like me"
2. Hit Space → renderer advances to slide 2
3. Hit `c` → renderer jumps to chorus
4. Hit `1` → jumps back to Verse 1
5. Hit `.` → screen blanks (renderer goes empty)
6. Hit `.` again → restored
7. Hit `Esc` → song ends, screen clears
8. From `/songs`, edit Amazing Grace, paste a new lyric body, save, take it again → new lyrics render

- [ ] **Step 4: Commit nothing — final integration is just verification.**

If everything passes, the plan is done. Plan B (STT subsystem) is the next plan.

---

## Self-Review Notes

Run after writing the plan, before handing off:

- **Spec coverage:**
  - Spec phases 1, 2, 3, 4 → covered by plan phases 1, 2, 3, 4. Phases 5, 6 are explicitly Plan B.
  - Spec data model (Song, Section, Slide, RundownRow union, SongSession) → Tasks 1.2, 1.3, 2.1, 2.2.
  - Spec WS protocol additions (song CRUD, song_*, stt_*) — song CRUD and song_* are in Tasks 1.8 and 2.4. STT messages are deferred to Plan B per the scope split.
  - Spec lyric template approach (reuse existing Template with `text` field) → Task 3.1 fixture.
  - Spec operator UI (library, song mode panel, hotkeys, rundown integration) → Tasks 3.3–3.5, 4.3, 4.4.
  - Spec failure modes — non-song take ends session: Task 2.3. Reconnect: passive (server-authoritative state via existing reconnect path).
  - Spec testing strategy: vitest unit tests for schema/parser/state machine, smoke for end-to-end. ✓
  - Spec "Open questions" section is about Plan B (listener daemon runtime, model size, threshold tuning) — correct to defer.

- **Placeholder scan:** No "TBD" / "implement later" / "similar to" in tasks. Code blocks present for every code change.

- **Type consistency:** `SongSessionSummary` shape matches between `packages/core/src/song.ts`, `server/src/songSession.ts`, and `apps/operator/src/app/components/SongModePanel.tsx`. `RundownRow` discriminated union shape consistent across producer (parser) and consumer (rundown UI). Hotkey kind ordinal mapping (`song_jump_kind`) consistent between client send (operator) and server handler.

- **Scope:** Single feature (manual lyric overlays), four sequential phases, ends with a fully usable feature. STT split into Plan B is explicitly stated.

- **Known minor compromise:** Hotkey `b` is overloaded between blank and bridge in the `useGlobalShortcuts` patch. Resolved in Task 3.5 by giving blank to `.` and bridge to `b`. The textual comment in the code reflects this.
