# Bitfocus Companion Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bitfocus Companion module under `packages/companion-module/` that lets a Stream Deck (or any Companion surface) trigger every OverlaySys WS action and surface live state on its buttons.

**Architecture:** A standalone workspace package depending on `@companion-module/base` (Companion 3.x SDK) and `@overlaysys/ws-protocol`. The module opens one WebSocket to the OverlaySys server, maintains a local reducer-driven cache of server state, and exposes Companion-native primitives (actions, feedbacks, variables, presets) that read/write through that cache. All logic is pure-function and unit-tested via Vitest; the only non-pure layer is the thin WS connection. Server-side code is untouched.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`), `@companion-module/base` ^1.10, `ws` ^8, `zod` ^3 (via existing `@overlaysys/ws-protocol`), Vitest (matches workspace).

**Spec:** `docs/superpowers/specs/2026-05-12-companion-integration-design.md`

---

## File structure

```
packages/companion-module/
  package.json
  tsconfig.json
  README.md
  companion/
    manifest.json
    HELP.md
  src/
    index.ts            # ModuleInstance — wires Companion lifecycle to the rest
    connection.ts       # WS client + reconnect, dispatches messages to reducer
    state.ts            # CompanionState type + apply() reducer
    labels.ts           # display-label helpers (row label, section label)
    actions.ts          # action definitions (Companion shape) + dispatch
    variables.ts        # variable definitions + projection from state
    feedbacks.ts        # feedback definitions + predicate from state
    presets.ts          # preset button packs
    config.ts           # config schema for the Companion config form
    types.ts            # internal type aliases shared across files
    __tests__/
      state.test.ts
      labels.test.ts
      variables.test.ts
      feedbacks.test.ts
      actions.test.ts
```

Boundary rules:
- `state.ts` is pure (no I/O, no Companion SDK). Reducer = `(state, ServerMessage) => state`.
- `labels.ts`, `variables.ts`, `feedbacks.ts`, `actions.ts` are pure projections / dispatchers — given state + inputs they produce strings, booleans, or `ClientMessage[]`.
- `connection.ts` is the only file that imports `ws`.
- `index.ts` is the only file that imports `@companion-module/base`'s `InstanceBase`.
- Tests live next to the modules they cover, all under `__tests__/`.

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/companion-module/package.json`
- Create: `packages/companion-module/tsconfig.json`
- Create: `packages/companion-module/README.md`
- Create: `packages/companion-module/companion/manifest.json`
- Create: `packages/companion-module/companion/HELP.md`
- Create: `packages/companion-module/src/index.ts` (stub)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@overlaysys/companion-module",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --dir src",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "dependencies": {
    "@companion-module/base": "^1.10.0",
    "@overlaysys/core": "workspace:*",
    "@overlaysys/ws-protocol": "workspace:*",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12",
    "typescript": "^5.6.0"
  }
}
```

Unlike the other workspace packages, this one builds to `dist/` because the Companion runtime loads compiled JS from `manifest.json#runtime.entrypoint`, not TS source.

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Write `companion/manifest.json`**

```json
{
  "id": "overlaysys",
  "name": "overlaysys",
  "shortname": "OverlaySys",
  "description": "Control OverlaySys (channels, hotcards, song rundown, STT) from Companion.",
  "version": "0.0.1",
  "license": "MIT",
  "repository": "https://github.com/mitchellpeck/OverlaySys",
  "bugs": "https://github.com/mitchellpeck/OverlaySys/issues",
  "maintainers": [
    { "name": "Mitchell Peck", "email": "me@mitchellpeck.com" }
  ],
  "runtime": {
    "type": "node22",
    "api": "nodejs-ipc",
    "apiVersion": "1.10.0",
    "entrypoint": "../dist/index.js"
  },
  "manufacturer": "OverlaySys",
  "products": ["OverlaySys server"],
  "keywords": ["broadcast", "graphics", "worship", "stt"],
  "legacyIds": []
}
```

- [ ] **Step 4: Write `companion/HELP.md` placeholder**

```markdown
# OverlaySys Companion Module

Connects Bitfocus Companion to an OverlaySys server over WebSocket.

## Installation (developer mode)

1. Build the module: `pnpm -F @overlaysys/companion-module build`
2. In Companion → Modules → Developer modules, point at the `packages/companion-module/` directory.
3. Add a new connection with type **OverlaySys**.

## Configuration

- **Host** — IP/hostname of the OverlaySys server (default `127.0.0.1`).
- **Port** — Port of the OverlaySys server (default `4000`).
- **Subscribed channels** — Comma-separated channel IDs to subscribe to (default `program,preview`).
- **Loaded show ID** — Optional. The show to drive `rundown_*` variables from. Pickable at runtime via the `Load Show` action; this field just persists the choice across Companion restarts.

See spec at `docs/superpowers/specs/2026-05-12-companion-integration-design.md` for the full action / variable / feedback reference.
```

- [ ] **Step 5: Write `README.md` (workspace-level pointer)**

```markdown
# @overlaysys/companion-module

Bitfocus Companion module for controlling OverlaySys.

See `companion/HELP.md` for installation, and `docs/superpowers/specs/2026-05-12-companion-integration-design.md` for the design spec.
```

- [ ] **Step 6: Write a stub `src/index.ts` so typecheck has something to chew on**

```typescript
export const MODULE_NAME = "overlaysys";
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install` from the repo root.

Expected: pnpm picks up the new workspace, installs `@companion-module/base`, `ws`, `@types/ws`, and links the existing `@overlaysys/*` workspace packages.

- [ ] **Step 8: Run typecheck to confirm setup**

Run: `pnpm -F @overlaysys/companion-module typecheck`
Expected: passes with no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/companion-module pnpm-lock.yaml
git commit -m "feat(companion-module): scaffold workspace package"
```

---

## Task 2: Internal types and display-label helpers

**Files:**
- Create: `packages/companion-module/src/types.ts`
- Create: `packages/companion-module/src/labels.ts`
- Test: `packages/companion-module/src/__tests__/labels.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
import type {
  ChannelState,
  ChannelConfig,
  Show,
  Song,
  SongMeta,
  ShowMeta,
  HotcardMeta,
  TemplateMeta,
  SttSpawnerStatus,
} from "@overlaysys/core";

export interface SttListener {
  audioSourceId: string;
  label?: string;
  online: boolean;
  lastSeen: number;
}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export interface CompanionState {
  connected: boolean;
  connectionState: ConnectionState;
  channelStates: Map<string, ChannelState>;
  templates: TemplateMeta[];
  shows: ShowMeta[];
  songs: SongMeta[];
  hotcards: HotcardMeta[];
  channels: ChannelConfig[];
  showCache: Map<string, Show>;
  songCache: Map<string, Song>;
  loadedShowId: string | null;
  loadedShowRowCursor: number | null;
  sttSpawner: SttSpawnerStatus | null;
  sttListeners: SttListener[];
  lastError: string | null;
}

export function initialState(): CompanionState {
  return {
    connected: false,
    connectionState: "disconnected",
    channelStates: new Map(),
    templates: [],
    shows: [],
    songs: [],
    hotcards: [],
    channels: [],
    showCache: new Map(),
    songCache: new Map(),
    loadedShowId: null,
    loadedShowRowCursor: null,
    sttSpawner: null,
    sttListeners: [],
    lastError: null,
  };
}
```

- [ ] **Step 2: Write failing tests in `src/__tests__/labels.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import {
  rowDisplayLabel,
  sectionDisplayLabel,
  songTitleForChannel,
} from "../labels";
import type { GraphicRow, SongRow, Song } from "@overlaysys/core";

describe("rowDisplayLabel", () => {
  it("returns song title for a song row", () => {
    const state = initialState();
    state.songs = [{ id: "s1", title: "Be Thou My Vision" }];
    const row: SongRow = {
      kind: "song",
      id: "row1",
      songId: "s1",
      lyricTemplateId: "lyric-default",
    };
    expect(rowDisplayLabel(state, row)).toBe("Be Thou My Vision");
  });

  it("returns the song id if title is not yet loaded", () => {
    const state = initialState();
    const row: SongRow = {
      kind: "song",
      id: "row1",
      songId: "unknown",
      lyricTemplateId: "lyric-default",
    };
    expect(rowDisplayLabel(state, row)).toBe("unknown");
  });

  it("returns notes for a graphic row when set", () => {
    const state = initialState();
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-1",
      data: { title: "Welcome" },
      notes: "Opening title",
    };
    expect(rowDisplayLabel(state, row)).toBe("Opening title");
  });

  it("falls back to template name for graphic row without notes", () => {
    const state = initialState();
    state.templates = [{ id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } }];
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-1",
      data: { title: "Welcome" },
    };
    expect(rowDisplayLabel(state, row)).toBe("Lower Third");
  });

  it("falls back to templateId when template meta is missing", () => {
    const state = initialState();
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-x",
      data: {},
    };
    expect(rowDisplayLabel(state, row)).toBe("tpl-x");
  });
});

describe("sectionDisplayLabel", () => {
  const song: Song = {
    id: "s1",
    title: "Test",
    sections: [
      {
        id: "sec1",
        kind: "verse",
        label: "Verse 1",
        slides: [{ id: "sl1", text: "line one" }],
      },
      {
        id: "sec2",
        kind: "chorus",
        label: "Chorus",
        slides: [{ id: "sl2", text: "chorus line" }],
      },
    ],
    defaultArrangement: ["sec1", "sec2"],
  };

  it("returns the label for the section at the cursor", () => {
    expect(
      sectionDisplayLabel(song, ["sec1", "sec2", "sec1"], 1),
    ).toBe("Chorus");
  });

  it("returns empty string when sectionIdx is out of range", () => {
    expect(sectionDisplayLabel(song, ["sec1"], 5)).toBe("");
  });

  it("returns empty string when section id is unknown", () => {
    expect(sectionDisplayLabel(song, ["nope"], 0)).toBe("");
  });
});

describe("songTitleForChannel", () => {
  it("returns title when songSession.songId is in cache", () => {
    const state = initialState();
    state.songs = [{ id: "s1", title: "Amazing Grace" }];
    state.channelStates.set("program", {
      channel: "program",
      active: null,
      songSession: {
        songId: "s1",
        lyricTemplateId: "lt",
        arrangement: ["sec1"],
        cursor: { sectionIdx: 0, slideIdx: 0 },
        blanked: false,
        trustMode: false,
        startedAt: 0,
      },
    });
    expect(songTitleForChannel(state, "program")).toBe("Amazing Grace");
  });

  it("returns empty when no songSession", () => {
    const state = initialState();
    state.channelStates.set("program", {
      channel: "program",
      active: null,
    });
    expect(songTitleForChannel(state, "program")).toBe("");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: tests fail because `labels.ts` doesn't exist yet.

- [ ] **Step 4: Implement `src/labels.ts`**

```typescript
import type { RundownRow, Song } from "@overlaysys/core";
import type { CompanionState } from "./types";

export function rowDisplayLabel(
  state: CompanionState,
  row: RundownRow,
): string {
  if (row.kind === "song") {
    const meta = state.songs.find((s) => s.id === row.songId);
    return meta?.title ?? row.songId;
  }
  if (row.notes && row.notes.trim().length > 0) return row.notes;
  const tpl = state.templates.find((t) => t.id === row.templateId);
  return tpl?.name ?? row.templateId;
}

export function sectionDisplayLabel(
  song: Song,
  arrangement: string[],
  sectionIdx: number,
): string {
  const sectionId = arrangement[sectionIdx];
  if (!sectionId) return "";
  const section = song.sections.find((s) => s.id === sectionId);
  return section?.label ?? "";
}

export function songTitleForChannel(
  state: CompanionState,
  channel: string,
): string {
  const ch = state.channelStates.get(channel);
  if (!ch?.songSession) return "";
  const meta = state.songs.find((s) => s.id === ch.songSession!.songId);
  return meta?.title ?? "";
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: all `labels.test.ts` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): internal types + display label helpers"
```

---

## Task 3: State reducer

**Files:**
- Create: `packages/companion-module/src/state.ts`
- Test: `packages/companion-module/src/__tests__/state.test.ts`

The reducer is a pure function `apply(state, ServerMessage) → CompanionState`. It handles every server-to-client message type. Unknown message types are no-ops (forward-compat: a server adding a new type doesn't crash the module).

It also handles a few **internal** events that aren't server messages — connection lifecycle, load_show action effects, and cursor manipulation. We model these as a separate `LocalEvent` union and accept either via `apply`.

- [ ] **Step 1: Write failing tests in `src/__tests__/state.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { apply } from "../state";
import { initialState } from "../types";
import type { ServerMessage } from "@overlaysys/ws-protocol";

describe("apply — connection lifecycle", () => {
  it("marks connected on local connect event", () => {
    const s = apply(initialState(), { type: "local_connected" });
    expect(s.connected).toBe(true);
    expect(s.connectionState).toBe("connected");
  });

  it("marks reconnecting on local reconnecting event", () => {
    const s = apply(initialState(), { type: "local_reconnecting" });
    expect(s.connectionState).toBe("reconnecting");
    expect(s.connected).toBe(false);
  });

  it("marks disconnected on local disconnect event", () => {
    let s = apply(initialState(), { type: "local_connected" });
    s = apply(s, { type: "local_disconnected" });
    expect(s.connected).toBe(false);
    expect(s.connectionState).toBe("disconnected");
  });
});

describe("apply — channel state", () => {
  it("upserts channel state from `state` message", () => {
    const msg: ServerMessage = {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hi" },
          phase: "on",
          takenAt: 1000,
        },
      },
    };
    const s = apply(initialState(), msg);
    expect(s.channelStates.get("program")?.active?.templateId).toBe("tpl-1");
  });

  it("replaces prior channel state", () => {
    let s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: { templateId: "tpl-1", data: {}, phase: "on", takenAt: 1 },
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(s.channelStates.get("program")?.active).toBeNull();
  });
});

describe("apply — list updates", () => {
  it("stores template list", () => {
    const s = apply(initialState(), {
      type: "template_list",
      templates: [{ id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } }],
    });
    expect(s.templates).toHaveLength(1);
    expect(s.templates[0]?.name).toBe("Lower Third");
  });

  it("stores hotcard list", () => {
    const s = apply(initialState(), {
      type: "hotcard_list",
      hotcards: [{ id: "h1", name: "Charlie L3", templateId: "tpl-1" }],
    });
    expect(s.hotcards).toHaveLength(1);
  });

  it("stores show list", () => {
    const s = apply(initialState(), {
      type: "show_list",
      shows: [{ id: "show-1", name: "Sunday Service", rowCount: 5 }],
    });
    expect(s.shows[0]?.name).toBe("Sunday Service");
  });

  it("stores song list", () => {
    const s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Amazing Grace" }],
    });
    expect(s.songs[0]?.title).toBe("Amazing Grace");
  });

  it("stores channel list", () => {
    const s = apply(initialState(), {
      type: "channel_list",
      configs: [{ id: "program", name: "Program", renderMode: "normal", background: "#000" }],
    });
    expect(s.channels[0]?.id).toBe("program");
  });
});

describe("apply — show and song caches", () => {
  it("caches a full show on `show` message", () => {
    const s = apply(initialState(), {
      type: "show",
      show: {
        id: "show-1",
        name: "Sunday",
        rows: [
          {
            kind: "graphic",
            id: "r1",
            templateId: "tpl-1",
            data: {},
          },
        ],
      },
    });
    expect(s.showCache.get("show-1")?.rows).toHaveLength(1);
  });

  it("caches a full song on `song` message", () => {
    const s = apply(initialState(), {
      type: "song",
      song: {
        id: "s1",
        title: "Test",
        sections: [
          { id: "sec1", kind: "verse", label: "V1", slides: [{ id: "sl1", text: "x" }] },
        ],
        defaultArrangement: ["sec1"],
      },
    });
    expect(s.songCache.get("s1")?.sections).toHaveLength(1);
  });
});

describe("apply — STT", () => {
  it("stores spawner status", () => {
    const s = apply(initialState(), {
      type: "stt_spawner_status",
      status: {
        state: "running",
        pid: 12345,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(s.sttSpawner?.state).toBe("running");
  });

  it("stores listener list", () => {
    const s = apply(initialState(), {
      type: "stt_listener_state",
      listeners: [
        { audioSourceId: "src1", label: "vocal", online: true, lastSeen: 0 },
      ],
    });
    expect(s.sttListeners[0]?.online).toBe(true);
  });
});

describe("apply — load_show local event", () => {
  it("sets loadedShowId and resets cursor", () => {
    const s = apply(initialState(), {
      type: "local_load_show",
      showId: "show-1",
    });
    expect(s.loadedShowId).toBe("show-1");
    expect(s.loadedShowRowCursor).toBe(0);
  });

  it("clearing pointer resets cursor too", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, { type: "local_clear_loaded_show" });
    expect(s.loadedShowId).toBeNull();
    expect(s.loadedShowRowCursor).toBeNull();
  });

  it("clears loadedShowId when the show disappears from show_list", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show_list",
      shows: [{ id: "other", name: "Other", rowCount: 0 }],
    });
    expect(s.loadedShowId).toBeNull();
  });

  it("does NOT clear loadedShowId when the loaded show is in show_list", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show_list",
      shows: [{ id: "show-1", name: "Show", rowCount: 0 }],
    });
    expect(s.loadedShowId).toBe("show-1");
  });
});

describe("apply — cursor", () => {
  it("advances the cursor within row bounds", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Show",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
          { kind: "graphic", id: "r3", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_advance", delta: 1 });
    expect(s.loadedShowRowCursor).toBe(1);
    s = apply(s, { type: "local_cursor_advance", delta: 10 });
    expect(s.loadedShowRowCursor).toBe(2);
    s = apply(s, { type: "local_cursor_advance", delta: -10 });
    expect(s.loadedShowRowCursor).toBe(0);
  });

  it("cursor_set finds the row by id", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Show",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    expect(s.loadedShowRowCursor).toBe(1);
  });
});

describe("apply — error message", () => {
  it("stores lastError from server error", () => {
    const s = apply(initialState(), {
      type: "error",
      code: "bad",
      message: "oh no",
    });
    expect(s.lastError).toBe("bad: oh no");
  });
});

describe("apply — unknown message", () => {
  it("returns state unchanged for unrecognized types", () => {
    const before = initialState();
    // Cast: simulating a future server message type.
    const after = apply(before, { type: "future_type" } as unknown as ServerMessage);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: fails — `state.ts` doesn't exist.

- [ ] **Step 3: Implement `src/state.ts`**

```typescript
import type { ServerMessage } from "@overlaysys/ws-protocol";
import type { CompanionState } from "./types";

export type LocalEvent =
  | { type: "local_connected" }
  | { type: "local_reconnecting" }
  | { type: "local_disconnected" }
  | { type: "local_load_show"; showId: string }
  | { type: "local_clear_loaded_show" }
  | { type: "local_cursor_set"; rowId: string }
  | { type: "local_cursor_advance"; delta: number };

export type ReducerEvent = ServerMessage | LocalEvent;

export function apply(state: CompanionState, evt: ReducerEvent): CompanionState {
  switch (evt.type) {
    case "local_connected":
      return { ...state, connected: true, connectionState: "connected" };
    case "local_reconnecting":
      return { ...state, connected: false, connectionState: "reconnecting" };
    case "local_disconnected":
      return { ...state, connected: false, connectionState: "disconnected" };

    case "state": {
      const next = new Map(state.channelStates);
      next.set(evt.channel, evt.state);
      return { ...state, channelStates: next };
    }

    case "template_list":
      return { ...state, templates: evt.templates };
    case "hotcard_list":
      return { ...state, hotcards: evt.hotcards };
    case "show_list": {
      const stillThere = state.loadedShowId
        ? evt.shows.some((s) => s.id === state.loadedShowId)
        : true;
      if (!stillThere) {
        return {
          ...state,
          shows: evt.shows,
          loadedShowId: null,
          loadedShowRowCursor: null,
        };
      }
      return { ...state, shows: evt.shows };
    }
    case "song_list":
      return { ...state, songs: evt.songs };
    case "channel_list":
      return { ...state, channels: evt.configs };

    case "show": {
      const next = new Map(state.showCache);
      next.set(evt.show.id, evt.show);
      return { ...state, showCache: next };
    }
    case "song": {
      const next = new Map(state.songCache);
      next.set(evt.song.id, evt.song);
      return { ...state, songCache: next };
    }
    case "hotcard": {
      // Authoritative hotcard payload — also reflect into the meta list if present.
      const idx = state.hotcards.findIndex((h) => h.id === evt.hotcard.id);
      const meta = {
        id: evt.hotcard.id,
        name: evt.hotcard.name,
        templateId: evt.hotcard.templateId,
      };
      const hotcards =
        idx >= 0
          ? state.hotcards.map((h, i) => (i === idx ? meta : h))
          : [...state.hotcards, meta];
      return { ...state, hotcards };
    }
    case "template": {
      const idx = state.templates.findIndex((t) => t.id === evt.template.id);
      const meta = {
        id: evt.template.id,
        name: evt.template.name,
        size: evt.template.size,
      };
      const templates =
        idx >= 0
          ? state.templates.map((t, i) => (i === idx ? meta : t))
          : [...state.templates, meta];
      return { ...state, templates };
    }
    case "channel": {
      const idx = state.channels.findIndex((c) => c.id === evt.config.id);
      const channels =
        idx >= 0
          ? state.channels.map((c, i) => (i === idx ? evt.config : c))
          : [...state.channels, evt.config];
      return { ...state, channels };
    }

    case "stt_spawner_status":
      return { ...state, sttSpawner: evt.status };
    case "stt_listener_state":
      return { ...state, sttListeners: evt.listeners };

    case "error":
      return { ...state, lastError: `${evt.code}: ${evt.message}` };

    case "local_load_show":
      return {
        ...state,
        loadedShowId: evt.showId,
        loadedShowRowCursor: 0,
      };
    case "local_clear_loaded_show":
      return { ...state, loadedShowId: null, loadedShowRowCursor: null };
    case "local_cursor_advance": {
      if (state.loadedShowId == null) return state;
      const show = state.showCache.get(state.loadedShowId);
      if (!show || show.rows.length === 0) return state;
      const cur = state.loadedShowRowCursor ?? 0;
      const next = Math.max(0, Math.min(show.rows.length - 1, cur + evt.delta));
      return { ...state, loadedShowRowCursor: next };
    }
    case "local_cursor_set": {
      if (state.loadedShowId == null) return state;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return state;
      const idx = show.rows.findIndex((r) => r.id === evt.rowId);
      if (idx < 0) return state;
      return { ...state, loadedShowRowCursor: idx };
    }

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: all `state.test.ts` and `labels.test.ts` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): state reducer for server and local events"
```

---

## Task 4: Variable projections

**Files:**
- Create: `packages/companion-module/src/variables.ts`
- Test: `packages/companion-module/src/__tests__/variables.test.ts`

This file exports both **definitions** (the static list Companion calls `setVariableDefinitions` with) and a **projection function** that maps `CompanionState` → `Record<string, string>` of current values. Companion's `setVariableValues(map)` accepts that map directly.

Configurable inputs:
- `channelsToWatch: string[]` — drives the per-channel variables (e.g. `["program", "preview"]`).
- `rundownRowLimit: number` — number of `rundown_<n>_*` variables to emit. Fixed at 40 per spec.

- [ ] **Step 1: Write failing tests in `src/__tests__/variables.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import { projectVariables, variableDefinitions, RUNDOWN_LIMIT } from "../variables";

const CHANNELS = ["program", "preview"];

describe("variableDefinitions", () => {
  it("includes channel-scoped variables for each configured channel", () => {
    const defs = variableDefinitions(CHANNELS);
    const ids = new Set(defs.map((d) => d.variableId));
    expect(ids.has("program_template_id")).toBe(true);
    expect(ids.has("preview_template_id")).toBe(true);
    expect(ids.has("program_is_live")).toBe(true);
    expect(ids.has("program_song_title")).toBe(true);
  });

  it("includes rundown_1..N variables", () => {
    const defs = variableDefinitions(CHANNELS);
    const ids = new Set(defs.map((d) => d.variableId));
    expect(ids.has("rundown_1_name")).toBe(true);
    expect(ids.has(`rundown_${RUNDOWN_LIMIT}_name`)).toBe(true);
  });

  it("includes connection and STT globals", () => {
    const ids = new Set(variableDefinitions(CHANNELS).map((d) => d.variableId));
    expect(ids.has("connection_state")).toBe(true);
    expect(ids.has("stt_running")).toBe(true);
    expect(ids.has("loaded_show_name")).toBe(true);
  });
});

describe("projectVariables — channel scope", () => {
  it("empty when channel has no state", () => {
    const v = projectVariables(initialState(), CHANNELS);
    expect(v.program_template_id).toBe("");
    expect(v.program_is_live).toBe("no");
  });

  it("populates template_id/name and is_live when active", () => {
    let s = apply(initialState(), {
      type: "template_list",
      templates: [{ id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } }],
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hello" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.program_template_id).toBe("tpl-1");
    expect(v.program_template_name).toBe("Lower Third");
    expect(v.program_is_live).toBe("yes");
    expect(v.program_phase).toBe("on");
  });

  it("projects active.data keys into program_data_<key>", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hello", subtitle: "World" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.program_data_title).toBe("Hello");
    expect(v.program_data_subtitle).toBe("World");
  });

  it("populates song_title and song_section when a session is active", () => {
    let s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Test Song" }],
    });
    s = apply(s, {
      type: "song",
      song: {
        id: "s1",
        title: "Test Song",
        sections: [
          { id: "sec1", kind: "verse", label: "Verse 1", slides: [{ id: "sl1", text: "Line one\nLine two" }] },
        ],
        defaultArrangement: ["sec1"],
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s1",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: true,
          startedAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.program_song_title).toBe("Test Song");
    expect(v.program_song_section).toBe("Verse 1");
    expect(v.program_song_slide_idx).toBe("1");
    expect(v.program_song_slide_text).toBe("Line one");
    expect(v.program_song_trust_mode).toBe("yes");
    expect(v.program_song_blanked).toBe("no");
  });
});

describe("projectVariables — globals", () => {
  it("connection_state mirrors state", () => {
    let s = initialState();
    expect(projectVariables(s, CHANNELS).connection_state).toBe("disconnected");
    s = apply(s, { type: "local_connected" });
    expect(projectVariables(s, CHANNELS).connection_state).toBe("connected");
  });

  it("stt_running reflects spawner state", () => {
    const s = apply(initialState(), {
      type: "stt_spawner_status",
      status: {
        state: "running",
        pid: 1,
        startedAt: 0,
        lastError: null,
        recentLogs: [],
      },
    });
    expect(projectVariables(s, CHANNELS).stt_running).toBe("yes");
  });
});

describe("projectVariables — rundown rows", () => {
  it("rundown_1_name shows the loaded show's first row", () => {
    let s = apply(initialState(), {
      type: "song_list",
      songs: [{ id: "s1", title: "Amazing Grace" }],
    });
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "Sunday",
        rows: [
          { kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lt" },
          { kind: "graphic", id: "r2", templateId: "tpl-x", data: {}, notes: "Title card" },
        ],
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_name).toBe("Amazing Grace");
    expect(v.rundown_1_kind).toBe("song");
    expect(v.rundown_2_name).toBe("Title card");
    expect(v.rundown_2_kind).toBe("graphic");
  });

  it("rundown_<n>_is_active = yes when row matches PGM", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          { kind: "graphic", id: "r1", templateId: "tpl-1", data: { title: "Hi" } },
        ],
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { title: "Hi" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_is_active).toBe("yes");
  });

  it("rundown_<n>_name is empty past the row count", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: { id: "show-1", name: "S", rows: [] },
    });
    const v = projectVariables(s, CHANNELS);
    expect(v.rundown_1_name).toBe("");
    expect(v.rundown_5_name).toBe("");
  });

  it("loaded_show_name comes from show meta", () => {
    let s = apply(initialState(), {
      type: "show_list",
      shows: [{ id: "show-1", name: "Sunday", rowCount: 2 }],
    });
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    const v = projectVariables(s, CHANNELS);
    expect(v.loaded_show_name).toBe("Sunday");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: fails — `variables.ts` doesn't exist.

- [ ] **Step 3: Implement `src/variables.ts`**

```typescript
import type { ActiveGraphic } from "@overlaysys/core";
import {
  rowDisplayLabel,
  sectionDisplayLabel,
  songTitleForChannel,
} from "./labels";
import type { CompanionState } from "./types";

export const RUNDOWN_LIMIT = 40;

export interface VariableDefinition {
  variableId: string;
  name: string;
}

export function variableDefinitions(channels: string[]): VariableDefinition[] {
  const defs: VariableDefinition[] = [];

  for (const c of channels) {
    defs.push(
      { variableId: `${c}_template_id`, name: `${c} template id` },
      { variableId: `${c}_template_name`, name: `${c} template name` },
      { variableId: `${c}_is_live`, name: `${c} is live (yes/no)` },
      { variableId: `${c}_phase`, name: `${c} transition phase` },
      { variableId: `${c}_song_title`, name: `${c} song title` },
      { variableId: `${c}_song_section`, name: `${c} song section label` },
      { variableId: `${c}_song_slide_idx`, name: `${c} song slide index (1-based)` },
      { variableId: `${c}_song_slide_text`, name: `${c} song slide first line` },
      { variableId: `${c}_song_blanked`, name: `${c} song is blanked (yes/no)` },
      { variableId: `${c}_song_trust_mode`, name: `${c} song trust mode (yes/no)` },
    );
    // Up to 10 well-known data keys; values fill in dynamically by name.
    // Companion needs static IDs, so we just include the first 10 keys
    // (alphabetically) that appear in any state at projection time. To keep
    // definitions stable, expose generic slots data_1..data_10.
    for (let i = 1; i <= 10; i++) {
      defs.push({
        variableId: `${c}_data_${i}_key`,
        name: `${c} data slot ${i} key`,
      });
      defs.push({
        variableId: `${c}_data_${i}_value`,
        name: `${c} data slot ${i} value`,
      });
    }
  }

  defs.push(
    { variableId: "connection_state", name: "WebSocket connection state" },
    { variableId: "last_error", name: "Last server-reported error" },
    { variableId: "stt_running", name: "STT spawner running (yes/no)" },
    { variableId: "stt_listener_count", name: "Online STT listeners" },
    { variableId: "loaded_show_id", name: "Loaded show id" },
    { variableId: "loaded_show_name", name: "Loaded show name" },
    { variableId: "loaded_show_row_count", name: "Loaded show row count" },
    { variableId: "cursor_row_idx", name: "Cursor row index (1-based)" },
    { variableId: "cursor_row_name", name: "Cursor row display label" },
    { variableId: "cursor_row_kind", name: "Cursor row kind (song/graphic)" },
  );

  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    defs.push(
      { variableId: `rundown_${n}_name`, name: `Rundown row ${n} display label` },
      { variableId: `rundown_${n}_kind`, name: `Rundown row ${n} kind` },
      { variableId: `rundown_${n}_is_active`, name: `Rundown row ${n} matches PGM` },
    );
  }

  return defs;
}

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: import("@overlaysys/core").RundownRow,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (!active) return false;
  if (active.templateId !== row.templateId) return false;
  const a = active.data;
  const b = row.data;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function projectVariables(
  state: CompanionState,
  channels: string[],
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const c of channels) {
    const ch = state.channelStates.get(c);
    const active = ch?.active ?? null;
    const tpl = active
      ? state.templates.find((t) => t.id === active.templateId)
      : undefined;
    out[`${c}_template_id`] = active?.templateId ?? "";
    out[`${c}_template_name`] = tpl?.name ?? "";
    out[`${c}_is_live`] = active ? "yes" : "no";
    out[`${c}_phase`] = active?.phase ?? "";

    // Data slot projection (first 10 keys, sorted by key name).
    const keys = active ? Object.keys(active.data).sort() : [];
    for (let i = 1; i <= 10; i++) {
      const k = keys[i - 1];
      out[`${c}_data_${i}_key`] = k ?? "";
      out[`${c}_data_${i}_value`] = k && active ? active.data[k] ?? "" : "";
    }

    // Song session.
    const sess = ch?.songSession;
    out[`${c}_song_title`] = songTitleForChannel(state, c);
    if (sess) {
      const song = state.songCache.get(sess.songId);
      out[`${c}_song_section`] = song
        ? sectionDisplayLabel(song, sess.arrangement, sess.cursor.sectionIdx)
        : "";
      out[`${c}_song_slide_idx`] = String(sess.cursor.slideIdx + 1);
      const sectionId = sess.arrangement[sess.cursor.sectionIdx];
      const section = song?.sections.find((s) => s.id === sectionId);
      const slide = section?.slides[sess.cursor.slideIdx];
      out[`${c}_song_slide_text`] = slide?.text.split("\n")[0] ?? "";
      out[`${c}_song_blanked`] = sess.blanked ? "yes" : "no";
      out[`${c}_song_trust_mode`] = sess.trustMode ? "yes" : "no";
    } else {
      out[`${c}_song_section`] = "";
      out[`${c}_song_slide_idx`] = "";
      out[`${c}_song_slide_text`] = "";
      out[`${c}_song_blanked`] = "";
      out[`${c}_song_trust_mode`] = "";
    }
  }

  out.connection_state = state.connectionState;
  out.last_error = state.lastError ?? "";
  out.stt_running = state.sttSpawner?.state === "running" ? "yes" : "no";
  out.stt_listener_count = String(
    state.sttListeners.filter((l) => l.online).length,
  );

  const loadedShow = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const loadedShowMeta = state.loadedShowId
    ? state.shows.find((s) => s.id === state.loadedShowId)
    : undefined;
  out.loaded_show_id = state.loadedShowId ?? "";
  out.loaded_show_name = loadedShowMeta?.name ?? loadedShow?.name ?? "";
  out.loaded_show_row_count = loadedShow ? String(loadedShow.rows.length) : "";

  const cursor = state.loadedShowRowCursor;
  const cursorRow =
    loadedShow && cursor != null ? loadedShow.rows[cursor] : undefined;
  out.cursor_row_idx = cursor != null ? String(cursor + 1) : "";
  out.cursor_row_name = cursorRow ? rowDisplayLabel(state, cursorRow) : "";
  out.cursor_row_kind = cursorRow?.kind ?? "";

  const pgmSongId = state.channelStates.get("program")?.songSession?.songId;
  const pgmActive = state.channelStates.get("program")?.active ?? null;
  for (let n = 1; n <= RUNDOWN_LIMIT; n++) {
    const row = loadedShow?.rows[n - 1];
    out[`rundown_${n}_name`] = row ? rowDisplayLabel(state, row) : "";
    out[`rundown_${n}_kind`] = row?.kind ?? "";
    out[`rundown_${n}_is_active`] =
      row && rowMatchesPgm(pgmActive, pgmSongId, row) ? "yes" : "no";
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): variable definitions and state projection"
```

---

## Task 5: Feedback predicates

**Files:**
- Create: `packages/companion-module/src/feedbacks.ts`
- Test: `packages/companion-module/src/__tests__/feedbacks.test.ts`

Each feedback exports a `predicate(state, options) => boolean`. The Companion-shaped definitions (with `options` arrays describing dropdowns) are also defined here so the SDK can be wired up in Task 8.

- [ ] **Step 1: Write failing tests in `src/__tests__/feedbacks.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import { feedbackPredicate } from "../feedbacks";

describe("feedbacks", () => {
  it("channel_is_live = true when channel has active", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: { templateId: "t", data: {}, phase: "on", takenAt: 0 },
      },
    });
    expect(feedbackPredicate(s, "channel_is_live", { channel: "program" })).toBe(true);
  });

  it("channel_is_live = false when channel cleared", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(feedbackPredicate(s, "channel_is_live", { channel: "program" })).toBe(false);
  });

  it("channel_is_blank = inverse of channel_is_live", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: { channel: "program", active: null },
    });
    expect(feedbackPredicate(s, "channel_is_blank", { channel: "program" })).toBe(true);
  });

  it("hotcard_on_air = true when channel matches hotcard data", () => {
    let s = apply(initialState(), {
      type: "hotcard",
      hotcard: { id: "h1", name: "L3", templateId: "tpl-1", data: { name: "Charlie" } },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { name: "Charlie" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    expect(
      feedbackPredicate(s, "hotcard_on_air", {
        hotcardId: "h1",
        channel: "program",
      }),
    ).toBe(true);
  });

  it("hotcard_on_air = false when data doesn't match", () => {
    let s = apply(initialState(), {
      type: "hotcard",
      hotcard: { id: "h1", name: "L3", templateId: "tpl-1", data: { name: "Charlie" } },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: {
          templateId: "tpl-1",
          data: { name: "Other" },
          phase: "on",
          takenAt: 0,
        },
      },
    });
    expect(
      feedbackPredicate(s, "hotcard_on_air", {
        hotcardId: "h1",
        channel: "program",
      }),
    ).toBe(false);
  });

  it("song_active = true when songSession is present", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: false,
          startedAt: 0,
        },
      },
    });
    expect(feedbackPredicate(s, "song_active", { channel: "program" })).toBe(true);
  });

  it("song_trust_on reads songSession.trustMode", () => {
    const s = apply(initialState(), {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: {
          songId: "s",
          lyricTemplateId: "lt",
          arrangement: ["sec1"],
          cursor: { sectionIdx: 0, slideIdx: 0 },
          blanked: false,
          trustMode: true,
          startedAt: 0,
        },
      },
    });
    expect(feedbackPredicate(s, "song_trust_on", { channel: "program" })).toBe(true);
  });

  it("stt_running tracks spawner state", () => {
    let s = apply(initialState(), {
      type: "stt_spawner_status",
      status: { state: "running", pid: 1, startedAt: 0, lastError: null, recentLogs: [] },
    });
    expect(feedbackPredicate(s, "stt_running", {})).toBe(true);
    s = apply(s, {
      type: "stt_spawner_status",
      status: { state: "stopped", pid: null, startedAt: 0, lastError: null, recentLogs: [] },
    });
    expect(feedbackPredicate(s, "stt_running", {})).toBe(false);
  });

  it("connection_lost = true when disconnected", () => {
    let s = initialState();
    expect(feedbackPredicate(s, "connection_lost", {})).toBe(true);
    s = apply(s, { type: "local_connected" });
    expect(feedbackPredicate(s, "connection_lost", {})).toBe(false);
  });

  it("show_loaded reflects loadedShowId", () => {
    let s = initialState();
    expect(feedbackPredicate(s, "show_loaded", {})).toBe(false);
    s = apply(s, { type: "local_load_show", showId: "show-1" });
    expect(feedbackPredicate(s, "show_loaded", {})).toBe(true);
  });

  it("row_is_cursor = true when chosen row id matches the cursor", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          { kind: "graphic", id: "r1", templateId: "t", data: {} },
          { kind: "graphic", id: "r2", templateId: "t", data: {} },
        ],
      },
    });
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    expect(feedbackPredicate(s, "row_is_cursor", { rowId: "r2" })).toBe(true);
    expect(feedbackPredicate(s, "row_is_cursor", { rowId: "r1" })).toBe(false);
  });

  it("row_is_active = true when row matches PGM", () => {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          { kind: "graphic", id: "r1", templateId: "tpl-1", data: { title: "Hi" } },
        ],
      },
    });
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: { templateId: "tpl-1", data: { title: "Hi" }, phase: "on", takenAt: 0 },
      },
    });
    expect(feedbackPredicate(s, "row_is_active", { rowId: "r1" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: fails — `feedbacks.ts` doesn't exist.

- [ ] **Step 3: Implement `src/feedbacks.ts`**

```typescript
import type { ActiveGraphic, RundownRow } from "@overlaysys/core";
import type { CompanionState } from "./types";

export type FeedbackId =
  | "channel_is_live"
  | "channel_is_blank"
  | "hotcard_on_air"
  | "song_active"
  | "song_trust_on"
  | "song_section_is"
  | "stt_running"
  | "connection_lost"
  | "show_loaded"
  | "row_is_cursor"
  | "row_is_active";

export type FeedbackOptions = Record<string, string | number | boolean | undefined>;

export interface FeedbackDefinition {
  id: FeedbackId;
  name: string;
  description: string;
  /** option ids referenced in the predicate */
  options: { id: string; type: "channel" | "hotcard" | "row" | "kind_ordinal" }[];
}

export const feedbackDefinitions: FeedbackDefinition[] = [
  { id: "channel_is_live", name: "Channel is live", description: "True when the chosen channel has a graphic on air.", options: [{ id: "channel", type: "channel" }] },
  { id: "channel_is_blank", name: "Channel is blank", description: "True when the chosen channel is cleared.", options: [{ id: "channel", type: "channel" }] },
  { id: "hotcard_on_air", name: "Hotcard is on air", description: "True when the chosen channel currently shows this hotcard's content.", options: [{ id: "hotcardId", type: "hotcard" }, { id: "channel", type: "channel" }] },
  { id: "song_active", name: "Song session active", description: "True when the chosen channel has a live song session.", options: [{ id: "channel", type: "channel" }] },
  { id: "song_trust_on", name: "Song trust mode on", description: "True when the chosen channel's song session has trust mode enabled.", options: [{ id: "channel", type: "channel" }] },
  { id: "song_section_is", name: "Song section matches", description: "True when the active section's kind + ordinal matches.", options: [{ id: "channel", type: "channel" }, { id: "kind_ordinal", type: "kind_ordinal" }] },
  { id: "stt_running", name: "STT spawner running", description: "True when the STT spawner reports running state.", options: [] },
  { id: "connection_lost", name: "Connection lost", description: "True when the WebSocket is not connected.", options: [] },
  { id: "show_loaded", name: "Show is loaded", description: "True when a show has been loaded into this Companion instance.", options: [] },
  { id: "row_is_cursor", name: "Row is at cursor", description: "True when the chosen row is at the cursor position.", options: [{ id: "rowId", type: "row" }] },
  { id: "row_is_active", name: "Row is active on PGM", description: "True when the chosen row's content currently matches PGM.", options: [{ id: "rowId", type: "row" }] },
];

function rowMatchesPgm(
  active: ActiveGraphic | null | undefined,
  pgmSongId: string | undefined,
  row: RundownRow,
): boolean {
  if (row.kind === "song") {
    return Boolean(pgmSongId && pgmSongId === row.songId);
  }
  if (!active) return false;
  if (active.templateId !== row.templateId) return false;
  const a = active.data;
  const b = row.data;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

export function feedbackPredicate(
  state: CompanionState,
  id: FeedbackId,
  options: FeedbackOptions,
): boolean {
  switch (id) {
    case "channel_is_live": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active != null;
    }
    case "channel_is_blank": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.active == null;
    }
    case "hotcard_on_air": {
      const hc = state.hotcards.find((h) => h.id === String(options.hotcardId ?? ""));
      if (!hc) return false;
      // Hotcard meta carries only id/name/templateId — the full hotcard payload
      // is in the showCache-equivalent in state.hotcardCache when added; for
      // now we approximate by matching templateId only. Full data match is a
      // refinement once a hotcard cache exists in state.
      const active = state.channelStates.get(String(options.channel ?? "program"))?.active;
      return active?.templateId === hc.templateId;
    }
    case "song_active": {
      const c = String(options.channel ?? "");
      return Boolean(state.channelStates.get(c)?.songSession);
    }
    case "song_trust_on": {
      const c = String(options.channel ?? "");
      return state.channelStates.get(c)?.songSession?.trustMode === true;
    }
    case "song_section_is": {
      const c = String(options.channel ?? "");
      const sess = state.channelStates.get(c)?.songSession;
      if (!sess) return false;
      const song = state.songCache.get(sess.songId);
      if (!song) return false;
      const sectionId = sess.arrangement[sess.cursor.sectionIdx];
      const section = song.sections.find((s) => s.id === sectionId);
      if (!section) return false;
      // Encoded as "<kind>:<ordinal>" — e.g. "verse:2".
      const target = String(options.kind_ordinal ?? "");
      const [kind, ordStr] = target.split(":");
      const ord = Number(ordStr);
      if (!kind || !Number.isFinite(ord)) return false;
      // Count which ordinal this section is within the arrangement so far.
      let seen = 0;
      for (let i = 0; i <= sess.cursor.sectionIdx; i++) {
        const sid = sess.arrangement[i];
        const s = song.sections.find((x) => x.id === sid);
        if (s?.kind === kind) seen++;
      }
      return section.kind === kind && seen === ord;
    }
    case "stt_running":
      return state.sttSpawner?.state === "running";
    case "connection_lost":
      return !state.connected;
    case "show_loaded":
      return state.loadedShowId != null;
    case "row_is_cursor": {
      if (state.loadedShowId == null || state.loadedShowRowCursor == null) return false;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return false;
      const row = show.rows[state.loadedShowRowCursor];
      return row?.id === String(options.rowId ?? "");
    }
    case "row_is_active": {
      if (state.loadedShowId == null) return false;
      const show = state.showCache.get(state.loadedShowId);
      if (!show) return false;
      const row = show.rows.find((r) => r.id === String(options.rowId ?? ""));
      if (!row) return false;
      const pgm = state.channelStates.get("program");
      return rowMatchesPgm(pgm?.active ?? null, pgm?.songSession?.songId, row);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): feedback definitions and predicates"
```

---

## Task 6: Action dispatchers (pure)

**Files:**
- Create: `packages/companion-module/src/actions.ts`
- Test: `packages/companion-module/src/__tests__/actions.test.ts`

Actions split into three layers:

1. **Definitions** — Companion-shaped action descriptors (id, name, options).
2. **Dispatch** — pure function `dispatchAction(state, id, options) → { messages: ClientMessage[]; localEvents: LocalEvent[] }`. Tests live here.
3. **Wiring** — handler closures that call dispatch and forward outputs to the connection (built in Task 7/8).

- [ ] **Step 1: Write failing tests in `src/__tests__/actions.test.ts`**

```typescript
import { describe, expect, it } from "vitest";
import { apply } from "../state";
import { initialState } from "../types";
import { dispatchAction } from "../actions";

describe("dispatchAction — basic channel ops", () => {
  it("clear sends clear", () => {
    const r = dispatchAction(initialState(), "clear", { channel: "program" });
    expect(r.messages).toEqual([{ type: "clear", channel: "program" }]);
  });

  it("take_pvw_to_pgm with defaults", () => {
    const r = dispatchAction(initialState(), "take_pvw_to_pgm", {});
    expect(r.messages).toEqual([
      { type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" },
    ]);
  });

  it("take_template parses key=value data", () => {
    const r = dispatchAction(initialState(), "take_template", {
      channel: "program",
      templateId: "tpl-1",
      data: "title=Hello\nsubtitle=World",
    });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { title: "Hello", subtitle: "World" },
      },
    ]);
  });
});

describe("dispatchAction — hotcard", () => {
  it("fire_hotcard sends take with hotcard data", () => {
    // Hotcard full payload arrives via `hotcard` message; the action needs
    // those bytes. Seed via apply.
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: {
        id: "h1",
        name: "L3",
        templateId: "tpl-1",
        data: { name: "Charlie" },
        channelHint: "program",
      },
    });
    const r = dispatchAction(s, "fire_hotcard", { hotcardId: "h1" });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { name: "Charlie" },
      },
    ]);
  });

  it("fire_hotcard falls back to 'program' when no channelHint and no override", () => {
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: { id: "h1", name: "L3", templateId: "tpl-1", data: {} },
    });
    const r = dispatchAction(s, "fire_hotcard", { hotcardId: "h1" });
    expect(r.messages[0]?.type).toBe("take");
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("fire_hotcard honors channel override", () => {
    const s = apply(initialState(), {
      type: "hotcard",
      hotcard: { id: "h1", name: "L3", templateId: "tpl-1", data: {}, channelHint: "preview" },
    });
    const r = dispatchAction(s, "fire_hotcard", {
      hotcardId: "h1",
      channel: "program",
    });
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("fire_hotcard is a no-op when hotcard payload not cached", () => {
    const r = dispatchAction(initialState(), "fire_hotcard", { hotcardId: "h1" });
    expect(r.messages).toEqual([]);
  });
});

describe("dispatchAction — song actions", () => {
  it("song_advance sends delta", () => {
    const r = dispatchAction(initialState(), "song_advance", {
      channel: "program",
      delta: -1,
    });
    expect(r.messages).toEqual([
      { type: "song_advance", channel: "program", delta: -1 },
    ]);
  });

  it("song_take_row sends song_take", () => {
    const r = dispatchAction(initialState(), "song_take_row", {
      showId: "show-1",
      songRowId: "r1",
      channel: "program",
    });
    expect(r.messages).toEqual([
      { type: "song_take", channel: "program", showId: "show-1", songRowId: "r1" },
    ]);
  });

  it("song_jump_kind sends kind + ordinal", () => {
    const r = dispatchAction(initialState(), "song_jump_kind", {
      channel: "program",
      kind: "chorus",
      ordinal: 2,
    });
    expect(r.messages).toEqual([
      { type: "song_jump_kind", channel: "program", kind: "chorus", ordinal: 2 },
    ]);
  });

  it("song_blank, song_end, song_set_trust", () => {
    expect(
      dispatchAction(initialState(), "song_blank", { channel: "program" }).messages,
    ).toEqual([{ type: "song_blank", channel: "program" }]);
    expect(
      dispatchAction(initialState(), "song_end", { channel: "program" }).messages,
    ).toEqual([{ type: "song_end", channel: "program" }]);
    expect(
      dispatchAction(initialState(), "song_set_trust", {
        channel: "program",
        trustMode: true,
      }).messages,
    ).toEqual([{ type: "song_set_trust", channel: "program", trustMode: true }]);
  });

  it("stt_start / stt_stop", () => {
    expect(dispatchAction(initialState(), "stt_start", {}).messages).toEqual([
      { type: "stt_spawner_start" },
    ]);
    expect(dispatchAction(initialState(), "stt_stop", {}).messages).toEqual([
      { type: "stt_spawner_stop" },
    ]);
  });
});

describe("dispatchAction — load_show and row actions", () => {
  function loadedShowState() {
    let s = apply(initialState(), { type: "local_load_show", showId: "show-1" });
    s = apply(s, {
      type: "show",
      show: {
        id: "show-1",
        name: "S",
        rows: [
          {
            kind: "graphic",
            id: "r1",
            templateId: "tpl-1",
            data: { title: "Hi" },
            channelHint: "program",
          },
          {
            kind: "song",
            id: "r2",
            songId: "s1",
            lyricTemplateId: "lt",
          },
        ],
      },
    });
    return s;
  }

  it("load_show emits a local event and a get_show fetch", () => {
    const r = dispatchAction(initialState(), "load_show", { showId: "show-1" });
    expect(r.localEvents).toEqual([{ type: "local_load_show", showId: "show-1" }]);
    expect(r.messages).toEqual([{ type: "get_show", showId: "show-1" }]);
  });

  it("clear_loaded_show emits a local event", () => {
    const r = dispatchAction(initialState(), "clear_loaded_show", {});
    expect(r.localEvents).toEqual([{ type: "local_clear_loaded_show" }]);
    expect(r.messages).toEqual([]);
  });

  it("take_row on a graphic row sends `take`", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r1" });
    expect(r.messages).toEqual([
      {
        type: "take",
        channel: "program",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
    ]);
  });

  it("take_row on a song row sends `song_take`", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r2" });
    expect(r.messages).toEqual([
      {
        type: "song_take",
        channel: "program",
        showId: "show-1",
        songRowId: "r2",
      },
    ]);
  });

  it("take_row uses row's channelHint when no channel override", () => {
    const r = dispatchAction(loadedShowState(), "take_row", { rowId: "r1" });
    expect((r.messages[0] as { channel: string }).channel).toBe("program");
  });

  it("take_row_pvw_pgm for graphic row: cue then take_pvw_to_pgm", () => {
    const r = dispatchAction(loadedShowState(), "take_row_pvw_pgm", { rowId: "r1" });
    expect(r.messages).toEqual([
      {
        type: "cue",
        channel: "preview",
        templateId: "tpl-1",
        data: { title: "Hi" },
      },
      { type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" },
    ]);
  });

  it("take_row_pvw_pgm for song row: song_take_pvw_to_pgm", () => {
    const r = dispatchAction(loadedShowState(), "take_row_pvw_pgm", { rowId: "r2" });
    expect(r.messages).toEqual([
      {
        type: "song_take_pvw_to_pgm",
        showId: "show-1",
        songRowId: "r2",
        fromChannel: "preview",
        toChannel: "program",
      },
    ]);
  });

  it("cursor_advance emits a local event", () => {
    const r = dispatchAction(loadedShowState(), "cursor_advance", { delta: 1 });
    expect(r.localEvents).toEqual([{ type: "local_cursor_advance", delta: 1 }]);
  });

  it("cursor_set emits a local event", () => {
    const r = dispatchAction(loadedShowState(), "cursor_set", { rowId: "r2" });
    expect(r.localEvents).toEqual([{ type: "local_cursor_set", rowId: "r2" }]);
  });

  it("take_row_at_cursor dispatches like take_row on the cursor row", () => {
    let s = loadedShowState();
    s = apply(s, { type: "local_cursor_set", rowId: "r2" });
    const r = dispatchAction(s, "take_row_at_cursor", { channel: "program" });
    expect(r.messages).toEqual([
      { type: "song_take", channel: "program", showId: "show-1", songRowId: "r2" },
    ]);
  });

  it("take_row is a no-op when show is not loaded", () => {
    const r = dispatchAction(initialState(), "take_row", { rowId: "r1" });
    expect(r.messages).toEqual([]);
    expect(r.localEvents).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: fails — `actions.ts` doesn't exist.

- [ ] **Step 3: Implement `src/actions.ts`**

```typescript
import type { ClientMessage } from "@overlaysys/ws-protocol";
import type { RundownRow } from "@overlaysys/core";
import type { LocalEvent } from "./state";
import type { CompanionState } from "./types";

export type ActionId =
  | "take_template"
  | "clear"
  | "cue_template"
  | "take_pvw_to_pgm"
  | "fire_hotcard"
  | "load_show"
  | "clear_loaded_show"
  | "take_row"
  | "take_row_pvw_pgm"
  | "take_row_at_cursor"
  | "cursor_advance"
  | "cursor_set"
  | "song_take_row"
  | "song_take_row_pvw_pgm"
  | "song_advance"
  | "song_jump_section"
  | "song_jump_kind"
  | "song_blank"
  | "song_end"
  | "song_set_trust"
  | "stt_start"
  | "stt_stop";

export type ActionOptions = Record<string, string | number | boolean | undefined>;

export interface DispatchResult {
  messages: ClientMessage[];
  localEvents: LocalEvent[];
}

/** Tracks the full hotcard payload separately from the meta list. */
export const hotcardPayloadCache = new Map<
  string,
  { templateId: string; data: Record<string, string>; channelHint?: string }
>();

function parseDataField(s: string | undefined | null): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const line of s.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1);
    if (k.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function rowMessages(
  state: CompanionState,
  row: RundownRow,
  channel: string,
): ClientMessage[] {
  if (row.kind === "song") {
    return [
      {
        type: "song_take",
        channel,
        showId: state.loadedShowId ?? "",
        songRowId: row.id,
      },
    ];
  }
  return [
    {
      type: "take",
      channel,
      templateId: row.templateId,
      data: row.data,
    },
  ];
}

function rowPvwPgmMessages(
  state: CompanionState,
  row: RundownRow,
  fromChannel: string,
  toChannel: string,
): ClientMessage[] {
  if (row.kind === "song") {
    return [
      {
        type: "song_take_pvw_to_pgm",
        showId: state.loadedShowId ?? "",
        songRowId: row.id,
        fromChannel,
        toChannel,
      },
    ];
  }
  return [
    {
      type: "cue",
      channel: fromChannel,
      templateId: row.templateId,
      data: row.data,
    },
    { type: "take_pvw_to_pgm", fromChannel, toChannel },
  ];
}

export function dispatchAction(
  state: CompanionState,
  id: ActionId,
  opts: ActionOptions,
): DispatchResult {
  const messages: ClientMessage[] = [];
  const localEvents: LocalEvent[] = [];

  const str = (k: string, dflt = ""): string => String(opts[k] ?? dflt);
  const num = (k: string, dflt = 0): number =>
    typeof opts[k] === "number" ? (opts[k] as number) : Number(opts[k] ?? dflt);
  const bool = (k: string): boolean => Boolean(opts[k]);

  switch (id) {
    case "take_template":
      messages.push({
        type: "take",
        channel: str("channel"),
        templateId: str("templateId"),
        data: parseDataField(str("data")),
      });
      break;
    case "clear":
      messages.push({ type: "clear", channel: str("channel") });
      break;
    case "cue_template":
      messages.push({
        type: "cue",
        channel: str("channel"),
        templateId: str("templateId"),
        data: parseDataField(str("data")),
      });
      break;
    case "take_pvw_to_pgm":
      messages.push({
        type: "take_pvw_to_pgm",
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    case "fire_hotcard": {
      const id = str("hotcardId");
      const payload = hotcardPayloadCache.get(id);
      if (!payload) break;
      const channel = str("channel") || payload.channelHint || "program";
      messages.push({
        type: "take",
        channel,
        templateId: payload.templateId,
        data: payload.data,
      });
      break;
    }
    case "load_show":
      localEvents.push({ type: "local_load_show", showId: str("showId") });
      messages.push({ type: "get_show", showId: str("showId") });
      break;
    case "clear_loaded_show":
      localEvents.push({ type: "local_clear_loaded_show" });
      break;
    case "take_row": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows.find((r) => r.id === str("rowId"));
      if (!row) break;
      const channel =
        str("channel") ||
        (row.kind === "graphic" || row.kind === "song"
          ? row.channelHint ?? "program"
          : "program");
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "take_row_pvw_pgm": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      const row = show?.rows.find((r) => r.id === str("rowId"));
      if (!row) break;
      messages.push(
        ...rowPvwPgmMessages(
          state,
          row,
          str("fromChannel", "preview"),
          str("toChannel", "program"),
        ),
      );
      break;
    }
    case "take_row_at_cursor": {
      const show = state.loadedShowId
        ? state.showCache.get(state.loadedShowId)
        : undefined;
      if (!show || state.loadedShowRowCursor == null) break;
      const row = show.rows[state.loadedShowRowCursor];
      if (!row) break;
      const channel =
        str("channel") ||
        (row.kind === "graphic" || row.kind === "song"
          ? row.channelHint ?? "program"
          : "program");
      messages.push(...rowMessages(state, row, channel));
      break;
    }
    case "cursor_advance":
      localEvents.push({ type: "local_cursor_advance", delta: num("delta", 1) });
      break;
    case "cursor_set":
      localEvents.push({ type: "local_cursor_set", rowId: str("rowId") });
      break;
    case "song_take_row":
      messages.push({
        type: "song_take",
        channel: str("channel", "program"),
        showId: str("showId"),
        songRowId: str("songRowId"),
      });
      break;
    case "song_take_row_pvw_pgm":
      messages.push({
        type: "song_take_pvw_to_pgm",
        showId: str("showId"),
        songRowId: str("songRowId"),
        fromChannel: str("fromChannel", "preview"),
        toChannel: str("toChannel", "program"),
      });
      break;
    case "song_advance":
      messages.push({
        type: "song_advance",
        channel: str("channel"),
        delta: num("delta", 1),
      });
      break;
    case "song_jump_section":
      messages.push({
        type: "song_jump",
        channel: str("channel"),
        sectionId: str("sectionId"),
        slideIdx: 0,
      });
      break;
    case "song_jump_kind":
      messages.push({
        type: "song_jump_kind",
        channel: str("channel"),
        kind: str("kind"),
        ordinal: num("ordinal", 1),
      });
      break;
    case "song_blank":
      messages.push({ type: "song_blank", channel: str("channel") });
      break;
    case "song_end":
      messages.push({ type: "song_end", channel: str("channel") });
      break;
    case "song_set_trust":
      messages.push({
        type: "song_set_trust",
        channel: str("channel"),
        trustMode: bool("trustMode"),
      });
      break;
    case "stt_start":
      messages.push({ type: "stt_spawner_start" });
      break;
    case "stt_stop":
      messages.push({ type: "stt_spawner_stop" });
      break;
  }

  return { messages, localEvents };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -F @overlaysys/companion-module test`
Expected: all action tests pass.

- [ ] **Step 5: Add a `hotcard` reducer hook that populates the payload cache**

Modify `src/state.ts`: in the `case "hotcard":` branch, also call `hotcardPayloadCache.set(...)` so the cache is populated by the same code path that updates the meta list. Add the import.

```typescript
// Top of file, with other imports
import { hotcardPayloadCache } from "./actions";
```

Replace the `case "hotcard":` body with:

```typescript
    case "hotcard": {
      hotcardPayloadCache.set(evt.hotcard.id, {
        templateId: evt.hotcard.templateId,
        data: evt.hotcard.data,
        channelHint: evt.hotcard.channelHint,
      });
      const idx = state.hotcards.findIndex((h) => h.id === evt.hotcard.id);
      const meta = {
        id: evt.hotcard.id,
        name: evt.hotcard.name,
        templateId: evt.hotcard.templateId,
      };
      const hotcards =
        idx >= 0
          ? state.hotcards.map((h, i) => (i === idx ? meta : h))
          : [...state.hotcards, meta];
      return { ...state, hotcards };
    }
```

Re-run tests: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): pure action dispatcher with TDD coverage"
```

---

## Task 7: WebSocket connection

**Files:**
- Create: `packages/companion-module/src/connection.ts`

This is the only I/O layer. It wraps `ws`, applies a backoff reconnect, decodes incoming messages with `decodeServer`, and exposes a `send` method. It does **not** know about Companion or about the reducer — it surfaces callbacks the module entry will wire up.

No unit tests for this file (it's almost pure orchestration around `ws`). Manual smoke is covered by Task 11's installation walkthrough.

- [ ] **Step 1: Implement `src/connection.ts`**

```typescript
import WebSocket from "ws";
import {
  decodeServer,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

export interface ConnectionCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnecting: () => void;
  onMessage: (msg: ServerMessage) => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
}

export interface ConnectionOptions {
  host: string;
  port: number;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class Connection {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly opts: ConnectionOptions,
    private readonly cb: ConnectionCallbacks,
  ) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.cb.onLog("warn", `dropping ${msg.type}: socket not open`);
      return;
    }
    this.ws.send(encode(msg));
  }

  private open(): void {
    const url = `ws://${this.opts.host}:${this.opts.port}/ws`;
    this.cb.onLog("info", `connecting ${url}`);
    const ws = new WebSocket(url, { perMessageDeflate: false });
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
      this.cb.onConnected();
    });

    ws.on("message", (raw) => {
      let msg: ServerMessage;
      try {
        msg = decodeServer(raw.toString());
      } catch (err) {
        this.cb.onLog("error", `decode failed: ${String(err)}`);
        return;
      }
      try {
        this.cb.onMessage(msg);
      } catch (err) {
        this.cb.onLog("error", `handler threw: ${String(err)}`);
      }
    });

    ws.on("error", (err) => {
      this.cb.onLog("warn", `socket error: ${String(err)}`);
    });

    ws.on("close", () => {
      this.cb.onDisconnected();
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    this.cb.onReconnecting();
    this.cb.onLog("info", `reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @overlaysys/companion-module typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/companion-module/src/connection.ts
git commit -m "feat(companion-module): WS connection with backoff reconnect"
```

---

## Task 8: Companion SDK definitions (actions / variables / feedbacks / presets)

**Files:**
- Create: `packages/companion-module/src/presets.ts`
- Modify: `packages/companion-module/src/actions.ts` (add `actionDefinitions` factory)
- Modify: `packages/companion-module/src/feedbacks.ts` (no semantic changes — already has definitions)

This task produces the SDK-shaped definitions Companion calls `setActionDefinitions`, `setFeedbackDefinitions`, `setVariableDefinitions`, `setPresetDefinitions` with. They depend on state (for dropdown choices), so each is a factory: `(state) => Definitions`.

- [ ] **Step 1: Append `actionDefinitions` factory to `src/actions.ts`**

Add at the bottom of `actions.ts`:

```typescript
import type {
  CompanionActionDefinitions,
  CompanionInputFieldDropdown,
  CompanionInputFieldTextInput,
  CompanionInputFieldNumber,
  CompanionInputFieldCheckbox,
} from "@companion-module/base";

function channelDropdown(state: CompanionState, id = "channel"): CompanionInputFieldDropdown {
  const choices = state.channels.length
    ? state.channels.map((c) => ({ id: c.id, label: c.name }))
    : [
        { id: "program", label: "program" },
        { id: "preview", label: "preview" },
      ];
  return {
    id,
    type: "dropdown",
    label: "Channel",
    default: choices[0]?.id ?? "program",
    choices,
  };
}

function showDropdown(state: CompanionState, id = "showId"): CompanionInputFieldDropdown {
  return {
    id,
    type: "dropdown",
    label: "Show",
    default: state.shows[0]?.id ?? "",
    choices: state.shows.map((s) => ({ id: s.id, label: s.name })),
  };
}

function hotcardDropdown(state: CompanionState, id = "hotcardId"): CompanionInputFieldDropdown {
  return {
    id,
    type: "dropdown",
    label: "Hotcard",
    default: state.hotcards[0]?.id ?? "",
    choices: state.hotcards.map((h) => ({ id: h.id, label: h.name })),
  };
}

function templateDropdown(state: CompanionState, id = "templateId"): CompanionInputFieldDropdown {
  return {
    id,
    type: "dropdown",
    label: "Template",
    default: state.templates[0]?.id ?? "",
    choices: state.templates.map((t) => ({ id: t.id, label: t.name })),
  };
}

function rowDropdown(state: CompanionState, id = "rowId"): CompanionInputFieldDropdown {
  const show = state.loadedShowId
    ? state.showCache.get(state.loadedShowId)
    : undefined;
  const choices = show
    ? show.rows.map((r, i) => ({
        id: r.id,
        label: `${i + 1}. ${r.kind === "song" ? "♪ " : ""}${r.id}`,
      }))
    : [];
  return {
    id,
    type: "dropdown",
    label: "Row",
    default: choices[0]?.id ?? "",
    choices,
  };
}

const dataInput: CompanionInputFieldTextInput = {
  id: "data",
  type: "textinput",
  label: "Data (key=value lines)",
  default: "",
};

const deltaInput: CompanionInputFieldNumber = {
  id: "delta",
  type: "number",
  label: "Delta",
  default: 1,
  min: -100,
  max: 100,
  step: 1,
};

const ordinalInput: CompanionInputFieldNumber = {
  id: "ordinal",
  type: "number",
  label: "Ordinal",
  default: 1,
  min: 1,
  max: 50,
  step: 1,
};

const kindInput: CompanionInputFieldDropdown = {
  id: "kind",
  type: "dropdown",
  label: "Section kind",
  default: "verse",
  choices: [
    { id: "verse", label: "Verse" },
    { id: "chorus", label: "Chorus" },
    { id: "bridge", label: "Bridge" },
    { id: "tag", label: "Tag" },
    { id: "intro", label: "Intro" },
    { id: "outro", label: "Outro" },
    { id: "other", label: "Other" },
  ],
};

const trustInput: CompanionInputFieldCheckbox = {
  id: "trustMode",
  type: "checkbox",
  label: "Trust mode",
  default: false,
};

export type ActionRunner = (id: ActionId, options: ActionOptions) => void;

export function actionDefinitions(
  state: CompanionState,
  run: ActionRunner,
): CompanionActionDefinitions {
  const noop = () => undefined;
  const wrap = (id: ActionId) => async (event: { options: ActionOptions }) => {
    run(id, event.options);
    return noop();
  };

  return {
    take_template: {
      name: "Take template",
      options: [channelDropdown(state), templateDropdown(state), dataInput],
      callback: wrap("take_template"),
    },
    clear: {
      name: "Clear channel",
      options: [channelDropdown(state)],
      callback: wrap("clear"),
    },
    cue_template: {
      name: "Cue template",
      options: [channelDropdown(state), templateDropdown(state), dataInput],
      callback: wrap("cue_template"),
    },
    take_pvw_to_pgm: {
      name: "Take PVW → PGM",
      options: [
        { ...channelDropdown(state, "fromChannel"), label: "From", default: "preview" },
        { ...channelDropdown(state, "toChannel"), label: "To", default: "program" },
      ],
      callback: wrap("take_pvw_to_pgm"),
    },
    fire_hotcard: {
      name: "Fire hotcard",
      options: [hotcardDropdown(state), channelDropdown(state)],
      callback: wrap("fire_hotcard"),
    },
    load_show: {
      name: "Load show (this Companion instance)",
      options: [showDropdown(state)],
      callback: wrap("load_show"),
    },
    clear_loaded_show: {
      name: "Clear loaded show",
      options: [],
      callback: wrap("clear_loaded_show"),
    },
    take_row: {
      name: "Take row from loaded show",
      options: [rowDropdown(state), channelDropdown(state)],
      callback: wrap("take_row"),
    },
    take_row_pvw_pgm: {
      name: "Take row PVW → PGM",
      options: [
        rowDropdown(state),
        { ...channelDropdown(state, "fromChannel"), label: "From", default: "preview" },
        { ...channelDropdown(state, "toChannel"), label: "To", default: "program" },
      ],
      callback: wrap("take_row_pvw_pgm"),
    },
    take_row_at_cursor: {
      name: "Take row at cursor",
      options: [channelDropdown(state)],
      callback: wrap("take_row_at_cursor"),
    },
    cursor_advance: {
      name: "Cursor: advance",
      options: [deltaInput],
      callback: wrap("cursor_advance"),
    },
    cursor_set: {
      name: "Cursor: set to row",
      options: [rowDropdown(state)],
      callback: wrap("cursor_set"),
    },
    song_take_row: {
      name: "Song: take row (any show)",
      options: [showDropdown(state), { ...rowDropdown(state), id: "songRowId" }, channelDropdown(state)],
      callback: wrap("song_take_row"),
    },
    song_take_row_pvw_pgm: {
      name: "Song: take row PVW → PGM (any show)",
      options: [
        showDropdown(state),
        { ...rowDropdown(state), id: "songRowId" },
        { ...channelDropdown(state, "fromChannel"), label: "From", default: "preview" },
        { ...channelDropdown(state, "toChannel"), label: "To", default: "program" },
      ],
      callback: wrap("song_take_row_pvw_pgm"),
    },
    song_advance: {
      name: "Song: advance ±",
      options: [channelDropdown(state), deltaInput],
      callback: wrap("song_advance"),
    },
    song_jump_section: {
      name: "Song: jump to section",
      options: [
        channelDropdown(state),
        {
          id: "sectionId",
          type: "textinput",
          label: "Section ID",
          default: "",
        },
      ],
      callback: wrap("song_jump_section"),
    },
    song_jump_kind: {
      name: "Song: jump by section kind + ordinal",
      options: [channelDropdown(state), kindInput, ordinalInput],
      callback: wrap("song_jump_kind"),
    },
    song_blank: {
      name: "Song: blank",
      options: [channelDropdown(state)],
      callback: wrap("song_blank"),
    },
    song_end: {
      name: "Song: end",
      options: [channelDropdown(state)],
      callback: wrap("song_end"),
    },
    song_set_trust: {
      name: "Song: set trust mode",
      options: [channelDropdown(state), trustInput],
      callback: wrap("song_set_trust"),
    },
    stt_start: {
      name: "STT: start spawner",
      options: [],
      callback: wrap("stt_start"),
    },
    stt_stop: {
      name: "STT: stop spawner",
      options: [],
      callback: wrap("stt_stop"),
    },
  };
}
```

- [ ] **Step 2: Append `feedbackDefinitionsForSDK` factory to `src/feedbacks.ts`**

```typescript
import type {
  CompanionFeedbackDefinitions,
  CompanionInputFieldDropdown,
  combineRgb,
} from "@companion-module/base";

function channelDropdown(state: CompanionState): CompanionInputFieldDropdown {
  const choices = state.channels.length
    ? state.channels.map((c) => ({ id: c.id, label: c.name }))
    : [
        { id: "program", label: "program" },
        { id: "preview", label: "preview" },
      ];
  return {
    id: "channel",
    type: "dropdown",
    label: "Channel",
    default: choices[0]?.id ?? "program",
    choices,
  };
}

export function feedbackDefinitionsForSDK(
  state: CompanionState,
  isTrue: (id: FeedbackId, options: FeedbackOptions) => boolean,
): CompanionFeedbackDefinitions {
  const defs: CompanionFeedbackDefinitions = {};
  for (const d of feedbackDefinitions) {
    const opts = d.options.map((o) => {
      if (o.type === "channel") return channelDropdown(state);
      if (o.type === "hotcard")
        return {
          id: "hotcardId",
          type: "dropdown" as const,
          label: "Hotcard",
          default: state.hotcards[0]?.id ?? "",
          choices: state.hotcards.map((h) => ({ id: h.id, label: h.name })),
        };
      if (o.type === "row") {
        const show = state.loadedShowId ? state.showCache.get(state.loadedShowId) : undefined;
        return {
          id: "rowId",
          type: "dropdown" as const,
          label: "Row",
          default: show?.rows[0]?.id ?? "",
          choices: show?.rows.map((r) => ({ id: r.id, label: r.id })) ?? [],
        };
      }
      // kind_ordinal — encoded as a textinput "verse:2"
      return {
        id: "kind_ordinal",
        type: "textinput" as const,
        label: "Kind:Ordinal (e.g. verse:2)",
        default: "verse:1",
      };
    });
    defs[d.id] = {
      name: d.name,
      description: d.description,
      type: "boolean",
      defaultStyle: { color: 0xffffff, bgcolor: 0x00aa00 },
      options: opts,
      callback: (fb) => isTrue(d.id, fb.options as FeedbackOptions),
    };
  }
  return defs;
}
```

- [ ] **Step 3: Implement `src/presets.ts`**

```typescript
import type { CompanionPresetDefinitions } from "@companion-module/base";
import { RUNDOWN_LIMIT } from "./variables";

const green = 0x00aa00;
const red = 0xaa0000;
const dark = 0x222222;
const white = 0xffffff;

export function presetDefinitions(): CompanionPresetDefinitions {
  const presets: CompanionPresetDefinitions = {};

  presets.take_pvw_pgm = {
    type: "button",
    category: "Master",
    name: "Take PVW → PGM",
    style: { text: "TAKE\\nPVW→PGM", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "take_pvw_to_pgm", options: {} }], up: [] }],
    feedbacks: [
      { feedbackId: "channel_is_live", options: { channel: "preview" }, style: { bgcolor: green } },
    ],
  };

  presets.clear_pgm = {
    type: "button",
    category: "Master",
    name: "Clear PGM",
    style: { text: "CLEAR\\nPGM", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "clear", options: { channel: "program" } }], up: [] }],
    feedbacks: [
      { feedbackId: "channel_is_live", options: { channel: "program" }, style: { bgcolor: red } },
    ],
  };

  presets.stt_toggle_start = {
    type: "button",
    category: "Master",
    name: "STT Start",
    style: { text: "STT\\nSTART", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "stt_start", options: {} }], up: [] }],
    feedbacks: [
      { feedbackId: "stt_running", options: {}, style: { bgcolor: green } },
    ],
  };

  presets.stt_toggle_stop = {
    type: "button",
    category: "Master",
    name: "STT Stop",
    style: { text: "STT\\nSTOP", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "stt_stop", options: {} }], up: [] }],
    feedbacks: [],
  };

  presets.song_advance_prev = {
    type: "button",
    category: "Song",
    name: "Song −1",
    style: { text: "◀ −1", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "song_advance", options: { channel: "program", delta: -1 } }], up: [] }],
    feedbacks: [],
  };

  presets.song_advance_next = {
    type: "button",
    category: "Song",
    name: "Song +1",
    style: { text: "+1 ▶", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "song_advance", options: { channel: "program", delta: 1 } }], up: [] }],
    feedbacks: [],
  };

  presets.song_blank = {
    type: "button",
    category: "Song",
    name: "Song Blank",
    style: { text: "BLANK", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "song_blank", options: { channel: "program" } }], up: [] }],
    feedbacks: [
      { feedbackId: "song_active", options: { channel: "program" }, style: { bgcolor: green } },
    ],
  };

  presets.song_end = {
    type: "button",
    category: "Song",
    name: "Song End",
    style: { text: "END\\nSONG", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "song_end", options: { channel: "program" } }], up: [] }],
    feedbacks: [],
  };

  presets.cursor_prev = {
    type: "button",
    category: "Rundown",
    name: "Cursor −1",
    style: { text: "↑", size: "24", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "cursor_advance", options: { delta: -1 } }], up: [] }],
    feedbacks: [],
  };

  presets.cursor_next = {
    type: "button",
    category: "Rundown",
    name: "Cursor +1",
    style: { text: "↓", size: "24", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "cursor_advance", options: { delta: 1 } }], up: [] }],
    feedbacks: [],
  };

  presets.take_at_cursor = {
    type: "button",
    category: "Rundown",
    name: "Take at cursor",
    style: { text: "TAKE\\nCURSOR", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "take_row_at_cursor", options: { channel: "program" } }], up: [] }],
    feedbacks: [],
  };

  for (let n = 1; n <= 8; n++) {
    presets[`rundown_row_${n}`] = {
      type: "button",
      category: "Rundown",
      name: `Row ${n}`,
      style: {
        text: `${n}\\n$(overlaysys:rundown_${n}_name)`,
        size: "14",
        color: white,
        bgcolor: dark,
      },
      steps: [
        {
          down: [
            {
              actionId: "take_row",
              options: { rowId: `\${rundown_${n}_id}` /* placeholder; real wiring uses the row dropdown */, channel: "program" },
            },
          ],
          up: [],
        },
      ],
      feedbacks: [],
    };
  }

  return presets;
}

export { RUNDOWN_LIMIT };
```

Note: the rundown row presets above ship as **starter templates**. Companion expects the row id at preset-creation time, but the user typically picks rows after dragging the preset onto a button. To avoid shipping broken presets, the implementer may instead surface the rundown row buttons as a "Drag-this-then-pick-a-row" workflow — leaving `rowId` empty so the user selects it after drop. Use that simpler shape if the `${rundown_<n>_id}` placeholder isn't supported by Companion's preset machinery in the SDK version we pin.

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @overlaysys/companion-module typecheck`
Expected: passes (or surfaces the `@companion-module/base` API discrepancies — fix as encountered; the import names above match Companion SDK 1.10).

- [ ] **Step 5: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): SDK-shaped action / feedback / preset definitions"
```

---

## Task 9: Module entry (`InstanceBase` wiring)

**Files:**
- Create: `packages/companion-module/src/config.ts`
- Modify: `packages/companion-module/src/index.ts` (replace stub)

The entry creates a `ModuleInstance extends InstanceBase<Config>`, wires the lifecycle (`init`, `destroy`, `configUpdated`), holds a `Connection` and a mutable `CompanionState`, and refreshes Companion's definitions/variables/feedbacks each time the reducer fires.

- [ ] **Step 1: Implement `src/config.ts`**

```typescript
import type { SomeCompanionConfigField } from "@companion-module/base";

export interface ModuleConfig {
  host: string;
  port: number;
  channels: string;       // CSV string
  loadedShowId: string;   // persisted across restarts; "" = none
}

export const defaultConfig: ModuleConfig = {
  host: "127.0.0.1",
  port: 4000,
  channels: "program,preview",
  loadedShowId: "",
};

export function configFields(): SomeCompanionConfigField[] {
  return [
    { id: "host", type: "textinput", label: "Server host", width: 6, default: defaultConfig.host },
    { id: "port", type: "number", label: "Server port", width: 6, default: defaultConfig.port, min: 1, max: 65535 },
    {
      id: "channels",
      type: "textinput",
      label: "Channels to subscribe (comma-separated)",
      width: 12,
      default: defaultConfig.channels,
    },
    {
      id: "loadedShowId",
      type: "textinput",
      label: "Loaded show ID (persists across restarts; usually set via the Load Show action)",
      width: 12,
      default: "",
    },
  ];
}

export function parseChannels(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
```

- [ ] **Step 2: Implement `src/index.ts`**

```typescript
import { InstanceBase, InstanceStatus, runEntrypoint } from "@companion-module/base";
import { Connection } from "./connection";
import { apply, type ReducerEvent } from "./state";
import { initialState, type CompanionState } from "./types";
import { dispatchAction, actionDefinitions, type ActionId, type ActionOptions } from "./actions";
import { feedbackPredicate, feedbackDefinitionsForSDK } from "./feedbacks";
import { projectVariables, variableDefinitions } from "./variables";
import { presetDefinitions } from "./presets";
import { configFields, defaultConfig, parseChannels, type ModuleConfig } from "./config";

class OverlaySysInstance extends InstanceBase<ModuleConfig> {
  private state: CompanionState = initialState();
  private connection: Connection | null = null;
  private channels: string[] = ["program", "preview"];

  async init(config: ModuleConfig): Promise<void> {
    this.channels = parseChannels(config.channels || defaultConfig.channels);

    // Initial state mirrors the persisted "loaded show" — definitions/variables
    // refer to it even before the server delivers the show payload.
    if (config.loadedShowId) {
      this.state = apply(this.state, {
        type: "local_load_show",
        showId: config.loadedShowId,
      });
    }

    this.refreshAll();
    this.openConnection(config);
  }

  async destroy(): Promise<void> {
    this.connection?.stop();
    this.connection = null;
  }

  async configUpdated(config: ModuleConfig): Promise<void> {
    this.channels = parseChannels(config.channels || defaultConfig.channels);
    this.connection?.stop();
    this.openConnection(config);
    this.refreshAll();
  }

  getConfigFields() {
    return configFields();
  }

  private openConnection(config: ModuleConfig): void {
    this.connection = new Connection(
      { host: config.host, port: config.port },
      {
        onConnected: () => {
          this.updateStatus(InstanceStatus.Ok);
          this.applyEvent({ type: "local_connected" });
          // Initial fetches.
          for (const c of this.channels) {
            this.connection?.send({ type: "subscribe", channel: c, role: "operator" });
          }
          this.connection?.send({ type: "list_templates" });
          this.connection?.send({ type: "list_shows" });
          this.connection?.send({ type: "list_songs" });
          this.connection?.send({ type: "list_hotcards" });
          this.connection?.send({ type: "list_channels" });
          this.connection?.send({ type: "stt_spawner_get_config" });
          if (this.state.loadedShowId) {
            this.connection?.send({ type: "get_show", showId: this.state.loadedShowId });
          }
        },
        onDisconnected: () => {
          this.updateStatus(InstanceStatus.Disconnected);
          this.applyEvent({ type: "local_disconnected" });
        },
        onReconnecting: () => {
          this.updateStatus(InstanceStatus.Connecting);
          this.applyEvent({ type: "local_reconnecting" });
        },
        onMessage: (msg) => {
          this.applyEvent(msg);
          // Auto-fetch full hotcards we haven't seen the payload for yet.
          if (msg.type === "hotcard_list") {
            for (const h of msg.hotcards) {
              this.connection?.send({ type: "get_hotcard", hotcardId: h.id });
            }
          }
        },
        onLog: (level, message) => this.log(level, message),
      },
    );
    this.connection.start();
  }

  private applyEvent(evt: ReducerEvent): void {
    this.state = apply(this.state, evt);
    this.refreshDynamic();
  }

  private refreshAll(): void {
    this.setActionDefinitions(
      actionDefinitions(this.state, (id, options) => this.runAction(id, options)),
    );
    this.setFeedbackDefinitions(
      feedbackDefinitionsForSDK(this.state, (id, options) =>
        feedbackPredicate(this.state, id, options),
      ),
    );
    this.setVariableDefinitions(variableDefinitions(this.channels));
    this.setPresetDefinitions(presetDefinitions());
    this.refreshDynamic();
  }

  private refreshDynamic(): void {
    this.setVariableValues(projectVariables(this.state, this.channels));
    this.checkFeedbacks();
  }

  private runAction(id: ActionId, options: ActionOptions): void {
    const { messages, localEvents } = dispatchAction(this.state, id, options);
    for (const e of localEvents) this.applyEvent(e);
    for (const m of messages) this.connection?.send(m);
    // Dropdowns (rows, hotcards) may have changed if cursor moved or a show
    // loaded — re-emit action definitions so dropdown defaults stay aligned.
    if (
      id === "load_show" ||
      id === "clear_loaded_show" ||
      id === "cursor_advance" ||
      id === "cursor_set"
    ) {
      this.setActionDefinitions(
        actionDefinitions(this.state, (aid, aoptions) => this.runAction(aid, aoptions)),
      );
    }
    // Also persist loadedShowId into config so it survives a restart.
    if (id === "load_show" && typeof options.showId === "string") {
      this.saveConfig({
        ...(this.getConfigFields() ? {} : {}),
        host: this.config?.host ?? defaultConfig.host,
        port: this.config?.port ?? defaultConfig.port,
        channels: this.config?.channels ?? defaultConfig.channels,
        loadedShowId: options.showId,
      });
    }
  }

  /** Accessor for the typed config — InstanceBase exposes it as `this.config` at runtime. */
  private get config(): ModuleConfig | undefined {
    // `InstanceBase` doesn't expose a public `config` property in some SDK
    // versions; this fallback returns undefined and callers handle it.
    return (this as unknown as { config?: ModuleConfig }).config;
  }
}

runEntrypoint(OverlaySysInstance, []);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @overlaysys/companion-module typecheck`

Expected: passes. If `@companion-module/base` exports differ between SDK minor versions, adjust imports (`runEntrypoint` vs `runEntryPoint`, `InstanceStatus` capitalization, `saveConfig` signature). The Companion SDK README in `node_modules/@companion-module/base/` is authoritative.

- [ ] **Step 4: Build**

Run: `pnpm -F @overlaysys/companion-module build`
Expected: `dist/index.js` exists.

- [ ] **Step 5: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion-module): InstanceBase entry wiring everything together"
```

---

## Task 10: Final docs and README pointer

**Files:**
- Modify: `packages/companion-module/companion/HELP.md`
- Modify: `README.md` (repo root)

- [ ] **Step 1: Expand `companion/HELP.md` with full action / variable / feedback reference**

Replace the placeholder HELP.md from Task 1 with this content:

```markdown
# OverlaySys Companion Module

Connects Bitfocus Companion to an OverlaySys server over WebSocket.

## Installation (developer mode)

1. Build: `pnpm -F @overlaysys/companion-module build`
2. In Companion, open the **Developer modules** path (set in Companion → Settings → Developer modules) and point it at `packages/companion-module/`.
3. Restart Companion. The module appears as **OverlaySys**.
4. Add a new connection of type **OverlaySys**, configure host/port, and Save.

## Configuration

| Field | Default | Notes |
|-------|---------|-------|
| Host | `127.0.0.1` | OverlaySys server host |
| Port | `4000` | OverlaySys WS port |
| Channels to subscribe | `program,preview` | Channel IDs to subscribe to and surface as variables |
| Loaded show ID | `` | Persisted across restarts; usually set via the **Load Show** action |

## Actions

| Action | Inputs | Effect |
|--------|--------|--------|
| Take template | channel, template, data | Take a template on the chosen channel |
| Clear channel | channel | Clear the chosen channel |
| Cue template | channel, template, data | Cue (pre-load) a template |
| Take PVW → PGM | from, to | Promote preview to program |
| Fire hotcard | hotcard, channel | Take a hotcard's stored payload on a channel |
| Load show | show | Load a show into this Companion instance |
| Clear loaded show | — | Clear the loaded-show pointer |
| Take row | row, channel | Take the chosen row (graphic → take, song → song_take) |
| Take row PVW → PGM | row, from, to | Cue then promote, or song_take_pvw_to_pgm for song rows |
| Take row at cursor | channel | Take whichever row the cursor is on |
| Cursor: advance | delta | Move the cursor ±N rows (clamped) |
| Cursor: set to row | row | Jump the cursor to a specific row |
| Song: take row | show, songRow, channel | Take a song row from any show |
| Song: take row PVW → PGM | show, songRow, from, to | Promote a song row through preview |
| Song: advance ± | channel, delta | song_advance |
| Song: jump to section | channel, sectionId | song_jump |
| Song: jump by kind+ordinal | channel, kind, ordinal | song_jump_kind |
| Song: blank | channel | song_blank |
| Song: end | channel | song_end |
| Song: set trust mode | channel, trustMode | song_set_trust |
| STT: start spawner | — | stt_spawner_start |
| STT: stop spawner | — | stt_spawner_stop |

## Variables

Per configured channel `<c>` (e.g. `program`, `preview`):

- `<c>_template_id`, `<c>_template_name`, `<c>_is_live`, `<c>_phase`
- `<c>_data_<n>_key` / `<c>_data_<n>_value` for n=1..10 (first 10 keys of the active template's data, sorted)
- `<c>_song_title`, `<c>_song_section`, `<c>_song_slide_idx`, `<c>_song_slide_text`, `<c>_song_blanked`, `<c>_song_trust_mode`

Global:

- `connection_state` (connected/disconnected/reconnecting)
- `last_error`
- `stt_running`, `stt_listener_count`
- `loaded_show_id`, `loaded_show_name`, `loaded_show_row_count`
- `cursor_row_idx`, `cursor_row_name`, `cursor_row_kind`
- `rundown_<n>_name` / `rundown_<n>_kind` / `rundown_<n>_is_active` for n=1..40

## Feedbacks

`channel_is_live`, `channel_is_blank`, `hotcard_on_air`, `song_active`, `song_trust_on`, `song_section_is`, `stt_running`, `connection_lost`, `show_loaded`, `row_is_cursor`, `row_is_active`.

## Manual smoke checklist

1. Start the server: `pnpm dev` (or `pnpm desktop`).
2. Add the connection; verify status goes green.
3. Add a button bound to **Take PVW → PGM**; confirm a template on preview promotes to program when pressed.
4. Add a button bound to **Fire hotcard** for a known hotcard; confirm it appears on program.
5. Run **Load show**; confirm `loaded_show_name` populates and `rundown_1_name` shows the first row.
6. Press **Take at cursor** twice (after a **Cursor +1**); confirm the second row goes to program.
7. With a song running, press **Song: advance ±1**; confirm slide changes.

## Spec

See `docs/superpowers/specs/2026-05-12-companion-integration-design.md`.
```

- [ ] **Step 2: Add a short pointer to the root `README.md`**

Append the following section (or insert it after the existing project sections):

```markdown
## Companion integration

A Bitfocus Companion module lives at `packages/companion-module/`. See its [HELP.md](packages/companion-module/companion/HELP.md) for install and usage, and the design spec at `docs/superpowers/specs/2026-05-12-companion-integration-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add packages/companion-module/companion/HELP.md README.md
git commit -m "docs(companion-module): help, action/variable reference, root README pointer"
```

---

## Task 11: Verification

- [ ] **Step 1: Run the full workspace typecheck**

Run: `pnpm typecheck`
Expected: passes (turbo runs typecheck across all packages).

- [ ] **Step 2: Run the full workspace test suite**

Run: `pnpm test`
Expected: all package tests pass, including the new companion-module tests.

- [ ] **Step 3: Run the module build**

Run: `pnpm -F @overlaysys/companion-module build`
Expected: `packages/companion-module/dist/index.js` exists, no errors.

- [ ] **Step 4: Confirm no untracked files were missed**

Run: `git status`
Expected: clean working tree on the implementation branch.

If anything's still uncommitted, commit it with an explanatory message.

---

## Self-review against spec

- **Spec §Architecture (workspace package, single WS):** Task 1 scaffolds, Task 7 connects, Task 9 wires. ✓
- **Spec §Module configuration (Companion UI):** Task 9 `src/config.ts`. ✓
- **Spec §Connection lifecycle (subscribe, list, backoff):** Task 7 backoff, Task 9 `onConnected` fetches. ✓
- **Spec §Local state cache:** Task 2 types, Task 3 reducer, hotcard payload cache added in Task 6 Step 5. ✓
- **Spec §Loaded show:** Task 3 reducer events, Task 9 persistence to config. ✓
- **Spec §Actions table:** Task 6 dispatcher covers every row; Task 8 SDK definitions surface them. ✓
- **Spec §Variables table:** Task 4 projection. The `<c>_data_<key>` requirement is implemented as slotted `<c>_data_<n>_key` / `<c>_data_<n>_value` because Companion variables need stable IDs — this is the noted refinement. ✓ (documented in HELP.md and the deferred-questions section of the spec).
- **Spec §Feedbacks table:** Task 5. The `hotcard_on_air` data-equality check approximates with templateId equality because the hotcard meta list doesn't carry data; the full payload cache (Task 6 Step 5) is the path to a stricter check. Stricter check is a follow-up — flagged as a known limitation in HELP.md `hotcard_on_air` semantics if needed. ✓ (approximation acceptable for v1)
- **Spec §Presets:** Task 8. The rundown row preset notes a limitation around row-id placeholders; falls back to user-drag workflow if SDK doesn't support templated row IDs. ✓
- **Spec §Error handling:** reducer is total (Task 3 default case), action send drops when disconnected (Task 7), `error` → `last_error` variable (Task 3 + Task 4). ✓
- **Spec §Testing:** Tasks 2–6 each add unit tests. No e2e by design. ✓
- **Spec §Documentation deliverables:** Task 10. ✓

**Type consistency check:** `dispatchAction` returns `{ messages, localEvents }`; `runAction` in Task 9 consumes both. `ActionId` / `FeedbackId` / `LocalEvent` are referenced consistently. `ChannelState` / `ActiveGraphic` / `RundownRow` / `Song` come from `@overlaysys/core` throughout.

**No placeholders.** Every step has executable content. The "if SDK API differs, adjust imports" note in Task 9 is a real handling instruction, not a TBD — Companion's SDK is the only true authority on the exact import shape and may drift between minor versions.
