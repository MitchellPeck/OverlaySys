# Channel Auto-Open + Display Assignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator pin each channel renderer window to a specific display and have it auto-open fullscreen at app launch, with a manual "reopen" path for after closes / hot-plug.

**Architecture:** Per-machine prefs persisted in `userData/data/channel-window-prefs.json` (separate from the syncable `data/channels/*.json`). A pure `windowPrefs.ts` module in the desktop app handles load/save/match-display logic and is unit-tested with hand-rolled `Display` fixtures (no Electron import). The Electron main process consumes it from `boot()` and from new IPC handlers; the operator gets a ⚙ popover on each channel card to edit prefs and a "Reopen on configured display" action.

**Tech Stack:** TypeScript, Electron (`screen`, `BrowserWindow`), Zod (already used in `@overlaysys/core`), Vitest, React (operator).

---

## File structure

**Create:**
- `packages/core/src/channelWindowPrefs.ts` — Zod schemas + TS types for `ChannelWindowPrefs`, `CachedDisplay`, `WindowPrefsFile`. Shared so the operator can type IPC payloads without re-declaring shapes.
- `packages/core/src/channelWindowPrefs.test.ts` — schema parse/reject tests.
- `apps/desktop/src/windowPrefs.ts` — pure file I/O + matching algorithm. Receives `Display[]` from caller — does **not** import `electron`.
- `apps/desktop/src/windowPrefs.test.ts` — load/save round-trip + `resolveDisplay` cases + cache cap.
- `apps/desktop/src/identifyDisplays.ts` — short-lived overlay `BrowserWindow` per display showing a large number.
- `apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx` — ⚙ popover UI.

**Modify:**
- `packages/core/src/index.ts` — re-export new schemas/types.
- `vitest.config.ts` — include `apps/desktop/src/**/*.test.ts`.
- `apps/desktop/src/main.ts` — `displayId` in `ChannelWindowOptions`, position-before-fullscreen, auto-open at boot, four new IPC handlers, in-memory resolution map.
- `apps/desktop/src/preload.ts` — expose new IPC methods on `window.overlaysys`.
- `apps/operator/src/lib/desktop.ts` — mirror the new API surface.
- `apps/operator/src/app/components/ChannelStatus.tsx` — ⚙ button, popover wiring, ↗ dropdown with "Reopen on configured display", fallback ⚠ indicator.

---

## Task 1: Shared schema in `@overlaysys/core`

**Files:**
- Create: `packages/core/src/channelWindowPrefs.ts`
- Create: `packages/core/src/channelWindowPrefs.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/channelWindowPrefs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WindowPrefsFileSchema,
  type WindowPrefsFile,
} from "./channelWindowPrefs";

describe("WindowPrefsFileSchema", () => {
  it("parses a fully populated file", () => {
    const input: WindowPrefsFile = {
      version: 1,
      displays: [
        {
          id: 69733632,
          label: "DELL U2718Q",
          bounds: { x: 0, y: 0, width: 3840, height: 2160 },
          internal: false,
        },
      ],
      channels: {
        program: {
          autoOpen: true,
          displayId: 69733632,
          fullscreen: true,
          frameless: false,
          alwaysOnTop: false,
          transparent: false,
        },
      },
    };
    expect(WindowPrefsFileSchema.parse(input)).toEqual(input);
  });

  it("applies defaults for an empty file", () => {
    const parsed = WindowPrefsFileSchema.parse({});
    expect(parsed).toEqual({ version: 1, displays: [], channels: {} });
  });

  it("applies per-channel boolean defaults", () => {
    const parsed = WindowPrefsFileSchema.parse({
      channels: { program: { displayId: 1 } },
    });
    expect(parsed.channels.program).toEqual({
      autoOpen: false,
      displayId: 1,
      fullscreen: false,
      frameless: false,
      alwaysOnTop: false,
      transparent: false,
    });
  });

  it("rejects wrong-typed bounds", () => {
    expect(() =>
      WindowPrefsFileSchema.parse({
        displays: [
          { id: 1, label: "x", bounds: { x: "0", y: 0, width: 1, height: 1 }, internal: false },
        ],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm test -- packages/core/src/channelWindowPrefs.test.ts
```

Expected: module-not-found error for `./channelWindowPrefs`.

- [ ] **Step 3: Create the schema module**

Create `packages/core/src/channelWindowPrefs.ts`:

```ts
import { z } from "zod";

/**
 * Per-machine channel window preferences. Lives in
 * `userData/data/channel-window-prefs.json`; intentionally separate
 * from the shared `data/channels/<id>.json` so display assignments
 * do not leak across rigs when projects are synced.
 */

export const CachedDisplaySchema = z.object({
  id: z.number(),
  label: z.string(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  internal: z.boolean(),
});
export type CachedDisplay = z.infer<typeof CachedDisplaySchema>;

export const ChannelWindowPrefsSchema = z.object({
  autoOpen: z.boolean().default(false),
  /** Electron `Display.id` of the target display when the pref was saved.
   *  May not match the currently-attached set; the resolver in the
   *  desktop host handles fallback. */
  displayId: z.number().optional(),
  fullscreen: z.boolean().default(false),
  frameless: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(false),
  transparent: z.boolean().default(false),
});
export type ChannelWindowPrefs = z.infer<typeof ChannelWindowPrefsSchema>;

export const WindowPrefsFileSchema = z.object({
  version: z.literal(1).default(1),
  displays: z.array(CachedDisplaySchema).default([]),
  channels: z.record(z.string(), ChannelWindowPrefsSchema).default({}),
});
export type WindowPrefsFile = z.infer<typeof WindowPrefsFileSchema>;
```

- [ ] **Step 4: Re-export from `packages/core/src/index.ts`**

Add the line in alphabetical position with the other exports:

```ts
export * from "./channelWindowPrefs";
```

- [ ] **Step 5: Run the test, confirm it passes**

```bash
pnpm test -- packages/core/src/channelWindowPrefs.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channelWindowPrefs.ts packages/core/src/channelWindowPrefs.test.ts packages/core/src/index.ts
git commit -m "feat(core): WindowPrefsFile schema for per-channel window assignment"
```

---

## Task 2: Pick up desktop tests in root Vitest config

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Edit `vitest.config.ts`**

Replace the `include` array:

```ts
include: [
  "packages/*/src/**/*.test.ts",
  "server/src/**/*.test.ts",
  "apps/desktop/src/**/*.test.ts",
],
```

- [ ] **Step 2: Verify the config still loads**

```bash
pnpm test -- --reporter=basic --run packages/core/src/channelWindowPrefs.test.ts
```

Expected: 4 passed. (Sanity check that the include change didn't break vitest's startup.)

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: include apps/desktop in vitest run"
```

---

## Task 3: `windowPrefs.ts` — load/save round-trip

**Files:**
- Create: `apps/desktop/src/windowPrefs.ts`
- Create: `apps/desktop/src/windowPrefs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src/windowPrefs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadPrefs, savePrefs } from "./windowPrefs";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "overlaysys-prefs-"));
  file = path.join(dir, "channel-window-prefs.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadPrefs / savePrefs", () => {
  it("returns defaults when the file does not exist", () => {
    expect(loadPrefs(file)).toEqual({ version: 1, displays: [], channels: {} });
  });

  it("round-trips a saved file", () => {
    savePrefs(file, {
      version: 1,
      displays: [],
      channels: {
        program: {
          autoOpen: true,
          displayId: 7,
          fullscreen: true,
          frameless: false,
          alwaysOnTop: false,
          transparent: false,
        },
      },
    });
    expect(loadPrefs(file).channels.program?.displayId).toBe(7);
  });

  it("returns defaults on malformed JSON", () => {
    require("node:fs").writeFileSync(file, "{not-json", "utf8");
    expect(loadPrefs(file)).toEqual({ version: 1, displays: [], channels: {} });
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: cannot resolve `./windowPrefs`.

- [ ] **Step 3: Create `apps/desktop/src/windowPrefs.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import {
  WindowPrefsFileSchema,
  type WindowPrefsFile,
} from "@overlaysys/core";

const DEFAULTS: WindowPrefsFile = {
  version: 1,
  displays: [],
  channels: {},
};

export function loadPrefs(file: string): WindowPrefsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return structuredClone(DEFAULTS);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
  const result = WindowPrefsFileSchema.safeParse(parsed);
  return result.success ? result.data : structuredClone(DEFAULTS);
}

export function savePrefs(file: string, prefs: WindowPrefsFile): void {
  const validated = WindowPrefsFileSchema.parse(prefs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(validated, null, 2), "utf8");
}
```

- [ ] **Step 4: Run, confirm 3 tests pass**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/windowPrefs.ts apps/desktop/src/windowPrefs.test.ts
git commit -m "feat(desktop): load/save channel window prefs to userData"
```

---

## Task 4: `windowPrefs.ts` — `resolveDisplay`

**Files:**
- Modify: `apps/desktop/src/windowPrefs.ts`
- Modify: `apps/desktop/src/windowPrefs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/desktop/src/windowPrefs.test.ts`:

```ts
import { resolveDisplay, type DisplayLike } from "./windowPrefs";

function display(over: Partial<DisplayLike>): DisplayLike {
  return {
    id: 1,
    label: "Built-in",
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    internal: true,
    ...over,
  };
}

describe("resolveDisplay", () => {
  const builtIn = display({ id: 1, label: "Built-in", internal: true });
  const dell = display({
    id: 2,
    label: "DELL U2718Q",
    bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
    internal: false,
  });
  const displays = [builtIn, dell];

  it("matches by exact id", () => {
    const result = resolveDisplay(
      { displayId: 2 },
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("id");
  });

  it("matches by label when id rotates", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays,
        cached: [
          {
            id: 999,
            label: "DELL U2718Q",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("label");
  });

  it("matches by bounds + internal flag when label differs", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays,
        cached: [
          {
            id: 999,
            label: "Some Other Name",
            bounds: { x: 0, y: 0, width: 3840, height: 2160 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(dell);
    expect(result.matchedBy).toBe("bounds");
  });

  it("falls back to primary when nothing matches", () => {
    const result = resolveDisplay(
      { displayId: 999 },
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(builtIn);
    expect(result.matchedBy).toBe("fallback");
  });

  it("falls back when prefs have no displayId", () => {
    const result = resolveDisplay(
      {},
      { displays, cached: [], primary: builtIn },
    );
    expect(result.display).toBe(builtIn);
    expect(result.matchedBy).toBe("fallback");
  });

  it("breaks ties by display order", () => {
    const twin = display({
      id: 3,
      label: "Twin",
      bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
      internal: false,
    });
    const result = resolveDisplay(
      { displayId: 999 },
      {
        displays: [twin, dell],
        cached: [
          {
            id: 999,
            label: "Mismatch",
            bounds: { x: 0, y: 0, width: 3840, height: 2160 },
            internal: false,
          },
        ],
        primary: builtIn,
      },
    );
    expect(result.display).toBe(twin);
    expect(result.matchedBy).toBe("bounds");
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: cannot import `resolveDisplay` / `DisplayLike`.

- [ ] **Step 3: Implement `resolveDisplay` in `windowPrefs.ts`**

Append to `apps/desktop/src/windowPrefs.ts`:

```ts
import type { CachedDisplay, ChannelWindowPrefs } from "@overlaysys/core";

/**
 * Subset of Electron's `Display` used by resolve/fingerprint. Defined
 * structurally so the module stays free of an `electron` import and
 * remains unit-testable with plain object fixtures.
 */
export interface DisplayLike {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  internal: boolean;
}

export type MatchedBy = "id" | "label" | "bounds" | "fallback";

export interface ResolveContext {
  /** Currently-attached displays, in `screen.getAllDisplays()` order. */
  displays: DisplayLike[];
  /** Cached display fingerprints from a previous successful match. */
  cached: CachedDisplay[];
  /** Used when nothing else matches. */
  primary: DisplayLike;
}

export interface ResolveResult {
  display: DisplayLike;
  matchedBy: MatchedBy;
}

export function resolveDisplay(
  prefs: Pick<ChannelWindowPrefs, "displayId">,
  ctx: ResolveContext,
): ResolveResult {
  const want = prefs.displayId;
  if (want === undefined) return { display: ctx.primary, matchedBy: "fallback" };

  // 1. Exact id.
  const byId = ctx.displays.find((d) => d.id === want);
  if (byId) return { display: byId, matchedBy: "id" };

  // Look up the cached fingerprint for that id, if any.
  const cached = ctx.cached.find((c) => c.id === want);
  if (cached) {
    // 2. Same label.
    const byLabel = ctx.displays.find((d) => d.label === cached.label);
    if (byLabel) return { display: byLabel, matchedBy: "label" };

    // 3. Same bounds.width × bounds.height + internal flag. First hit wins.
    const byBounds = ctx.displays.find(
      (d) =>
        d.internal === cached.internal &&
        d.bounds.width === cached.bounds.width &&
        d.bounds.height === cached.bounds.height,
    );
    if (byBounds) return { display: byBounds, matchedBy: "bounds" };
  }

  // 4. Fallback.
  return { display: ctx.primary, matchedBy: "fallback" };
}

export function fingerprintDisplay(d: DisplayLike): CachedDisplay {
  return {
    id: d.id,
    label: d.label,
    bounds: { ...d.bounds },
    internal: d.internal,
  };
}
```

- [ ] **Step 4: Run, confirm all tests pass**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/windowPrefs.ts apps/desktop/src/windowPrefs.test.ts
git commit -m "feat(desktop): resolveDisplay with id/label/bounds/fallback matching"
```

---

## Task 5: `windowPrefs.ts` — `updateDisplayCache` + cap

**Files:**
- Modify: `apps/desktop/src/windowPrefs.ts`
- Modify: `apps/desktop/src/windowPrefs.test.ts`

The spec calls out that the cached `displays[]` could grow unbounded. Cap it: on every save, keep only displays currently attached *plus* any display id referenced by a channel pref.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/windowPrefs.test.ts`:

```ts
import { updateDisplayCache, fingerprintDisplay } from "./windowPrefs";

describe("updateDisplayCache", () => {
  const builtIn = {
    id: 1,
    label: "Built-in",
    bounds: { x: 0, y: 0, width: 1512, height: 982 },
    internal: true,
  };
  const dell = {
    id: 2,
    label: "DELL U2718Q",
    bounds: { x: 1512, y: 0, width: 3840, height: 2160 },
    internal: false,
  };

  it("keeps only attached displays plus referenced display ids", () => {
    const prev = [
      fingerprintDisplay(builtIn),
      fingerprintDisplay(dell),
      fingerprintDisplay({
        id: 99,
        label: "Stale",
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        internal: false,
      }),
    ];
    const next = updateDisplayCache(prev, [builtIn], {
      program: { autoOpen: true, displayId: 2, fullscreen: false, frameless: false, alwaysOnTop: false, transparent: false },
    });
    expect(next.map((d) => d.id).sort()).toEqual([1, 2]);
  });

  it("replaces a cached entry when an attached display has the same id", () => {
    const stale = {
      id: 1,
      label: "Old Label",
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      internal: false,
    };
    const next = updateDisplayCache([stale], [builtIn], {});
    expect(next).toEqual([fingerprintDisplay(builtIn)]);
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: cannot import `updateDisplayCache`.

- [ ] **Step 3: Implement `updateDisplayCache` in `windowPrefs.ts`**

Append:

```ts
export function updateDisplayCache(
  previous: CachedDisplay[],
  attached: DisplayLike[],
  channels: Record<string, ChannelWindowPrefs>,
): CachedDisplay[] {
  const referenced = new Set<number>();
  for (const prefs of Object.values(channels)) {
    if (typeof prefs.displayId === "number") referenced.add(prefs.displayId);
  }

  const attachedById = new Map(attached.map((d) => [d.id, d]));
  const out: CachedDisplay[] = [];

  // Attached displays always win — fresh fingerprint.
  for (const d of attached) out.push(fingerprintDisplay(d));

  // Keep stale entries only if their id is referenced by a pref AND
  // they are not already represented by an attached display.
  for (const cached of previous) {
    if (attachedById.has(cached.id)) continue;
    if (referenced.has(cached.id)) out.push(cached);
  }

  return out;
}
```

- [ ] **Step 4: Run, confirm all tests pass**

```bash
pnpm test -- apps/desktop/src/windowPrefs.test.ts
```

Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/windowPrefs.ts apps/desktop/src/windowPrefs.test.ts
git commit -m "feat(desktop): cap window-prefs display cache to attached+referenced"
```

---

## Task 6: Extend `ChannelWindowOptions` with `displayId`; position-before-fullscreen

**Files:**
- Modify: `apps/desktop/src/main.ts` (lines 130–135 for the interface; 345–406 for `createChannelWindow`).

- [ ] **Step 1: Add `displayId` to the `ChannelWindowOptions` interface**

Replace lines 130–135 of `apps/desktop/src/main.ts`:

```ts
interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
  /** Electron `Display.id` of the target screen. If undefined or unknown,
   *  the window opens on the primary display. */
  displayId?: number;
}
```

- [ ] **Step 2: Make `createChannelWindow` position the window before fullscreen**

Modify `createChannelWindow` in `apps/desktop/src/main.ts`. Add an import at the top of the file (next to the other electron imports):

```ts
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
```

Replace the `BrowserWindow` constructor block in `createChannelWindow` (around lines 347–368) with:

```ts
function createChannelWindow(channelId: string, opts: ChannelWindowOptions = {}): BrowserWindow {
  const isMac = process.platform === "darwin";

  // Look up the target display so we can position the window on it
  // BEFORE any fullscreen transition. Electron honors the screen the
  // window is currently on at the moment fullscreen is engaged.
  const targetDisplay =
    (opts.displayId !== undefined
      ? screen.getAllDisplays().find((d) => d.id === opts.displayId)
      : undefined) ?? screen.getPrimaryDisplay();

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    x: targetDisplay.bounds.x + 40,
    y: targetDisplay.bounds.y + 40,
    title: `Channel — ${channelId}`,
    backgroundColor: opts.transparent ? "#00000000" : "#000000",
    transparent: !!opts.transparent,
    frame: !opts.frameless,
    alwaysOnTop: !!opts.alwaysOnTop,
    simpleFullscreen: true,
    ...(isMac ? {} : { fullscreen: !!opts.fullscreen }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
```

(Leave the existing macOS `enter-full-screen` safety listener, the `setSimpleFullScreen` call, the `loadURL`, the `closed` listener, and the `channelWindows.set(...)` block exactly as-is. Only the constructor changes.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @overlaysys/desktop typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): position channel window on target display before fullscreen"
```

---

## Task 7: In-memory resolution map + new IPC handlers

**Files:**
- Modify: `apps/desktop/src/main.ts` (top-level state + `registerIpc`)

- [ ] **Step 1: Add resolution-state and prefs-path helpers**

Near the existing top-level state declarations in `main.ts` (after the `channelWindows` map around line 128), add:

```ts
import {
  loadPrefs,
  savePrefs,
  resolveDisplay,
  updateDisplayCache,
  fingerprintDisplay,
  type MatchedBy,
} from "./windowPrefs";
import type {
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";

interface ChannelResolution {
  matchedBy: MatchedBy;
  configuredLabel: string | null;
  actualLabel: string;
  actualDisplayId: number;
}

const channelResolutions = new Map<string, ChannelResolution>();

function prefsFilePath(): string {
  return path.join(app.getPath("userData"), "data", "channel-window-prefs.json");
}

function currentDisplaysSnapshot() {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    label: d.label,
    bounds: {
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
    },
    internal: d.internal,
  }));
}
```

(Place the imports near the top of the file with the others. Place the `interface`, `Map`, and helper functions in the top-level state section near `channelWindows`.)

- [ ] **Step 2: Add IPC handlers in `registerIpc()`**

Inside `registerIpc()` (after the existing `overlaysys:get-mode` handler), add:

```ts
ipcMain.handle("overlaysys:get-displays", () => currentDisplaysSnapshot());

ipcMain.handle("overlaysys:get-channel-window-prefs", (): WindowPrefsFile => {
  return loadPrefs(prefsFilePath());
});

ipcMain.handle(
  "overlaysys:set-channel-window-prefs",
  (_event, channelId: string, prefs: ChannelWindowPrefs): WindowPrefsFile => {
    if (typeof channelId !== "string" || !channelId) {
      throw new Error("channelId required");
    }
    const file = loadPrefs(prefsFilePath());
    file.channels[channelId] = prefs;
    file.displays = updateDisplayCache(
      file.displays,
      currentDisplaysSnapshot(),
      file.channels,
    );
    savePrefs(prefsFilePath(), file);
    return file;
  },
);

ipcMain.handle("overlaysys:get-channel-window-resolutions", () => {
  return Object.fromEntries(channelResolutions);
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @overlaysys/desktop typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): IPC for read/write channel window prefs + resolution state"
```

---

## Task 8: Apply prefs on `openChannelWindow`; auto-open at boot

**Files:**
- Modify: `apps/desktop/src/main.ts` (the existing `open-channel-window` handler and the `boot()` function)

- [ ] **Step 1: Add a helper that opens a channel using prefs**

After `createChannelWindow` in `apps/desktop/src/main.ts`, add:

```ts
/**
 * Resolve the target display for a channel and open its renderer
 * window. Records the resolution result so the operator UI can
 * surface fallbacks. Honors `forceRecreate` to support the "Reopen
 * on configured display" action.
 */
function openConfiguredChannelWindow(
  channelId: string,
  prefs: ChannelWindowPrefs,
  overrides: Partial<ChannelWindowOptions> = {},
  forceRecreate = false,
): { reused: boolean } {
  const file = loadPrefs(prefsFilePath());
  const displays = currentDisplaysSnapshot();
  const primary = screen.getPrimaryDisplay();
  const resolved = resolveDisplay(prefs, {
    displays,
    cached: file.displays,
    primary: {
      id: primary.id,
      label: primary.label,
      bounds: { ...primary.bounds },
      internal: primary.internal,
    },
  });

  const cachedFor = file.displays.find((c) => c.id === prefs.displayId);
  channelResolutions.set(channelId, {
    matchedBy: resolved.matchedBy,
    configuredLabel: cachedFor?.label ?? null,
    actualLabel: resolved.display.label,
    actualDisplayId: resolved.display.id,
  });

  // Refresh the display cache with whatever we just resolved.
  if (resolved.matchedBy !== "fallback") {
    file.displays = updateDisplayCache(file.displays, displays, file.channels);
    savePrefs(prefsFilePath(), file);
  }

  const existing = channelWindows.get(channelId);
  if (existing && !existing.isDestroyed()) {
    if (forceRecreate) {
      existing.close();
    } else {
      existing.focus();
      return { reused: true };
    }
  }

  const opts: ChannelWindowOptions = {
    fullscreen: prefs.fullscreen,
    frameless: prefs.frameless,
    alwaysOnTop: prefs.alwaysOnTop,
    transparent: prefs.transparent,
    displayId: resolved.display.id,
    ...overrides,
  };
  createChannelWindow(channelId, opts);
  return { reused: false };
}
```

- [ ] **Step 2: Update the existing `open-channel-window` handler**

Replace the body of the existing `overlaysys:open-channel-window` handler (around lines 480–493) with:

```ts
ipcMain.handle(
  "overlaysys:open-channel-window",
  (_event, channelId: string, opts?: ChannelWindowOptions) => {
    if (typeof channelId !== "string" || !channelId) {
      throw new Error("channelId required");
    }
    // If we have stored prefs for this channel, layer the caller's
    // explicit `opts` on top — but use prefs as the base (display,
    // fullscreen, etc.).
    const file = loadPrefs(prefsFilePath());
    const prefs = file.channels[channelId];
    if (prefs) {
      return openConfiguredChannelWindow(channelId, prefs, opts ?? {}, false);
    }
    const existing = channelWindows.get(channelId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { reused: true };
    }
    createChannelWindow(channelId, opts);
    return { reused: false };
  },
);
```

- [ ] **Step 3: Add a "reopen on configured display" IPC handler**

Inside `registerIpc()`, add:

```ts
ipcMain.handle(
  "overlaysys:reopen-channel-on-configured-display",
  (_event, channelId: string) => {
    if (typeof channelId !== "string" || !channelId) {
      throw new Error("channelId required");
    }
    const file = loadPrefs(prefsFilePath());
    const prefs = file.channels[channelId];
    if (!prefs) return { reused: false, reason: "no-prefs" as const };
    openConfiguredChannelWindow(channelId, prefs, {}, /* forceRecreate */ true);
    return { reused: false };
  },
);
```

- [ ] **Step 4: Auto-open at boot**

Find `async function boot()` in `apps/desktop/src/main.ts`. After `operatorWindow = createOperatorWindow();` near the end of `boot()`, add:

```ts
  // Auto-open configured channel windows. Done after the operator
  // window so closing the operator (which closes all channel windows)
  // is the canonical lifecycle owner.
  try {
    const file = loadPrefs(prefsFilePath());
    for (const [channelId, prefs] of Object.entries(file.channels)) {
      if (prefs.autoOpen) {
        openConfiguredChannelWindow(channelId, prefs, {}, false);
      }
    }
  } catch (err) {
    console.error("[desktop] auto-open failed:", err);
  }
```

- [ ] **Step 5: Typecheck + build the desktop main**

```bash
pnpm --filter @overlaysys/desktop typecheck
pnpm --filter @overlaysys/desktop build
```

Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat(desktop): auto-open + reopen channels on configured display"
```

---

## Task 9: `identifyDisplays.ts` — flash-number overlay

**Files:**
- Create: `apps/desktop/src/identifyDisplays.ts`
- Modify: `apps/desktop/src/main.ts` (register IPC handler)

- [ ] **Step 1: Create the overlay module**

Create `apps/desktop/src/identifyDisplays.ts`:

```ts
import { BrowserWindow, screen } from "electron";

/**
 * Open a transparent, click-through overlay on each display showing a
 * large number for ~2 seconds, so the operator can match the
 * numbered choices in the channel-window-settings dropdown to the
 * physical screen.
 *
 * Each overlay is its own BrowserWindow; they all close themselves
 * after the timeout.
 */
export function identifyDisplays(durationMs = 2000): void {
  const displays = screen.getAllDisplays();
  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    if (!d) continue;
    const win = new BrowserWindow({
      width: Math.min(480, d.bounds.width),
      height: Math.min(360, d.bounds.height),
      x: d.bounds.x + Math.floor((d.bounds.width - 480) / 2),
      y: d.bounds.y + Math.floor((d.bounds.height - 360) / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      backgroundColor: "#00000000",
    });
    win.setIgnoreMouseEvents(true);

    const html = `<!doctype html><html><body style="margin:0;background:transparent;display:flex;align-items:center;justify-content:center;height:100vh;">
<div style="font-family:system-ui,sans-serif;font-size:240px;font-weight:900;color:#fff;text-shadow:0 8px 32px rgba(0,0,0,0.85),0 0 4px rgba(0,0,0,1);line-height:1;">${i + 1}</div>
<div style="position:fixed;bottom:24px;left:0;right:0;text-align:center;font-family:system-ui,sans-serif;font-size:18px;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,0.9);">${d.label || `Display ${i + 1}`}</div>
</body></html>`;
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

    setTimeout(() => {
      if (!win.isDestroyed()) win.close();
    }, durationMs);
  }
}
```

- [ ] **Step 2: Register IPC handler in `main.ts`**

Add an import near the other relative imports:

```ts
import { identifyDisplays } from "./identifyDisplays";
```

Inside `registerIpc()`, add:

```ts
ipcMain.handle("overlaysys:identify-displays", () => {
  identifyDisplays();
});
```

- [ ] **Step 3: Typecheck + build**

```bash
pnpm --filter @overlaysys/desktop typecheck
pnpm --filter @overlaysys/desktop build
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/identifyDisplays.ts apps/desktop/src/main.ts
git commit -m "feat(desktop): identify-displays overlay flashes numbers on each screen"
```

---

## Task 10: Expose new IPC in preload + operator shim

**Files:**
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/operator/src/lib/desktop.ts`

- [ ] **Step 1: Add the new methods to the preload `ChannelWindowOptions`, `OverlaysysApi`, and `api` const**

In `apps/desktop/src/preload.ts`:

Replace the `ChannelWindowOptions` interface to include `displayId`:

```ts
interface ChannelWindowOptions {
  frameless?: boolean;
  alwaysOnTop?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
  displayId?: number;
}
```

Add an import at the top:

```ts
import type {
  ChannelWindowPrefs,
  WindowPrefsFile,
  CachedDisplay,
} from "@overlaysys/core";
```

Add to the `OverlaysysApi` interface, after `setChannelWindowOptions`:

```ts
  /** List of currently-attached displays for the picker UI. */
  getDisplays(): Promise<CachedDisplay[]>;

  /** Current persisted prefs file. */
  getChannelWindowPrefs(): Promise<WindowPrefsFile>;

  /** Merge-and-persist the prefs for one channel. Returns the new file. */
  setChannelWindowPrefs(
    channelId: string,
    prefs: ChannelWindowPrefs,
  ): Promise<WindowPrefsFile>;

  /** In-memory resolution info per open channel (id → result). */
  getChannelWindowResolutions(): Promise<
    Record<string, {
      matchedBy: "id" | "label" | "bounds" | "fallback";
      configuredLabel: string | null;
      actualLabel: string;
      actualDisplayId: number;
    }>
  >;

  /** Close (if open) and recreate the channel window on its configured display. */
  reopenChannelOnConfiguredDisplay(channelId: string): Promise<{ reused: boolean; reason?: "no-prefs" }>;

  /** Briefly flash a large number on every attached display. */
  identifyDisplays(): Promise<void>;
```

Add to the `api` const:

```ts
  getDisplays: () => ipcRenderer.invoke("overlaysys:get-displays"),
  getChannelWindowPrefs: () => ipcRenderer.invoke("overlaysys:get-channel-window-prefs"),
  setChannelWindowPrefs: (channelId, prefs) =>
    ipcRenderer.invoke("overlaysys:set-channel-window-prefs", channelId, prefs),
  getChannelWindowResolutions: () =>
    ipcRenderer.invoke("overlaysys:get-channel-window-resolutions"),
  reopenChannelOnConfiguredDisplay: (channelId) =>
    ipcRenderer.invoke("overlaysys:reopen-channel-on-configured-display", channelId),
  identifyDisplays: () => ipcRenderer.invoke("overlaysys:identify-displays"),
```

- [ ] **Step 2: Mirror the additions in `apps/operator/src/lib/desktop.ts`**

Add the same import + the same interface fields. Update the `ChannelWindowOptions` interface to include `displayId?: number`. Append the new method signatures to the `OverlaysysApi` interface inside that file. No `api` const exists here — the operator only declares types.

- [ ] **Step 3: Typecheck both**

```bash
pnpm --filter @overlaysys/desktop typecheck
pnpm --filter @overlaysys/operator typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload.ts apps/operator/src/lib/desktop.ts
git commit -m "feat(desktop): expose channel-window-prefs IPC in preload + operator shim"
```

---

## Task 11: `ChannelWindowSettingsPopover.tsx`

**Files:**
- Create: `apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import type {
  CachedDisplay,
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";
import { colors, radius } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";

const DEFAULT_PREFS: ChannelWindowPrefs = {
  autoOpen: false,
  displayId: undefined,
  fullscreen: false,
  frameless: false,
  alwaysOnTop: false,
  transparent: false,
};

export function ChannelWindowSettingsPopover({
  channelId,
  onClose,
}: {
  channelId: string;
  onClose: () => void;
}) {
  const api = getDesktopApi();
  const [displays, setDisplays] = useState<CachedDisplay[]>([]);
  const [prefs, setPrefs] = useState<ChannelWindowPrefs>(DEFAULT_PREFS);
  const [file, setFile] = useState<WindowPrefsFile | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const [d, f] = await Promise.all([
        api.getDisplays(),
        api.getChannelWindowPrefs(),
      ]);
      setDisplays(d);
      setFile(f);
      const existing = f.channels[channelId];
      if (existing) setPrefs(existing);
    })();
  }, [api, channelId]);

  if (!api) return null;

  const configuredButMissing =
    prefs.displayId !== undefined &&
    !displays.some((d) => d.id === prefs.displayId);
  const cachedConfigured =
    configuredButMissing && file
      ? file.displays.find((d) => d.id === prefs.displayId) ?? null
      : null;

  const update = <K extends keyof ChannelWindowPrefs>(
    key: K,
    value: ChannelWindowPrefs[K],
  ) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  const onSave = async () => {
    await api.setChannelWindowPrefs(channelId, prefs);
    setDirty(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      style={{
        position: "absolute",
        right: 0,
        top: 28,
        zIndex: 50,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: 12,
        width: 280,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontSize: 12,
        color: colors.text,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Window settings</div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={prefs.autoOpen}
          onChange={(e) => update("autoOpen", e.target.checked)}
        />
        Auto-open at launch
      </label>

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Display</div>
        <select
          value={prefs.displayId ?? ""}
          onChange={(e) =>
            update("displayId", e.target.value === "" ? undefined : Number(e.target.value))
          }
          style={{ width: "100%", padding: 4 }}
        >
          <option value="">(none — open on primary)</option>
          {displays.map((d, i) => (
            <option key={d.id} value={d.id}>
              {i + 1}. {d.label || `Display ${i + 1}`} ({d.bounds.width}×{d.bounds.height}
              {d.internal ? ", internal" : ""})
            </option>
          ))}
          {cachedConfigured && (
            <option value={cachedConfigured.id}>
              {cachedConfigured.label} ⚠ not attached
            </option>
          )}
        </select>
        <button
          onClick={() => api.identifyDisplays()}
          style={{
            marginTop: 4,
            background: "transparent",
            color: colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Identify displays
        </button>
      </div>

      {(
        [
          ["fullscreen", "Fullscreen"],
          ["frameless", "Frameless"],
          ["alwaysOnTop", "Always on top"],
          ["transparent", "Transparent"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
        >
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={(e) => update(key, e.target.checked)}
          />
          {label}
        </label>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          style={{
            background: dirty ? colors.accent : "transparent",
            color: dirty ? "#000" : colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "4px 10px",
            cursor: dirty ? "pointer" : "default",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component typechecks**

```bash
pnpm --filter @overlaysys/operator typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx
git commit -m "feat(operator): ChannelWindowSettingsPopover for per-channel window prefs"
```

---

## Task 12: Wire into `ChannelStatus.tsx`

**Files:**
- Modify: `apps/operator/src/app/components/ChannelStatus.tsx`

The card needs three additions: a ⚙ button that toggles the popover, a "Reopen on configured display" item shown when the channel has prefs, and a yellow ⚠ when the last resolution was a fallback.

- [ ] **Step 1: Add state + load resolution info**

Near the top of `ChannelStatus` (after the prop destructure, before the return), add:

```tsx
import { useEffect, useState } from "react";
import { ChannelWindowSettingsPopover } from "./ChannelWindowSettingsPopover";

// ... (existing imports retained)

const [settingsOpen, setSettingsOpen] = useState(false);
const [hasPrefs, setHasPrefs] = useState(false);
const [fallbackWarning, setFallbackWarning] = useState<{
  configuredLabel: string | null;
  actualLabel: string;
} | null>(null);

useEffect(() => {
  if (!isElectron() || !config) return;
  const api = getDesktopApi();
  if (!api) return;
  let cancelled = false;
  const refresh = async () => {
    const [prefsFile, resolutions] = await Promise.all([
      api.getChannelWindowPrefs(),
      api.getChannelWindowResolutions(),
    ]);
    if (cancelled) return;
    setHasPrefs(!!prefsFile.channels[config.id]);
    const r = resolutions[config.id];
    setFallbackWarning(
      r && r.matchedBy === "fallback" && r.configuredLabel
        ? { configuredLabel: r.configuredLabel, actualLabel: r.actualLabel }
        : null,
    );
  };
  void refresh();
  const offOpened = api.onChannelWindowOpened(refresh);
  const offClosed = api.onChannelWindowClosed(refresh);
  return () => {
    cancelled = true;
    offOpened();
    offClosed();
  };
}, [config]);
```

- [ ] **Step 2: Replace the ↗-button block with a button + ⚙ + reopen action**

Replace the `(href || config) && (<button …↗ />)` block in the card header with:

```tsx
{(href || config) && (
  <>
    {hasPrefs && (
      <button
        onClick={() => {
          const api = getDesktopApi();
          if (api && config) void api.reopenChannelOnConfiguredDisplay(config.id);
        }}
        title="Reopen on configured display"
        style={{
          width: 22,
          height: 18,
          background: "transparent",
          color: accent,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.sm,
          cursor: "pointer",
          fontSize: 10,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ⟳
      </button>
    )}
    <button
      onClick={() => {
        if (isElectron() && config) {
          getDesktopApi()?.openChannelWindow(config.id);
        } else if (href) {
          window.open(href, "_blank", "noreferrer");
        }
      }}
      title="Open renderer"
      style={{
        width: 22,
        height: 18,
        background: "transparent",
        color: accent,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.sm,
        cursor: "pointer",
        fontSize: 10,
        padding: 0,
        lineHeight: 1,
      }}
    >
      ↗
    </button>
    {isElectron() && config && (
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          title="Window settings"
          style={{
            width: 22,
            height: 18,
            background: "transparent",
            color: settingsOpen ? accent : colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            cursor: "pointer",
            fontSize: 10,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ⚙
        </button>
        {settingsOpen && (
          <ChannelWindowSettingsPopover
            channelId={config.id}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    )}
  </>
)}
```

(Wrap the existing parent flex container with `position: "relative"` if it doesn't already establish a containing block.)

- [ ] **Step 3: Add the fallback warning indicator**

Just below the `● {label}` line at the top of the card, add:

```tsx
{fallbackWarning && (
  <div
    title={`Configured for ${fallbackWarning.configuredLabel}; using ${fallbackWarning.actualLabel}`}
    style={{ fontSize: 11, color: colors.warn }}
  >
    ⚠
  </div>
)}
```

- [ ] **Step 4: Typecheck the operator**

```bash
pnpm --filter @overlaysys/operator typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/components/ChannelStatus.tsx
git commit -m "feat(operator): channel card window-settings popover + reopen + fallback warning"
```

---

## Task 13: Manual end-to-end verification

**Files:** none.

This task verifies the feature works in the real desktop runtime. No automated test substitutes for it.

- [ ] **Step 1: Start the operator + renderer dev servers**

```bash
pnpm dev
```

Wait until both `http://localhost:3000` and `http://localhost:3001` are responding.

- [ ] **Step 2: Start the desktop app in dev mode**

In a new terminal:

```bash
pnpm desktop
```

Operator window appears. Open the renderer dev tools menu (`⌥⌘I` on macOS) on a channel window once it appears.

- [ ] **Step 3: Configure program channel**

In the operator, click ⚙ on the Program card. Set:

- Auto-open at launch: on
- Display: pick a non-primary display from the dropdown (use "Identify displays" if unsure)
- Fullscreen: on
- All others: off

Click Save. Expected: popover closes, prefs persist (verify in
`~/Library/Application Support/OverlaySys/data/channel-window-prefs.json` on macOS — the path is from `app.getPath('userData')`).

- [ ] **Step 4: Test "Reopen on configured display"**

Close the program renderer window manually. In the operator, click ⟳ next to the Program card's ↗ button. Expected: window reappears fullscreen on the configured display.

- [ ] **Step 5: Test auto-open**

Quit the desktop app fully. Restart with `pnpm desktop`. Expected: operator window opens, then program renderer window auto-opens fullscreen on the configured display.

- [ ] **Step 6: Test missing-display fallback**

Quit the app. Edit `channel-window-prefs.json` and change Program's `displayId` to a number that doesn't exist (e.g., `999999`). Restart. Expected: Program window opens fullscreen on the primary display, and the Program card shows a yellow ⚠ with the tooltip naming the configured and actual labels.

- [ ] **Step 7: Restore working state**

Click ⚙ → pick the real display → Save. Verify ⚠ disappears next time the window is reopened.

---

## Notes on edge cases not covered by tests

- macOS `simpleFullscreen` quirk: the existing `enter-full-screen` safety listener in `createChannelWindow` stays in place. Position is set in the constructor (before any fullscreen path runs), so the simple-fullscreen transition lands on the correct screen.
- The cached `displays[]` is rewritten on every successful (non-fallback) resolve and on every `set-channel-window-prefs` call, so the file stays bounded.
- Operator running in a browser (web mode, not Electron) sees `isElectron()` return false; the ⚙ button, ⟳ button, and popover never render. Existing ↗ → `window.open(href)` flow is preserved.
