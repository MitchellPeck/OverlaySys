# Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators can export shows, songs, and templates as single JSON files (per-row button on each list page) or as a multi-entity `.bundle.json` (central `/data` page with dependency resolution + import preview + per-conflict Replace/Skip).

**Architecture:** Pure-function bundle module in `packages/core` (Zod schema, dependency collector, format auto-detector). UI lives in operator app: per-row export buttons on the three list pages, a new `/data` page with two collapsible sections (Export bundle + Import). No server-side or WS-protocol changes — the existing `save_*`, `get_*`, `list_*` messages are sufficient. A small `showCache` is added to the operator store so per-row export of a show can read the full entity without server roundtrip when already cached.

**Tech Stack:** TypeScript, Vitest, Zod, React (Next.js operator app), Zustand store, existing WS protocol.

**Spec:** [`docs/superpowers/specs/2026-05-07-import-export-design.md`](../specs/2026-05-07-import-export-design.md)

---

## File Map

**Created:**
- `packages/core/src/bundle.ts` — `BundleSchema`, `collectDependencies`, `detectImport`. Pure functions.
- `packages/core/src/bundle.test.ts` — unit tests for the above.
- `apps/operator/src/lib/download.ts` — `downloadJson(filename, value)` helper.
- `apps/operator/src/app/data/page.tsx` — the `/data` page (composes ExportBundle + Import).
- `apps/operator/src/app/data/ExportBundle.tsx` — selection lists + warnings + download trigger.
- `apps/operator/src/app/data/ImportPreview.tsx` — preview + per-conflict Replace/Skip + save.

**Modified:**
- `packages/core/src/index.ts` — export the new `bundle` module.
- `apps/operator/src/lib/store.ts` — add `showCache: Record<string, Show>` + `setShowFull` action.
- `apps/operator/src/lib/useWs.ts` — populate `showCache` on `show` messages (in addition to existing `setShow` singleton).
- `apps/operator/src/app/components/AppHeader.tsx` — add `{ href: "/data", label: "Data" }` to `NAV_LINKS`.
- `apps/operator/src/app/songs/page.tsx` — per-row "Export" button.
- `apps/operator/src/app/shows/page.tsx` — per-row "Export" button.
- `apps/operator/src/app/design/page.tsx` — per-row "Export" button.

**Unchanged:**
- Server (`server/src/`) — no protocol or storage changes.
- WS protocol (`packages/ws-protocol/src/index.ts`) — no new messages.
- Renderer — no changes.

---

## Phase 1 — Core: bundle module

### Task 1: Bundle schema + skeleton

**Why:** Set up the public surface for the bundle module — types, Zod schema, function stubs — before any logic.

**Files:**
- Create: `packages/core/src/bundle.ts`
- Create: `packages/core/src/bundle.test.ts`

- [ ] **Step 1: Write failing tests for the public surface**

Create `packages/core/src/bundle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BundleSchema,
  collectDependencies,
  detectImport,
  type BundleSelection,
} from "./bundle";

describe("BundleSchema", () => {
  it("accepts a minimal valid bundle", () => {
    const ok = BundleSchema.safeParse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects a JSON missing the format discriminator", () => {
    const result = BundleSchema.safeParse({
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a wrong format string", () => {
    const result = BundleSchema.safeParse({
      format: "something-else",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    });
    expect(result.success).toBe(false);
  });

  it("treats songs/templates/shows arrays as defaulting to empty when omitted", () => {
    const ok = BundleSchema.parse({
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
    });
    expect(ok.songs).toEqual([]);
    expect(ok.templates).toEqual([]);
    expect(ok.shows).toEqual([]);
  });
});

describe("collectDependencies (skeleton)", () => {
  it("is a function that takes a selection and a store", () => {
    const empty: BundleSelection = { songIds: [], templateIds: [], showIds: [] };
    const out = collectDependencies(empty, {
      songs: new Map(),
      templates: new Map(),
      shows: new Map(),
    });
    expect(out.songs).toEqual([]);
    expect(out.templates).toEqual([]);
    expect(out.shows).toEqual([]);
    expect(out.missing).toEqual([]);
  });
});

describe("detectImport (skeleton)", () => {
  it("returns kind 'error' for non-recognized JSON", () => {
    expect(detectImport({ random: "junk" }).kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run and confirm fail (module not found)**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: FAIL — module './bundle' not found.

- [ ] **Step 3: Implement the skeleton**

Create `packages/core/src/bundle.ts`:

```ts
import { z } from "zod";
import { SongSchema, type Song } from "./song";
import { TemplateSchema, type Template } from "./template";
import { ShowSchema, type Show } from "./show";

export const BundleSchema = z.object({
  format: z.literal("overlaysys-bundle"),
  version: z.literal(1),
  exportedAt: z.string(),
  name: z.string().optional(),
  songs: z.array(SongSchema).default([]),
  templates: z.array(TemplateSchema).default([]),
  shows: z.array(ShowSchema).default([]),
});
export type Bundle = z.infer<typeof BundleSchema>;

export interface BundleSelection {
  songIds: string[];
  templateIds: string[];
  showIds: string[];
}

export interface MissingRef {
  kind: "song" | "template";
  id: string;
  referencedBy: string;
}

export interface BundlePayload {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  missing: MissingRef[];
}

export interface StoreSnapshot {
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  shows: Map<string, Show>;
}

export function collectDependencies(
  _selection: BundleSelection,
  _store: StoreSnapshot,
): BundlePayload {
  return { songs: [], templates: [], shows: [], missing: [] };
}

export type Detected =
  | { kind: "bundle"; bundle: Bundle }
  | { kind: "song"; song: Song }
  | { kind: "template"; template: Template }
  | { kind: "show"; show: Show }
  | { kind: "error"; message: string };

export function detectImport(_json: unknown): Detected {
  return { kind: "error", message: "not yet implemented" };
}
```

- [ ] **Step 4: Run tests to verify skeleton passes**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: all 6 skeleton tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bundle.ts packages/core/src/bundle.test.ts
git commit -m "feat(core): bundle module skeleton + BundleSchema"
```

---

### Task 2: `collectDependencies` — full implementation

**Why:** This is the core of dependency resolution. Tests pin down each branch of the algorithm.

**Files:**
- Modify: `packages/core/src/bundle.ts`
- Modify: `packages/core/src/bundle.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/src/bundle.test.ts`:

```ts
import { type Song, type Template, type Show } from "@overlaysys/core";

function makeSong(id: string, defaultLyricTemplateId?: string): Song {
  return {
    id,
    title: id,
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["x"] }] }],
    defaultArrangement: ["v1"],
    ...(defaultLyricTemplateId !== undefined ? { defaultLyricTemplateId } : {}),
  };
}

function makeTemplate(id: string): Template {
  return {
    id,
    name: id,
    canvas: { width: 1920, height: 1080, background: { kind: "solid", color: "#000" } },
    fields: [],
    layers: [],
  };
}

function makeShow(id: string, rows: Show["rows"]): Show {
  return { id, name: id, rows };
}

describe("collectDependencies", () => {
  it("pulls a show's referenced songs and templates", () => {
    const store: StoreSnapshot = {
      songs: new Map([["amazing-grace", makeSong("amazing-grace", "tpl-lyric")]]),
      templates: new Map([
        ["tpl-lyric", makeTemplate("tpl-lyric")],
        ["tpl-graphic", makeTemplate("tpl-graphic")],
        ["tpl-stinger", makeTemplate("tpl-stinger")],
      ]),
      shows: new Map([
        [
          "show1",
          makeShow("show1", [
            { kind: "graphic", id: "r1", templateId: "tpl-graphic", data: {} },
            {
              kind: "song",
              id: "r2",
              songId: "amazing-grace",
              lyricTemplateId: "tpl-lyric",
            },
          ]),
        ],
      ]),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["show1"] },
      store,
    );
    expect(out.shows.map((s) => s.id)).toEqual(["show1"]);
    expect(out.songs.map((s) => s.id)).toEqual(["amazing-grace"]);
    expect(out.templates.map((t) => t.id).sort()).toEqual([
      "tpl-graphic",
      "tpl-lyric",
    ]);
    expect(out.missing).toEqual([]);
  });

  it("pulls a song's defaultLyricTemplateId", () => {
    const store: StoreSnapshot = {
      songs: new Map([["s1", makeSong("s1", "tpl-default")]]),
      templates: new Map([["tpl-default", makeTemplate("tpl-default")]]),
      shows: new Map(),
    };
    const out = collectDependencies(
      { songIds: ["s1"], templateIds: [], showIds: [] },
      store,
    );
    expect(out.songs.map((s) => s.id)).toEqual(["s1"]);
    expect(out.templates.map((t) => t.id)).toEqual(["tpl-default"]);
  });

  it("does NOT pull anything for a standalone template", () => {
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["t1", makeTemplate("t1")]]),
      shows: new Map(),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: ["t1"], showIds: [] },
      store,
    );
    expect(out.templates.map((t) => t.id)).toEqual(["t1"]);
    expect(out.songs).toEqual([]);
    expect(out.shows).toEqual([]);
  });

  it("records a missing-ref when a referenced song is not in the store", () => {
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["tpl-lyric", makeTemplate("tpl-lyric")]]),
      shows: new Map([
        [
          "show-stale",
          makeShow("show-stale", [
            {
              kind: "song",
              id: "r1",
              songId: "ghost-song",
              lyricTemplateId: "tpl-lyric",
            },
          ]),
        ],
      ]),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["show-stale"] },
      store,
    );
    expect(out.shows.map((s) => s.id)).toEqual(["show-stale"]);
    expect(out.songs).toEqual([]);
    expect(out.missing).toEqual([
      { kind: "song", id: "ghost-song", referencedBy: "show-stale" },
    ]);
  });

  it("does not double-add when two shows reference the same template", () => {
    const tpl = makeTemplate("tpl-shared");
    const store: StoreSnapshot = {
      songs: new Map(),
      templates: new Map([["tpl-shared", tpl]]),
      shows: new Map([
        ["a", makeShow("a", [{ kind: "graphic", id: "r1", templateId: "tpl-shared", data: {} }])],
        ["b", makeShow("b", [{ kind: "graphic", id: "r1", templateId: "tpl-shared", data: {} }])],
      ]),
    };
    const out = collectDependencies(
      { songIds: [], templateIds: [], showIds: ["a", "b"] },
      store,
    );
    expect(out.templates.map((t) => t.id)).toEqual(["tpl-shared"]);
  });

  it("includes directly-selected entities even if they have no deps", () => {
    const store: StoreSnapshot = {
      songs: new Map([["s1", makeSong("s1")]]),
      templates: new Map([["t1", makeTemplate("t1")]]),
      shows: new Map(),
    };
    const out = collectDependencies(
      { songIds: ["s1"], templateIds: ["t1"], showIds: [] },
      store,
    );
    expect(out.songs.map((s) => s.id)).toEqual(["s1"]);
    expect(out.templates.map((t) => t.id)).toEqual(["t1"]);
  });

  it("records missing-ref for a directly-selected id that doesn't exist in the store", () => {
    const out = collectDependencies(
      { songIds: ["ghost"], templateIds: [], showIds: [] },
      { songs: new Map(), templates: new Map(), shows: new Map() },
    );
    expect(out.songs).toEqual([]);
    expect(out.missing).toEqual([
      { kind: "song", id: "ghost", referencedBy: "(direct selection)" },
    ]);
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: FAIL — current stub returns empty result, doesn't match expectations.

- [ ] **Step 3: Implement `collectDependencies`**

Replace the body of `collectDependencies` in `packages/core/src/bundle.ts`:

```ts
export function collectDependencies(
  selection: BundleSelection,
  store: StoreSnapshot,
): BundlePayload {
  const songIds = new Set<string>(selection.songIds);
  const templateIds = new Set<string>(selection.templateIds);
  const showIds = new Set<string>(selection.showIds);
  const missing: MissingRef[] = [];

  // Walk each selected show, expanding songs + templates.
  for (const showId of showIds) {
    const show = store.shows.get(showId);
    if (!show) continue;
    for (const row of show.rows) {
      if (row.kind === "graphic") {
        templateIds.add(row.templateId);
      } else {
        songIds.add(row.songId);
        templateIds.add(row.lyricTemplateId);
      }
    }
  }

  // Walk each (now-expanded) song, pulling defaultLyricTemplateId.
  for (const songId of songIds) {
    const song = store.songs.get(songId);
    if (!song) continue;
    if (song.defaultLyricTemplateId) {
      templateIds.add(song.defaultLyricTemplateId);
    }
  }

  // Resolve.
  const songs: Song[] = [];
  const templates: Template[] = [];
  const shows: Show[] = [];

  for (const id of songIds) {
    const song = store.songs.get(id);
    if (song) {
      songs.push(song);
    } else {
      // Find what referenced it for the missing record.
      const referencedBy = findReferrer("song", id, store, selection);
      missing.push({ kind: "song", id, referencedBy });
    }
  }
  for (const id of templateIds) {
    const tpl = store.templates.get(id);
    if (tpl) {
      templates.push(tpl);
    } else {
      const referencedBy = findReferrer("template", id, store, selection);
      missing.push({ kind: "template", id, referencedBy });
    }
  }
  for (const id of showIds) {
    const show = store.shows.get(id);
    if (show) shows.push(show);
    // Shows are never referenced by other entities; missing show in selection
    // means the operator selected something that vanished from the store —
    // treat as silent.
  }

  return { songs, templates, shows, missing };
}

function findReferrer(
  kind: "song" | "template",
  id: string,
  store: StoreSnapshot,
  selection: BundleSelection,
): string {
  // Direct selection wins — operator asked for this id by name.
  if (kind === "song" && selection.songIds.includes(id)) return "(direct selection)";
  if (kind === "template" && selection.templateIds.includes(id)) return "(direct selection)";
  // Otherwise find a show or song that references it.
  for (const showId of selection.showIds) {
    const show = store.shows.get(showId);
    if (!show) continue;
    for (const row of show.rows) {
      if (kind === "template") {
        if (row.kind === "graphic" && row.templateId === id) return showId;
        if (row.kind === "song" && row.lyricTemplateId === id) return showId;
      } else {
        if (row.kind === "song" && row.songId === id) return showId;
      }
    }
  }
  if (kind === "template") {
    for (const songId of selection.songIds) {
      const song = store.songs.get(songId);
      if (song?.defaultLyricTemplateId === id) return songId;
    }
  }
  return "(unknown)";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: all `collectDependencies` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/bundle.ts packages/core/src/bundle.test.ts
git commit -m "feat(core): bundle collectDependencies (resolves song/template/show refs)"
```

---

### Task 3: `detectImport` — format auto-detection

**Why:** The import flow needs to distinguish bundles from single-entity JSON files reliably.

**Files:**
- Modify: `packages/core/src/bundle.ts`
- Modify: `packages/core/src/bundle.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `packages/core/src/bundle.test.ts`:

```ts
describe("detectImport", () => {
  it("recognizes a bundle by the format discriminator", () => {
    const bundle = {
      format: "overlaysys-bundle",
      version: 1,
      exportedAt: "2026-05-08T00:00:00Z",
      songs: [],
      templates: [],
      shows: [],
    };
    const result = detectImport(bundle);
    expect(result.kind).toBe("bundle");
  });

  it("recognizes a single Song", () => {
    const result = detectImport(makeSong("amazing-grace"));
    expect(result.kind).toBe("song");
    if (result.kind === "song") {
      expect(result.song.id).toBe("amazing-grace");
    }
  });

  it("recognizes a single Template", () => {
    const result = detectImport(makeTemplate("tpl-1"));
    expect(result.kind).toBe("template");
  });

  it("recognizes a single Show", () => {
    const result = detectImport(makeShow("show-1", []));
    expect(result.kind).toBe("show");
  });

  it("returns 'error' for arbitrary JSON", () => {
    const result = detectImport({ foo: "bar" });
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for a string", () => {
    const result = detectImport("not an object");
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for null", () => {
    const result = detectImport(null);
    expect(result.kind).toBe("error");
  });

  it("returns 'error' for a malformed bundle (rejects with bundle's error message)", () => {
    const result = detectImport({
      format: "overlaysys-bundle",
      version: 1,
      // missing exportedAt
    });
    expect(result.kind).toBe("error");
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: FAIL — current stub always returns `{ kind: "error", message: "not yet implemented" }`.

- [ ] **Step 3: Implement `detectImport`**

Replace the body of `detectImport` in `packages/core/src/bundle.ts`:

```ts
export function detectImport(json: unknown): Detected {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { kind: "error", message: "expected a JSON object" };
  }
  const obj = json as Record<string, unknown>;

  if (obj.format === "overlaysys-bundle") {
    const result = BundleSchema.safeParse(obj);
    if (result.success) return { kind: "bundle", bundle: result.data };
    return { kind: "error", message: `invalid bundle: ${result.error.message}` };
  }

  // Try entity schemas in order of specificity.
  const songR = SongSchema.safeParse(obj);
  if (songR.success) return { kind: "song", song: songR.data };
  const templateR = TemplateSchema.safeParse(obj);
  if (templateR.success) return { kind: "template", template: templateR.data };
  const showR = ShowSchema.safeParse(obj);
  if (showR.success) return { kind: "show", show: showR.data };

  return {
    kind: "error",
    message: "not a bundle, song, template, or show",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/bundle.test.ts`
Expected: all `detectImport` tests pass.

- [ ] **Step 5: Run full core suite to confirm no regressions**

Run: `pnpm vitest run packages/core/src/`
Expected: all tests pass (existing + new bundle tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bundle.ts packages/core/src/bundle.test.ts
git commit -m "feat(core): bundle detectImport (auto-detects bundle vs single entity)"
```

---

### Task 4: Wire core public exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add export line**

Edit `packages/core/src/index.ts`. Add:

```ts
export * from "./bundle";
```

Place near the other module re-exports.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit -p packages/core/tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export bundle module"
```

---

## Phase 2 — Operator UI primitives

### Task 5: Add `showCache` to operator store

**Why:** Per-row export of a show needs the FULL `Show` object. The store currently keeps `showMetas` (lightweight) and a singleton `show: Show | null` (only the currently-edited show). We need a per-id cache parallel to `songCache` / `templateCache`.

**Files:**
- Modify: `apps/operator/src/lib/store.ts`
- Modify: `apps/operator/src/lib/useWs.ts`

- [ ] **Step 1: Inspect the existing store**

Open `apps/operator/src/lib/store.ts`. Find:
- `templateCache: Record<string, Template>` and `setTemplate(t: Template)` setter (which puts `t` into `templateCache`).
- `songCache: Record<string, Song>` and `setSong(song: Song)` setter.
- The singleton `show: Show | null` and `setShow(s)` setter — leave these alone.

- [ ] **Step 2: Add `showCache` field + setter to the store**

In `apps/operator/src/lib/store.ts`:

1. Add to the type definition (`StoreState`), near the existing `songCache` line:

```ts
showCache: Record<string, Show>;
```

2. Add the setter type (near `setSong`):

```ts
setShowFull: (show: Show) => void;
```

3. In the `create<StoreState>((set) => ({ ... }))` object, add:

```ts
showCache: {},
```

(near the existing `songCache: {}`)

4. And the setter implementation, near `setSong`:

```ts
setShowFull: (show) =>
  set((s) => ({ showCache: { ...s.showCache, [show.id]: show } })),
```

- [ ] **Step 3: Update WS handler to populate the cache**

In `apps/operator/src/lib/useWs.ts`, find the `case "show":` (or wherever `msg.show` is handled — look for `store.setShow(msg.show)`). Add a SECOND call alongside it:

```ts
store.setShow(msg.show);
store.setShowFull(msg.show);
```

(Adding to the cache does not interfere with the singleton — both update.)

- [ ] **Step 4: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/store.ts apps/operator/src/lib/useWs.ts
git commit -m "feat(operator): showCache for full Show objects keyed by id"
```

---

### Task 6: `download.ts` helper

**Files:**
- Create: `apps/operator/src/lib/download.ts`

- [ ] **Step 1: Write the helper**

Create `apps/operator/src/lib/download.ts`:

```ts
"use client";

/**
 * Trigger a browser download of a JSON-serializable value as a file.
 *
 * Pure client-side — uses Blob + a transient anchor element + revokeObjectURL
 * to release the URL after the click is dispatched.
 */
export function downloadJson(filename: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the download has time to start in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 2: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors. (The new file is not yet referenced.)

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/lib/download.ts
git commit -m "feat(operator): downloadJson helper"
```

---

### Task 7: Per-row Export button on `/songs`

**Files:**
- Modify: `apps/operator/src/app/songs/page.tsx`

- [ ] **Step 1: Add imports + helper**

In `apps/operator/src/app/songs/page.tsx`, add at the top alongside the existing imports:

```ts
import { downloadJson } from "@/lib/download";
```

- [ ] **Step 2: Add an `exportSong(id)` handler**

Inside the `SongsPage` component, after the existing `removeSong`/`handleImportSubmit` definitions, add:

```ts
function exportSong(id: string) {
  const cached = useStore.getState().songCache[id];
  if (cached) {
    downloadJson(`${id}.json`, cached);
    return;
  }
  if (conn !== "open") return;
  send({ type: "get_song", songId: id });
  const start = Date.now();
  const tick = () => {
    const c = useStore.getState().songCache[id];
    if (c) { downloadJson(`${id}.json`, c); return; }
    if (Date.now() - start > 2000) return;
    setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
}
```

(Same polling approach used by exportShow/exportTemplate in subsequent tasks — keeps the three handlers consistent.)

- [ ] **Step 3: Add the Export button to the table row**

Find the existing `<button onClick={() => removeSong(s.id, s.title)}>...</button>` Delete button. Just before it, add an Export button:

```tsx
<button onClick={() => exportSong(s.id)} style={btn()}>Export</button>
```

So the actions cell becomes:

```tsx
<td style={td()}>
  <button onClick={() => exportSong(s.id)} style={btn()}>Export</button>
  {" "}
  <button onClick={() => removeSong(s.id, s.title)} style={btn()}>
    Delete
  </button>
</td>
```

- [ ] **Step 4: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

Open the operator app (`pnpm dev` from repo root). Navigate to `/songs`. Click `Export` next to "Amazing Grace". The browser should download `amazing-grace.json`. Open the file and confirm it matches `data/songs/amazing-grace.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/songs/page.tsx
git commit -m "feat(operator): per-row Export on /songs"
```

---

### Task 8: Per-row Export button on `/shows`

**Files:**
- Modify: `apps/operator/src/app/shows/page.tsx`

- [ ] **Step 1: Add imports**

In `apps/operator/src/app/shows/page.tsx`, add at the top:

```ts
import { downloadJson } from "@/lib/download";
```

- [ ] **Step 2: Add the `exportShow(id)` handler**

Inside the `ShowsIndexPage` component, after `remove`:

```ts
function exportShow(id: string) {
  const cached = useStore.getState().showCache[id];
  if (cached) {
    downloadJson(`${id}.json`, cached);
    return;
  }
  if (conn !== "open") return;
  send({ type: "get_show", showId: id });
  const start = Date.now();
  const tick = () => {
    const c = useStore.getState().showCache[id];
    if (c) { downloadJson(`${id}.json`, c); return; }
    if (Date.now() - start > 2000) return;
    setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
}
```

- [ ] **Step 3: Add the Export button to each show row**

Find the show list rendering (look for `showMetas.map(...)` or the rendering of each show row's actions). Add an Export button before the existing Delete button.

Specifically, look for the existing button that calls `remove(...)`. Just before it, add:

```tsx
<button onClick={() => exportShow(s.id)} style={btn()}>Export</button>
{" "}
```

(If the file uses inline-styled buttons via a local `btn()` helper, reuse it. If it uses different styling, follow the pattern of the existing Delete button.)

- [ ] **Step 4: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

`pnpm dev`. Navigate to `/shows`. Click `Export` next to a show. The browser downloads `<show-id>.json`. Open and verify it matches `data/shows/<show-id>.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/shows/page.tsx
git commit -m "feat(operator): per-row Export on /shows"
```

---

### Task 9: Per-row Export button on `/design` (templates)

**Files:**
- Modify: `apps/operator/src/app/design/page.tsx`

- [ ] **Step 1: Add imports**

In `apps/operator/src/app/design/page.tsx`, add at the top:

```ts
import { downloadJson } from "@/lib/download";
```

- [ ] **Step 2: Add the `exportTemplate(id)` handler**

Inside the `DesignIndexPage` component, after `remove`:

```ts
function exportTemplate(id: string) {
  const cached = useStore.getState().templateCache[id];
  if (cached) {
    downloadJson(`${id}.json`, cached);
    return;
  }
  if (conn !== "open") return;
  send({ type: "get_template", templateId: id });
  const start = Date.now();
  const tick = () => {
    const c = useStore.getState().templateCache[id];
    if (c) { downloadJson(`${id}.json`, c); return; }
    if (Date.now() - start > 2000) return;
    setTimeout(tick, 50);
  };
  setTimeout(tick, 50);
}
```

- [ ] **Step 3: Add the Export button to each template row**

Find where each template renders its actions (look for `templates.map(...)` or the row rendering). Add an Export button before the existing Delete button:

```tsx
<button onClick={() => exportTemplate(t.id)} style={btn()}>Export</button>
{" "}
```

(Match the existing local `btn()` helper or styling.)

- [ ] **Step 4: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Manual smoke**

`pnpm dev`. Navigate to `/design`. Click `Export` next to a template. The browser downloads `<template-id>.json`. Open and verify it matches `data/templates/<template-id>.json`.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/design/page.tsx
git commit -m "feat(operator): per-row Export on /design (templates)"
```

---

## Phase 3 — `/data` page

### Task 10: `/data` route skeleton + nav link

**Files:**
- Create: `apps/operator/src/app/data/page.tsx`
- Modify: `apps/operator/src/app/components/AppHeader.tsx`

- [ ] **Step 1: Add nav link**

Edit `apps/operator/src/app/components/AppHeader.tsx`. Find the `NAV_LINKS` array and add an entry:

```ts
const NAV_LINKS = [
  { href: "/", label: "Show" },
  { href: "/shows", label: "Shows" },
  { href: "/songs", label: "Songs" },
  { href: "/stt", label: "STT" },
  { href: "/design", label: "Design" },
  { href: "/channels", label: "Channels" },
  { href: "/data", label: "Data" },
];
```

- [ ] **Step 2: Create the placeholder page**

Create `apps/operator/src/app/data/page.tsx`:

```tsx
"use client";

import { AppHeader } from "@/app/components/AppHeader";

export default function DataPage() {
  return (
    <>
      <AppHeader context={<h1 style={{ margin: 0, fontSize: 16 }}>Data</h1>} />
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <p style={{ color: "var(--text-dim)" }}>
          Import and export shows, songs, and templates.
        </p>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual smoke**

`pnpm dev`. Click the new "Data" link in the nav. The /data page should load with the placeholder text.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/components/AppHeader.tsx apps/operator/src/app/data/page.tsx
git commit -m "feat(operator): /data page skeleton + nav link"
```

---

### Task 11: Export bundle UI on `/data`

**Files:**
- Create: `apps/operator/src/app/data/ExportBundle.tsx`
- Modify: `apps/operator/src/app/data/page.tsx`

- [ ] **Step 1: Create the ExportBundle component**

Create `apps/operator/src/app/data/ExportBundle.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collectDependencies,
  type BundleSelection,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { downloadJson } from "@/lib/download";

type Tab = "songs" | "shows" | "templates";

export function ExportBundle() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const songsList = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);
  const songCache = useStore((s) => s.songCache);
  const showCache = useStore((s) => s.showCache);
  const templateCache = useStore((s) => s.templateCache);
  const setSong = useStore((s) => s.setSong);

  const [tab, setTab] = useState<Tab>("songs");
  const [includeDeps, setIncludeDeps] = useState(true);
  const [bundleName, setBundleName] = useState("");
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [selectedShows, setSelectedShows] = useState<Set<string>>(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());

  // Hydrate the lists once when the page opens.
  useEffect(() => {
    if (conn !== "open") return;
    send({ type: "list_songs" });
    send({ type: "list_shows" });
    send({ type: "list_templates" });
  }, [conn, send]);

  // Build a store snapshot for collectDependencies. This works only with what's
  // currently in the caches; entities not yet cached are fetched on demand
  // when the operator clicks Download.
  const storeSnapshot = useMemo(
    () => ({
      songs: new Map<string, Song>(Object.entries(songCache)),
      templates: new Map<string, Template>(Object.entries(templateCache)),
      shows: new Map<string, Show>(Object.entries(showCache)),
    }),
    [songCache, templateCache, showCache],
  );

  const selection: BundleSelection = useMemo(
    () => ({
      songIds: Array.from(selectedSongs),
      showIds: Array.from(selectedShows),
      templateIds: Array.from(selectedTemplates),
    }),
    [selectedSongs, selectedShows, selectedTemplates],
  );

  const hasSelection =
    selectedSongs.size > 0 || selectedShows.size > 0 || selectedTemplates.size > 0;

  // Resolve the bundle preview (including missing-ref warnings) reactively.
  const preview = useMemo(() => {
    if (!hasSelection) return null;
    if (!includeDeps) {
      return {
        songs: Array.from(selectedSongs)
          .map((id) => songCache[id])
          .filter(Boolean) as Song[],
        templates: Array.from(selectedTemplates)
          .map((id) => templateCache[id])
          .filter(Boolean) as Template[],
        shows: Array.from(selectedShows)
          .map((id) => showCache[id])
          .filter(Boolean) as Show[],
        missing: [],
      };
    }
    return collectDependencies(selection, storeSnapshot);
  }, [
    hasSelection, includeDeps, selection, storeSnapshot, selectedSongs,
    selectedShows, selectedTemplates, songCache, templateCache, showCache,
  ]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  // Prefetch any selected song/show/template that isn't cached yet, so
  // collectDependencies has the full data to walk references.
  useEffect(() => {
    if (conn !== "open") return;
    for (const id of selectedSongs) if (!songCache[id]) send({ type: "get_song", songId: id });
    for (const id of selectedShows) if (!showCache[id]) send({ type: "get_show", showId: id });
    for (const id of selectedTemplates) if (!templateCache[id]) send({ type: "get_template", templateId: id });
  }, [conn, send, selectedSongs, selectedShows, selectedTemplates, songCache, showCache, templateCache, setSong]);

  function downloadBundle() {
    if (!preview) return;
    const filename = `${slugify(bundleName) || "overlaysys"}.bundle.json`;
    const bundle = {
      format: "overlaysys-bundle" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      ...(bundleName.trim() ? { name: bundleName.trim() } : {}),
      songs: preview.songs,
      templates: preview.templates,
      shows: preview.shows,
    };
    downloadJson(filename, bundle);
  }

  return (
    <section style={{ marginBottom: 24, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
      <h2 style={{ marginTop: 0, fontSize: 14 }}>Export bundle</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ width: 120, fontSize: 12, color: "var(--text-dim)" }}>Bundle name</label>
        <input
          value={bundleName}
          onChange={(e) => setBundleName(e.target.value)}
          placeholder="(optional)"
          style={{ flex: 1, maxWidth: 320 }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={includeDeps}
          onChange={(e) => setIncludeDeps(e.target.checked)}
        />
        Include referenced dependencies
      </label>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {(["songs", "shows", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn(),
              ...(tab === t ? { background: "var(--accent)", color: "#fff" } : {}),
            }}
          >
            {t} ({t === "songs" ? songsList.length : t === "shows" ? showMetas.length : templates.length})
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginBottom: 8 }}>
        {tab === "songs" && songsList.map((s) => (
          <CheckRow
            key={s.id}
            id={s.id}
            label={s.title || s.id}
            checked={selectedSongs.has(s.id)}
            onToggle={() => setSelectedSongs((cur) => toggle(cur, s.id))}
          />
        ))}
        {tab === "shows" && showMetas.map((s) => (
          <CheckRow
            key={s.id}
            id={s.id}
            label={s.name || s.id}
            checked={selectedShows.has(s.id)}
            onToggle={() => setSelectedShows((cur) => toggle(cur, s.id))}
          />
        ))}
        {tab === "templates" && templates.map((t) => (
          <CheckRow
            key={t.id}
            id={t.id}
            label={t.name || t.id}
            checked={selectedTemplates.has(t.id)}
            onToggle={() => setSelectedTemplates((cur) => toggle(cur, t.id))}
          />
        ))}
      </div>

      {preview && (preview.missing.length > 0) && (
        <div style={{ padding: 8, background: "rgba(245, 158, 11, 0.1)", border: "1px solid #f59e0b", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>
          <strong>⚠ {preview.missing.length} reference(s) not found locally</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            {preview.missing.map((m, i) => (
              <li key={i}>
                <code>{m.kind}:{m.id}</code> referenced by <code>{m.referencedBy}</code> — will be omitted
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Will export: <strong>{preview.songs.length}</strong> song(s),{" "}
          <strong>{preview.templates.length}</strong> template(s),{" "}
          <strong>{preview.shows.length}</strong> show(s).
        </p>
      )}

      <button onClick={downloadBundle} disabled={!hasSelection} style={btn("primary")}>
        Download bundle
      </button>
    </section>
  );
}

function CheckRow({
  id, label, checked, onToggle,
}: {
  id: string; label: string; checked: boolean; onToggle: () => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 13, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <code style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)" }}>{id}</code>
    </label>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

- [ ] **Step 2: Wire it into `/data` page**

Edit `apps/operator/src/app/data/page.tsx`:

```tsx
"use client";

import { AppHeader } from "@/app/components/AppHeader";
import { ExportBundle } from "./ExportBundle";

export default function DataPage() {
  return (
    <>
      <AppHeader context={<h1 style={{ margin: 0, fontSize: 16 }}>Data</h1>} />
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <ExportBundle />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual smoke**

`pnpm dev`. Navigate to `/data`. The Export bundle section should render. Click the "shows" tab and tick a show. The "Will export" line should show 1 show + however many songs/templates that show references. Click "Download bundle". Open the downloaded `.bundle.json` and confirm:
- `format: "overlaysys-bundle"`, `version: 1`, `exportedAt` is a valid ISO timestamp.
- `shows` contains the selected show.
- `songs` and `templates` contain the dep-resolved entities.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/data/ExportBundle.tsx apps/operator/src/app/data/page.tsx
git commit -m "feat(operator): /data ExportBundle (selection + deps + download)"
```

---

### Task 12: Import preview + apply on `/data`

**Files:**
- Create: `apps/operator/src/app/data/ImportPreview.tsx`
- Modify: `apps/operator/src/app/data/page.tsx`

- [ ] **Step 1: Create the ImportPreview component**

Create `apps/operator/src/app/data/ImportPreview.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  detectImport,
  type Bundle,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

type Decision = "save" | "skip";

interface ItemRow {
  kind: "song" | "template" | "show";
  id: string;
  label: string;
  conflict: boolean; // true if id exists locally
  decision: Decision;
}

interface PreviewState {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  rows: ItemRow[];
}

export function ImportPreview() {
  const { send } = useWs();
  const songMetas = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);

  const [parseError, setParseError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  function existingIds() {
    return {
      songs: new Set(songMetas.map((s) => s.id)),
      templates: new Set(templates.map((t) => t.id)),
      shows: new Set(showMetas.map((s) => s.id)),
    };
  }

  function buildPreview(songs: Song[], templates: Template[], shows: Show[]): PreviewState {
    const ex = existingIds();
    const rows: ItemRow[] = [
      ...songs.map<ItemRow>((s) => ({
        kind: "song",
        id: s.id,
        label: s.title || s.id,
        conflict: ex.songs.has(s.id),
        decision: ex.songs.has(s.id) ? "skip" : "save",
      })),
      ...templates.map<ItemRow>((t) => ({
        kind: "template",
        id: t.id,
        label: t.name || t.id,
        conflict: ex.templates.has(t.id),
        decision: ex.templates.has(t.id) ? "skip" : "save",
      })),
      ...shows.map<ItemRow>((sh) => ({
        kind: "show",
        id: sh.id,
        label: sh.name || sh.id,
        conflict: ex.shows.has(sh.id),
        decision: ex.shows.has(sh.id) ? "skip" : "save",
      })),
    ];
    return { songs, templates, shows, rows };
  }

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    setPreview(null);
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setParseError(`could not read file: ${String(err)}`);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      setParseError(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const detected = detectImport(json);
    if (detected.kind === "error") {
      setParseError(detected.message);
      return;
    }
    if (detected.kind === "bundle") {
      const b: Bundle = detected.bundle;
      setPreview(buildPreview(b.songs, b.templates, b.shows));
    } else if (detected.kind === "song") {
      setPreview(buildPreview([detected.song], [], []));
    } else if (detected.kind === "template") {
      setPreview(buildPreview([], [detected.template], []));
    } else if (detected.kind === "show") {
      setPreview(buildPreview([], [], [detected.show]));
    }
  }

  function setDecision(idx: number, decision: Decision) {
    setPreview((p) => {
      if (!p) return p;
      const rows = p.rows.slice();
      const row = rows[idx];
      if (!row) return p;
      rows[idx] = { ...row, decision };
      return { ...p, rows };
    });
  }

  function applyImport() {
    if (!preview) return;
    // Save in order: templates first, songs second, shows last.
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "template") {
        const t = preview.templates.find((x) => x.id === row.id);
        if (t) send({ type: "save_template", template: t });
      }
    }
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "song") {
        const s = preview.songs.find((x) => x.id === row.id);
        if (s) send({ type: "save_song", song: s });
      }
    }
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "show") {
        const sh = preview.shows.find((x) => x.id === row.id);
        if (sh) send({ type: "save_show", show: sh });
      }
    }
    setPreview(null);
    setFilename(null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const saveCount = preview?.rows.filter((r) => r.decision === "save").length ?? 0;
  const skipCount = preview?.rows.filter((r) => r.decision === "skip").length ?? 0;

  return (
    <section style={{ marginBottom: 24, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
      <h2 style={{ marginTop: 0, fontSize: 14 }}>Import</h2>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 4, marginBottom: 8 }}
      >
        <input
          type="file"
          accept=".json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
          }}
          style={{ marginRight: 8 }}
        />
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          or drop a <code>.json</code> / <code>.bundle.json</code> file here
        </span>
        {filename && (
          <span style={{ marginLeft: 8, fontSize: 12 }}>
            Loaded: <code>{filename}</code>
          </span>
        )}
      </div>

      {parseError && (
        <p style={{ color: "#ef4444", fontSize: 12 }}>Parse failed: {parseError}</p>
      )}

      {preview && (
        <>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginBottom: 8 }}>
            {preview.rows.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
                The file contained no entities.
              </p>
            ) : (
              preview.rows.map((row, idx) => (
                <div
                  key={`${row.kind}:${row.id}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 6px", fontSize: 13,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ minWidth: 80, fontSize: 11, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {row.kind}
                  </span>
                  <span style={{ fontWeight: 600 }}>{row.label}</span>
                  <code style={{ fontSize: 10, color: "var(--text-dim)" }}>{row.id}</code>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {row.conflict ? (
                      <>
                        <span style={{ color: "#f59e0b", fontSize: 11 }}>⚠ exists</span>
                        <label style={{ fontSize: 11 }}>
                          <input
                            type="radio"
                            name={`decision-${idx}`}
                            checked={row.decision === "save"}
                            onChange={() => setDecision(idx, "save")}
                          />{" "}
                          Replace
                        </label>
                        <label style={{ fontSize: 11 }}>
                          <input
                            type="radio"
                            name={`decision-${idx}`}
                            checked={row.decision === "skip"}
                            onChange={() => setDecision(idx, "skip")}
                          />{" "}
                          Skip
                        </label>
                      </>
                    ) : (
                      <span style={{ color: "#10b981", fontSize: 11 }}>new</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          <button
            onClick={applyImport}
            disabled={saveCount === 0}
            style={{
              padding: "6px 10px",
              background: "var(--accent)",
              color: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Save {saveCount} item(s){skipCount > 0 ? `, skip ${skipCount}` : ""}
          </button>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `/data`**

Edit `apps/operator/src/app/data/page.tsx`:

```tsx
"use client";

import { AppHeader } from "@/app/components/AppHeader";
import { ExportBundle } from "./ExportBundle";
import { ImportPreview } from "./ImportPreview";

export default function DataPage() {
  return (
    <>
      <AppHeader context={<h1 style={{ margin: 0, fontSize: 16 }}>Data</h1>} />
      <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <ExportBundle />
        <ImportPreview />
      </div>
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run from repo root: `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Manual smoke — full round trip**

`pnpm dev`. On `/data`:

1. Export: tick a show, click Download bundle. Save the file.
2. Import: click Choose file, pick the file you just exported. Confirm the preview shows every entity with "⚠ exists" markers (since they're already in your local data) and "Skip" pre-selected.
3. Toggle one entity's radio to "Replace". Click "Save 1 item, skip N". Confirm:
   - The save count matches what you toggled.
   - The corresponding `data/<entity>/<id>.json` file is updated on disk (touch a field in your selection before exporting if you want a visible diff).

- [ ] **Step 5: Manual smoke — single entity import**

Drop a single `<id>.json` (e.g. one exported from the per-row Export buttons) onto the import zone. Confirm the preview shows just that one entity with the appropriate conflict marker.

- [ ] **Step 6: Manual smoke — error path**

Drop a non-JSON file (or paste broken JSON via the file picker). Confirm an inline error appears and no preview renders.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/app/data/ImportPreview.tsx apps/operator/src/app/data/page.tsx
git commit -m "feat(operator): /data ImportPreview (auto-detect + per-conflict Replace/Skip)"
```

---

## Phase 4 — Final

### Task 13: Cross-package check

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass — existing tests + new bundle tests.

- [ ] **Step 3: Lint (if configured)**

Run: `pnpm lint`. If lint fails on PRE-EXISTING infrastructure issues (e.g. missing ESLint config), report and skip. Only fix lint errors introduced by THIS branch.

- [ ] **Step 4: End-to-end UI smoke**

`pnpm dev`. Walk through every flow once more:

- Per-row Export on `/songs` → downloads correct JSON.
- Per-row Export on `/shows` → downloads correct JSON.
- Per-row Export on `/design` → downloads correct JSON.
- `/data` Export bundle → tick a show, deps on, download → file is valid bundle.
- `/data` Import bundle → drop the same file, see preview → no rows are saved (all skip default).
- `/data` Import single → drop a single-entity file, see preview, save once.

- [ ] **Step 5: No commit unless step 3 introduced lint fixes**

If everything is green and clean, no commit needed.

---

## Done criteria

- `pnpm test` passes (existing + new bundle tests).
- `pnpm typecheck` passes.
- An operator can: (a) export single JSON for any song/show/template from its list page; (b) export a bundle of selected entities (with deps) from `/data`; (c) import a bundle or single JSON via `/data` with a per-conflict Replace/Skip preview.
- Bundle format `{ format: "overlaysys-bundle", version: 1, exportedAt, songs, templates, shows }` is the canonical output.
- No new WS messages; no server changes; no schema changes.
