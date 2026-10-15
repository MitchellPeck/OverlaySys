# Video Playback (Media Slot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a full-frame video with audio (e.g. a giving video during offertory) from a rundown row, in a per-channel media slot beneath graphics, with audio routed to a selectable output device, auto-clear on end, and operator progress/transport controls.

**Architecture:** A new `video` rundown row kind and a new `ChannelState.media` slot that is independent of `active`. Transport is declarative state on the server (`paused`, `seek.seq`), renderers converge on it and report playback back with `media_status`; the server rebroadcasts status transitions as `state` and time ticks as a lightweight `media_playback` message. Audio device choice is a per-machine Electron channel-window pref passed to the renderer as URL params and applied with `HTMLMediaElement.setSinkId`.

**Tech Stack:** TypeScript, zod, Fastify + ws (server), React 18 + Vite (renderer), Next.js (operator), Electron (desktop), vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-video-playback-design.md`

## Global Constraints

- Audio device selection applies to **Electron desktop channel windows only**; OBS Browser Source is untouched.
- One video per channel; a new `media_take` replaces the current one.
- No fades, playlists, looping mode, or preview→program promotion of media (`take_pvw_to_pgm` must not touch `media`).
- Graphic `take` / `clear` / `update` / `takePvwToPgm` / `setActiveNull` must never modify `media`, and media functions must never modify `active`.
- Mirror/matte renderers play video **muted** and **never send `media_status`**.
- `endAction` default is `"clear"`; `volume` default is `1`, range 0–1.
- Time ticks: renderer reports every 250 ms while playing; server sends them as `media_playback`, not `state`.
- The operator machine must never play media audio (ChannelPreview shows a text indicator, not a `<video>`).
- `PROTOCOL_VERSION` becomes `2`.
- The repo's `pnpm typecheck` and `pnpm test` are green at baseline (641 tests); every task ends with both green.

## Review Focus

1. **Two takes in the same millisecond / stale `ended`** — a late `ended` from take N must not clear take N+1. `mediaTake` guarantees strictly increasing `takenAt` (Task 3 test "stale ended after re-take").
2. **Renderer reconnect mid-video** — must resume near the last reported time and must *not* re-apply an old seek (Task 5 `initialMountPlan` tests).
3. **Saved audio device unplugged / renamed id** — falls back to label match, then to default output with a visible warning, never silence (Task 5 `pickAudioSink` tests).
4. **Operator on a different machine than the server (clock skew)** — progress interpolation uses the operator's local receive time, not server `updatedAt` (Task 8 `displayTime` tests).
5. **Exporting/importing a show bundle containing a video row** — the video asset must travel with the bundle and be retargeted on import (Task 4 bundle tests).

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/channel.ts` (modify) | `MediaEndActionSchema`, `MediaStatusSchema`, `MediaPlaybackSchema`, `ChannelMediaSchema`, `ChannelState.media` |
| `packages/core/src/show.ts` (modify) | `VideoRowSchema`, add to `RundownRowSchema` union |
| `packages/core/src/channelWindowPrefs.ts` (modify) | `audioOutput` pref |
| `packages/core/src/bundle.ts` (modify) | include/rewrite video row assets |
| `packages/ws-protocol/src/index.ts` (modify) | 4 client messages, `media_playback` server message, version 2 |
| `server/src/channels.ts` (modify) | `mediaTake/mediaClear/mediaControl/mediaStatus/subscribeMediaPlayback` |
| `server/src/channelsMedia.test.ts` (create) | server media logic tests |
| `server/src/ws.ts` (modify) | route new messages, playback subscription |
| `server/src/bundleApply.ts` (modify) | normalize/retarget video row asset URL |
| `apps/renderer/src/mediaSync.ts` (create) | pure helpers: URL resolve, sink pick, seek/mount planning |
| `apps/renderer/src/mediaSync.test.ts` (create) | tests for the above |
| `apps/renderer/src/MediaLayer.tsx` (create) | `<video>` lifecycle, sink, reporting |
| `apps/renderer/src/Renderer.tsx` (modify) | render `MediaLayer` beneath stage |
| `apps/desktop/src/rendererUrl.ts` (create) | pure `buildRendererChannelUrl` |
| `apps/desktop/src/rendererUrl.test.ts` (create) | tests |
| `apps/desktop/src/main.ts` (modify) | use helper, autoplay policy |
| `apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx` (modify) | Audio output dropdown |
| `apps/operator/src/lib/mediaTime.ts` (create) | pure progress/status display math |
| `apps/operator/src/lib/mediaTime.test.ts` (create) | tests |
| `apps/operator/src/lib/store.ts`, `useWs.ts` (modify) | merge `media_playback`, local receive time |
| `apps/operator/src/app/components/MediaTransportStrip.tsx` (create) | operator transport UI |
| `apps/operator/src/app/components/TakePanel.tsx`, `SongModePanel` host `page.tsx`, `ChannelPreview.tsx` (modify) | mount strip, preview indicator |
| `apps/operator/src/app/components/VideoRowModal.tsx` (create) | add/edit video row |
| `apps/operator/src/app/shows/edit/page.tsx`, `components/Rundown.tsx`, `hooks/useGlobalShortcuts.ts` (modify) | row editing, display, take |
| `packages/companion-module/src/{actions,feedbacks,labels}.ts` (modify) | exhaustive handling of `video` rows |

---

### Task 1: Core schemas — `ChannelMedia` and `VideoRow`

**Files:**
- Modify: `packages/core/src/channel.ts`
- Modify: `packages/core/src/show.ts` (row schemas + `RundownRowSchema` union at ~line 150)
- Create: `packages/core/src/channel.test.ts`
- Modify: `packages/core/src/show.test.ts`

**Interfaces:**
- Produces (exported from `@overlaysys/core`):
  - `MediaEndActionSchema` / `type MediaEndAction = "clear" | "hold"`
  - `MediaStatusSchema` / `type MediaStatus = "loading" | "playing" | "paused" | "ended" | "error"`
  - `MediaPlaybackSchema` / `type MediaPlayback = { status; currentTime: number; duration: number; updatedAt: number; error?: string }`
  - `ChannelMediaSchema` / `type ChannelMedia = { rowId; assetUrl; label?; volume; endAction; takenAt; paused: boolean; seek?: { time: number; seq: number }; playback: MediaPlayback }`
  - `ChannelState.media?: ChannelMedia | null`
  - `VideoRowSchema` / `type VideoRow = { kind: "video"; id; assetUrl; label?; durationSec?; volume: number; endAction: MediaEndAction; channelHint?; notes?; sourceRef? }`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/channel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChannelStateSchema, ChannelMediaSchema } from "./channel";

const media = {
  rowId: "r1",
  assetUrl: "/assets/abc.mp4",
  volume: 1,
  endAction: "clear",
  takenAt: 1000,
  paused: false,
  playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: 1000 },
};

describe("ChannelMediaSchema", () => {
  it("parses a fresh take", () => {
    const m = ChannelMediaSchema.parse(media);
    expect(m.seek).toBeUndefined();
    expect(m.playback.status).toBe("loading");
  });

  it("parses seek and error", () => {
    const m = ChannelMediaSchema.parse({
      ...media,
      seek: { time: 12.5, seq: 3 },
      playback: { ...media.playback, status: "error", error: "boom" },
    });
    expect(m.seek).toEqual({ time: 12.5, seq: 3 });
    expect(m.playback.error).toBe("boom");
  });

  it("rejects an unknown status", () => {
    expect(() =>
      ChannelMediaSchema.parse({ ...media, playback: { ...media.playback, status: "buffering" } }),
    ).toThrow();
  });
});

describe("ChannelStateSchema.media", () => {
  it("is optional (legacy state)", () => {
    const s = ChannelStateSchema.parse({ channel: "program", active: null });
    expect(s.media).toBeUndefined();
  });

  it("accepts null and a media object", () => {
    expect(ChannelStateSchema.parse({ channel: "p", active: null, media: null }).media).toBeNull();
    expect(ChannelStateSchema.parse({ channel: "p", active: null, media }).media?.rowId).toBe("r1");
  });
});
```

Append to `packages/core/src/show.test.ts` (it already imports `describe/it/expect`; add `RundownRowSchema` to its existing `./show` import if not present):

```ts
describe("VideoRow", () => {
  it("parses with defaults", () => {
    const row = RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/assets/a.mp4" });
    if (row.kind !== "video") throw new Error("expected video");
    expect(row.volume).toBe(1);
    expect(row.endAction).toBe("clear");
    expect(row.label).toBeUndefined();
  });

  it("keeps label, duration, hold and channel", () => {
    const row = RundownRowSchema.parse({
      kind: "video", id: "v1", assetUrl: "/assets/a.mp4",
      label: "Giving", durationSec: 301.2, volume: 0.5, endAction: "hold", channelHint: "program",
    });
    if (row.kind !== "video") throw new Error("expected video");
    expect(row).toMatchObject({ label: "Giving", durationSec: 301.2, volume: 0.5, endAction: "hold" });
  });

  it("rejects volume > 1", () => {
    expect(() =>
      RundownRowSchema.parse({ kind: "video", id: "v1", assetUrl: "/a.mp4", volume: 2 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/channel.test.ts packages/core/src/show.test.ts`
Expected: FAIL — `ChannelMediaSchema` is not exported; video row rejected by discriminated union.

- [ ] **Step 3: Implement**

In `packages/core/src/channel.ts`, after `ActiveGraphicSchema`/type and before `ChannelStateSchema`:

```ts
export const MediaEndActionSchema = z.enum(["clear", "hold"]);
export type MediaEndAction = z.infer<typeof MediaEndActionSchema>;

export const MediaStatusSchema = z.enum(["loading", "playing", "paused", "ended", "error"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

/** Last playback report from a renderer, stamped with server receive time. */
export const MediaPlaybackSchema = z.object({
  status: MediaStatusSchema,
  currentTime: z.number(),
  duration: z.number(),
  updatedAt: z.number(),
  error: z.string().optional(),
});
export type MediaPlayback = z.infer<typeof MediaPlaybackSchema>;

/**
 * Full-frame video slot, independent of `active` so a graphic can sit on
 * top of a playing video. Transport is declarative: renderers converge on
 * `paused` and apply any `seek.seq` they haven't applied for this
 * `takenAt`, so reconnects and multiple renderers need no command replay.
 */
export const ChannelMediaSchema = z.object({
  rowId: z.string(),
  assetUrl: z.string(),
  label: z.string().optional(),
  volume: z.number().min(0).max(1),
  endAction: MediaEndActionSchema,
  takenAt: z.number(),
  paused: z.boolean(),
  seek: z.object({ time: z.number(), seq: z.number() }).optional(),
  playback: MediaPlaybackSchema,
});
export type ChannelMedia = z.infer<typeof ChannelMediaSchema>;
```

and change `ChannelStateSchema` to:

```ts
export const ChannelStateSchema = z.object({
  channel: z.string(),
  active: ActiveGraphicSchema.nullable(),
  songSession: SongSessionSummarySchema.optional(),
  media: ChannelMediaSchema.nullable().optional(),
});
```

In `packages/core/src/show.ts`, add `import { MediaEndActionSchema } from "./channel";` at the top, add after `ScriptureRowSchema`/type:

```ts
/**
 * Full-frame video played in the channel's media slot (beneath graphics).
 * `durationSec` is display-only, captured when the row is saved.
 */
export const VideoRowSchema = z.object({
  kind: z.literal("video"),
  id: z.string(),
  assetUrl: z.string(),
  label: z.string().optional(),
  durationSec: z.number().optional(),
  volume: z.number().min(0).max(1).default(1),
  endAction: MediaEndActionSchema.default("clear"),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
  sourceRef: RowSourceRefSchema.optional(),
});
export type VideoRow = z.infer<typeof VideoRowSchema>;
```

and extend the union: `z.discriminatedUnion("kind", [GraphicRowSchema, SongRowSchema, ScriptureRowSchema, VideoRowSchema])`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/channel.test.ts packages/core/src/show.test.ts`
Expected: PASS.

Do **not** run the full typecheck yet — adding the union member intentionally breaks consumers; Task 4 fixes them. Run `pnpm --filter @overlaysys/core typecheck` — Expected: PASS except possibly `bundle.ts` errors (fixed in Task 4). If `bundle.ts` errors appear, note them and continue.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/channel.ts packages/core/src/channel.test.ts packages/core/src/show.ts packages/core/src/show.test.ts
git commit -m "feat(core): add video rundown row and channel media slot schemas"
```

---

### Task 2: Protocol messages

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`
- Modify: `packages/ws-protocol/src/schema.test.ts`

**Interfaces:**
- Consumes: `MediaEndActionSchema`, `MediaStatusSchema`, `MediaPlaybackSchema` from Task 1.
- Produces `ClientMessage` variants:
  - `{ type: "media_take"; channel: string; rowId: string; assetUrl: string; label?: string; volume: number; endAction: "clear"|"hold" }`
  - `{ type: "media_clear"; channel: string }`
  - `{ type: "media_control"; channel: string; takenAt: number; action: "play"|"pause"|"restart"|"seek"; time?: number }`
  - `{ type: "media_status"; channel: string; takenAt: number; status: MediaStatus; currentTime: number; duration: number; error?: string }`
- Produces `ServerMessage` variant: `{ type: "media_playback"; channel: string; takenAt: number; playback: MediaPlayback }`
- `PROTOCOL_VERSION = 2`

- [ ] **Step 1: Write failing tests** — append to `packages/ws-protocol/src/schema.test.ts` (extend its import to `import { decodeClient, decodeServer, encode, PROTOCOL_VERSION } from "./index";`):

```ts
describe("media messages", () => {
  it("decodes media_take", () => {
    const msg = decodeClient(encode({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear",
    }));
    expect(msg.type).toBe("media_take");
  });

  it("rejects media_take with volume > 1", () => {
    expect(() => decodeClient(JSON.stringify({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/a.mp4", volume: 1.5, endAction: "clear",
    }))).toThrow();
  });

  it("decodes media_control seek with time", () => {
    const msg = decodeClient(encode({
      type: "media_control", channel: "program", takenAt: 5, action: "seek", time: 30,
    }));
    if (msg.type !== "media_control") throw new Error("wrong type");
    expect(msg.time).toBe(30);
  });

  it("decodes media_status and media_clear", () => {
    expect(decodeClient(encode({
      type: "media_status", channel: "program", takenAt: 5,
      status: "playing", currentTime: 1.2, duration: 300,
    })).type).toBe("media_status");
    expect(decodeClient(encode({ type: "media_clear", channel: "program" })).type).toBe("media_clear");
  });

  it("decodes media_playback", () => {
    const msg = decodeServer(encode({
      type: "media_playback", channel: "program", takenAt: 5,
      playback: { status: "playing", currentTime: 2, duration: 300, updatedAt: 99 },
    }));
    if (msg.type !== "media_playback") throw new Error("wrong type");
    expect(msg.playback.currentTime).toBe(2);
  });

  it("is protocol version 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
});
```

Check `decodeClient` uses `ClientMessageSchema.parse` (index.ts ~line 384); it does.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/ws-protocol/src/schema.test.ts`
Expected: FAIL (unknown discriminator `media_take`, version 1).

- [ ] **Step 3: Implement** in `packages/ws-protocol/src/index.ts`:

Add `MediaEndActionSchema, MediaStatusSchema, MediaPlaybackSchema,` to the `@overlaysys/core` import. Set `export const PROTOCOL_VERSION = 2;`. Inside `ClientMessageSchema`'s array, after the `take_pvw_to_pgm` entry (~line 140), add:

```ts
  // ── Media slot (full-frame video beneath graphics) ──
  z.object({
    type: z.literal("media_take"),
    channel: z.string(),
    rowId: z.string(),
    assetUrl: z.string(),
    label: z.string().optional(),
    volume: z.number().min(0).max(1),
    endAction: MediaEndActionSchema,
  }),
  z.object({ type: z.literal("media_clear"), channel: z.string() }),
  z.object({
    type: z.literal("media_control"),
    channel: z.string(),
    takenAt: z.number(),
    action: z.enum(["play", "pause", "restart", "seek"]),
    time: z.number().min(0).optional(),
  }),
  /** Renderer → server playback report. Stale `takenAt` is ignored. */
  z.object({
    type: z.literal("media_status"),
    channel: z.string(),
    takenAt: z.number(),
    status: MediaStatusSchema,
    currentTime: z.number().min(0),
    duration: z.number().min(0),
    error: z.string().optional(),
  }),
```

Inside `ServerMessageSchema`'s array, after the `state` entry:

```ts
  /** ~4 Hz playback tick for a channel's media slot. Status transitions arrive as `state`. */
  z.object({
    type: z.literal("media_playback"),
    channel: z.string(),
    takenAt: z.number(),
    playback: MediaPlaybackSchema,
  }),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/ws-protocol/src/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ws-protocol/src/index.ts packages/ws-protocol/src/schema.test.ts
git commit -m "feat(ws-protocol): add media take/clear/control/status and playback messages"
```

---

### Task 3: Server media slot logic + WS routing

**Files:**
- Modify: `server/src/channels.ts`
- Create: `server/src/channelsMedia.test.ts`
- Modify: `server/src/ws.ts` (subscribe case ~line 125; add cases after `take_pvw_to_pgm` ~line 160)

**Interfaces:**
- Consumes: Task 1 types, Task 2 messages.
- Produces (in `server/src/channels.ts`):
  - `type MediaTakeArgs = { rowId: string; assetUrl: string; label?: string; volume: number; endAction: MediaEndAction }`
  - `mediaTake(channel: string, args: MediaTakeArgs, now?: number): void`
  - `mediaClear(channel: string): void`
  - `type MediaControlAction = "play" | "pause" | "restart" | "seek"`
  - `mediaControl(channel: string, takenAt: number, action: MediaControlAction, time?: number): void`
  - `type MediaStatusReport = { status: MediaStatus; currentTime: number; duration: number; error?: string }`
  - `mediaStatus(channel: string, takenAt: number, report: MediaStatusReport, now?: number): void`
  - `type MediaPlaybackEvent = { channel: string; takenAt: number; playback: MediaPlayback }`
  - `subscribeMediaPlayback(channel: string, listener: (e: MediaPlaybackEvent) => void): () => void`

- [ ] **Step 1: Write failing tests** — create `server/src/channelsMedia.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelState } from "@overlaysys/core";
import * as channels from "./channels";
import * as templates from "./templates";

// Each test uses its own channel name so module-level state can't leak.
let n = 0;
let ch = "";
let states: ChannelState[] = [];
let ticks: channels.MediaPlaybackEvent[] = [];
let unsubs: (() => void)[] = [];

const ARGS: channels.MediaTakeArgs = {
  rowId: "row-1",
  assetUrl: "/assets/give.mp4",
  label: "Giving",
  volume: 1,
  endAction: "clear",
};

function media() {
  return channels.getState(ch).media ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
  ch = `media-test-${++n}`;
  states = [];
  ticks = [];
  unsubs = [
    channels.subscribe(ch, (s) => states.push(structuredClone(s))),
    channels.subscribeMediaPlayback(ch, (e) => ticks.push(e)),
  ];
  states = []; // drop the immediate push from subscribe()
});
afterEach(() => {
  for (const u of unsubs) u();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("mediaTake", () => {
  it("installs a loading media slot and emits state", () => {
    channels.mediaTake(ch, ARGS, 1000);
    expect(media()).toMatchObject({
      rowId: "row-1", assetUrl: "/assets/give.mp4", label: "Giving",
      volume: 1, endAction: "clear", takenAt: 1000, paused: false,
      playback: { status: "loading", currentTime: 0, duration: 0 },
    });
    expect(states).toHaveLength(1);
  });

  it("gives strictly increasing takenAt for takes in the same ms", () => {
    channels.mediaTake(ch, ARGS, 1000);
    channels.mediaTake(ch, ARGS, 1000);
    expect(media()?.takenAt).toBe(1001);
  });

  it("does not touch the active graphic", () => {
    channels.take(ch, "lower-third", { name: "x" });
    channels.mediaTake(ch, ARGS, 1000);
    expect(channels.getState(ch).active?.templateId).toBe("lower-third");
  });
});

describe("graphic operations leave media alone", () => {
  it("take, update, clear and setActiveNull preserve media", () => {
    channels.mediaTake(ch, ARGS, 1000);
    channels.take(ch, "lower-third", {});
    channels.update(ch, { a: "b" });
    channels.clear(ch);
    vi.advanceTimersByTime(2000);
    channels.setActiveNull(ch);
    expect(media()?.takenAt).toBe(1000);
  });
});

describe("mediaClear", () => {
  it("nulls media, keeps active, emits once", () => {
    channels.take(ch, "lower-third", {});
    channels.mediaTake(ch, ARGS, 1000);
    states = [];
    channels.mediaClear(ch);
    expect(media()).toBeNull();
    expect(channels.getState(ch).active?.templateId).toBe("lower-third");
    expect(states).toHaveLength(1);
  });

  it("is a no-op without media", () => {
    channels.mediaClear(ch);
    expect(states).toHaveLength(0);
  });
});

describe("mediaControl", () => {
  beforeEach(() => channels.mediaTake(ch, ARGS, 1000));

  it("ignores a stale takenAt", () => {
    states = [];
    channels.mediaControl(ch, 999, "pause");
    expect(media()?.paused).toBe(false);
    expect(states).toHaveLength(0);
  });

  it("pause / play toggle paused", () => {
    channels.mediaControl(ch, 1000, "pause");
    expect(media()?.paused).toBe(true);
    channels.mediaControl(ch, 1000, "play");
    expect(media()?.paused).toBe(false);
    expect(media()?.seek).toBeUndefined();
  });

  it("restart seeks to 0, unpauses and bumps seq", () => {
    channels.mediaControl(ch, 1000, "pause");
    channels.mediaControl(ch, 1000, "restart");
    expect(media()).toMatchObject({ paused: false, seek: { time: 0, seq: 1 } });
    channels.mediaControl(ch, 1000, "restart");
    expect(media()?.seek?.seq).toBe(2);
  });

  it("seek sets time (clamped at 0) and bumps seq; seek without time is ignored", () => {
    channels.mediaControl(ch, 1000, "seek", 42);
    expect(media()?.seek).toEqual({ time: 42, seq: 1 });
    channels.mediaControl(ch, 1000, "seek");
    expect(media()?.seek).toEqual({ time: 42, seq: 1 });
  });
});

describe("mediaStatus", () => {
  beforeEach(() => channels.mediaTake(ch, ARGS, 1000));

  it("emits state on status transitions and ticks otherwise", () => {
    states = [];
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0, duration: 300 }, 2000);
    expect(states).toHaveLength(1);
    expect(media()?.playback).toMatchObject({ status: "playing", duration: 300, updatedAt: 2000 });

    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0.25, duration: 300 }, 2250);
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0.5, duration: 300 }, 2500);
    expect(states).toHaveLength(1);
    expect(ticks.map((t) => t.playback.currentTime)).toEqual([0.25, 0.5]);
    expect(ticks[0]).toMatchObject({ channel: ch, takenAt: 1000 });
    expect(media()?.playback.currentTime).toBe(0.5);
  });

  it("emits state when an error appears", () => {
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 0, duration: 300 }, 2000);
    states = [];
    channels.mediaStatus(ch, 1000, { status: "playing", currentTime: 1, duration: 300, error: "audio device 'Aux' not found — using default" }, 3000);
    expect(states).toHaveLength(1);
    expect(media()?.playback.error).toContain("Aux");
  });

  it("ignores a stale takenAt", () => {
    channels.mediaStatus(ch, 999, { status: "playing", currentTime: 5, duration: 300 }, 2000);
    expect(media()?.playback.status).toBe("loading");
  });

  it("ended + clear removes media", () => {
    channels.mediaStatus(ch, 1000, { status: "ended", currentTime: 300, duration: 300 }, 2000);
    expect(media()).toBeNull();
  });

  it("ended + hold keeps media, pauses it; play then seeks to 0", () => {
    channels.mediaTake(ch, { ...ARGS, endAction: "hold" }, 5000);
    channels.mediaStatus(ch, 5000, { status: "ended", currentTime: 300, duration: 300 }, 6000);
    expect(media()).toMatchObject({ paused: true, playback: { status: "ended" } });
    channels.mediaControl(ch, 5000, "play");
    expect(media()).toMatchObject({ paused: false, seek: { time: 0, seq: 1 } });
  });

  it("a stale ended after re-take does not clear the new take", () => {
    channels.mediaTake(ch, ARGS, 1000); // same ms → takenAt 1001
    channels.mediaStatus(ch, 1000, { status: "ended", currentTime: 300, duration: 300 }, 2000);
    expect(media()?.takenAt).toBe(1001);
  });
});

describe("takePvwToPgm", () => {
  it("does not promote media", () => {
    const pvw = `${ch}-pvw`;
    channels.mediaTake(pvw, ARGS, 1000);
    channels.take(pvw, "lower-third", {});
    channels.takePvwToPgm(pvw, ch);
    expect(channels.getState(ch).media ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/channelsMedia.test.ts`
Expected: FAIL — `channels.mediaTake is not a function`.

- [ ] **Step 3: Implement** in `server/src/channels.ts`.

Change the import line to:

```ts
import type {
  ChannelState,
  MediaEndAction,
  MediaPlayback,
  MediaStatus,
  SongSessionSummary,
  SubTakeContext,
} from "@overlaysys/core";
```

Append at the end of the file:

```ts
// ───── Media slot ──────────────────────────────────────────────────────────
//
// Full-frame video beneath graphics. Independent of `active`: nothing above
// touches `media`, nothing below touches `active`. Status transitions emit
// full `state`; ~4 Hz time ticks go to playback listeners only, so template
// renderers and Companion aren't re-rendered on every tick.

export type MediaPlaybackEvent = {
  channel: string;
  takenAt: number;
  playback: MediaPlayback;
};
type PlaybackListener = (e: MediaPlaybackEvent) => void;
const playbackListeners = new Map<string, Set<PlaybackListener>>();

export function subscribeMediaPlayback(
  channel: string,
  listener: PlaybackListener,
): () => void {
  let set = playbackListeners.get(channel);
  if (!set) {
    set = new Set();
    playbackListeners.set(channel, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

function notifyPlayback(e: MediaPlaybackEvent): void {
  const ls = playbackListeners.get(e.channel);
  if (!ls) return;
  for (const l of ls) l(e);
}

export type MediaTakeArgs = {
  rowId: string;
  assetUrl: string;
  label?: string;
  volume: number;
  endAction: MediaEndAction;
};

export function mediaTake(channel: string, args: MediaTakeArgs, now = Date.now()): void {
  const s = getOrInit(channel);
  // takenAt is the take's identity — a late `ended` from the previous take
  // must never match, so force it strictly increasing even within one ms.
  const prev = s.media?.takenAt ?? 0;
  const takenAt = now > prev ? now : prev + 1;
  s.media = {
    rowId: args.rowId,
    assetUrl: args.assetUrl,
    ...(args.label !== undefined ? { label: args.label } : {}),
    volume: args.volume,
    endAction: args.endAction,
    takenAt,
    paused: false,
    playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: now },
  };
  emit(channel);
}

export function mediaClear(channel: string): void {
  const s = getOrInit(channel);
  if (!s.media) return;
  s.media = null;
  emit(channel);
}

export type MediaControlAction = "play" | "pause" | "restart" | "seek";

export function mediaControl(
  channel: string,
  takenAt: number,
  action: MediaControlAction,
  time?: number,
): void {
  const m = states.get(channel)?.media;
  if (!m || m.takenAt !== takenAt) return;
  const nextSeq = (m.seek?.seq ?? 0) + 1;
  switch (action) {
    case "play":
      // Playing a held-at-end video starts it over.
      if (m.playback.status === "ended") m.seek = { time: 0, seq: nextSeq };
      m.paused = false;
      break;
    case "pause":
      m.paused = true;
      break;
    case "restart":
      m.seek = { time: 0, seq: nextSeq };
      m.paused = false;
      break;
    case "seek":
      if (time === undefined) return;
      m.seek = { time: Math.max(0, time), seq: nextSeq };
      break;
  }
  emit(channel);
}

export type MediaStatusReport = {
  status: MediaStatus;
  currentTime: number;
  duration: number;
  error?: string;
};

export function mediaStatus(
  channel: string,
  takenAt: number,
  report: MediaStatusReport,
  now = Date.now(),
): void {
  const m = states.get(channel)?.media;
  if (!m || m.takenAt !== takenAt) return;
  const prev = m.playback;
  const next: MediaPlayback = {
    status: report.status,
    currentTime: report.currentTime,
    duration: report.duration,
    updatedAt: now,
    ...(report.error ? { error: report.error } : {}),
  };
  m.playback = next;

  if (report.status === "ended") {
    if (m.endAction === "clear") {
      mediaClear(channel);
    } else {
      m.paused = true;
      emit(channel);
    }
    return;
  }

  const transition =
    prev.status !== next.status ||
    prev.error !== next.error ||
    prev.duration !== next.duration;
  if (transition) emit(channel);
  else notifyPlayback({ channel, takenAt, playback: next });
}
```

In `server/src/ws.ts`, replace the non-duplicate branch of `case "subscribe"`:

```ts
          const unsub = channels.subscribe(parsed.channel, (state) => {
            send({ type: "state", channel: state.channel, state });
          });
          const unsubPlayback = channels.subscribeMediaPlayback(parsed.channel, (e) => {
            send({ type: "media_playback", ...e });
          });
          subscriptions.set(parsed.channel, () => {
            unsub();
            unsubPlayback();
          });
          break;
```

and after `case "take_pvw_to_pgm": {...}` add:

```ts
        case "media_take": {
          channels.mediaTake(parsed.channel, {
            rowId: parsed.rowId,
            assetUrl: parsed.assetUrl,
            ...(parsed.label !== undefined ? { label: parsed.label } : {}),
            volume: parsed.volume,
            endAction: parsed.endAction,
          });
          break;
        }
        case "media_clear": {
          channels.mediaClear(parsed.channel);
          break;
        }
        case "media_control": {
          channels.mediaControl(parsed.channel, parsed.takenAt, parsed.action, parsed.time);
          break;
        }
        case "media_status": {
          channels.mediaStatus(parsed.channel, parsed.takenAt, {
            status: parsed.status,
            currentTime: parsed.currentTime,
            duration: parsed.duration,
            ...(parsed.error !== undefined ? { error: parsed.error } : {}),
          });
          break;
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run server/src/channelsMedia.test.ts server/src/channels.test.ts server/src/ws.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/channels.ts server/src/channelsMedia.test.ts server/src/ws.ts
git commit -m "feat(server): media slot with declarative transport and playback ticks"
```

---

### Task 4: Integrate the `video` row kind across the monorepo (typecheck green)

Adding `VideoRow` to the union breaks every place that falls through to "graphic" after excluding song/scripture. This task makes the whole repo typecheck and gives video rows correct behavior everywhere they surface, except the show-editor modal (Task 9).

**Files:**
- Modify: `packages/core/src/bundle.ts` (switch ~line 109; `collectReferencedAssetFilenames` ~line 316; `rewriteShowAssetUrls` ~line 391)
- Modify: `packages/core/src/bundle.test.ts`
- Modify: `server/src/bundleApply.ts` (`normalizeAssetUrlsInShow` ~line 231; `rewriteAssetUrlsInShow` ~line 287)
- Modify: `server/src/bundleApply.test.ts`
- Modify: `packages/companion-module/src/actions.ts` (~lines 75–125), `feedbacks.ts` (~line 236), `labels.ts`
- Modify: `apps/operator/src/app/components/Rundown.tsx`
- Modify: `apps/operator/src/app/hooks/useGlobalShortcuts.ts` (~line 107)
- Modify: `apps/operator/src/app/shows/edit/page.tsx` (row rendering ~line 613 only; modal comes in Task 9)

**Interfaces:**
- Consumes: `VideoRow` (Task 1), `media_take` (Task 2).
- Produces: `apps/operator/src/lib/mediaTake.ts` → `videoRowTakeMessage(row: VideoRow): ClientMessage` (used by Rundown, shortcuts, Companion has its own copy because it doesn't depend on the operator app).

- [ ] **Step 1: Write failing bundle tests**

Append to `packages/core/src/bundle.test.ts` (add `collectReferencedAssetFilenames, rewriteShowAssetUrls` to its `./bundle` import, and `Show` to its type import if not present):

```ts
describe("video rows in bundles", () => {
  const show: Show = {
    id: "s1", name: "Sun", projectId: "p1", songs: [],
    rows: [{ kind: "video", id: "v1", assetUrl: "/assets/abc123.mp4", volume: 1, endAction: "clear" }],
  } as Show;

  it("collects the video asset", () => {
    const files = collectReferencedAssetFilenames({ templates: [], hotcards: [], shows: [show] });
    expect([...files]).toContain("abc123.mp4");
  });

  it("rewrites the video asset url exactly like a graphic row's asset value", () => {
    const graphicShow = {
      ...show,
      rows: [{ kind: "graphic", id: "g", templateId: "t", data: { v: "/assets/abc123.mp4" } }],
    } as Show;
    const videoRow = rewriteShowAssetUrls(show, "http://host:4000").rows[0] as { assetUrl: string };
    const graphicRow = rewriteShowAssetUrls(graphicShow, "http://host:4000").rows[0] as { data: Record<string, string> };
    expect(videoRow.assetUrl).toBe(graphicRow.data.v);
    expect(videoRow.assetUrl).not.toBe("/assets/abc123.mp4");
  });
});
```

(Comparing against a graphic row avoids hard-coding `rewriteAssetUrlToHost`'s output format. If `rewriteAssetUrlToHost` intentionally leaves relative URLs untouched, drop the `not.toBe` line.)

Append to `server/src/bundleApply.test.ts` (add `normalizeAssetUrlsInShow, rewriteAssetUrlsInShow` to its `./bundleApply` import if absent):

```ts
describe("video rows", () => {
  const show = {
    id: "s1", name: "Sun", projectId: "p1", songs: [],
    rows: [{ kind: "video" as const, id: "v1", assetUrl: "http://old-host:5555/assets/abc.mp4", volume: 1, endAction: "clear" as const }],
  };

  it("normalizes an absolute video asset url to relative", () => {
    const out = normalizeAssetUrlsInShow(show as never);
    expect((out.rows[0] as { assetUrl: string }).assetUrl).toBe("/assets/abc.mp4");
  });

  it("retargets a video asset url like graphic data", () => {
    const rel = { ...show, rows: [{ ...show.rows[0]!, assetUrl: "/assets/abc.mp4" }] };
    const graphic = { ...show, rows: [{ kind: "graphic" as const, id: "g", templateId: "t", data: { v: "/assets/abc.mp4" } }] };
    const vOut = rewriteAssetUrlsInShow(rel as never, "http://new:4000").rows[0] as { assetUrl: string };
    const gOut = rewriteAssetUrlsInShow(graphic as never, "http://new:4000").rows[0] as { data: { v: string } };
    expect(vOut.assetUrl).toBe(gOut.data.v);
  });
});
```

Before relying on the first server assertion, read `normalizeOne` in `server/src/bundleApply.ts:180` — if it does not convert `http://old-host:5555/assets/abc.mp4` → `/assets/abc.mp4`, change the expectation to `normalizeAssetUrlsInShow` applied to an equivalent graphic row's data value (same comparison pattern as the retarget test).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/bundle.test.ts server/src/bundleApply.test.ts`
Expected: FAIL (video asset not collected / not rewritten).

- [ ] **Step 3: Implement bundle handling**

`packages/core/src/bundle.ts`, in the `switch (row.kind)` of the dependency walk add:

```ts
        case "video":
          // Video rows reference an asset, not a template; the asset is
          // picked up by collectReferencedAssetFilenames.
          break;
```

In `collectReferencedAssetFilenames`, replace the show loop body:

```ts
    for (const row of sh.rows) {
      if (row.kind === "graphic") {
        for (const v of Object.values(row.data)) add(v);
      } else if (row.kind === "video") {
        add(row.assetUrl);
      }
    }
```

Replace `rewriteShowAssetUrls`:

```ts
export function rewriteShowAssetUrls(s: Show, originBase: string): Show {
  return {
    ...s,
    rows: s.rows.map((row) => {
      if (row.kind === "graphic") return { ...row, data: rewriteDataRecord(row.data, originBase) };
      if (row.kind === "video") return { ...row, assetUrl: rewriteAssetUrlToHost(row.assetUrl, originBase) };
      return row;
    }),
  };
}
```

`server/src/bundleApply.ts`: in `normalizeAssetUrlsInShow` replace the map callback:

```ts
  const rows = s.rows.map((row) => {
    if (row.kind === "video") {
      const assetUrl = normalizeOne(row.assetUrl);
      if (assetUrl === row.assetUrl) return row;
      changed = true;
      return { ...row, assetUrl };
    }
    if (row.kind !== "graphic") return row;
    const data = normalizeDataRecord(row.data);
    if (data === row.data) return row;
    changed = true;
    return { ...row, data };
  });
```

and `rewriteAssetUrlsInShow`:

```ts
export function rewriteAssetUrlsInShow(s: Show, originBase: string): Show {
  return {
    ...s,
    rows: s.rows.map((row) => {
      if (row.kind === "graphic") return { ...row, data: retargetRecord(row.data, originBase) };
      if (row.kind === "video") return { ...row, assetUrl: retargetOne(row.assetUrl, originBase) };
      return row;
    }),
  };
}
```

(`liftShow` / `liftInlineDataUrlsInShow` stay graphic-only: video rows are always uploaded assets, never data URLs.)

- [ ] **Step 4: Run bundle tests**

Run: `pnpm vitest run packages/core/src/bundle.test.ts server/src/bundleApply.test.ts`
Expected: PASS.

- [ ] **Step 5: Operator take helper**

Create `apps/operator/src/lib/mediaTake.ts`:

```ts
import type { VideoRow } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

/** Media takes go straight to their channel — there is no PVW stage for video. */
export function videoRowTakeMessage(row: VideoRow): ClientMessage {
  return {
    type: "media_take",
    channel: row.channelHint ?? "program",
    rowId: row.id,
    assetUrl: row.assetUrl,
    ...(row.label !== undefined ? { label: row.label } : {}),
    volume: row.volume,
    endAction: row.endAction,
  };
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
```

Check the operator already depends on `@overlaysys/ws-protocol` (`grep ws-protocol apps/operator/package.json`); it does via `useWs`. If not, import `ClientMessage` from wherever `useWs.ts` imports it.

- [ ] **Step 6: Rundown (`apps/operator/src/app/components/Rundown.tsx`)**

Add imports: `VideoRow` to the `@overlaysys/core` type import; `import { videoRowTakeMessage, formatClock } from "@/lib/mediaTake";`.

In the template-prefetch effect, after the scripture `continue`:

```ts
      if (r.kind === "video") continue;
```

In `cueSelected()`, after the scripture early-return:

```ts
      if (row.kind === "video") {
        // No cue for video — previewing would double the audio.
        return;
      }
```

In `takeSelected()`, after the scripture early-return:

```ts
      if (row.kind === "video") {
        send(videoRowTakeMessage(row));
        return;
      }
```

In the row map, before `const tplMeta = ...`:

```ts
            if (row.kind === "video") {
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedRow(row.id)}
                  onDoubleClick={() => {
                    setSelectedRow(row.id);
                    send(videoRowTakeMessage(row));
                  }}
                  style={{
                    background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
                    borderLeft: selected
                      ? `3px solid ${colors.accent}`
                      : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <td style={td()}>{i + 1}</td>
                  <td style={td()} colSpan={2}>
                    <div style={{ fontWeight: 600 }}>
                      <span aria-hidden style={{ marginRight: 6 }}>🎬</span>
                      {row.label || "Video"}
                    </div>
                    <div style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
                      video{row.durationSec ? ` · ${formatClock(row.durationSec)}` : ""} ·{" "}
                      {row.endAction === "clear" ? "clears at end" : "holds at end"}
                    </div>
                  </td>
                </tr>
              );
            }
```

- [ ] **Step 7: Shortcuts (`apps/operator/src/app/hooks/useGlobalShortcuts.ts`)**

Import `videoRowTakeMessage` from `@/lib/mediaTake`. In the `Space` branch, insert before `} else if (hotcard) {`:

```ts
        } else if (row && row.kind === "video") {
          client.send(videoRowTakeMessage(row));
```

(Enter/cue intentionally has no video branch.)

- [ ] **Step 8: Show editor row display (`apps/operator/src/app/shows/edit/page.tsx`)**

`RundownTable` receives a new optional prop `onEditVideoRow?: (row: VideoRow) => void` (add to its props type next to `onEditScriptureRow`, add `VideoRow` to the core type import). Before the final `return (<RundownRowEditor ...`, add:

```tsx
          if (row.kind === "video") {
            return (
              <tr key={row.id}>
                <td colSpan={10} style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>🎬 {row.label || "Video"}</span>
                    <span style={{ color: colors.textDim, fontSize: 11 }}>
                      {row.channelHint ?? "program"} · {row.endAction === "clear" ? "clears at end" : "holds at end"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEditVideoRow?.(row)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: colors.accent,
                        cursor: "pointer",
                        fontSize: 11,
                        padding: 0,
                        textDecoration: "underline",
                        marginLeft: "auto",
                      }}
                    >
                      Edit video…
                    </button>
                    <IconButton
                      onClick={() => onDeleteRow(row.id)}
                      title="Delete row"
                      size={24}
                      style={{ color: colors.red, fontSize: 14 }}
                    >
                      ×
                    </IconButton>
                  </div>
                </td>
              </tr>
            );
          }
```

- [ ] **Step 9: Companion module**

`packages/companion-module/src/actions.ts` — in `rowMessages`, after the scripture branch:

```ts
  if (row.kind === "video") {
    return [
      {
        type: "media_take",
        channel,
        rowId: row.id,
        assetUrl: row.assetUrl,
        ...(row.label !== undefined ? { label: row.label } : {}),
        volume: row.volume,
        endAction: row.endAction,
      },
    ];
  }
```

In `rowPvwPgmMessages`, after the scripture branch:

```ts
  if (row.kind === "video") {
    // No PVW stage for video (would double audio).
    return [];
  }
```

`feedbacks.ts` `rowMatchesPgm`, after the scripture branch:

```ts
  if (row.kind === "video") return false;
```

`labels.ts` `rowDisplayLabel`, after the song branch:

```ts
  if (row.kind === "video") return row.label || "Video";
```

- [ ] **Step 10: Full typecheck and test**

Run: `pnpm typecheck && pnpm test`
Expected: all packages typecheck; all tests pass. Any remaining typecheck error will be a `row.kind` fall-through not listed above — handle it the same way (video rows have no `templateId`; skip them or treat them as their own branch) and re-run.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/bundle.ts packages/core/src/bundle.test.ts server/src/bundleApply.ts server/src/bundleApply.test.ts packages/companion-module/src apps/operator/src/lib/mediaTake.ts apps/operator/src/app/components/Rundown.tsx apps/operator/src/app/hooks/useGlobalShortcuts.ts apps/operator/src/app/shows/edit/page.tsx
git commit -m "feat: wire video rows through rundown, shortcuts, bundles and Companion"
```

---

### Task 5: Renderer pure helpers (`mediaSync.ts`)

**Files:**
- Create: `apps/renderer/src/mediaSync.ts`
- Create: `apps/renderer/src/mediaSync.test.ts`

**Interfaces:**
- Consumes: `ChannelMedia` (Task 1).
- Produces:
  - `resolveMediaUrl(stored: string, wsUrl: string): string`
  - `type SinkRequest = { id?: string; label?: string }`
  - `type AudioDeviceLike = { deviceId: string; label: string; kind: string }`
  - `pickAudioSink(devices: AudioDeviceLike[], want: SinkRequest): { deviceId: string | null; warning?: string }` (`null` = system default)
  - `readSinkRequest(search: string): SinkRequest`
  - `type AppliedSeek = { takenAt: number; seq: number }`
  - `initialMountPlan(media: ChannelMedia): { startAt: number; applied: AppliedSeek }`
  - `pendingSeek(media: ChannelMedia, applied: AppliedSeek): number | null`

- [ ] **Step 1: Write failing tests** — `apps/renderer/src/mediaSync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChannelMedia } from "@overlaysys/core";
import {
  initialMountPlan,
  pendingSeek,
  pickAudioSink,
  readSinkRequest,
  resolveMediaUrl,
} from "./mediaSync";

const base: ChannelMedia = {
  rowId: "r", assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear",
  takenAt: 100, paused: false,
  playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: 0 },
};

describe("resolveMediaUrl", () => {
  it("prefixes relative /assets paths with the ws server's http origin", () => {
    expect(resolveMediaUrl("/assets/a.mp4", "ws://10.0.0.5:4000/ws")).toBe("http://10.0.0.5:4000/assets/a.mp4");
    expect(resolveMediaUrl("/assets/a.mp4", "wss://h.example/ws")).toBe("https://h.example/assets/a.mp4");
  });
  it("leaves absolute urls alone", () => {
    expect(resolveMediaUrl("https://cdn/x.mp4", "ws://h:4000/ws")).toBe("https://cdn/x.mp4");
  });
});

describe("pickAudioSink", () => {
  const devices = [
    { deviceId: "default", label: "Default", kind: "audiooutput" },
    { deviceId: "abc", label: "Aux (USB Audio)", kind: "audiooutput" },
    { deviceId: "mic1", label: "Aux (USB Audio)", kind: "audioinput" },
  ];
  it("returns default when nothing requested", () => {
    expect(pickAudioSink(devices, {})).toEqual({ deviceId: null });
  });
  it("matches by id", () => {
    expect(pickAudioSink(devices, { id: "abc", label: "whatever" })).toEqual({ deviceId: "abc" });
  });
  it("falls back to label among outputs only", () => {
    expect(pickAudioSink(devices, { id: "stale", label: "Aux (USB Audio)" })).toEqual({ deviceId: "abc" });
  });
  it("falls back to default with a warning when missing", () => {
    const r = pickAudioSink(devices, { id: "gone", label: "Focusrite" });
    expect(r.deviceId).toBeNull();
    expect(r.warning).toBe("audio device 'Focusrite' not found — using default");
  });
});

describe("readSinkRequest", () => {
  it("reads both params", () => {
    expect(readSinkRequest("?channel=program&audioSinkId=abc&audioSinkLabel=Aux%201")).toEqual({ id: "abc", label: "Aux 1" });
  });
  it("is empty without params", () => {
    expect(readSinkRequest("?channel=program")).toEqual({});
  });
});

describe("initialMountPlan", () => {
  it("starts at 0 on a fresh take", () => {
    expect(initialMountPlan(base)).toEqual({ startAt: 0, applied: { takenAt: 100, seq: 0 } });
  });
  it("resumes from last reported time and marks existing seek as applied", () => {
    const m = { ...base, seek: { time: 10, seq: 2 }, playback: { ...base.playback, status: "playing" as const, currentTime: 95 } };
    expect(initialMountPlan(m)).toEqual({ startAt: 95, applied: { takenAt: 100, seq: 2 } });
  });
});

describe("pendingSeek", () => {
  it("returns the time for an unseen seq", () => {
    expect(pendingSeek({ ...base, seek: { time: 30, seq: 1 } }, { takenAt: 100, seq: 0 })).toBe(30);
  });
  it("returns null when already applied or none", () => {
    expect(pendingSeek({ ...base, seek: { time: 30, seq: 1 } }, { takenAt: 100, seq: 1 })).toBeNull();
    expect(pendingSeek(base, { takenAt: 100, seq: 0 })).toBeNull();
  });
  it("treats a different takenAt as unapplied", () => {
    expect(pendingSeek({ ...base, seek: { time: 0, seq: 1 } }, { takenAt: 99, seq: 5 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/renderer/src/mediaSync.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/renderer/src/mediaSync.ts`:

```ts
import type { ChannelMedia } from "@overlaysys/core";

/**
 * Pure helpers for the renderer's media slot. Kept out of MediaLayer.tsx so
 * the reconnect / device-fallback logic is unit-tested (same split as
 * mirrorSubscription.ts).
 */

/**
 * Stored asset URLs are relative (`/assets/<sha>.mp4`). The renderer page
 * may be served from a different origin than the asset server (Vite :3001
 * in dev), so resolve against the WS server's HTTP origin.
 */
export function resolveMediaUrl(stored: string, wsUrl: string): string {
  if (!stored.startsWith("/assets/")) return stored;
  try {
    const u = new URL(wsUrl);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}${stored}`;
  } catch {
    return stored;
  }
}

export type SinkRequest = { id?: string; label?: string };
export type AudioDeviceLike = { deviceId: string; label: string; kind: string };

/**
 * Device ids are per-origin hashes and can differ between the operator page
 * (where the id was picked) and the renderer page, so fall back to label.
 * Missing device → system default plus a warning; never silence.
 */
export function pickAudioSink(
  devices: AudioDeviceLike[],
  want: SinkRequest,
): { deviceId: string | null; warning?: string } {
  if (!want.id && !want.label) return { deviceId: null };
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const byId = want.id ? outputs.find((d) => d.deviceId === want.id) : undefined;
  if (byId) return { deviceId: byId.deviceId };
  const byLabel = want.label ? outputs.find((d) => d.label === want.label) : undefined;
  if (byLabel) return { deviceId: byLabel.deviceId };
  return {
    deviceId: null,
    warning: `audio device '${want.label ?? want.id}' not found — using default`,
  };
}

export function readSinkRequest(search: string): SinkRequest {
  const p = new URLSearchParams(search);
  const id = p.get("audioSinkId");
  const label = p.get("audioSinkLabel");
  return { ...(id ? { id } : {}), ...(label ? { label } : {}) };
}

export type AppliedSeek = { takenAt: number; seq: number };

/**
 * On (re)mount, start from the last reported position and treat any seek
 * already in state as applied — re-applying it would jump a reconnecting
 * renderer back to an old scrub point.
 */
export function initialMountPlan(media: ChannelMedia): { startAt: number; applied: AppliedSeek } {
  return {
    startAt: media.playback.currentTime > 0 ? media.playback.currentTime : 0,
    applied: { takenAt: media.takenAt, seq: media.seek?.seq ?? 0 },
  };
}

export function pendingSeek(media: ChannelMedia, applied: AppliedSeek): number | null {
  if (!media.seek) return null;
  if (applied.takenAt === media.takenAt && applied.seq >= media.seek.seq) return null;
  return media.seek.time;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run apps/renderer/src/mediaSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/mediaSync.ts apps/renderer/src/mediaSync.test.ts
git commit -m "feat(renderer): pure media sync helpers (url, audio sink, seek planning)"
```

---

### Task 6: Renderer `MediaLayer`

**Files:**
- Create: `apps/renderer/src/MediaLayer.tsx`
- Modify: `apps/renderer/src/Renderer.tsx`

**Interfaces:**
- Consumes: Task 5 helpers; `WsClient` (`apps/renderer/src/wsClient.ts`, has `send(msg: ClientMessage)`); `defaultServerUrl()`.
- Produces: `<MediaLayer media={ChannelMedia | null} channel={string} isMirror={boolean} matte={boolean} send={(msg: ClientMessage) => void} scale={number} />`

- [ ] **Step 1: Create `apps/renderer/src/MediaLayer.tsx`**

```tsx
import { useEffect, useRef } from "react";
import type { ChannelMedia, MediaStatus } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { defaultServerUrl } from "./wsClient";
import {
  initialMountPlan,
  pendingSeek,
  pickAudioSink,
  readSinkRequest,
  resolveMediaUrl,
  type AppliedSeek,
} from "./mediaSync";

const STAGE_W = 1920;
const STAGE_H = 1080;
const TICK_MS = 250;

type Props = {
  media: ChannelMedia | null;
  /** The channel this window renders (URL param), used in media_status. */
  channel: string;
  /** Mirror windows (e.g. alpha) play muted and never report. */
  isMirror: boolean;
  matte: boolean;
  scale: number;
  send: (msg: ClientMessage) => void;
};

/**
 * Full-frame video slot beneath the template stage. Keyed by takenAt by the
 * parent, so a new take is a fresh element (hard cut) and this component
 * only handles one take's lifetime.
 */
export function MediaLayer(props: Props) {
  if (!props.media) return null;
  return <MediaVideo key={props.media.takenAt} {...props} media={props.media} />;
}

function MediaVideo({ media, channel, isMirror, matte, scale, send }: Props & { media: ChannelMedia }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const appliedRef = useRef<AppliedSeek>(initialMountPlan(media).applied);
  const warningRef = useRef<string | undefined>(undefined);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const takenAt = media.takenAt;

  function report(status: MediaStatus, error?: string) {
    if (isMirror) return;
    const v = videoRef.current;
    const err = error ?? warningRef.current;
    send({
      type: "media_status",
      channel,
      takenAt,
      status,
      currentTime: v && Number.isFinite(v.currentTime) ? v.currentTime : 0,
      duration: v && Number.isFinite(v.duration) ? v.duration : 0,
      ...(err ? { error: err } : {}),
    });
  }

  // Mount: source, start position, audio sink, event reporting, ticks.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const plan = initialMountPlan(mediaRef.current);
    let disposed = false;

    if (isMirror) {
      v.setAttribute("muted", "");
      v.muted = true;
    }
    v.src = resolveMediaUrl(mediaRef.current.assetUrl, defaultServerUrl());
    v.addEventListener(
      "loadedmetadata",
      () => {
        if (plan.startAt > 0) v.currentTime = plan.startAt;
      },
      { once: true },
    );

    const onPlaying = () => report("playing");
    const onPause = () => {
      if (!v.ended) report("paused");
    };
    const onEnded = () => report("ended");
    const onWaiting = () => report("loading");
    const onMeta = () => report(v.paused ? "loading" : "playing");
    const onError = () => report("error", v.error?.message || `media error ${v.error?.code ?? ""}`.trim());
    v.addEventListener("playing", onPlaying);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("error", onError);

    const tick = setInterval(() => {
      if (!v.paused && !v.ended) report("playing");
    }, TICK_MS);

    // Route audio before the first play so the aux port gets the first frame of sound.
    void (async () => {
      if (!isMirror) {
        const want = readSinkRequest(location.search);
        if (want.id || want.label) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const pick = pickAudioSink(devices, want);
            warningRef.current = pick.warning;
            const withSink = v as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
            if (pick.deviceId && withSink.setSinkId) await withSink.setSinkId(pick.deviceId);
          } catch (err) {
            warningRef.current = `audio routing failed (${String(err)}) — using default`;
          }
        }
      }
      if (disposed) return;
      if (!mediaRef.current.paused) {
        v.play().catch((err: unknown) => {
          if (!disposed) report("error", `autoplay blocked: ${String(err)}`);
        });
      }
    })();

    return () => {
      disposed = true;
      clearInterval(tick);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("error", onError);
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
    // Mount-once per take; parent keys this component by takenAt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Converge on declarative transport state.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = isMirror ? 0 : media.volume;
    const seekTo = pendingSeek(media, appliedRef.current);
    if (seekTo !== null) {
      appliedRef.current = { takenAt: media.takenAt, seq: media.seek!.seq };
      v.currentTime = seekTo;
    }
    if (media.paused && !v.paused) v.pause();
    if (!media.paused && v.paused && v.readyState > 0) {
      v.play().catch((err: unknown) => report("error", `autoplay blocked: ${String(err)}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.paused, media.seek?.seq, media.volume, isMirror]);

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: STAGE_W,
        height: STAGE_H,
        transform: `translate(-50%, -50%) scale(${scale})`,
        transformOrigin: "50% 50%",
        // Same silhouette trick as the template stage: the video area keys solid white.
        filter: matte ? "brightness(0) invert(1)" : undefined,
        zIndex: 1,
        pointerEvents: "none",
      }}
    >
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        disablePictureInPicture
        style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
      />
    </div>
  );
}
```

Notes for the implementer:
- `background: "#000"` on the `<video>` makes letterbox bars black only inside the stage box; the rest of the page keeps the channel background, as the spec requires. Under matte, the whole video box becomes white — the intended key.
- Check that `@overlaysys/ws-protocol` is a renderer dependency (`grep ws-protocol apps/renderer/package.json`); `wsClient.ts` already imports from it.

- [ ] **Step 2: Wire into `Renderer.tsx`**

1. Imports: `import { MediaLayer } from "./MediaLayer";` and `import type { ClientMessage } from "@overlaysys/ws-protocol";`.
2. Add `const clientRef = useRef<WsClient | null>(null);` next to the other refs. In the main effect, after `const client = new WsClient(defaultServerUrl());` add `clientRef.current = client;`, and in its cleanup add `clientRef.current = null;`.
3. Add a stable sender after the refs:

```ts
  const sendRef = useRef((msg: ClientMessage) => clientRef.current?.send(msg));
```

4. In the JSX, between the background `<div>` and the stage `<div ref={stageRef}>`, add:

```tsx
      <MediaLayer
        media={latestState?.media ?? null}
        channel={channel}
        isMirror={subscriptionRef.current.source !== channel}
        matte={matte}
        scale={scale}
        send={sendRef.current}
      />
```

5. Change the stage `<div ref={stageRef}>` style `zIndex: 1` → `zIndex: 2` so graphics draw over the video.
6. In `DebugOverlay`, add below the `active` line:

```tsx
      <div>media: {state?.media ? `${state.media.label ?? state.media.rowId} (${state.media.playback.status})` : "—"}</div>
```

`latestState` is already set on every `state` message; `media_playback` ticks are ignored by the renderer (it doesn't need them).

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @overlaysys/renderer typecheck && pnpm vitest run apps/renderer`
Expected: PASS.

- [ ] **Step 4: Smoke test in a browser**

Run `pnpm dev`. Open the renderer with its debug overlay (`http://localhost:3001/?channel=program` plus the debug param that `apps/renderer/src/main.tsx` reads). Expected: no console errors, debug overlay shows `media: —`, and existing graphic takes from the operator still render. Full playback is verified once the operator UI exists (Task 10).

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/MediaLayer.tsx apps/renderer/src/Renderer.tsx
git commit -m "feat(renderer): media layer beneath graphics with audio sink routing and status reports"
```

---

### Task 7: Desktop — audio output pref, renderer URL, autoplay

**Files:**
- Modify: `packages/core/src/channelWindowPrefs.ts`
- Create: `apps/desktop/src/rendererUrl.ts`, `apps/desktop/src/rendererUrl.test.ts`
- Modify: `apps/desktop/src/main.ts` (`rendererChannelUrl` ~line 362; `createChannelWindow` webPreferences ~line 650)
- Modify: `apps/desktop/src/windowPrefs.test.ts`
- Modify: `apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx`

**Interfaces:**
- Produces:
  - `ChannelWindowPrefs.audioOutput?: { deviceId: string; label: string }`
  - `buildRendererChannelUrl(opts: { isDev: boolean; devRendererUrl: string; serverHost: string; serverPort: number; channelId: string; audioOutput?: { deviceId: string; label: string } }): string`

- [ ] **Step 1: Failing tests**

`apps/desktop/src/rendererUrl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRendererChannelUrl } from "./rendererUrl";

const prod = { isDev: false, devRendererUrl: "http://localhost:3001", serverHost: "127.0.0.1", serverPort: 5123 };

describe("buildRendererChannelUrl", () => {
  it("builds the packaged url without audio params", () => {
    const u = new URL(buildRendererChannelUrl({ ...prod, channelId: "program" }));
    expect(u.origin + u.pathname).toBe("http://127.0.0.1:5123/renderer/");
    expect(u.searchParams.get("channel")).toBe("program");
    expect(u.searchParams.get("server")).toBe("ws://127.0.0.1:5123/ws");
    expect(u.searchParams.has("audioSinkId")).toBe(false);
  });

  it("adds encoded audio params", () => {
    const u = new URL(buildRendererChannelUrl({
      ...prod, channelId: "program",
      audioOutput: { deviceId: "a b/c", label: "Aux (USB) & more" },
    }));
    expect(u.searchParams.get("audioSinkId")).toBe("a b/c");
    expect(u.searchParams.get("audioSinkLabel")).toBe("Aux (USB) & more");
  });

  it("uses the dev renderer url in dev", () => {
    const u = new URL(buildRendererChannelUrl({ ...prod, isDev: true, channelId: "alpha", audioOutput: { deviceId: "x", label: "X" } }));
    expect(u.origin).toBe("http://localhost:3001");
    expect(u.searchParams.get("channel")).toBe("alpha");
    expect(u.searchParams.get("audioSinkLabel")).toBe("X");
    expect(u.searchParams.has("server")).toBe(false);
  });
});
```

Append to `apps/desktop/src/windowPrefs.test.ts` inside the existing `describe("loadPrefs / savePrefs")`:

```ts
  it("round-trips audioOutput and tolerates its absence", () => {
    savePrefs(file, {
      version: 1,
      displays: [],
      channels: {
        program: {
          autoOpen: false, fullscreen: false, frameless: false, alwaysOnTop: false, transparent: false,
          audioOutput: { deviceId: "abc", label: "Aux" },
        },
        alpha: { autoOpen: false, fullscreen: false, frameless: false, alwaysOnTop: false, transparent: false },
      },
    });
    const loaded = loadPrefs(file);
    expect(loaded.channels.program?.audioOutput).toEqual({ deviceId: "abc", label: "Aux" });
    expect(loaded.channels.alpha?.audioOutput).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/desktop/src/rendererUrl.test.ts apps/desktop/src/windowPrefs.test.ts`
Expected: FAIL (module missing; `audioOutput` stripped/unknown by schema).

- [ ] **Step 3: Implement**

`packages/core/src/channelWindowPrefs.ts`, add to `ChannelWindowPrefsSchema` after `transparent`:

```ts
  /** Output device for media audio in this window (per-machine; never synced).
   *  `label` is the fallback match — device ids are per-origin hashes. */
  audioOutput: z.object({ deviceId: z.string(), label: z.string() }).optional(),
```

`apps/desktop/src/rendererUrl.ts`:

```ts
/**
 * Pure builder for a channel window's renderer URL (main.ts imports
 * electron, so the logic lives here to be testable).
 */
export function buildRendererChannelUrl(opts: {
  isDev: boolean;
  devRendererUrl: string;
  serverHost: string;
  serverPort: number;
  channelId: string;
  audioOutput?: { deviceId: string; label: string };
}): string {
  const u = opts.isDev
    ? new URL(opts.devRendererUrl)
    : new URL(`http://${opts.serverHost}:${opts.serverPort}/renderer/`);
  u.searchParams.set("channel", opts.channelId);
  if (!opts.isDev) {
    u.searchParams.set("server", `ws://${opts.serverHost}:${opts.serverPort}/ws`);
  }
  if (opts.audioOutput) {
    u.searchParams.set("audioSinkId", opts.audioOutput.deviceId);
    u.searchParams.set("audioSinkLabel", opts.audioOutput.label);
  }
  return u.toString();
}
```

`apps/desktop/src/main.ts`: add `import { buildRendererChannelUrl } from "./rendererUrl";` and replace `rendererChannelUrl`:

```ts
function rendererChannelUrl(channelId: string): string {
  // Audio device is a per-machine pref, read fresh so a reopen picks up changes.
  const audioOutput = loadPrefs(prefsFilePath()).channels[channelId]?.audioOutput;
  return buildRendererChannelUrl({
    isDev,
    devRendererUrl: process.env["RENDERER_URL"] ?? "http://localhost:3001",
    serverHost,
    serverPort,
    channelId,
    ...(audioOutput ? { audioOutput } : {}),
  });
}
```

(`loadPrefs` and `prefsFilePath` are already in scope in `main.ts` — confirm with `grep -n "function prefsFilePath\|loadPrefs" apps/desktop/src/main.ts`. Note the prod URL previously used `encodeURIComponent(channelId)` in a template string; `URLSearchParams` encodes equivalently.)

In `createChannelWindow`'s `webPreferences`, add:

```ts
      // Media rows play with sound; Chromium blocks unmuted autoplay by default.
      autoplayPolicy: "no-user-gesture-required",
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/desktop && pnpm --filter @overlaysys/desktop typecheck`
Expected: PASS. (If the desktop package has no `typecheck` script, run `pnpm typecheck`.)

- [ ] **Step 5: Audio output picker in `ChannelWindowSettingsPopover.tsx`**

Add `audioOutput: undefined` to `DEFAULT_PREFS`. Add state and loading:

```tsx
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [savedAudio, setSavedAudio] = useState<ChannelWindowPrefs["audioOutput"]>(undefined);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const list = async () =>
        (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications");
      let outs = await list();
      // Chromium hides labels until a media permission has been granted once.
      if (outs.length > 0 && outs.every((d) => !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const t of s.getTracks()) t.stop();
          outs = await list();
        } catch {
          // Leave unlabeled; ids still work.
        }
      }
      setAudioDevices(outs.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId })));
    })();
  }, [api]);
```

In the existing prefs-loading effect, after `if (existing) setPrefs(existing);` add `setSavedAudio(existing?.audioOutput);`.

Below the Display block, add:

```tsx
      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Audio output (video rows)</div>
        <select
          value={prefs.audioOutput?.deviceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id === "") return update("audioOutput", undefined);
            const d = audioDevices.find((x) => x.deviceId === id) ?? prefs.audioOutput;
            update("audioOutput", d ? { deviceId: d.deviceId, label: d.label } : undefined);
          }}
          style={{ width: "100%", padding: 4 }}
        >
          <option value="">System default</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
          {prefs.audioOutput &&
            !audioDevices.some(
              (d) => d.deviceId === prefs.audioOutput!.deviceId || d.label === prefs.audioOutput!.label,
            ) && (
              <option value={prefs.audioOutput.deviceId}>
                {prefs.audioOutput.label} ⚠ not connected
              </option>
            )}
        </select>
      </div>
```

Replace `onSave`:

```tsx
  const onSave = async () => {
    await api.setChannelWindowPrefs(channelId, prefs);
    // The renderer reads its audio device from the URL, so an open window
    // must be reopened for a change to take effect. It rejoins mid-video
    // from the server's last reported position.
    const audioChanged =
      (savedAudio?.deviceId ?? "") !== (prefs.audioOutput?.deviceId ?? "");
    if (audioChanged) {
      const open = await api.listChannelWindows();
      if (open.includes(channelId)) await api.reopenChannelOnConfiguredDisplay(channelId);
    }
    setSavedAudio(prefs.audioOutput);
    setDirty(false);
    onSaved?.();
    onClose();
  };
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/channelWindowPrefs.ts apps/desktop/src/rendererUrl.ts apps/desktop/src/rendererUrl.test.ts apps/desktop/src/windowPrefs.test.ts apps/desktop/src/main.ts apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx
git commit -m "feat(desktop): per-window audio output device for media and unmuted autoplay"
```

---

### Task 8: Operator — playback state, transport strip, preview indicator

**Files:**
- Create: `apps/operator/src/lib/mediaTime.ts`, `apps/operator/src/lib/mediaTime.test.ts`
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`
- Create: `apps/operator/src/app/components/MediaTransportStrip.tsx`
- Modify: `apps/operator/src/app/page.tsx` (mount strip above the middle panel content), `apps/operator/src/app/components/ChannelPreview.tsx`

**Interfaces:**
- Consumes: `ChannelMedia`, `MediaPlayback`, `media_playback`, `media_control`, `media_clear`, `formatClock` (Task 4).
- Produces:
  - `type MediaDisplayStatus = "loading" | "playing" | "paused" | "ended" | "error" | "no-renderer"`
  - `displayTime(m: ChannelMedia, heardAtLocal: number, nowLocal: number): { elapsed: number; remaining: number; fraction: number }`
  - `displayStatus(m: ChannelMedia, heardAtLocal: number, nowLocal: number): MediaDisplayStatus`
  - store: `mediaHeardAt: Record<string, number>`, `applyMediaPlayback(channel: string, takenAt: number, playback: MediaPlayback): void`
  - `<MediaTransportStrip />` (no props; reads store)

- [ ] **Step 1: Failing tests** — `apps/operator/src/lib/mediaTime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ChannelMedia } from "@overlaysys/core";
import { displayStatus, displayTime, NO_RENDERER_MS } from "./mediaTime";

const m = (over: Partial<ChannelMedia["playback"]> = {}, rest: Partial<ChannelMedia> = {}): ChannelMedia => ({
  rowId: "r", assetUrl: "/a.mp4", volume: 1, endAction: "clear", takenAt: 1, paused: false,
  playback: { status: "playing", currentTime: 10, duration: 300, updatedAt: 999_999, ...over },
  ...rest,
});

describe("displayTime", () => {
  it("interpolates from LOCAL receive time while playing (ignores server clock)", () => {
    const t = displayTime(m(), 5_000, 5_500);
    expect(t.elapsed).toBeCloseTo(10.5);
    expect(t.remaining).toBeCloseTo(289.5);
    expect(t.fraction).toBeCloseTo(10.5 / 300);
  });

  it("does not interpolate when paused", () => {
    expect(displayTime(m({ status: "paused" }), 5_000, 9_000).elapsed).toBe(10);
  });

  it("caps interpolation at one second past the last report and at duration", () => {
    expect(displayTime(m(), 5_000, 20_000).elapsed).toBe(11);
    expect(displayTime(m({ currentTime: 299.8 }), 5_000, 6_000).elapsed).toBe(300);
  });

  it("handles unknown duration", () => {
    const t = displayTime(m({ duration: 0, status: "loading", currentTime: 0 }), 0, 0);
    expect(t).toEqual({ elapsed: 0, remaining: 0, fraction: 0 });
  });
});

describe("displayStatus", () => {
  it("passes through a fresh status", () => {
    expect(displayStatus(m(), 5_000, 5_100)).toBe("playing");
    expect(displayStatus(m({ status: "paused" }), 5_000, 60_000)).toBe("paused");
  });

  it("flags no-renderer when playing/loading goes quiet", () => {
    expect(displayStatus(m(), 5_000, 5_000 + NO_RENDERER_MS + 1)).toBe("no-renderer");
    expect(displayStatus(m({ status: "loading" }), 5_000, 5_000 + NO_RENDERER_MS + 1)).toBe("no-renderer");
  });

  it("keeps error visible", () => {
    expect(displayStatus(m({ status: "error", error: "x" }), 0, 99_999)).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/mediaTime.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `apps/operator/src/lib/mediaTime.ts`:

```ts
import type { ChannelMedia } from "@overlaysys/core";

/** Reports arrive every 250 ms while playing; 3 s of silence means no renderer. */
export const NO_RENDERER_MS = 3_000;
/** Never extrapolate more than this past the last report (stalls, hiccups). */
const MAX_EXTRAPOLATE_S = 1;

export type MediaDisplayStatus = "loading" | "playing" | "paused" | "ended" | "error" | "no-renderer";

/**
 * Progress for display. Interpolates with the operator's LOCAL clock from
 * when the last report was received — server `updatedAt` is another
 * machine's clock and may be skewed.
 */
export function displayTime(
  m: ChannelMedia,
  heardAtLocal: number,
  nowLocal: number,
): { elapsed: number; remaining: number; fraction: number } {
  const { status, currentTime, duration } = m.playback;
  let elapsed = currentTime;
  if (status === "playing") {
    elapsed += Math.min(MAX_EXTRAPOLATE_S, Math.max(0, (nowLocal - heardAtLocal) / 1000));
  }
  if (duration > 0) elapsed = Math.min(elapsed, duration);
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
  const fraction = duration > 0 ? elapsed / duration : 0;
  return { elapsed, remaining, fraction };
}

export function displayStatus(m: ChannelMedia, heardAtLocal: number, nowLocal: number): MediaDisplayStatus {
  const s = m.playback.status;
  if ((s === "playing" || s === "loading") && nowLocal - heardAtLocal > NO_RENDERER_MS) {
    return "no-renderer";
  }
  return s;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/operator/src/lib/mediaTime.test.ts`
Expected: PASS.

- [ ] **Step 5: Store + WS wiring**

`apps/operator/src/lib/store.ts`: add `MediaPlayback` to the core type import. In the state type (near `channelStates`, ~line 64):

```ts
  /** Local ms when each channel's media playback was last heard (for interpolation / staleness). */
  mediaHeardAt: Record<string, number>;
  applyMediaPlayback: (channel: string, takenAt: number, playback: MediaPlayback) => void;
```

Initial value next to `channelStates: {},`: `mediaHeardAt: {},`. Replace `setChannelState` and add `applyMediaPlayback`:

```ts
  setChannelState: (s) =>
    set((cur) => ({
      channelStates: { ...cur.channelStates, [s.channel]: s },
      // Any state carrying media is a fresh playback report.
      mediaHeardAt: s.media
        ? { ...cur.mediaHeardAt, [s.channel]: Date.now() }
        : cur.mediaHeardAt,
    })),
  applyMediaPlayback: (channel, takenAt, playback) =>
    set((cur) => {
      const st = cur.channelStates[channel];
      if (!st?.media || st.media.takenAt !== takenAt) return {};
      return {
        channelStates: { ...cur.channelStates, [channel]: { ...st, media: { ...st.media, playback } } },
        mediaHeardAt: { ...cur.mediaHeardAt, [channel]: Date.now() },
      };
    }),
```

`apps/operator/src/lib/useWs.ts`, add a case after `case "state":`:

```ts
      case "media_playback":
        store.applyMediaPlayback(msg.channel, msg.takenAt, msg.playback);
        break;
```

The operator subscribes to `program` and `preview` (`CHANNELS_TO_WATCH`). Video rows default to `program`; that's sufficient for v1. If the row's `channelHint` is some other channel the strip won't see it — add that channel to the subscription list: in `case "hello"`, nothing to change now; instead note in the strip (below) that it lists every channel present in `channelStates`.

- [ ] **Step 6: Create `apps/operator/src/app/components/MediaTransportStrip.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelMedia } from "@overlaysys/core";
import { Button, colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { formatClock } from "@/lib/mediaTake";
import { displayStatus, displayTime, type MediaDisplayStatus } from "@/lib/mediaTime";

const STATUS_LABEL: Record<MediaDisplayStatus, string> = {
  loading: "Loading",
  playing: "Playing",
  paused: "Paused",
  ended: "Ended",
  error: "Error",
  "no-renderer": "No renderer reporting",
};

const STATUS_COLOR: Record<MediaDisplayStatus, string> = {
  loading: colors.textDim,
  playing: "#3ccf6e",
  paused: "#f0b429",
  ended: colors.textDim,
  error: colors.red,
  "no-renderer": colors.red,
};

/**
 * Transport for every channel currently holding media. Shown regardless of
 * the selected rundown row so Stop is always one click away.
 */
export function MediaTransportStrip() {
  const channelStates = useStore((s) => s.channelStates);
  const entries = Object.values(channelStates).filter(
    (s): s is typeof s & { media: ChannelMedia } => !!s.media,
  );
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {entries.map((s) => (
        <ChannelTransport key={s.channel} channel={s.channel} media={s.media} />
      ))}
    </div>
  );
}

function ChannelTransport({ channel, media }: { channel: string; media: ChannelMedia }) {
  const { send } = useWs();
  const heardAt = useStore((s) => s.mediaHeardAt[channel] ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const status = displayStatus(media, heardAt, now);
  const t = displayTime(media, heardAt, now);
  const duration = media.playback.duration;
  const fraction = scrub ?? t.fraction;
  const control = (action: "play" | "pause" | "restart" | "seek", time?: number) =>
    send({ type: "media_control", channel, takenAt: media.takenAt, action, ...(time !== undefined ? { time } : {}) });

  const fractionAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: 10,
        background: colors.panel2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span aria-hidden>🎬</span>
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {media.label || "Video"}
        </span>
        <span style={{ fontSize: 11, color: colors.textDim }}>{channel}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status] }}>
          ● {STATUS_LABEL[status]}
        </span>
      </div>

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t.elapsed)}
        onPointerDown={(e) => {
          if (duration <= 0) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setScrub(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (scrub !== null) setScrub(fractionAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (scrub === null) return;
          control("seek", fractionAt(e.clientX) * duration);
          setScrub(null);
        }}
        style={{
          height: 10,
          borderRadius: 5,
          background: colors.border,
          cursor: duration > 0 ? "pointer" : "default",
          position: "relative",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${fraction * 100}%`,
            borderRadius: 5,
            background: colors.accent,
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6, gap: 8 }}>
        <span style={{ fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>
          {formatClock(scrub !== null ? scrub * duration : t.elapsed)} / {duration > 0 ? formatClock(duration) : "–:––"}
        </span>
        <span
          style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          title="Time remaining"
        >
          -{formatClock(t.remaining)}
        </span>
      </div>

      {media.playback.error && (
        <div style={{ marginTop: 6, fontSize: 11, color: colors.red }}>{media.playback.error}</div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {media.paused ? (
          <Button size="sm" onClick={() => control("play")} style={{ flex: 1 }}>▶ Play</Button>
        ) : (
          <Button size="sm" onClick={() => control("pause")} style={{ flex: 1 }}>❚❚ Pause</Button>
        )}
        <Button size="sm" onClick={() => control("restart")} style={{ flex: 1 }}>⟲ Restart</Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => send({ type: "media_clear", channel })}
          style={{ flex: 1 }}
        >
          ■ Stop
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Mount the strip**

In `apps/operator/src/app/page.tsx`, import `MediaTransportStrip` and render it at the top of the middle `ShellPanel`, above the song-mode/take-panel ternary, so it shows in both modes:

```tsx
          <MediaTransportStrip />
          {activeSongSession && activeSongChannel ? (
```

(Wrap the two children in a fragment if `ShellPanel` expects a single child.)

- [ ] **Step 8: ChannelPreview indicator**

In `apps/operator/src/app/components/ChannelPreview.tsx`, import `formatClock` and `displayTime`; read `const heardAt = useStore((s) => s.mediaHeardAt[config.id] ?? 0);`. In the returned JSX, inside the container element (absolutely positioned over the stage), add:

```tsx
      {state?.media && (
        <div
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 10,
            pointerEvents: "none",
          }}
        >
          ▶ {state.media.label || "Video"} · {formatClock(displayTime(state.media, heardAt, Date.now()).remaining)} left
        </div>
      )}
```

The preview must not mount a `<video>` (Global Constraints). If the container isn't `position: relative`, add that to its style. Mirror channels' previews will receive their own channel's state (no media) — acceptable.

- [ ] **Step 9: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/operator/src/lib/mediaTime.ts apps/operator/src/lib/mediaTime.test.ts apps/operator/src/lib/store.ts apps/operator/src/lib/useWs.ts apps/operator/src/app/components/MediaTransportStrip.tsx apps/operator/src/app/page.tsx apps/operator/src/app/components/ChannelPreview.tsx
git commit -m "feat(operator): media transport strip with progress, remaining time and controls"
```

---

### Task 9: Operator — add/edit video rows in the show editor

**Files:**
- Create: `apps/operator/src/app/components/VideoRowModal.tsx`
- Modify: `apps/operator/src/app/shows/edit/page.tsx`

**Interfaces:**
- Consumes: `VideoRow` (Task 1), `uploadAsset`, `resolveAssetUrl` (`@/lib/uploadAsset`), `VideoInput` (`@overlaysys/editor-kit`), `onEditVideoRow` prop on `RundownTable` (Task 4).
- Produces: `<VideoRowModal open editingRow? channels onClose onSave(args: VideoRowSaveArgs) />` with `type VideoRowSaveArgs = { assetUrl: string; label: string; durationSec?: number; volume: number; endAction: "clear" | "hold"; channelHint: string }`.

- [ ] **Step 1: Create `VideoRowModal.tsx`**

Check the editor-kit export name first: `grep -n VideoInput packages/editor-kit/src/index.ts`. Check the operator already depends on `@overlaysys/editor-kit` (`grep editor-kit apps/operator/package.json`).

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ChannelConfig, VideoRow } from "@overlaysys/core";
import { VideoInput } from "@overlaysys/editor-kit";
import { Button, Field, Input, Modal, Select } from "@overlaysys/ui";
import { resolveAssetUrl, uploadAsset } from "@/lib/uploadAsset";

export type VideoRowSaveArgs = {
  assetUrl: string;
  label: string;
  durationSec?: number;
  volume: number;
  endAction: "clear" | "hold";
  channelHint: string;
};

/** Read a video's duration in the browser; undefined if it can't load. */
function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d: number | undefined) => {
      v.removeAttribute("src");
      v.load();
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : undefined);
    v.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 10_000);
    v.src = url;
  });
}

export function VideoRowModal({
  open,
  editingRow,
  channels,
  onClose,
  onSave,
}: {
  open: boolean;
  editingRow?: VideoRow;
  channels: ChannelConfig[];
  onClose: () => void;
  onSave: (args: VideoRowSaveArgs) => void;
}) {
  const [assetUrl, setAssetUrl] = useState("");
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(1);
  const [endAction, setEndAction] = useState<"clear" | "hold">("clear");
  const [channelHint, setChannelHint] = useState("program");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAssetUrl(editingRow?.assetUrl ?? "");
    setLabel(editingRow?.label ?? "");
    setVolume(editingRow?.volume ?? 1);
    setEndAction(editingRow?.endAction ?? "clear");
    setChannelHint(editingRow?.channelHint ?? "program");
  }, [open, editingRow]);

  async function save() {
    if (!assetUrl) return;
    setSaving(true);
    try {
      const durationSec = await probeDuration(resolveAssetUrl(assetUrl));
      onSave({
        assetUrl,
        label: label.trim(),
        ...(durationSec !== undefined ? { durationSec } : {}),
        volume,
        endAction,
        channelHint,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingRow ? "Edit video" : "Add video"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!assetUrl || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Video">
        <VideoInput
          value={assetUrl}
          onChange={setAssetUrl}
          onUpload={async (file) => (await uploadAsset(file)).url}
        />
      </Field>
      <Field label="Label">
        <Input value={label} placeholder="Giving video" onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Channel">
        <Select value={channelHint} onChange={(e) => setChannelHint(e.target.value)}>
          {channels.length === 0 && <option value="program">program</option>}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.id}</option>
          ))}
        </Select>
      </Field>
      <Field label={`Volume — ${Math.round(volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </Field>
      <Field label="When the video ends">
        <Select value={endAction} onChange={(e) => setEndAction(e.target.value as "clear" | "hold")}>
          <option value="clear">Clear automatically</option>
          <option value="hold">Hold last frame</option>
        </Select>
      </Field>
    </Modal>
  );
}
```

`VideoInput` with a relative `/assets/...` value: if its preview doesn't render in dev (operator :3000 vs server :4000), that's cosmetic; the stored value stays relative, matching how template video fields are stored. Uploads in cloud mode return cloud paths via `uploadAsset`; video playback from cloud assets is out of scope (renderers talk to the local server).

- [ ] **Step 2: Wire into `apps/operator/src/app/shows/edit/page.tsx`**

Imports: `VideoRow` (core types), `import { VideoRowModal, type VideoRowSaveArgs } from "@/app/components/VideoRowModal";`.

State next to the scripture modal state:

```tsx
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [editingVideoRow, setEditingVideoRow] = useState<VideoRow | null>(null);
```

Save handler next to `addScriptureRow`:

```tsx
  function saveVideoRow(args: VideoRowSaveArgs) {
    const fields = {
      assetUrl: args.assetUrl,
      ...(args.label ? { label: args.label } : {}),
      ...(args.durationSec !== undefined ? { durationSec: args.durationSec } : {}),
      volume: args.volume,
      endAction: args.endAction,
      channelHint: args.channelHint,
    };
    if (editingVideoRow) {
      update((s) => {
        const idx = s.rows.findIndex((r) => r.id === editingVideoRow.id);
        if (idx >= 0) {
          const { label: _l, durationSec: _d, ...keep } = editingVideoRow;
          s.rows[idx] = { ...keep, ...fields };
        }
      });
    } else {
      update((s) => {
        s.rows.push({ kind: "video", id: uuid(), ...fields });
      });
    }
    setVideoModalOpen(false);
    setEditingVideoRow(null);
  }
```

(Destructuring away `label`/`durationSec` lets clearing the label in the modal actually remove it.)

Pass to `RundownTable`:

```tsx
            onEditVideoRow={(row) => {
              setEditingVideoRow(row);
              setVideoModalOpen(true);
            }}
```

Add-row button next to "+ Scripture":

```tsx
            <button onClick={() => setVideoModalOpen(true)} style={addRowBtn}>+ Video</button>
```

Modal next to `ScriptureRowModal`:

```tsx
      <VideoRowModal
        open={videoModalOpen}
        editingRow={editingVideoRow ?? undefined}
        channels={takeableChannels}
        onClose={() => {
          setVideoModalOpen(false);
          setEditingVideoRow(null);
        }}
        onSave={saveVideoRow}
      />
```

(`takeableChannels` is already computed in this component and passed to `RundownTable` — confirm its type is `ChannelConfig[]`.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/components/VideoRowModal.tsx apps/operator/src/app/shows/edit/page.tsx
git commit -m "feat(operator): add and edit video rows in the show editor"
```

---

### Task 10: End-to-end verification on the desktop app

No code unless a step fails (then fix, add a regression test where the fix is in testable code, and commit).

- [ ] **Step 1: Full suite**

Run: `pnpm typecheck && pnpm test`
Expected: green; test count > 641.

- [ ] **Step 2: Run the desktop app** (`pnpm desktop`, with `pnpm dev` running if the desktop dev mode requires it — see `apps/desktop/src/main.ts` header comment).

- [ ] **Step 3: Audio routing**
  1. Channels → `program` → Window settings → Audio output: choose the aux device → Save. Confirm the device list shows real names (not ids).
     If labels are still blank after the popover's `getUserMedia` fallback, add this in `main.ts` right after `app.whenReady()` resolves (import `session` from `electron`), then re-verify:
     ```ts
     // Channel/operator pages need device labels (audio output picker) and
     // speaker selection (setSinkId). Both are local pages we serve.
     session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
       permission === "media" || permission === "speaker-selection" ? true : null,
     );
     ```
     At plan time `main.ts` installs no permission handlers, so Electron's defaults apply; this step is only needed if they turn out to hide labels.
  2. Open the program window.

- [ ] **Step 4: Playback flow** — Show editor → "+ Video" → upload a ≥30 s MP4 with audio, label "Giving test", channel program, Clear automatically → Save. In the rundown, select the row → "Take ▶ PGM".
  Expected: video full-frame in the program window; audio on the aux device; transport strip shows Playing, elapsed counting up, remaining counting down smoothly.

- [ ] **Step 5: Overlay** — take any lower-third graphic on program. Expected: it draws over the video. Clear it (Esc). Expected: video keeps playing.

- [ ] **Step 6: Transport** — Pause (video and audio stop; badge Paused), Play, drag the bar to ~80% (jumps), Restart (back to 0:00).

- [ ] **Step 7: Auto-clear** — seek to the last 5 s and let it end. Expected: video disappears from the program window, strip disappears.

- [ ] **Step 8: Alpha/mirror** — if an alpha channel mirrors program, open it, take the video again. Expected: alpha shows a white rectangle where the video is; no second audio stream (listen for doubling/echo).

- [ ] **Step 9: Resilience** — while playing: change the audio device in Window settings and Save. Expected: window reopens and resumes within ~1–2 s of where it was. Then unplug/disable the aux device and re-take. Expected: plays on default output with the warning shown in the strip.

- [ ] **Step 10: Bundle** — Data → export a bundle containing the show; import it on a fresh data dir (or re-import). Expected: the video row plays after import.

- [ ] **Step 11: Commit any fixes** from the above with messages describing the defect fixed.
