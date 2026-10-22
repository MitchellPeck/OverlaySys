# Confidence Monitor — Phase 1 (Stage Channel Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel can be marked `kind: "stage"` and its renderer window becomes a confidence monitor showing the followed channel's current and next slide, the live rundown row's title and cue, a clock, live timers and video time remaining, using a built-in "Speaker" layout.

**Architecture:** Channels record the last rundown row taken to them (`ChannelState.liveRow`). A pure server function `buildStageFeed` derives a `StageFeed` from the followed channel's state, the show, songs and templates; a hub module rebuilds feeds (debounced 50 ms) on any channel/show/song/template/config change and pushes `stage_feed` messages to every subscriber of a stage channel. The renderer, on a stage channel, renders the feed's `StageLayout` with React widget components instead of mounting templates.

**Tech Stack:** TypeScript, zod 3, Fastify + `ws` server, React 19 + Vite renderer, Next 15 operator, Vitest 4 (node env, logic tests only), pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-10-22-confidence-monitor-design.md`

## Global Constraints

- `ChannelConfig.kind` defaults to `"graphics"`; existing channel JSON and cloud payloads must parse unchanged.
- `follows` defaults to `"program"`; `layoutId` defaults to the built-in `"speaker"`.
- Template graphics, `template-engine` and graphics-channel rendering behavior must not change.
- `liveRow` changes only when a take carries a source; unsourced takes and `clear` leave it alone.
- Feed rebuilds are debounced to ~50 ms per channel; clock/timer/video ticking is done locally in the renderer (no per-second broadcasts).
- Layouts in phase 1 are built-in only (no on-disk storage, no CRUD messages).
- `ProjectChannelOverride` is not extended.
- Tests are Vitest, node environment, logic only — no DOM/component tests. UI is verified manually.
- Run tests with `pnpm test` (root `vitest.config.ts`); typecheck with `pnpm -r typecheck` (or `pnpm turbo typecheck`).

## Review Focus

- A stage channel whose followed channel has nothing on air, or whose `follows` names a missing channel, itself, or another stage channel — every widget must render an empty state, never throw. (Task 5 tests.)
- The live row was deleted from the show, or the show was deleted, after it was taken — `row`/`nextRow` must be null and `next` must still compute from the session. (Task 5 tests.)
- A song arrangement that references a section id missing from the song — next-slide lookup must skip it rather than return garbage or crash. (Task 5 tests.)
- Server restart / socket reconnect — the stage window must resubscribe and receive a fresh feed immediately. (Task 6 test: `subscribeStage` pushes on subscribe; renderer already resubscribes on every `hello`.)
- Video paused — remaining time must freeze; playing — it must count down between 4 Hz reports. (Task 7 tests.)

---

## File Structure

**Core (`packages/core/src/`)**
- Modify `channelConfig.ts` — `kind`, `follows`, `layoutId`.
- Modify `channel.ts` — `RowSourceSchema`, `ChannelState.liveRow`.
- Create `stageLayout.ts` — layout + widget schemas, built-in Speaker layout, `resolveStageLayout`.
- Create `stageFeed.ts` — `StageFeed` wire schema and view types.
- Modify `index.ts` — export the two new modules.

**Protocol (`packages/ws-protocol/src/index.ts`)** — `source` on `take`/`cue`, `showId` on `media_take`, `stage_feed` server message.

**Server (`server/src/`)**
- Modify `channels.ts` — `liveRow` handling, `setLiveRow`, `allStates`, `onAnyChange`.
- Modify `scriptureSession.ts` — pass a source on scripture takes.
- Modify `ws.ts` — pass sources; register stage subscriptions; invalidate feeds on saves.
- Create `stageFeed.ts` — pure `buildStageFeed` + helpers.
- Create `stageFeedHub.ts` — subscriptions, input loading, debounce.

**Operator (`apps/operator/src/`)**
- Modify `lib/rowData.ts`, `lib/mediaTake.ts` and their call sites; `app/components/SongTakeStrip.tsx` outro take.
- Modify `app/settings/channels/page.tsx` — kind / follows / layout controls.

**Companion (`packages/companion-module/src/actions.ts`)** — sources on row takes.

**Renderer (`apps/renderer/src/`)**
- Create `stage/stageTime.ts` — pure clock/timer/video helpers.
- Create `stage/fitText.ts` — pure `fitFontSize`.
- Create `stage/StageView.tsx`, `stage/widgets.tsx`, `stage/useFitText.ts`.
- Modify `Renderer.tsx` — receive `stage_feed`, render `StageView` for stage channels.

---

### Task 1: Stage fields on `ChannelConfig`

**Files:**
- Modify: `packages/core/src/channelConfig.ts`
- Test: `packages/core/src/channelConfig.test.ts` (create)

**Interfaces:**
- Produces: `ChannelKindSchema`, `type ChannelKind = "graphics" | "stage"`, `ChannelConfig.kind: ChannelKind` (defaulted), `ChannelConfig.follows?: string`, `ChannelConfig.layoutId?: string`, `DEFAULT_STAGE_FOLLOWS = "program"`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/channelConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChannelConfigSchema, DEFAULT_STAGE_FOLLOWS } from "./channelConfig";

describe("ChannelConfigSchema stage fields", () => {
  it("defaults kind to graphics for pre-stage JSON", () => {
    const c = ChannelConfigSchema.parse({ id: "program", name: "Program" });
    expect(c.kind).toBe("graphics");
    expect(c.follows).toBeUndefined();
    expect(c.layoutId).toBeUndefined();
  });

  it("accepts a stage channel with follows and layoutId", () => {
    const c = ChannelConfigSchema.parse({
      id: "pastor",
      name: "Pastor",
      kind: "stage",
      follows: "program",
      layoutId: "speaker",
    });
    expect(c).toMatchObject({ kind: "stage", follows: "program", layoutId: "speaker" });
  });

  it("rejects an unknown kind", () => {
    expect(() => ChannelConfigSchema.parse({ id: "x", name: "X", kind: "bogus" })).toThrow();
  });

  it("exports the default follows target", () => {
    expect(DEFAULT_STAGE_FOLLOWS).toBe("program");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/channelConfig.test.ts`
Expected: FAIL — `DEFAULT_STAGE_FOLLOWS` is not exported / `kind` is undefined.

- [ ] **Step 3: Implement**

In `packages/core/src/channelConfig.ts`, after `ChannelRenderModeSchema`:

```ts
/**
 * `graphics` channels mount templates. `stage` channels are confidence
 * monitors: the renderer draws a StageLayout fed by the server's StageFeed
 * (see stageFeed.ts) and ignores template takes.
 */
export const ChannelKindSchema = z.enum(["graphics", "stage"]);
export type ChannelKind = z.infer<typeof ChannelKindSchema>;

/** Channel a stage channel follows when `follows` is unset. */
export const DEFAULT_STAGE_FOLLOWS = "program";
```

Inside `ChannelConfigSchema`'s object, after `background`:

```ts
  kind: ChannelKindSchema.default("graphics"),
  /** Stage only: the channel whose current/next content this monitor shows. */
  follows: z.string().optional(),
  /** Stage only: StageLayout id; unset or unknown falls back to the built-in Speaker layout. */
  layoutId: z.string().optional(),
```

In `packages/core/src/channelResolution.ts`, `resolveChannelConfig`'s returned object must carry the new fields (overrides don't touch them). Add after `background`:

```ts
    kind: base.kind,
    ...(base.follows !== undefined ? { follows: base.follows } : {}),
    ...(base.layoutId !== undefined ? { layoutId: base.layoutId } : {}),
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/core/src/channelConfig.test.ts packages/core/src/channelResolution.test.ts`
Expected: PASS. If `channelResolution.test.ts` has exact `toEqual` expectations on resolved configs, add `kind: "graphics"` to those expected objects (fixtures built with `ChannelConfigSchema.parse` already have it; hand-built literals typed as `ChannelConfig` need `kind` to typecheck).

- [ ] **Step 5: Typecheck and fix literal configs**

Run: `pnpm -r typecheck`
Expected: errors only where code builds `ChannelConfig` object literals without `kind` (e.g. the operator channels settings "create" path, seed data in `server/src/storage.ts`). Add `kind: "graphics"` to each. Re-run until clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/channelConfig.ts packages/core/src/channelConfig.test.ts packages/core/src/channelResolution.ts
git add -u
git commit -m "feat(core): stage channel kind, follows and layoutId"
```

---

### Task 2: `StageLayout` schema and built-in Speaker layout

**Files:**
- Create: `packages/core/src/stageLayout.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/stageLayout.test.ts`

**Interfaces:**
- Produces:
  - `StageLayoutSchema`, `type StageLayout = { id; name; size: {w,h}; background: string; widgets: StageWidget[]; builtIn?: boolean }`
  - `StageWidgetSchema` (discriminated on `kind`: `"currentSlide" | "nextSlide" | "rowTitle" | "rowCue" | "clock" | "timer" | "videoRemaining" | "text"`), `type StageWidget`, `type StageWidgetKind`, `type StageWidgetStyle`
  - `SPEAKER_LAYOUT: StageLayout`, `BUILT_IN_STAGE_LAYOUTS: StageLayout[]`, `DEFAULT_STAGE_LAYOUT_ID = "speaker"`
  - `resolveStageLayout(id: string | undefined): StageLayout`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/stageLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_STAGE_LAYOUTS,
  DEFAULT_STAGE_LAYOUT_ID,
  SPEAKER_LAYOUT,
  StageLayoutSchema,
  StageWidgetSchema,
  resolveStageLayout,
} from "./stageLayout";

describe("StageWidgetSchema", () => {
  it("fills style and props defaults", () => {
    const w = StageWidgetSchema.parse({ id: "c", kind: "clock", rect: { x: 0, y: 0, w: 100, h: 50 } });
    expect(w.kind).toBe("clock");
    expect(w.style.fontSize).toBe(64);
    expect(w.style.autoFit).toBe(true);
    if (w.kind !== "clock") throw new Error("narrowing");
    expect(w.props).toEqual({ format: "12h", seconds: false });
  });

  it("accepts a timer pinned to a channel", () => {
    const w = StageWidgetSchema.parse({
      id: "t",
      kind: "timer",
      rect: { x: 0, y: 0, w: 10, h: 10 },
      props: { source: { channel: "program" } },
    });
    if (w.kind !== "timer") throw new Error("narrowing");
    expect(w.props.source).toEqual({ channel: "program" });
  });

  it("rejects zero-size rects", () => {
    expect(() =>
      StageWidgetSchema.parse({ id: "x", kind: "text", rect: { x: 0, y: 0, w: 0, h: 10 } }),
    ).toThrow();
  });
});

describe("built-in layouts", () => {
  it("Speaker layout is valid and has unique widget ids", () => {
    const parsed = StageLayoutSchema.parse(SPEAKER_LAYOUT);
    const ids = parsed.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parsed.builtIn).toBe(true);
  });

  it("every widget fits inside the canvas", () => {
    for (const layout of BUILT_IN_STAGE_LAYOUTS) {
      for (const w of layout.widgets) {
        expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(layout.size.w);
        expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(layout.size.h);
      }
    }
  });
});

describe("resolveStageLayout", () => {
  it("returns the matching built-in", () => {
    expect(resolveStageLayout("speaker").id).toBe("speaker");
  });
  it("falls back to the default for unknown or missing ids", () => {
    expect(resolveStageLayout(undefined).id).toBe(DEFAULT_STAGE_LAYOUT_ID);
    expect(resolveStageLayout("nope").id).toBe(DEFAULT_STAGE_LAYOUT_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/stageLayout.test.ts`
Expected: FAIL — cannot resolve `./stageLayout`.

- [ ] **Step 3: Implement**

Create `packages/core/src/stageLayout.ts`:

```ts
import { z } from "zod";

/**
 * A confidence-monitor layout: a canvas of freely positioned widgets, each
 * bound to one slice of the server's StageFeed (see stageFeed.ts). Separate
 * from Template on purpose — stage widgets scroll, tick and highlight, and
 * have no in/out timelines.
 */

export const StageRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type StageRect = z.infer<typeof StageRectSchema>;

export const StageWidgetStyleSchema = z.object({
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  fontSize: z.number().positive().default(64),
  fontWeight: z.number().int().min(100).max(900).default(600),
  color: z.string().default("#ffffff"),
  background: z.string().optional(),
  padding: z.number().min(0).default(16),
  align: z.enum(["left", "center", "right"]).default("left"),
  vAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  /** Shrink from fontSize until the content fits the box. */
  autoFit: z.boolean().default(true),
  /** Small caption drawn above the content, e.g. "NEXT". */
  label: z.string().optional(),
  border: z
    .object({ width: z.number().min(0), color: z.string(), radius: z.number().min(0) })
    .optional(),
});
export type StageWidgetStyle = z.infer<typeof StageWidgetStyleSchema>;

const base = {
  id: z.string(),
  rect: StageRectSchema,
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  style: StageWidgetStyleSchema.default({}),
};

export const StageTimerSourceSchema = z.union([
  z.literal("firstActive"),
  z.object({ channel: z.string() }),
]);
export type StageTimerSource = z.infer<typeof StageTimerSourceSchema>;

export const StageWidgetSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("currentSlide"),
    props: z.object({ showReference: z.boolean().default(true) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("nextSlide"),
    props: z
      .object({
        maxLines: z.number().int().positive().default(2),
        dimOpacity: z.number().min(0).max(1).default(0.6),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("rowTitle"),
    props: z.object({ showNext: z.boolean().default(true) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("rowCue"),
    props: z.object({ includeNextRow: z.boolean().default(false) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("clock"),
    props: z
      .object({ format: z.enum(["12h", "24h"]).default("12h"), seconds: z.boolean().default(false) })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("timer"),
    props: z.object({ source: StageTimerSourceSchema.default("firstActive") }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("videoRemaining"),
    props: z.object({ warnBelowSec: z.number().min(0).default(30) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("text"),
    props: z.object({ text: z.string().default("") }).default({}),
  }),
]);
export type StageWidget = z.infer<typeof StageWidgetSchema>;
export type StageWidgetKind = StageWidget["kind"];

export const StageLayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).default({ w: 1920, h: 1080 }),
  background: z.string().default("#000000"),
  /** Array order is z-order (later draws on top). */
  widgets: z.array(StageWidgetSchema),
  /** Shipped in code; read-only, duplicate to edit (phase 5). */
  builtIn: z.boolean().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional(),
});
export type StageLayout = z.infer<typeof StageLayoutSchema>;

export const DEFAULT_STAGE_LAYOUT_ID = "speaker";

/** Speaker: row title + clock across the top, live slide, then next / cue / timers. */
export const SPEAKER_LAYOUT: StageLayout = StageLayoutSchema.parse({
  id: "speaker",
  name: "Speaker",
  builtIn: true,
  size: { w: 1920, h: 1080 },
  background: "#000000",
  widgets: [
    {
      id: "row-title",
      kind: "rowTitle",
      rect: { x: 24, y: 24, w: 1472, h: 110 },
      style: { fontSize: 48, label: "NOW" },
    },
    {
      id: "clock",
      kind: "clock",
      rect: { x: 1520, y: 24, w: 376, h: 110 },
      style: { fontSize: 72, align: "right", vAlign: "middle", autoFit: false },
    },
    {
      id: "current",
      kind: "currentSlide",
      rect: { x: 24, y: 158, w: 1872, h: 520 },
      style: { fontSize: 72, label: "LIVE", border: { width: 2, color: "#333333", radius: 12 } },
    },
    {
      id: "next",
      kind: "nextSlide",
      rect: { x: 24, y: 702, w: 1180, h: 354 },
      style: { fontSize: 48, label: "NEXT", color: "#bbbbbb" },
    },
    {
      id: "cue",
      kind: "rowCue",
      rect: { x: 1228, y: 702, w: 668, h: 220 },
      style: { fontSize: 40, label: "CUE", color: "#ffd166" },
    },
    {
      id: "timer",
      kind: "timer",
      rect: { x: 1228, y: 946, w: 330, h: 110 },
      style: { fontSize: 56, label: "TIMER", autoFit: false },
    },
    {
      id: "video",
      kind: "videoRemaining",
      rect: { x: 1566, y: 946, w: 330, h: 110 },
      style: { fontSize: 56, label: "VIDEO", autoFit: false },
    },
  ],
});

export const BUILT_IN_STAGE_LAYOUTS: StageLayout[] = [SPEAKER_LAYOUT];

/** The built-in with this id, else the default. Phase 5 adds stored layouts. */
export function resolveStageLayout(id: string | undefined): StageLayout {
  return BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === id) ?? SPEAKER_LAYOUT;
}
```

Add to `packages/core/src/index.ts` (after `channelWindowPrefs`):

```ts
export * from "./stageLayout";
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/core/src/stageLayout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stageLayout.ts packages/core/src/stageLayout.test.ts packages/core/src/index.ts
git commit -m "feat(core): StageLayout schema and built-in Speaker layout"
```

---

### Task 3: `liveRow` on channel state, protocol fields, `StageFeed` wire schema

**Files:**
- Modify: `packages/core/src/channel.ts`
- Create: `packages/core/src/stageFeed.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/ws-protocol/src/index.ts`
- Modify: `server/src/channels.ts`
- Test: `server/src/channels.liveRow.test.ts` (create), `packages/core/src/stageFeed.test.ts` (create)

**Interfaces:**
- Consumes: `StageLayoutSchema` (Task 2).
- Produces:
  - core: `RowSourceSchema`, `type RowSource = { showId: string; rowId: string }`, `ChannelState.liveRow?: RowSource`
  - core: `SlideViewSchema`/`type SlideView = { kind: "lyric"|"scripture"|"graphic"|"none"; lines: string[]; reference?: string }`, `NONE_SLIDE`, `StageRowViewSchema`/`type StageRowView = { title: string; cue: string }`, `StageTimerSchema`/`type StageTimer = { label: string; channel: string; mode: "countdown"|"countup"; format?: TimeFormat; value: string }`, `StageVideoSchema`/`type StageVideo = { status; currentTime; duration; at; label? }`, `StageFeedSchema`/`type StageFeed = { layout; current; next; row; nextRow; timers; video; serverNow }`
  - protocol: `take`/`cue` gain `source?: RowSource`; `media_take` gains `showId?: string`; server message `{ type: "stage_feed"; channel: string; feed: StageFeed }`
  - server `channels.ts`: `take(channel, templateId, data, subTakeContext?, scripture?, source?: RowSource)`, `MediaTakeArgs.showId?: string`, `setLiveRow(channel: string, source: RowSource): void`, `allStates(): ChannelState[]`, `onAnyChange(listener: (channel: string) => void): () => void`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/stageFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NONE_SLIDE, StageFeedSchema } from "./stageFeed";
import { SPEAKER_LAYOUT } from "./stageLayout";

describe("StageFeedSchema", () => {
  it("round-trips an empty feed", () => {
    const feed = {
      layout: SPEAKER_LAYOUT,
      current: NONE_SLIDE,
      next: NONE_SLIDE,
      row: null,
      nextRow: null,
      timers: [],
      video: null,
      serverNow: 1,
    };
    expect(StageFeedSchema.parse(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  });
});
```

Create `server/src/channels.liveRow.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as channels from "./channels";
import * as templates from "./templates";

const SRC = { showId: "show-1", rowId: "row-1" };

describe("channel liveRow", () => {
  beforeEach(() => {
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a sourced take sets liveRow", () => {
    channels.take("lr-a", "tpl", {}, undefined, undefined, SRC);
    expect(channels.getState("lr-a").liveRow).toEqual(SRC);
  });

  it("an unsourced take keeps the previous liveRow", () => {
    channels.take("lr-b", "tpl", {}, undefined, undefined, SRC);
    channels.take("lr-b", "hotcard", {});
    expect(channels.getState("lr-b").liveRow).toEqual(SRC);
  });

  it("clear keeps liveRow", () => {
    channels.take("lr-c", "tpl", {}, undefined, undefined, SRC);
    channels.clear("lr-c");
    expect(channels.getState("lr-c").liveRow).toEqual(SRC);
  });

  it("take_pvw_to_pgm carries the preview liveRow", () => {
    channels.take("lr-pvw", "tpl", {}, undefined, undefined, SRC);
    channels.takePvwToPgm("lr-pvw", "lr-pgm");
    expect(channels.getState("lr-pgm").liveRow).toEqual(SRC);
  });

  it("media_take with showId sets liveRow from rowId", () => {
    channels.mediaTake("lr-m", {
      rowId: "vid-1",
      showId: "show-1",
      assetUrl: "/assets/a.mp4",
      volume: 1,
      endAction: "clear",
    });
    expect(channels.getState("lr-m").liveRow).toEqual({ showId: "show-1", rowId: "vid-1" });
  });

  it("setLiveRow emits to channel and any-change listeners", () => {
    const seen: string[] = [];
    const off = channels.onAnyChange((ch) => seen.push(ch));
    const perChannel = vi.fn();
    const unsub = channels.subscribe("lr-d", perChannel);
    perChannel.mockClear();
    channels.setLiveRow("lr-d", SRC);
    expect(perChannel).toHaveBeenCalledTimes(1);
    expect(seen).toContain("lr-d");
    off();
    unsub();
  });

  it("onAnyChange fires even when the channel has no direct subscribers", () => {
    const seen: string[] = [];
    const off = channels.onAnyChange((ch) => seen.push(ch));
    channels.take("lr-e", "tpl", {});
    expect(seen).toContain("lr-e");
    off();
  });

  it("allStates includes channels that have been touched", () => {
    channels.take("lr-f", "tpl", {});
    expect(channels.allStates().map((s) => s.channel)).toContain("lr-f");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/stageFeed.test.ts server/src/channels.liveRow.test.ts`
Expected: FAIL — missing module `./stageFeed`; `setLiveRow` / `onAnyChange` / `allStates` not functions.

- [ ] **Step 3: Core — `RowSource` and `liveRow`**

In `packages/core/src/channel.ts`, before `ChannelStateSchema`:

```ts
/** The rundown row a take came from. */
export const RowSourceSchema = z.object({ showId: z.string(), rowId: z.string() });
export type RowSource = z.infer<typeof RowSourceSchema>;
```

Inside `ChannelStateSchema`'s object, after `mediaClearCut`:

```ts
  /**
   * Last rundown row taken to this channel. Only takes that carry a source
   * change it — hotcards, ad-hoc takes and clears leave it — so stage
   * monitors keep the row's cue up while a lower third flashes by.
   */
  liveRow: RowSourceSchema.optional(),
```

- [ ] **Step 4: Core — `stageFeed.ts`**

Create `packages/core/src/stageFeed.ts`:

```ts
import { z } from "zod";
import { MediaStatusSchema } from "./channel";
import { StageLayoutSchema } from "./stageLayout";
import { TimeFormatSchema } from "./template";

/**
 * Everything a confidence monitor renders, derived server-side
 * (server/src/stageFeed.ts) and pushed as `stage_feed`. Time-based values
 * are raw (anchors, playback reports) — the renderer ticks them locally.
 */

export const SlideViewSchema = z.object({
  kind: z.enum(["lyric", "scripture", "graphic", "none"]),
  lines: z.array(z.string()),
  reference: z.string().optional(),
});
export type SlideView = z.infer<typeof SlideViewSchema>;

export const NONE_SLIDE: SlideView = { kind: "none", lines: [] };

export const StageRowViewSchema = z.object({ title: z.string(), cue: z.string() });
export type StageRowView = z.infer<typeof StageRowViewSchema>;

export const StageTimerSchema = z.object({
  label: z.string(),
  channel: z.string(),
  mode: z.enum(["countdown", "countup"]),
  format: TimeFormatSchema.optional(),
  /** Encoded TimerValue (see timeField.ts). */
  value: z.string(),
});
export type StageTimer = z.infer<typeof StageTimerSchema>;

export const StageVideoSchema = z.object({
  status: MediaStatusSchema,
  currentTime: z.number(),
  duration: z.number(),
  /** Server ms when currentTime was reported. */
  at: z.number(),
  label: z.string().optional(),
});
export type StageVideo = z.infer<typeof StageVideoSchema>;

export const StageFeedSchema = z.object({
  layout: StageLayoutSchema,
  current: SlideViewSchema,
  next: SlideViewSchema,
  row: StageRowViewSchema.nullable(),
  nextRow: StageRowViewSchema.nullable(),
  timers: z.array(StageTimerSchema),
  video: StageVideoSchema.nullable(),
  serverNow: z.number(),
});
export type StageFeed = z.infer<typeof StageFeedSchema>;
```

Add to `packages/core/src/index.ts` after the `stageLayout` export:

```ts
export * from "./stageFeed";
```

- [ ] **Step 5: Protocol**

In `packages/ws-protocol/src/index.ts`:
- Add `RowSourceSchema` and `StageFeedSchema` to the existing `@overlaysys/core` import.
- In the `take` and `cue` client message objects add: `source: RowSourceSchema.optional(),`
- In the `media_take` object add: `/** Show the row belongs to; with rowId it becomes the channel's liveRow. */ showId: z.string().optional(),`
- In `ServerMessageSchema`, after the `state` entry, add:

```ts
  /** Confidence-monitor content for a `kind: "stage"` channel. */
  z.object({
    type: z.literal("stage_feed"),
    channel: z.string(),
    feed: StageFeedSchema,
  }),
```

- [ ] **Step 6: Server `channels.ts`**

Add `RowSource` to the type import from `@overlaysys/core`.

Below the `listeners` map:

```ts
type AnyListener = (channel: string) => void;
const anyListeners = new Set<AnyListener>();

/** Called after every emit on any channel. Used by the stage feed hub. */
export function onAnyChange(listener: AnyListener): () => void {
  anyListeners.add(listener);
  return () => {
    anyListeners.delete(listener);
  };
}

export function allStates(): ChannelState[] {
  return [...states.values()];
}
```

Replace `emit` so any-listeners run even with no per-channel subscribers:

```ts
function emit(channel: string): void {
  const s = states.get(channel);
  if (!s) return;
  const ls = listeners.get(channel);
  if (ls) for (const l of ls) l(s);
  for (const l of anyListeners) l(channel);
}
```

Add `setLiveRow` after `getState`:

```ts
export function setLiveRow(channel: string, source: RowSource): void {
  const s = getOrInit(channel);
  s.liveRow = source;
  emit(channel);
}
```

Extend `take`'s signature with a sixth parameter and set it before `emit(channel)` (right after the `s.active = {...}` assignment):

```ts
  source?: RowSource,
```

```ts
  if (source) s.liveRow = source;
```

In `takePvwToPgm`, right after `pgm.active = {...};`:

```ts
  if (src.liveRow) pgm.liveRow = src.liveRow;
```

Find the `MediaTakeArgs` type in `channels.ts` and add `showId?: string;`. In `mediaTake`, before `delete s.mediaClearCut;`:

```ts
  if (args.showId) s.liveRow = { showId: args.showId, rowId: args.rowId };
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run packages/core/src/stageFeed.test.ts server/src/channels.liveRow.test.ts server/src/channels.test.ts server/src/channelsMedia.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/channel.ts packages/core/src/stageFeed.ts packages/core/src/stageFeed.test.ts packages/core/src/index.ts packages/ws-protocol/src/index.ts server/src/channels.ts server/src/channels.liveRow.test.ts
git commit -m "feat: liveRow on channel state, stage_feed wire schema"
```

---

### Task 4: Server and client takes send their rundown source

**Files:**
- Modify: `server/src/ws.ts` (handlers `take`, `cue`, `media_take`, `song_take`, `song_take_pvw_to_pgm`, `take_song_sub`)
- Modify: `server/src/scriptureSession.ts` (`takeIntro`, `takeSlide`)
- Modify: `apps/operator/src/lib/rowData.ts`, `apps/operator/src/lib/mediaTake.ts`
- Modify call sites: `apps/operator/src/app/components/Rundown.tsx`, `apps/operator/src/app/components/StageArea.tsx`, `apps/operator/src/app/hooks/useGlobalShortcuts.ts`, `apps/operator/src/app/components/SongTakeStrip.tsx`
- Modify: `packages/companion-module/src/actions.ts` (`rowMessages`, `rowPvwPgmMessages`)
- Test: `apps/operator/src/lib/rowData.test.ts`, `apps/operator/src/lib/mediaTake.test.ts`, `packages/companion-module/src/__tests__/actions.test.ts`, `server/src/scriptureSession.test.ts`

**Interfaces:**
- Consumes: `channels.take(..., source)`, `channels.setLiveRow`, `MediaTakeArgs.showId`, protocol `source`/`showId` (Task 3).
- Produces: `graphicRowMessage(row, type, overrides, showId?: string)`, `videoRowTakeMessage(row, showId?: string)` — both add the source only when `showId` is given.

- [ ] **Step 1: Write failing operator tests**

Append to `apps/operator/src/lib/rowData.test.ts` (reuse the file's existing graphic row fixture if it has one; otherwise this literal):

```ts
describe("graphicRowMessage source", () => {
  const row = { kind: "graphic" as const, id: "g1", templateId: "t", data: { a: "1" } };
  it("adds the rundown source when a show id is given", () => {
    const msg = graphicRowMessage(row, "take", {}, "show-1");
    expect(msg).toMatchObject({ type: "take", source: { showId: "show-1", rowId: "g1" } });
  });
  it("omits source without a show id", () => {
    expect(graphicRowMessage(row, "cue", {})).not.toHaveProperty("source");
  });
});
```

Append to `apps/operator/src/lib/mediaTake.test.ts`:

```ts
describe("videoRowTakeMessage showId", () => {
  const row = VideoRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/assets/a.mp4" });
  it("adds showId when given", () => {
    expect(videoRowTakeMessage(row, "show-1")).toMatchObject({ showId: "show-1", rowId: "v1" });
  });
  it("omits showId without one", () => {
    expect(videoRowTakeMessage(row)).not.toHaveProperty("showId");
  });
});
```

(Import `VideoRowSchema` from `@overlaysys/core` and `describe/it/expect` from `vitest` if the file doesn't already.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/rowData.test.ts apps/operator/src/lib/mediaTake.test.ts`
Expected: FAIL — `source` / `showId` missing.

- [ ] **Step 3: Implement operator helpers**

`apps/operator/src/lib/rowData.ts` — replace `graphicRowMessage`:

```ts
/**
 * The cue/take message for a graphic row, with effective data. With a show
 * id it carries the rundown source so stage monitors know the live row.
 */
export function graphicRowMessage(
  row: GraphicRow,
  type: "cue" | "take",
  overrides: RowDataOverrides,
  showId?: string,
): ClientMessage {
  return {
    type,
    channel: row.channelHint ?? (type === "cue" ? "preview" : "program"),
    templateId: row.templateId,
    data: effectiveRowData(row, overrides),
    ...(showId ? { source: { showId, rowId: row.id } } : {}),
  };
}
```

`apps/operator/src/lib/mediaTake.ts` — change the signature to `videoRowTakeMessage(row: VideoRow, showId?: string)` and add as the last property of the returned object:

```ts
    ...(showId ? { showId } : {}),
```

- [ ] **Step 4: Update operator call sites**

Pass the loaded show's id at every call:
- `Rundown.tsx:161` → `graphicRowMessage(row, "take", overrides, show?.id)`; `Rundown.tsx:130` → `videoRowTakeMessage(row, show?.id)` (`show` is `useStore((s) => s.show)` at line 21).
- `StageArea.tsx:205,206,367,378` → append `, useStore.getState().show?.id` as the last argument; `StageArea.tsx:130,402` → `videoRowTakeMessage(<row>, useStore.getState().show?.id)`.
- `useGlobalShortcuts.ts:86,105` → append `, show.id` (`show` is `store.show` at line 58, already non-null there because `show.id` is used at lines 91/110); `:123` → `videoRowTakeMessage(row, show.id)`.
- `SongTakeStrip.tsx` `takeOutro()` (around line 176) — add to the `take` message: `source: { showId: show.id, rowId: row.id },`.

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: clean.

- [ ] **Step 5: Write failing Companion test**

In `packages/companion-module/src/__tests__/actions.test.ts`, find the existing test around line 509 that expects `{ type: "take", channel: "lower", templateId: "tpl-1", data: { title: "Hi" } }` for a row take. Copy its setup into a new test next to it:

```ts
  it("row takes carry the loaded show as source", () => {
    // ...same state/row setup as the neighbouring take_row_by_index test...
    const r = dispatchAction(state, "take_row_by_index", { rowIndex: 1 });
    expect(r.messages[0]).toMatchObject({ source: { showId: state.loadedShowId, rowId: expect.any(String) } });
  });
```

Run: `pnpm vitest run packages/companion-module/src/__tests__/actions.test.ts`
Expected: the new test FAILS.

- [ ] **Step 6: Implement Companion sources**

In `packages/companion-module/src/actions.ts`, at the top of `rowMessages` and of `rowPvwPgmMessages`:

```ts
  const showId = state.loadedShowId;
  const source = showId ? { source: { showId, rowId: row.id } } : {};
```

- `rowMessages`: video branch → add `...(showId ? { showId } : {}),` to the `media_take`; final graphic `take` → add `...source,`.
- `rowPvwPgmMessages`: final graphic `cue` → add `...source,` (the following `take_pvw_to_pgm` carries it to program server-side).

Run: `pnpm vitest run packages/companion-module/src/__tests__/actions.test.ts`
Expected: the new test passes. Existing tests that assert exact message equality (`toEqual`) for graphic takes/cues with a loaded show now fail because of the added `source` — update those expectations to include `source: { showId: <fixture show id>, rowId: <fixture row id> }` (and `showId` on `media_take`). Do not weaken them to `toMatchObject`.

- [ ] **Step 7: Server-originated sources**

`server/src/scriptureSession.ts`:
- `takeIntro`: change `channels.take(ch, intro.templateId, intro.fieldValues, undefined, {...})` to pass a sixth argument `{ showId, rowId: row.id }`.
- `takeSlide`: same — sixth argument `{ showId, rowId: row.id }` on its `channels.take(...)` call.

Add to `server/src/scriptureSession.test.ts` (use the file's existing row fixture and take helper):

```ts
  it("scripture slide takes set the channel liveRow", () => {
    scriptureSession.takeSlide("sc-live", "show-1", ROW, 0);
    expect(channels.getState("sc-live").liveRow).toEqual({ showId: "show-1", rowId: ROW.id });
  });
```

(`ROW` = the scripture row fixture already defined in that file; rename to match.)

`server/src/ws.ts`:
- `case "take"` and `case "cue"`: `channels.take(parsed.channel, parsed.templateId, parsed.data, undefined, undefined, parsed.source);`
- `case "media_take"`: add `...(parsed.showId ? { showId: parsed.showId } : {}),` to the args object.
- `case "song_take"`: after `songSession.start(...)` add `channels.setLiveRow(parsed.channel, { showId: parsed.showId, rowId: row.id });`
- `case "song_take_pvw_to_pgm"`: after the promote call add `channels.setLiveRow(parsed.toChannel, { showId: parsed.showId, rowId: parsed.songRowId });`
- `case "take_song_sub"`: intro/outro `channels.take(resolvedChannel, take.templateId, take.fieldValues, { songRowId: row.id, sub: parsed.sub }, undefined, { showId: parsed.showId, rowId: row.id });`; lyrics branch — after the advance/start `if/else` add `channels.setLiveRow(resolvedChannel, { showId: parsed.showId, rowId: row.id });`

- [ ] **Step 8: Run everything touched**

Run: `pnpm vitest run server/src packages/companion-module apps/operator/src/lib`
Expected: PASS.
Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add -u
git commit -m "feat: rundown takes record their source row on the channel"
```

---

### Task 5: Pure `buildStageFeed`

**Files:**
- Create: `server/src/stageFeed.ts`
- Test: `server/src/stageFeed.test.ts`

**Interfaces:**
- Consumes: `StageFeed`, `SlideView`, `NONE_SLIDE`, `StageRowView`, `StageTimer`, `StageVideo` (Task 3); `StageLayout` (Task 2); `ChannelState.liveRow` (Task 3); `resolveArrangement` from `@overlaysys/core`; `scriptureSlideData` from `@overlaysys/scripture`.
- Produces:

```ts
export interface StageFeedInputs {
  layout: StageLayout;
  /** State of the followed channel, or null when it is missing / a stage channel. */
  followed: ChannelState | null;
  allStates: ChannelState[];
  /** Show named by followed.liveRow, if it still exists. */
  show: Show | null;
  /** Songs by id: at least the live session's song and the live/next rows' songs. */
  songs: Map<string, Song>;
  /** Templates by id: at least every active template and the live/next graphic rows' templates. */
  templates: Map<string, Template>;
  now: number;
}
export function buildStageFeed(i: StageFeedInputs): StageFeed;
export function lyricSlideAt(song: Song, arrangement: string[], cursor: { sectionIdx: number; slideIdx: number }): SlideView;
export function nextLyricCursor(song: Song, arrangement: string[], cursor: { sectionIdx: number; slideIdx: number }): { sectionIdx: number; slideIdx: number } | null;
export function rowTitle(row: RundownRow, songs: Map<string, Song>, templates: Map<string, Template>): string;
export function firstContentOf(row: RundownRow | null, show: Show, songs: Map<string, Song>, templates: Map<string, Template>): SlideView;
```

- [ ] **Step 1: Write the failing tests**

Create `server/src/stageFeed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NONE_SLIDE,
  SPEAKER_LAYOUT,
  ShowSchema,
  SongSchema,
  type ChannelState,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { buildStageFeed, lyricSlideAt, nextLyricCursor, rowTitle } from "./stageFeed";

const song: Song = SongSchema.parse({
  id: "song-1",
  title: "Amazing Grace",
  sections: [
    { id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "a", lines: ["A1"] }, { id: "b", lines: ["B1", "B2"] }] },
    { id: "c", kind: "chorus", label: "Chorus", slides: [{ id: "c1", lines: ["C1"] }] },
  ],
  defaultArrangement: ["v1", "c"],
});

const lowerThird: Template = {
  id: "lt",
  name: "Lower third",
  size: { w: 1920, h: 1080 },
  fields: [
    { key: "name", label: "Name", type: "text" },
    { key: "role", label: "Role", type: "text" },
    { key: "img", label: "Image", type: "image" },
  ],
  layers: [],
  timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  fonts: [],
};

const timerTpl: Template = {
  ...lowerThird,
  id: "timer",
  name: "Countdown",
  fields: [{ key: "t", label: "Service starts", type: "time", timeMode: "countdown", timeFormat: "M:SS" }],
};

const show: Show = ShowSchema.parse({
  id: "show-1",
  name: "Sunday",
  projectId: "p",
  songs: [],
  rows: [
    { kind: "graphic", id: "r-welcome", templateId: "lt", data: { name: "Welcome" }, notes: "Smile" },
    { kind: "song", id: "r-song", songId: "song-1", lyricTemplateId: "lyrics", notes: "  Band in  " },
    {
      kind: "scripture",
      id: "r-scr",
      reference: "John 3:16-17",
      translation: "kjv",
      templateId: "scr",
      slides: [
        { id: "s1", verses: [{ book: "John", chapter: 3, verse: 16, text: "For God so loved" }] },
        { id: "s2", verses: [{ book: "John", chapter: 3, verse: 17, text: "For God sent not" }] },
      ],
    },
    { kind: "video", id: "r-vid", assetUrl: "/assets/v.mp4", label: "Announcements" },
  ],
});

const songs = new Map([[song.id, song]]);
const templates = new Map([
  [lowerThird.id, lowerThird],
  [timerTpl.id, timerTpl],
]);

function base(followed: ChannelState | null, extra: Partial<Parameters<typeof buildStageFeed>[0]> = {}) {
  return buildStageFeed({
    layout: SPEAKER_LAYOUT,
    followed,
    allStates: followed ? [followed] : [],
    show,
    songs,
    templates,
    now: 1000,
    ...extra,
  });
}

function songState(sectionIdx: number, slideIdx: number, arrangement = ["v1", "c"]): ChannelState {
  return {
    channel: "program",
    active: { templateId: "lyrics", data: { text: "" }, phase: "on", takenAt: 1 },
    songSession: {
      songId: "song-1",
      lyricTemplateId: "lyrics",
      arrangement,
      cursor: { sectionIdx, slideIdx },
      blanked: false,
      trustMode: false,
      startedAt: 1,
    },
    liveRow: { showId: "show-1", rowId: "r-song" },
  };
}

describe("lyric helpers", () => {
  it("reads the slide at a cursor", () => {
    expect(lyricSlideAt(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({
      kind: "lyric",
      lines: ["B1", "B2"],
      reference: "Verse 1",
    });
  });
  it("advances within a section, across sections, and ends", () => {
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 0 })).toEqual({ sectionIdx: 0, slideIdx: 1 });
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({ sectionIdx: 1, slideIdx: 0 });
    expect(nextLyricCursor(song, ["v1", "c"], { sectionIdx: 1, slideIdx: 0 })).toBeNull();
  });
  it("skips arrangement entries whose section is missing", () => {
    expect(nextLyricCursor(song, ["v1", "gone", "c"], { sectionIdx: 0, slideIdx: 1 })).toEqual({ sectionIdx: 2, slideIdx: 0 });
    expect(lyricSlideAt(song, ["gone"], { sectionIdx: 0, slideIdx: 0 })).toEqual(NONE_SLIDE);
  });
});

describe("rowTitle", () => {
  it("names each row kind", () => {
    expect(rowTitle(show.rows[0]!, songs, templates)).toBe("Lower third — Welcome");
    expect(rowTitle(show.rows[1]!, songs, templates)).toBe("Amazing Grace");
    expect(rowTitle(show.rows[2]!, songs, templates)).toBe("John 3:16-17");
    expect(rowTitle(show.rows[3]!, songs, templates)).toBe("Announcements");
  });
});

describe("buildStageFeed", () => {
  it("is empty and safe with no followed channel", () => {
    const f = base(null);
    expect(f.current).toEqual(NONE_SLIDE);
    expect(f.next).toEqual(NONE_SLIDE);
    expect(f.row).toBeNull();
    expect(f.nextRow).toBeNull();
    expect(f.video).toBeNull();
    expect(f.timers).toEqual([]);
    expect(f.serverNow).toBe(1000);
  });

  it("song mid-section: current and next are lyric slides, row and cue from the rundown", () => {
    const f = base(songState(0, 0));
    expect(f.current).toEqual({ kind: "lyric", lines: ["A1"], reference: "Verse 1" });
    expect(f.next).toEqual({ kind: "lyric", lines: ["B1", "B2"], reference: "Verse 1" });
    expect(f.row).toEqual({ title: "Amazing Grace", cue: "Band in" });
    expect(f.nextRow).toEqual({ title: "John 3:16-17", cue: "" });
  });

  it("last lyric slide: next falls through to the next row's first content", () => {
    const f = base(songState(1, 0));
    expect(f.next).toEqual({ kind: "scripture", lines: ["For God so loved"], reference: "John 3:16" });
  });

  it("blanked song shows no current lines but still computes next", () => {
    const s = songState(0, 0);
    s.songSession!.blanked = true;
    const f = base(s);
    expect(f.current).toEqual(NONE_SLIDE);
    expect(f.next.lines).toEqual(["B1", "B2"]);
  });

  it("scripture: next slide, then next row after the last slide", () => {
    const scr = (slideIdx: number): ChannelState => ({
      channel: "program",
      active: { templateId: "scr", data: {}, phase: "on", takenAt: 1 },
      scriptureSession: {
        rowId: "r-scr",
        reference: "John 3:16-17",
        slideIdx,
        slideCount: 2,
        slideReference: slideIdx === 0 ? "John 3:16" : "John 3:17",
        text: slideIdx === 0 ? "For God so loved" : "For God sent not",
      },
      liveRow: { showId: "show-1", rowId: "r-scr" },
    });
    const first = base(scr(0));
    expect(first.current).toEqual({ kind: "scripture", lines: ["For God so loved"], reference: "John 3:16" });
    expect(first.next).toEqual({ kind: "scripture", lines: ["For God sent not"], reference: "John 3:17" });
    const last = base(scr(1));
    expect(last.next).toEqual({ kind: "graphic", lines: ["Announcements"], reference: "Video" });
  });

  it("graphic: current lines are the template's non-empty text fields", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Jane", role: "", img: "x.png" }, phase: "on", takenAt: 1 },
      liveRow: { showId: "show-1", rowId: "r-welcome" },
    });
    expect(f.current).toEqual({ kind: "graphic", lines: ["Jane"], reference: "Lower third" });
    expect(f.row).toEqual({ title: "Lower third — Welcome", cue: "Smile" });
    expect(f.next).toEqual({ kind: "lyric", lines: ["A1"], reference: "Amazing Grace" });
  });

  it("a graphic in its out phase is not current", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Jane" }, phase: "out", takenAt: 1 },
    });
    expect(f.current).toEqual(NONE_SLIDE);
  });

  it("song intro on air with the song queued: next is the song's first slide", () => {
    const f = base({
      channel: "program",
      active: { templateId: "lt", data: { name: "Amazing Grace" }, phase: "on", takenAt: 1, subTakeContext: { songRowId: "r-song", sub: "intro" } },
      queuedSong: { songId: "song-1", songRowId: "r-song", title: "Amazing Grace" },
      liveRow: { showId: "show-1", rowId: "r-song" },
    });
    expect(f.next).toEqual({ kind: "lyric", lines: ["A1"], reference: "Amazing Grace" });
  });

  it("live row deleted from the show: row/nextRow null, session next still works", () => {
    const s = songState(0, 0);
    s.liveRow = { showId: "show-1", rowId: "deleted" };
    const f = base(s);
    expect(f.row).toBeNull();
    expect(f.nextRow).toBeNull();
    expect(f.next.lines).toEqual(["B1", "B2"]);
  });

  it("show missing: row null, last slide next is none", () => {
    const f = base(songState(1, 0), { show: null });
    expect(f.row).toBeNull();
    expect(f.next).toEqual(NONE_SLIDE);
  });

  it("collects running timers from every channel, sorted by channel", () => {
    const followed = songState(0, 0);
    const timerState: ChannelState = {
      channel: "a-timers",
      active: { templateId: "timer", data: { t: "5000" }, phase: "on", takenAt: 1 },
    };
    const f = base(followed, { allStates: [followed, timerState] });
    expect(f.timers).toEqual([
      { label: "Service starts", channel: "a-timers", mode: "countdown", format: "M:SS", value: "5000" },
    ]);
  });

  it("skips timers with an unparseable value", () => {
    const timerState: ChannelState = {
      channel: "t",
      active: { templateId: "timer", data: { t: "" }, phase: "on", takenAt: 1 },
    };
    expect(base(null, { allStates: [timerState] }).timers).toEqual([]);
  });

  it("reports video on the followed channel until it ends", () => {
    const media = (status: "playing" | "ended"): ChannelState => ({
      channel: "program",
      active: null,
      media: {
        rowId: "r-vid",
        assetUrl: "/assets/v.mp4",
        label: "Announcements",
        volume: 1,
        endAction: "clear",
        transitionIn: { style: "cut", durationMs: 0 },
        transitionOut: { style: "cut", durationMs: 0 },
        takenAt: 1,
        paused: false,
        playback: { status, currentTime: 12, duration: 90, updatedAt: 900 },
      },
      liveRow: { showId: "show-1", rowId: "r-vid" },
    });
    expect(base(media("playing")).video).toEqual({
      status: "playing",
      currentTime: 12,
      duration: 90,
      at: 900,
      label: "Announcements",
    });
    expect(base(media("ended")).video).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/stageFeed.test.ts`
Expected: FAIL — cannot resolve `./stageFeed`.

- [ ] **Step 3: Implement**

Create `server/src/stageFeed.ts`:

```ts
// Pure derivation of a confidence monitor's StageFeed. All I/O (loading
// shows, songs, templates, configs) lives in stageFeedHub.ts so this file
// can be exhaustively unit-tested.

import {
  NONE_SLIDE,
  decodeTimerValue,
  resolveArrangement,
  type ChannelState,
  type RundownRow,
  type Show,
  type SlideView,
  type Song,
  type StageFeed,
  type StageLayout,
  type StageRowView,
  type StageTimer,
  type StageVideo,
  type Template,
} from "@overlaysys/core";
import { scriptureSlideData } from "@overlaysys/scripture";

export interface StageFeedInputs {
  layout: StageLayout;
  followed: ChannelState | null;
  allStates: ChannelState[];
  show: Show | null;
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  now: number;
}

type Cursor = { sectionIdx: number; slideIdx: number };

function sectionFor(song: Song, arrangement: string[], sectionIdx: number) {
  const id = arrangement[sectionIdx];
  return id === undefined ? undefined : song.sections.find((s) => s.id === id);
}

export function lyricSlideAt(song: Song, arrangement: string[], cursor: Cursor): SlideView {
  const section = sectionFor(song, arrangement, cursor.sectionIdx);
  const slide = section?.slides[cursor.slideIdx];
  if (!section || !slide) return NONE_SLIDE;
  return { kind: "lyric", lines: slide.lines, reference: section.label };
}

/** Next slide in arrangement order, skipping missing sections; null at the end. */
export function nextLyricCursor(song: Song, arrangement: string[], cursor: Cursor): Cursor | null {
  const section = sectionFor(song, arrangement, cursor.sectionIdx);
  if (section && cursor.slideIdx + 1 < section.slides.length) {
    return { sectionIdx: cursor.sectionIdx, slideIdx: cursor.slideIdx + 1 };
  }
  for (let i = cursor.sectionIdx + 1; i < arrangement.length; i++) {
    if (sectionFor(song, arrangement, i)) return { sectionIdx: i, slideIdx: 0 };
  }
  return null;
}

function textFieldLines(template: Template | undefined, data: Record<string, string>): string[] {
  if (!template) return [];
  return template.fields
    .filter((f) => f.type === "text")
    .map((f) => (data[f.key] ?? "").trim())
    .filter((v) => v !== "");
}

export function rowTitle(row: RundownRow, songs: Map<string, Song>, templates: Map<string, Template>): string {
  switch (row.kind) {
    case "graphic": {
      const tpl = templates.get(row.templateId);
      const first = textFieldLines(tpl, row.data)[0];
      const name = tpl?.name ?? "Graphic";
      return first ? `${name} — ${first}` : name;
    }
    case "song":
      return songs.get(row.songId)?.title ?? "Song";
    case "scripture":
      return row.reference;
    case "video":
      return row.label ?? "Video";
  }
}

function rowView(row: RundownRow, songs: Map<string, Song>, templates: Map<string, Template>): StageRowView {
  return { title: rowTitle(row, songs, templates), cue: row.notes?.trim() ?? "" };
}

function scriptureView(row: Extract<RundownRow, { kind: "scripture" }>, slideIdx: number): SlideView {
  const d = scriptureSlideData(row, slideIdx);
  return { kind: "scripture", lines: d.text.split("\n"), reference: d.reference };
}

/** What a row puts on screen first. */
export function firstContentOf(
  row: RundownRow | null,
  show: Show,
  songs: Map<string, Song>,
  templates: Map<string, Template>,
): SlideView {
  if (!row) return NONE_SLIDE;
  switch (row.kind) {
    case "song": {
      const song = songs.get(row.songId);
      if (!song) return NONE_SLIDE;
      const showSong = show.songs.find((s) => s.songId === row.songId);
      const arrangement = resolveArrangement(row, showSong, song);
      const view = lyricSlideAt(song, arrangement, { sectionIdx: 0, slideIdx: 0 });
      return view.kind === "none" ? view : { ...view, reference: song.title };
    }
    case "scripture":
      return scriptureView(row, 0);
    case "graphic": {
      const tpl = templates.get(row.templateId);
      return { kind: "graphic", lines: textFieldLines(tpl, row.data), reference: tpl?.name ?? "Graphic" };
    }
    case "video":
      return { kind: "graphic", lines: [row.label ?? "Video"], reference: "Video" };
  }
}

function currentOf(s: ChannelState, songs: Map<string, Song>, templates: Map<string, Template>): SlideView {
  if (s.songSession) {
    if (s.songSession.blanked) return NONE_SLIDE;
    const song = songs.get(s.songSession.songId);
    return song ? lyricSlideAt(song, s.songSession.arrangement, s.songSession.cursor) : NONE_SLIDE;
  }
  if (s.scriptureSession) {
    return {
      kind: "scripture",
      lines: s.scriptureSession.text.split("\n"),
      reference: s.scriptureSession.slideReference,
    };
  }
  if (s.active && s.active.phase !== "out") {
    const tpl = templates.get(s.active.templateId);
    return { kind: "graphic", lines: textFieldLines(tpl, s.active.data), reference: tpl?.name ?? "Graphic" };
  }
  return NONE_SLIDE;
}

function timersOf(states: ChannelState[], templates: Map<string, Template>): StageTimer[] {
  const out: StageTimer[] = [];
  const sorted = [...states].sort((a, b) => a.channel.localeCompare(b.channel));
  for (const s of sorted) {
    if (!s.active || s.active.phase === "out") continue;
    const tpl = templates.get(s.active.templateId);
    if (!tpl) continue;
    for (const f of tpl.fields) {
      if (f.type !== "time" || (f.timeMode !== "countdown" && f.timeMode !== "countup")) continue;
      const value = s.active.data[f.key] ?? "";
      if (!Number.isFinite(decodeTimerValue(value).anchor)) continue;
      out.push({
        label: f.label || tpl.name,
        channel: s.channel,
        mode: f.timeMode,
        ...(f.timeFormat ? { format: f.timeFormat } : {}),
        value,
      });
    }
  }
  return out;
}

function videoOf(s: ChannelState | null): StageVideo | null {
  const m = s?.media;
  if (!m) return null;
  const { status, currentTime, duration, updatedAt } = m.playback;
  if (status === "ended" || status === "error") return null;
  return { status, currentTime, duration, at: updatedAt, ...(m.label !== undefined ? { label: m.label } : {}) };
}

export function buildStageFeed(i: StageFeedInputs): StageFeed {
  const { followed, show, songs, templates } = i;
  const liveRow = followed?.liveRow;
  const idx = show && liveRow ? show.rows.findIndex((r) => r.id === liveRow.rowId) : -1;
  const row = show && idx >= 0 ? show.rows[idx]! : null;
  const nextRowObj = show && idx >= 0 ? show.rows[idx + 1] ?? null : null;

  const current = followed ? currentOf(followed, songs, templates) : NONE_SLIDE;

  let next: SlideView = NONE_SLIDE;
  if (followed) {
    const sess = followed.songSession;
    const song = sess ? songs.get(sess.songId) : undefined;
    if (sess && song) {
      const c = nextLyricCursor(song, sess.arrangement, sess.cursor);
      if (c) next = lyricSlideAt(song, sess.arrangement, c);
    } else if (followed.scriptureSession && row?.kind === "scripture" && row.id === followed.scriptureSession.rowId) {
      const n = followed.scriptureSession.slideIdx + 1;
      if (n < row.slides.length) next = scriptureView(row, n);
    } else if (
      show &&
      row &&
      ((row.kind === "song" && followed.queuedSong?.songRowId === row.id) ||
        (row.kind === "scripture" && followed.queuedScripture?.rowId === row.id))
    ) {
      // An intro is on air with its row armed: next is the row's own first slide.
      next = firstContentOf(row, show, songs, templates);
    }
    if (next.kind === "none" && show && row) {
      next = firstContentOf(nextRowObj, show, songs, templates);
    }
  }

  return {
    layout: i.layout,
    current,
    next,
    row: row ? rowView(row, songs, templates) : null,
    nextRow: nextRowObj ? rowView(nextRowObj, songs, templates) : null,
    timers: timersOf(i.allStates, templates),
    video: videoOf(followed),
    serverNow: i.now,
  };
}
```

Note: `scriptureSlideData` expects a row-like object; `ScriptureRow` satisfies it (the server already calls it with `ScriptureRow` in `scriptureSession.ts`). If `server/package.json` lacks `@overlaysys/scripture`, it already imports it in `scriptureSession.ts`, so no dependency change.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run server/src/stageFeed.test.ts`
Expected: PASS. If the scripture `reference` for slide 0 differs from `"John 3:16"` (it comes from `slideReference` in `@overlaysys/scripture`), check that function's output for a one-verse slide and fix the **test expectation** to match it, not the implementation.

- [ ] **Step 5: Commit**

```bash
git add server/src/stageFeed.ts server/src/stageFeed.test.ts
git commit -m "feat(server): pure StageFeed derivation"
```

---

### Task 6: Stage feed hub and WebSocket wiring

**Files:**
- Create: `server/src/stageFeedHub.ts`
- Modify: `server/src/ws.ts`
- Test: `server/src/stageFeedHub.test.ts`

**Interfaces:**
- Consumes: `buildStageFeed` (Task 5); `channels.getState`, `channels.allStates`, `channels.onAnyChange` (Task 3); `channelConfigs.getChannelConfig`; `shows.getShow`; `songs.getSong`; `templates.getTemplate`; `resolveStageLayout`, `DEFAULT_STAGE_FOLLOWS`.
- Produces:
  - `computeFeed(channel: string, now?: number): Promise<StageFeed | null>` — null unless the channel's config has `kind: "stage"`.
  - `subscribeStage(channel: string, send: (channel: string, feed: StageFeed) => void): () => void` — pushes immediately (if stage) and on every invalidation.
  - `invalidateAll(): void` — debounced rebuild of every subscribed channel.
  - `STAGE_FEED_DEBOUNCE_MS = 50`.

- [ ] **Step 1: Write the failing test**

Create `server/src/stageFeedHub.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelConfigSchema, type ChannelConfig } from "@overlaysys/core";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";
import * as hub from "./stageFeedHub";

const configs = new Map<string, ChannelConfig>();
function cfg(raw: Record<string, unknown>) {
  const c = ChannelConfigSchema.parse(raw);
  configs.set(c.id, c);
}

describe("stageFeedHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    configs.clear();
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => configs.get(id) ?? null);
    vi.spyOn(shows, "getShow").mockResolvedValue(null);
    vi.spyOn(songs, "getSong").mockResolvedValue(null);
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns null for graphics channels", async () => {
    cfg({ id: "program", name: "Program" });
    expect(await hub.computeFeed("program")).toBeNull();
  });

  it("builds a feed for a stage channel with the default layout", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const feed = await hub.computeFeed("pastor", 42);
    expect(feed?.layout.id).toBe("speaker");
    expect(feed?.serverNow).toBe(42);
  });

  it("treats a stage channel following itself or another stage channel as following nothing", async () => {
    cfg({ id: "a", name: "A", kind: "stage", follows: "a" });
    cfg({ id: "b", name: "B", kind: "stage", follows: "a" });
    expect((await hub.computeFeed("a"))?.current.kind).toBe("none");
    expect((await hub.computeFeed("b"))?.current.kind).toBe("none");
  });

  it("pushes on subscribe and once per debounce window on invalidation", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const send = vi.fn();
    const off = hub.subscribeStage("pastor", send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    hub.invalidateAll();
    hub.invalidateAll();
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toBe("pastor");
    off();
  });

  it("does not push to graphics-channel subscribers", async () => {
    cfg({ id: "program", name: "Program" });
    const send = vi.fn();
    const off = hub.subscribeStage("program", send);
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).not.toHaveBeenCalled();
    off();
  });

  it("stops pushing after unsubscribe", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    const send = vi.fn();
    const off = hub.subscribeStage("pastor", send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    off();
    hub.invalidateAll();
    await vi.advanceTimersByTimeAsync(hub.STAGE_FEED_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/stageFeedHub.test.ts`
Expected: FAIL — cannot resolve `./stageFeedHub`.

- [ ] **Step 3: Implement the hub**

Create `server/src/stageFeedHub.ts`:

```ts
// Loads the inputs for buildStageFeed and pushes feeds to subscribers of
// stage channels. Every channel subscription registers here; channels whose
// config isn't `kind: "stage"` simply never get a feed, so flipping a
// channel's kind takes effect on the next invalidation without resubscribing.

import {
  DEFAULT_STAGE_FOLLOWS,
  resolveStageLayout,
  type Song,
  type StageFeed,
  type Template,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songs from "./songs";
import * as templates from "./templates";
import { buildStageFeed } from "./stageFeed";

export const STAGE_FEED_DEBOUNCE_MS = 50;

type Send = (channel: string, feed: StageFeed) => void;

const subs = new Map<string, Set<Send>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export async function computeFeed(channel: string, now = Date.now()): Promise<StageFeed | null> {
  const cfg = await channelConfigs.getChannelConfig(channel);
  if (!cfg || cfg.kind !== "stage") return null;
  const followsId = cfg.follows ?? DEFAULT_STAGE_FOLLOWS;
  const followedCfg = await channelConfigs.getChannelConfig(followsId);
  // A channel with no config can still carry state (ad-hoc ids); a stage
  // channel (including this one) has nothing worth following.
  const followed = followedCfg?.kind === "stage" ? null : channels.getState(followsId);
  const allStates = channels.allStates();

  const show = followed?.liveRow ? await shows.getShow(followed.liveRow.showId) : null;
  const rowIdx = show && followed?.liveRow ? show.rows.findIndex((r) => r.id === followed.liveRow!.rowId) : -1;
  const nearRows = show && rowIdx >= 0 ? show.rows.slice(rowIdx, rowIdx + 2) : [];

  const songIds = new Set<string>();
  if (followed?.songSession) songIds.add(followed.songSession.songId);
  const templateIds = new Set<string>();
  for (const s of allStates) if (s.active) templateIds.add(s.active.templateId);
  for (const r of nearRows) {
    if (r.kind === "song") songIds.add(r.songId);
    if (r.kind === "graphic") templateIds.add(r.templateId);
  }

  const songMap = new Map<string, Song>();
  for (const id of songIds) {
    const s = await songs.getSong(id);
    if (s) songMap.set(id, s);
  }
  const templateMap = new Map<string, Template>();
  for (const id of templateIds) {
    const t = await templates.getTemplate(id);
    if (t) templateMap.set(id, t);
  }

  return buildStageFeed({
    layout: resolveStageLayout(cfg.layoutId),
    followed,
    allStates,
    show,
    songs: songMap,
    templates: templateMap,
    now,
  });
}

async function pushTo(channel: string, targets: Iterable<Send>): Promise<void> {
  const feed = await computeFeed(channel);
  if (!feed) return;
  for (const send of targets) send(channel, feed);
}

export function subscribeStage(channel: string, send: Send): () => void {
  let set = subs.get(channel);
  if (!set) {
    set = new Set();
    subs.set(channel, set);
  }
  set.add(send);
  void pushTo(channel, [send]);
  return () => {
    const cur = subs.get(channel);
    if (!cur) return;
    cur.delete(send);
    if (cur.size === 0) subs.delete(channel);
  };
}

export function invalidateAll(): void {
  for (const channel of subs.keys()) {
    if (pending.has(channel)) continue;
    pending.set(
      channel,
      setTimeout(() => {
        pending.delete(channel);
        const targets = subs.get(channel);
        if (targets) void pushTo(channel, [...targets]);
      }, STAGE_FEED_DEBOUNCE_MS),
    );
  }
}
```

- [ ] **Step 4: Run hub tests**

Run: `pnpm vitest run server/src/stageFeedHub.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `ws.ts`**

Add the import next to the other server modules:

```ts
import * as stageFeedHub from "./stageFeedHub";
```

In the module-scope subscriptions section (near `songSession.onMatch`):

```ts
// Any channel change can alter what a confidence monitor shows (a timer on
// another channel, the followed channel's take), so rebuild every feed.
channels.onAnyChange(() => stageFeedHub.invalidateAll());
```

In `case "subscribe"`, after `unsubPlayback` is created:

```ts
          const unsubStage = stageFeedHub.subscribeStage(parsed.channel, (channel, feed) => {
            send({ type: "stage_feed", channel, feed });
          });
```

and include `unsubStage();` in the cleanup closure stored in `subscriptions`.

In the already-subscribed branch at the top of `case "subscribe"` (the resync that re-sends `state`), also re-send the feed:

```ts
            void stageFeedHub.computeFeed(parsed.channel).then((feed) => {
              if (feed) send({ type: "stage_feed", channel: parsed.channel, feed });
            });
```

Add `stageFeedHub.invalidateAll();` after the successful write in each of: `save_show`, `delete_show`, `save_song`, `delete_song`, `save_template`, `delete_template`, `save_channel`, `delete_channel`.

- [ ] **Step 6: Run server tests and typecheck**

Run: `pnpm vitest run server/src`
Expected: PASS (including `ws.test.ts`; if it asserts the exact set of messages sent on subscribe, a graphics channel sends no `stage_feed`, so no change should be needed).
Run: `pnpm --filter ./server typecheck` (or `pnpm -r typecheck`)
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/src/stageFeedHub.ts server/src/stageFeedHub.test.ts server/src/ws.ts
git commit -m "feat(server): push stage_feed to stage channel subscribers"
```

---

### Task 7: Renderer pure helpers — time and auto-fit

**Files:**
- Create: `apps/renderer/src/stage/stageTime.ts`, `apps/renderer/src/stage/fitText.ts`
- Test: `apps/renderer/src/stage/stageTime.test.ts`, `apps/renderer/src/stage/fitText.test.ts`

**Interfaces:**
- Consumes: `StageTimer`, `StageVideo` (Task 3); `computeTimeDisplay`, `formatTime` from `@overlaysys/core`.
- Produces:
  - `serverOffset(serverNow: number, localNow: number): number`
  - `formatClockDisplay(ms: number, format: "12h" | "24h", seconds: boolean): string` (uses local time zone of `new Date(ms)`)
  - `timerDisplay(t: StageTimer, serverNowMs: number): string`
  - `videoRemainingSec(v: StageVideo, serverNowMs: number): number`
  - `formatRemaining(sec: number): string` → `"M:SS"` or `"H:MM:SS"`
  - `fitFontSize(maxSize: number, minSize: number, fits: (size: number) => boolean): number`

- [ ] **Step 1: Write the failing tests**

`apps/renderer/src/stage/stageTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatClockDisplay, formatRemaining, serverOffset, timerDisplay, videoRemainingSec } from "./stageTime";

describe("stageTime", () => {
  it("serverOffset is server minus local", () => {
    expect(serverOffset(1500, 1000)).toBe(500);
  });

  it("formats a 12h and 24h clock", () => {
    const ms = new Date(2026, 0, 1, 15, 7, 9).getTime();
    expect(formatClockDisplay(ms, "12h", false)).toBe("3:07 PM");
    expect(formatClockDisplay(ms, "12h", true)).toBe("3:07:09 PM");
    expect(formatClockDisplay(ms, "24h", false)).toBe("15:07");
    const midnight = new Date(2026, 0, 1, 0, 5, 0).getTime();
    expect(formatClockDisplay(midnight, "12h", false)).toBe("12:05 AM");
  });

  it("ticks a countdown and freezes a paused one", () => {
    const running = { label: "x", channel: "c", mode: "countdown" as const, value: "65000" };
    expect(timerDisplay(running, 5000)).toBe("01:00");
    const paused = { ...running, value: JSON.stringify({ a: 65000, p: 35000 }), format: "M:SS" as const };
    expect(timerDisplay(paused, 60000)).toBe("0:30");
  });

  it("interpolates playing video and freezes paused video", () => {
    const v = { status: "playing" as const, currentTime: 10, duration: 70, at: 1000 };
    expect(videoRemainingSec(v, 3000)).toBe(58);
    expect(videoRemainingSec({ ...v, status: "paused" }, 3000)).toBe(60);
    expect(videoRemainingSec(v, 999_999)).toBe(0);
  });

  it("formats remaining time", () => {
    expect(formatRemaining(59.4)).toBe("0:59");
    expect(formatRemaining(61)).toBe("1:01");
    expect(formatRemaining(3725)).toBe("1:02:05");
  });
});
```

`apps/renderer/src/stage/fitText.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitFontSize } from "./fitText";

describe("fitFontSize", () => {
  it("returns max when it already fits", () => {
    expect(fitFontSize(80, 12, () => true)).toBe(80);
  });
  it("finds the largest size that fits", () => {
    expect(fitFontSize(80, 12, (s) => s <= 37)).toBe(37);
  });
  it("returns min when nothing fits", () => {
    expect(fitFontSize(80, 12, () => false)).toBe(12);
  });
  it("probes O(log n) sizes", () => {
    let calls = 0;
    fitFontSize(200, 10, (s) => {
      calls++;
      return s <= 100;
    });
    expect(calls).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/renderer/src/stage`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`apps/renderer/src/stage/stageTime.ts`:

```ts
import { computeTimeDisplay, type StageTimer, type StageVideo } from "@overlaysys/core";

/** Add to Date.now() to approximate server time. */
export function serverOffset(serverNow: number, localNow: number): number {
  return serverNow - localNow;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatClockDisplay(ms: number, format: "12h" | "24h", seconds: boolean): string {
  const d = new Date(ms);
  const h = d.getHours();
  const tail = `${pad2(d.getMinutes())}${seconds ? `:${pad2(d.getSeconds())}` : ""}`;
  if (format === "24h") return `${pad2(h)}:${tail}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${tail} ${h < 12 ? "AM" : "PM"}`;
}

export function timerDisplay(t: StageTimer, serverNowMs: number): string {
  return computeTimeDisplay(
    { key: "t", label: t.label, type: "time", timeMode: t.mode, ...(t.format ? { timeFormat: t.format } : {}) },
    t.value,
    serverNowMs,
  );
}

export function videoRemainingSec(v: StageVideo, serverNowMs: number): number {
  const elapsed = v.status === "playing" ? Math.max(0, (serverNowMs - v.at) / 1000) : 0;
  return Math.max(0, v.duration - (v.currentTime + elapsed));
}

export function formatRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}
```

`apps/renderer/src/stage/fitText.ts`:

```ts
/**
 * Largest integer font size in [minSize, maxSize] for which `fits` holds,
 * assuming fits is monotone (true below some threshold). Shared with the
 * phase-5 designer so preview and output match.
 */
export function fitFontSize(maxSize: number, minSize: number, fits: (size: number) => boolean): number {
  let lo = Math.ceil(minSize);
  let hi = Math.floor(maxSize);
  if (fits(hi)) return hi;
  let best = lo;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/renderer/src/stage`
Expected: PASS. (If the countdown expectation's zero-padding differs, `computeTimeDisplay` defaults to `"MM:SS"` — `"01:00"` is correct for 60 s.)

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/stage
git commit -m "feat(renderer): stage time and auto-fit helpers"
```

---

### Task 8: `StageView` and widgets in the renderer

**Files:**
- Create: `apps/renderer/src/stage/useFitText.ts`, `apps/renderer/src/stage/widgets.tsx`, `apps/renderer/src/stage/StageView.tsx`
- Modify: `apps/renderer/src/Renderer.tsx`

**Interfaces:**
- Consumes: `StageFeed`, `StageWidget`, `StageWidgetStyle` (Tasks 2–3); Task 7 helpers; `stage_feed` server message (Task 3).
- Produces: `<StageView feed={StageFeed} offsetMs={number} connected={boolean} />` and `<StageWidgetView widget feed nowMs />` (exported for the phase-5 designer).

This task is UI; there is no DOM test environment. Verify manually (Step 5).

- [ ] **Step 1: Auto-fit hook**

`apps/renderer/src/stage/useFitText.ts`:

```ts
import { useLayoutEffect, useRef, useState } from "react";
import { fitFontSize } from "./fitText";

const MIN_FONT = 12;

/** Shrinks the element's font from maxSize until it no longer overflows. Re-fits when `dep` changes. */
export function useFitText<T extends HTMLElement>(maxSize: number, enabled: boolean, dep: unknown) {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState(maxSize);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) {
      setSize(maxSize);
      return;
    }
    const fits = (s: number) => {
      el.style.fontSize = `${s}px`;
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    const best = fitFontSize(maxSize, MIN_FONT, fits);
    el.style.fontSize = `${best}px`;
    setSize(best);
  }, [maxSize, enabled, dep]);
  return { ref, fontSize: enabled ? size : maxSize };
}
```

- [ ] **Step 2: Widgets**

`apps/renderer/src/stage/widgets.tsx`:

```tsx
import type { CSSProperties, ReactNode } from "react";
import type { SlideView, StageFeed, StageWidget } from "@overlaysys/core";
import { useFitText } from "./useFitText";
import { formatClockDisplay, formatRemaining, timerDisplay, videoRemainingSec } from "./stageTime";

const EMPTY = "—";

function Frame({ widget, children }: { widget: StageWidget; children: ReactNode }) {
  const st = widget.style;
  const box: CSSProperties = {
    position: "absolute",
    left: widget.rect.x,
    top: widget.rect.y,
    width: widget.rect.w,
    height: widget.rect.h,
    boxSizing: "border-box",
    padding: st.padding,
    background: st.background,
    border: st.border ? `${st.border.width}px solid ${st.border.color}` : undefined,
    borderRadius: st.border?.radius,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  return (
    <div style={box}>
      {st.label && (
        <div style={{ fontFamily: st.fontFamily, fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#888", marginBottom: 6 }}>
          {st.label}
        </div>
      )}
      {children}
    </div>
  );
}

function FitBody({ widget, text, dim }: { widget: StageWidget; text: string; dim?: number }) {
  const st = widget.style;
  const { ref, fontSize } = useFitText<HTMLDivElement>(st.fontSize, st.autoFit, text);
  const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[st.vAlign];
  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        fontFamily: st.fontFamily,
        fontSize,
        fontWeight: st.fontWeight,
        color: st.color,
        textAlign: st.align,
        lineHeight: 1.15,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        opacity: dim,
        overflow: "hidden",
      }}
    >
      {text || <span style={{ opacity: 0.3 }}>{EMPTY}</span>}
    </div>
  );
}

function slideText(v: SlideView, maxLines?: number): string {
  const lines = maxLines ? v.lines.slice(0, maxLines) : v.lines;
  return lines.join("\n");
}

export function StageWidgetView({ widget, feed, nowMs }: { widget: StageWidget; feed: StageFeed; nowMs: number }) {
  if (widget.hidden) return null;
  switch (widget.kind) {
    case "currentSlide": {
      const ref = widget.props.showReference ? feed.current.reference : undefined;
      return (
        <Frame widget={widget}>
          {ref && <div style={{ fontSize: 24, color: "#888", fontFamily: widget.style.fontFamily }}>{ref}</div>}
          <FitBody widget={widget} text={slideText(feed.current)} />
        </Frame>
      );
    }
    case "nextSlide":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={slideText(feed.next, widget.props.maxLines)} dim={widget.props.dimOpacity} />
        </Frame>
      );
    case "rowTitle": {
      const next = widget.props.showNext && feed.nextRow ? `  →  ${feed.nextRow.title}` : "";
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={feed.row ? `${feed.row.title}${next}` : ""} />
        </Frame>
      );
    }
    case "rowCue": {
      const parts = [feed.row?.cue ?? ""];
      if (widget.props.includeNextRow && feed.nextRow?.cue) parts.push(`Next: ${feed.nextRow.cue}`);
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={parts.filter(Boolean).join("\n\n")} />
        </Frame>
      );
    }
    case "clock":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={formatClockDisplay(nowMs, widget.props.format, widget.props.seconds)} />
        </Frame>
      );
    case "timer": {
      const src = widget.props.source;
      const t = src === "firstActive" ? feed.timers[0] : feed.timers.find((x) => x.channel === src.channel);
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={t ? timerDisplay(t, nowMs) : ""} />
        </Frame>
      );
    }
    case "videoRemaining": {
      const v = feed.video;
      const sec = v ? videoRemainingSec(v, nowMs) : 0;
      const warn = v && sec <= widget.props.warnBelowSec;
      return (
        <Frame widget={{ ...widget, style: { ...widget.style, color: warn ? "#ff5c5c" : widget.style.color } }}>
          <FitBody
            widget={{ ...widget, style: { ...widget.style, color: warn ? "#ff5c5c" : widget.style.color } }}
            text={v ? `-${formatRemaining(sec)}` : ""}
          />
        </Frame>
      );
    }
    case "text":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={widget.props.text} />
        </Frame>
      );
  }
}
```

- [ ] **Step 3: `StageView`**

`apps/renderer/src/stage/StageView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { StageFeed } from "@overlaysys/core";
import { StageWidgetView } from "./widgets";

/** Re-render at 4 Hz so clocks, timers and video remaining tick locally. */
function useNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offsetMs), 250);
    return () => clearInterval(id);
  }, [offsetMs]);
  return now;
}

function useFitScale(w: number, h: number): number {
  const calc = () => Math.min(window.innerWidth / w, window.innerHeight / h);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    const onResize = () => setScale(calc());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);
  return scale;
}

export function StageView({ feed, offsetMs, connected }: { feed: StageFeed; offsetMs: number; connected: boolean }) {
  const { layout } = feed;
  const now = useNow(offsetMs);
  const scale = useFitScale(layout.size.w, layout.size.h);
  return (
    <div style={{ position: "fixed", inset: 0, background: layout.background, zIndex: 10, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: layout.size.w,
          height: layout.size.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
        }}
      >
        {layout.widgets.map((w) => (
          <StageWidgetView key={w.id} widget={w} feed={feed} nowMs={now} />
        ))}
      </div>
      {!connected && (
        <div
          style={{
            position: "fixed",
            right: 12,
            bottom: 12,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(255,60,60,0.85)",
            color: "#fff",
            font: "600 14px system-ui, sans-serif",
          }}
        >
          disconnected
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Hook into `Renderer.tsx`**

- Imports: `import type { StageFeed } from "@overlaysys/core";` (add to the existing core type import) and `import { StageView } from "./stage/StageView";` and `import { serverOffset } from "./stage/stageTime";`.
- State, next to `latestState`:

```ts
  const [stageFeed, setStageFeed] = useState<{ feed: StageFeed; offsetMs: number } | null>(null);
```

- In the `client.on((msg) => { ... })` chain, add a branch (before the `state` branch):

```ts
      } else if (msg.type === "stage_feed" && msg.channel === channel) {
        setStageFeed({ feed: msg.feed, offsetMs: serverOffset(msg.feed.serverNow, Date.now()) });
```

- In the returned JSX, after the graphics stage `<div ref={stageRef} ... />` and before the debug overlay:

```tsx
      {config?.kind === "stage" && stageFeed && (
        <StageView feed={stageFeed.feed} offsetMs={stageFeed.offsetMs} connected={status === "open"} />
      )}
```

(The graphics stage stays mounted underneath and is empty on a stage channel, so no graphics code paths change.)

Run: `pnpm --filter @overlaysys/renderer typecheck`
Expected: clean.

- [ ] **Step 5: Manual verification**

1. `pnpm dev` (or the repo's usual dev command for server + renderer + operator).
2. Create `data/channels/pastor.json`: `{ "id": "pastor", "name": "Pastor", "kind": "stage" }` (or use Task 9's UI once done).
3. Open `http://localhost:3001/?channel=pastor` — expect the black Speaker layout with a ticking clock and "—" placeholders.
4. In the operator, load a show, take a graphic row with notes → NOW shows "<template> — <first field>", CUE shows the notes, NEXT shows the next row's first content.
5. Take a song row and advance → LIVE shows the current lyric, NEXT the next slide; at the last slide NEXT shows the next row's first content.
6. Fire a hotcard → CUE stays.
7. Take a countdown timer template on any channel → TIMER ticks. Pause it → it freezes.
8. Take a video row → VIDEO counts down; turns red under 30 s; pause freezes it.
9. Stop the server → "disconnected" badge, clock keeps ticking; restart → badge clears and content returns.
10. `http://localhost:3001/?channel=program` still renders graphics exactly as before.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src/stage apps/renderer/src/Renderer.tsx
git commit -m "feat(renderer): render stage channels as a confidence monitor"
```

---

### Task 9: Channel settings — kind, follows, layout

**Files:**
- Modify: `apps/operator/src/app/settings/channels/page.tsx` (the `ChannelRow` editor around lines 380–500)

**Interfaces:**
- Consumes: `ChannelKind`, `BUILT_IN_STAGE_LAYOUTS`, `DEFAULT_STAGE_FOLLOWS` (Tasks 1–2).

UI only; verify manually.

- [ ] **Step 1: Kind selector**

Import `BUILT_IN_STAGE_LAYOUTS`, `DEFAULT_STAGE_FOLLOWS`, `type ChannelKind` from `@overlaysys/core`.

In the row's first grid (the one with name / render mode / mirror), insert a kind `<Select>` right after the name `<Input>`, and change the grid's `gridTemplateColumns` to `"180px 1fr 120px 160px 200px auto auto"`:

```tsx
          <Select
            value={draft.kind}
            onChange={(e) => patch({ kind: e.target.value as ChannelKind })}
            title="Channel kind"
          >
            <option value="graphics">graphics</option>
            <option value="stage">stage monitor</option>
          </Select>
```

- [ ] **Step 2: Stage-only controls replace render mode / mirror**

Wrap the existing render-mode and mirror `<Select>`s in `{draft.kind === "graphics" ? (<>…existing two selects…</>) : (<>…stage selects…</>)}` where the stage branch is:

```tsx
            <>
              <Select
                value={draft.follows ?? DEFAULT_STAGE_FOLLOWS}
                onChange={(e) => patch({ follows: e.target.value })}
                title="Channel whose content this monitor shows"
              >
                {allChannels
                  .filter((o) => o.id !== config.id && o.kind !== "stage")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      follows {o.name}
                    </option>
                  ))}
              </Select>
              <Select
                value={draft.layoutId ?? BUILT_IN_STAGE_LAYOUTS[0]!.id}
                onChange={(e) => patch({ layoutId: e.target.value })}
                title="Stage layout"
              >
                {BUILT_IN_STAGE_LAYOUTS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </>
```

Hide the background editor row and the matte hint for stage channels (the layout's background applies): wrap the background `<div>` in `{draft.kind === "graphics" && (…)}`.

If the project-override editor (`ProjectOverrideEditor`) is shown, also hide it for stage channels: `showOverride && draft.kind === "graphics"`.

- [ ] **Step 3: Typecheck and manual check**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: clean.

Manual: Settings → Channels → set a channel to "stage monitor", pick follows/layout, Save. An already-open renderer window for that channel switches to the monitor within ~50 ms of the save (Task 6's `save_channel` invalidation plus the renderer's `channel_list` handling). Switching it back to graphics hides the monitor.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/settings/channels/page.tsx
git commit -m "feat(operator): configure stage channels in settings"
```

---

### Task 10: Full verification

- [ ] **Step 1:** `pnpm test` — expected: all suites pass.
- [ ] **Step 2:** `pnpm -r typecheck` — expected: clean.
- [ ] **Step 3:** `pnpm -r build` (or `pnpm turbo build`) — expected: success, including the operator static export and the renderer bundle.
- [ ] **Step 4:** Re-run Task 8 Step 5 manual checks 3–10 end-to-end in the Electron app (`apps/desktop`), with the stage channel set to auto-open on a second display via the existing channel window settings popover.
- [ ] **Step 5:** Commit any fixes; the branch is ready for review.
