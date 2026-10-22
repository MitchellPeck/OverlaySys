# Confidence Monitor — Phases 2–4 (Sermon Notes, Companion, Stage Messages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pastors get scrollable, point-by-point sermon notes on the confidence monitor that they drive from their phone via Bitfocus Companion; the booth can send short messages to stage; operators author/import notes per show and control both from the live view.

**Architecture:** Sermon notes are Markdown documents on the `Show` (`Show.sermonNotes[]`), split into points by a pure `splitPoints`. A server-memory `StageState` (`server/src/stageState.ts`) holds the active notes set, point index, scroll offset and the current message; it's mutated only through new client messages, reduced by a pure `notesNav` reducer, broadcast to operator/Companion as `stage_state`, and folded into every `stage_feed` via the existing hub. Renderer widgets `sermonNotes` and `message` draw it; the Speaker layout gains a notes area and a message bar.

**Tech Stack:** TypeScript, zod 3, Fastify + `ws`, React 19 + Vite renderer, Next 15 operator, `@companion-module/base`, `mammoth` (browser .docx → Markdown), Vitest 4 (node env, logic tests only).

**Spec:** `docs/superpowers/specs/2026-10-22-confidence-monitor-design.md` (phases 2–4)

## Global Constraints

- Notes live on the show: `Show.sermonNotes?: SermonNotes[]`; rows link with optional `sermonNotesId`. Existing show JSON must parse unchanged.
- Points: split on Markdown headings (any level); with no headings, split on blank-line blocks. Empty/whitespace body → `[]`.
- Navigation: point-by-point primary (`notes_point` delta/index, clamped), free scroll secondary (`notes_scroll` delta in viewport fractions, default 0.33), scroll resets to 0 on every point change.
- One shared notes position per server (all stage channels show the same position).
- `stage_state` is broadcast to all clients on every StageState change; stage feeds are invalidated on every change.
- Overflow (`notes_overflow`) must be idempotent across several stage windows: it carries the `pointIdx` it observed and is ignored when that no longer matches.
- Taking a row with `sermonNotesId` to any channel except `preview` selects that set (point 0) unless it is already active. A sourced take from a *different show* than the active notes' show clears the active notes first.
- Message presets default: `["Wrap up", "5 minutes", "Stand by"]`, stored server-side at `dataRoot()/settings/stage.json`, GET/PUT `/api/stage/settings`.
- `PROTOCOL_VERSION` is unchanged (new messages are additive; old Companion builds drop unknown server types via `decodeServerTolerant`).
- Tests are Vitest node env, logic only; UI verified by typecheck + build and a manual checklist.
- Run tests with `pnpm test`; known pre-existing failure `server/src/pco/importPlan.test.ts` "persists a client-configured song draft instead of rebuilding it" — ignore.

## Review Focus

- Two stage windows open at once both detect overflow → the server must advance exactly one point. (Task 3 test.)
- Notes body edited while a monitor shows it, so the active `pointIdx` exceeds the new point count → feed must clamp, never index past the end. (Task 4 test.)
- The active notes set is deleted from the show, or the show is deleted → `notes` is null in the feed and Companion variables blank, no throw. (Task 4 test, Task 8 test.)
- Pastor presses Next on the last point / Prev on the first → no change, no wrap. (Task 1 test.)
- A .docx with tables/images → import keeps headings, paragraphs, bold/italic, lists; drops what it can't represent without failing. (Task 6 test on the normalizer.)

---

## File Structure

**Core (`packages/core/src/`)**
- Create `sermonNotes.ts` — `SermonNotesSchema`, `splitPoints`, `NotesPoint`.
- Create `notesNav.ts` — `StageStateSchema`, pure reducer `reduceStageState`.
- Modify `show.ts` — `Show.sermonNotes`, `sermonNotesId` on every row kind.
- Modify `stageFeed.ts` — `notes`, `message` in `StageFeed`.
- Modify `stageLayout.ts` — widget kinds `sermonNotes`, `message`; Speaker layout gets both.
- Create `stageSettings.ts` — `StageSettingsSchema` (message presets).
- Modify `index.ts`.

**Protocol (`packages/ws-protocol/src/index.ts`)** — client `notes_select`, `notes_point`, `notes_scroll`, `notes_reset`, `notes_overflow`, `stage_message`, `stage_message_clear`; server `stage_state`.

**Server (`server/src/`)**
- Create `stageState.ts` — state holder, row-take hook, broadcast.
- Create `stageSettings.ts` — load/save + routes.
- Modify `channels.ts` — `onLiveRow` listener registry.
- Modify `stageFeed.ts`, `stageFeedHub.ts` — notes + message in the feed.
- Modify `ws.ts` — handlers, wiring.
- Modify `index.ts` — register stage settings routes.

**Renderer (`apps/renderer/src/stage/`)**
- Create `notesMarkdown.ts` — tiny Markdown → block model (pure).
- Modify `widgets.tsx` — `sermonNotes`, `message` widgets; overflow detection.
- Modify `StageView.tsx`, `Renderer.tsx` — pass `send` for overflow.

**Operator (`apps/operator/src/`)**
- Create `lib/notesImport.ts` — file → Markdown (txt/md passthrough, docx via mammoth), pure normalizer.
- Create `app/shows/edit/SermonNotesEditor.tsx`; modify `app/shows/edit/page.tsx` (section + row picker).
- Modify `lib/store.ts`, `lib/useWs.ts` — `stageState`.
- Create `app/components/StagePanel.tsx`; modify `app/page.tsx` (right column).
- Create `app/settings/stage/page.tsx`; modify `app/shell/areas.ts` (+ test) — Settings → Stage monitor.

**Companion (`packages/companion-module/src/`)** — `types.ts`, `state.ts`, `actions.ts`, `variables.ts`, `feedbacks.ts`, `presets.ts`, `index.ts`.

---

### Task 1: Core — sermon notes schema, `splitPoints`, `notesNav` reducer

**Files:**
- Create: `packages/core/src/sermonNotes.ts`, `packages/core/src/notesNav.ts`
- Modify: `packages/core/src/show.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/sermonNotes.test.ts`, `packages/core/src/notesNav.test.ts`

**Interfaces:**
- Produces:
  - `SermonNotesSchema`, `type SermonNotes = { id: string; title: string; body: string; updatedAt?: string }`
  - `type NotesPoint = { heading: string; markdown: string }`; `splitPoints(body: string): NotesPoint[]`
  - `Show.sermonNotes?: SermonNotes[]`; `sermonNotesId?: string` on `GraphicRow`, `SongRow`, `ScriptureRow`, `VideoRow`
  - `StageStateSchema`, `type StageState = { notes: { showId: string; notesId: string } | null; pointIdx: number; scrollOffset: number; message: { text: string; sentAt: number } | null }`, `INITIAL_STAGE_STATE`
  - `type StageAction = { type: "select"; showId: string; notesId: string | null } | { type: "point"; delta: number } | { type: "point"; index: number } | { type: "scroll"; delta: number } | { type: "reset" } | { type: "overflow"; direction: "next" | "prev"; atPoint: number } | { type: "message"; text: string; now: number } | { type: "messageClear" }`
  - `reduceStageState(s: StageState, a: StageAction, pointCount: number): StageState`

- [ ] **Step 1: Write the failing tests**

`packages/core/src/sermonNotes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ShowSchema } from "./show";
import { splitPoints } from "./sermonNotes";

describe("splitPoints", () => {
  it("splits on headings of any level, keeping the heading line in the point", () => {
    const pts = splitPoints("# Intro\nHello\n\n## Point one\nText **bold**\n### Sub\nMore");
    expect(pts.map((p) => p.heading)).toEqual(["Intro", "Point one", "Sub"]);
    expect(pts[1]!.markdown).toBe("## Point one\nText **bold**");
  });

  it("keeps text before the first heading as its own point", () => {
    const pts = splitPoints("Opening prayer\n\n# One\nA");
    expect(pts.map((p) => p.heading)).toEqual(["Opening prayer", "One"]);
  });

  it("falls back to blank-line blocks when there are no headings", () => {
    const pts = splitPoints("First block\nline two\n\n\nSecond block");
    expect(pts).toEqual([
      { heading: "First block", markdown: "First block\nline two" },
      { heading: "Second block", markdown: "Second block" },
    ]);
  });

  it("truncates long first-line headings to 60 chars with an ellipsis", () => {
    const long = "x".repeat(80);
    expect(splitPoints(long)[0]!.heading).toBe("x".repeat(59) + "…");
  });

  it("strips list markers and emphasis from a block's heading", () => {
    expect(splitPoints("- **Grace** is free")[0]!.heading).toBe("Grace is free");
  });

  it("returns [] for empty or whitespace input", () => {
    expect(splitPoints("")).toEqual([]);
    expect(splitPoints("  \n\n \t")).toEqual([]);
  });

  it("normalizes CRLF", () => {
    expect(splitPoints("# A\r\nx\r\n# B\r\ny").map((p) => p.heading)).toEqual(["A", "B"]);
  });
});

describe("Show sermon notes fields", () => {
  it("parses shows without sermon notes unchanged", () => {
    const s = ShowSchema.parse({ id: "s", name: "S", projectId: "p", rows: [], songs: [] });
    expect(s.sermonNotes).toBeUndefined();
  });
  it("accepts notes and a row link", () => {
    const s = ShowSchema.parse({
      id: "s",
      name: "S",
      projectId: "p",
      songs: [],
      sermonNotes: [{ id: "n1", title: "Sermon", body: "# A" }],
      rows: [{ kind: "graphic", id: "r", templateId: "t", data: {}, sermonNotesId: "n1" }],
    });
    expect(s.sermonNotes?.[0]?.id).toBe("n1");
    expect(s.rows[0]).toMatchObject({ sermonNotesId: "n1" });
  });
});
```

`packages/core/src/notesNav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_STAGE_STATE, reduceStageState, type StageState } from "./notesNav";

const active = (over: Partial<StageState> = {}): StageState => ({
  ...INITIAL_STAGE_STATE,
  notes: { showId: "s", notesId: "n" },
  ...over,
});

describe("reduceStageState", () => {
  it("select sets notes and resets position; selecting the same set is a no-op", () => {
    const a = reduceStageState(active({ pointIdx: 3, scrollOffset: 0.5 }), { type: "select", showId: "s", notesId: "n2" }, 5);
    expect(a).toMatchObject({ notes: { showId: "s", notesId: "n2" }, pointIdx: 0, scrollOffset: 0 });
    const same = active({ pointIdx: 3 });
    expect(reduceStageState(same, { type: "select", showId: "s", notesId: "n" }, 5)).toBe(same);
  });

  it("select null clears notes", () => {
    expect(reduceStageState(active(), { type: "select", showId: "s", notesId: null }, 5).notes).toBeNull();
  });

  it("point delta clamps without wrapping and resets scroll", () => {
    expect(reduceStageState(active({ pointIdx: 4, scrollOffset: 0.3 }), { type: "point", delta: 1 }, 5)).toMatchObject({ pointIdx: 4, scrollOffset: 0.3 });
    expect(reduceStageState(active({ pointIdx: 0 }), { type: "point", delta: -1 }, 5).pointIdx).toBe(0);
    expect(reduceStageState(active({ pointIdx: 1, scrollOffset: 0.3 }), { type: "point", delta: 1 }, 5)).toMatchObject({ pointIdx: 2, scrollOffset: 0 });
  });

  it("point index clamps into range", () => {
    expect(reduceStageState(active(), { type: "point", index: 99 }, 5).pointIdx).toBe(4);
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "point", index: -3 }, 5).pointIdx).toBe(0);
  });

  it("navigation without active notes or with zero points is a no-op", () => {
    const s = { ...INITIAL_STAGE_STATE };
    expect(reduceStageState(s, { type: "point", delta: 1 }, 5)).toBe(s);
    const a = active();
    expect(reduceStageState(a, { type: "point", delta: 1 }, 0)).toBe(a);
  });

  it("scroll accumulates and floors at zero on the first point", () => {
    const one = reduceStageState(active(), { type: "scroll", delta: 0.33 }, 5);
    expect(one.scrollOffset).toBeCloseTo(0.33);
    expect(reduceStageState(one, { type: "scroll", delta: -1 }, 5).scrollOffset).toBe(0);
  });

  it("scroll may go negative on later points (overflow handles moving back)", () => {
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "scroll", delta: -0.33 }, 5).scrollOffset).toBeCloseTo(-0.33);
  });

  it("reset returns to point 0 / scroll 0", () => {
    expect(reduceStageState(active({ pointIdx: 3, scrollOffset: 1 }), { type: "reset" }, 5)).toMatchObject({ pointIdx: 0, scrollOffset: 0 });
  });

  it("overflow moves one point only when the observed point is still current", () => {
    const s = active({ pointIdx: 2, scrollOffset: 0.9 });
    const moved = reduceStageState(s, { type: "overflow", direction: "next", atPoint: 2 }, 5);
    expect(moved).toMatchObject({ pointIdx: 3, scrollOffset: 0 });
    // A second window reporting the same overflow is ignored.
    expect(reduceStageState(moved, { type: "overflow", direction: "next", atPoint: 2 }, 5)).toBe(moved);
    expect(reduceStageState(active({ pointIdx: 2 }), { type: "overflow", direction: "prev", atPoint: 2 }, 5).pointIdx).toBe(1);
  });

  it("overflow at the ends clamps (no change)", () => {
    const last = active({ pointIdx: 4, scrollOffset: 2 });
    expect(reduceStageState(last, { type: "overflow", direction: "next", atPoint: 4 }, 5)).toBe(last);
  });

  it("messages set and clear", () => {
    const m = reduceStageState(INITIAL_STAGE_STATE, { type: "message", text: " Wrap up ", now: 7 }, 0);
    expect(m.message).toEqual({ text: "Wrap up", sentAt: 7 });
    expect(reduceStageState(m, { type: "messageClear" }, 0).message).toBeNull();
    expect(reduceStageState(INITIAL_STAGE_STATE, { type: "message", text: "   ", now: 7 }, 0).message).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/sermonNotes.test.ts packages/core/src/notesNav.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`packages/core/src/sermonNotes.ts`:

```ts
import { z } from "zod";

/** Long-form speaker notes attached to a show; split into points for the confidence monitor. */
export const SermonNotesSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown. Headings (any level) start points; without headings, blank-line blocks do. */
  body: z.string(),
  updatedAt: z.string().optional(),
});
export type SermonNotes = z.infer<typeof SermonNotesSchema>;

export type NotesPoint = { heading: string; markdown: string };

const HEADING = /^#{1,6}\s+(.*)$/;
const HEADING_MAX = 60;

function plainHeading(line: string): string {
  const text = line
    .replace(HEADING, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
  return text.length > HEADING_MAX ? text.slice(0, HEADING_MAX - 1) + "…" : text;
}

function point(lines: string[]): NotesPoint | null {
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (!lines.length) return null;
  return { heading: plainHeading(lines[0]!), markdown: lines.join("\n") };
}

export function splitPoints(body: string): NotesPoint[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: NotesPoint[] = [];
  const hasHeadings = lines.some((l) => HEADING.test(l));
  let cur: string[] = [];
  const flush = () => {
    const p = point(cur);
    if (p) out.push(p);
    cur = [];
  };
  for (const line of lines) {
    if (hasHeadings ? HEADING.test(line) : !line.trim()) {
      flush();
      if (hasHeadings) cur.push(line);
    } else {
      cur.push(line);
    }
  }
  flush();
  return out;
}
```

`packages/core/src/notesNav.ts`:

```ts
import { z } from "zod";

/** Server-memory confidence-monitor state shared by every stage channel. */
export const StageStateSchema = z.object({
  notes: z.object({ showId: z.string(), notesId: z.string() }).nullable(),
  pointIdx: z.number().int().nonnegative(),
  /** Extra scroll inside the active point, in fractions of the notes widget's height. */
  scrollOffset: z.number(),
  message: z.object({ text: z.string(), sentAt: z.number() }).nullable(),
});
export type StageState = z.infer<typeof StageStateSchema>;

export const INITIAL_STAGE_STATE: StageState = { notes: null, pointIdx: 0, scrollOffset: 0, message: null };

export type StageAction =
  | { type: "select"; showId: string; notesId: string | null }
  | { type: "point"; delta: number }
  | { type: "point"; index: number }
  | { type: "scroll"; delta: number }
  | { type: "reset" }
  | { type: "overflow"; direction: "next" | "prev"; atPoint: number }
  | { type: "message"; text: string; now: number }
  | { type: "messageClear" };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function goTo(s: StageState, idx: number, count: number): StageState {
  const next = clamp(idx, 0, count - 1);
  return next === s.pointIdx ? s : { ...s, pointIdx: next, scrollOffset: 0 };
}

/** Pure. `pointCount` is the active notes' current point count (0 when none). */
export function reduceStageState(s: StageState, a: StageAction, pointCount: number): StageState {
  switch (a.type) {
    case "select":
      if (a.notesId === null) return s.notes ? { ...s, notes: null, pointIdx: 0, scrollOffset: 0 } : s;
      if (s.notes?.showId === a.showId && s.notes.notesId === a.notesId) return s;
      return { ...s, notes: { showId: a.showId, notesId: a.notesId }, pointIdx: 0, scrollOffset: 0 };
    case "message": {
      const text = a.text.trim();
      return { ...s, message: text ? { text, sentAt: a.now } : null };
    }
    case "messageClear":
      return s.message ? { ...s, message: null } : s;
  }
  if (!s.notes || pointCount <= 0) return s;
  switch (a.type) {
    case "point":
      return "index" in a ? goTo(s, a.index, pointCount) : goTo(s, s.pointIdx + a.delta, pointCount);
    case "scroll": {
      const raw = s.scrollOffset + a.delta;
      return { ...s, scrollOffset: s.pointIdx === 0 ? Math.max(0, raw) : raw };
    }
    case "reset":
      return { ...s, pointIdx: 0, scrollOffset: 0 };
    case "overflow":
      if (a.atPoint !== s.pointIdx) return s;
      return goTo(s, s.pointIdx + (a.direction === "next" ? 1 : -1), pointCount);
  }
}
```

`packages/core/src/show.ts`:
- Import `SermonNotesSchema` from `./sermonNotes`.
- Add to `GraphicRowSchema`, `SongRowSchema`, `ScriptureRowSchema` and `VideoRowSchema` objects (after `notes`): `/** Sermon notes set this row selects on the confidence monitor when taken. */ sermonNotesId: z.string().optional(),`
- In the `ShowSchema` inner `z.object`, after `scheduledFor`: `sermonNotes: z.array(SermonNotesSchema).optional(),`

`packages/core/src/index.ts`: add `export * from "./sermonNotes";` and `export * from "./notesNav";`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/core/src/sermonNotes.test.ts packages/core/src/notesNav.test.ts packages/core/src/show.test.ts`
Expected: PASS (`show.test.ts` may not exist — then just the two).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): sermon notes, point splitting and stage-state reducer"
```

---

### Task 2: Core — feed and layout support for notes and messages; stage settings schema

**Files:**
- Modify: `packages/core/src/stageFeed.ts`, `packages/core/src/stageLayout.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/stageSettings.ts`
- Test: `packages/core/src/stageFeed.test.ts`, `packages/core/src/stageLayout.test.ts`, `packages/core/src/stageSettings.test.ts`

**Interfaces:**
- Consumes: `NotesPoint` (Task 1).
- Produces:
  - `StageFeed.notes: { id: string; title: string; points: NotesPoint[]; pointIdx: number; scrollOffset: number } | null`
  - `StageFeed.message: { text: string; sentAt: number } | null`
  - Widget kinds `sermonNotes` (props `{ highlightColor: string = "#ffd166", dimPast: boolean = true, showCounter: boolean = true, anchor: number (0..1) = 0.33 }`) and `message` (props `{ flash: boolean = true }`)
  - `StageSettingsSchema`, `type StageSettings = { messagePresets: string[] }`, `DEFAULT_MESSAGE_PRESETS = ["Wrap up", "5 minutes", "Stand by"]`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/stageFeed.test.ts` (inside the existing describe):

```ts
  it("carries notes and a message", () => {
    const feed = {
      layout: SPEAKER_LAYOUT,
      current: NONE_SLIDE,
      next: NONE_SLIDE,
      row: null,
      nextRow: null,
      timers: [],
      video: null,
      notes: { id: "n", title: "Sermon", points: [{ heading: "A", markdown: "# A" }], pointIdx: 0, scrollOffset: 0 },
      message: { text: "Wrap up", sentAt: 5 },
      serverNow: 1,
    };
    expect(StageFeedSchema.parse(JSON.parse(JSON.stringify(feed)))).toEqual(feed);
  });
```

(Update the existing round-trip test's fixture to include `notes: null, message: null`.)

Append to `packages/core/src/stageLayout.test.ts`:

```ts
describe("notes and message widgets", () => {
  it("fill defaults", () => {
    const n = StageWidgetSchema.parse({ id: "n", kind: "sermonNotes", rect: { x: 0, y: 0, w: 10, h: 10 } });
    if (n.kind !== "sermonNotes") throw new Error("narrowing");
    expect(n.props).toEqual({ highlightColor: "#ffd166", dimPast: true, showCounter: true, anchor: 0.33 });
    const m = StageWidgetSchema.parse({ id: "m", kind: "message", rect: { x: 0, y: 0, w: 10, h: 10 } });
    if (m.kind !== "message") throw new Error("narrowing");
    expect(m.props).toEqual({ flash: true });
  });
  it("Speaker layout includes notes and message widgets", () => {
    const kinds = SPEAKER_LAYOUT.widgets.map((w) => w.kind);
    expect(kinds).toContain("sermonNotes");
    expect(kinds).toContain("message");
  });
});
```

`packages/core/src/stageSettings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_PRESETS, StageSettingsSchema } from "./stageSettings";

describe("StageSettingsSchema", () => {
  it("defaults the presets", () => {
    expect(StageSettingsSchema.parse({}).messagePresets).toEqual(DEFAULT_MESSAGE_PRESETS);
    expect(DEFAULT_MESSAGE_PRESETS).toEqual(["Wrap up", "5 minutes", "Stand by"]);
  });
  it("trims and drops blank presets", () => {
    expect(StageSettingsSchema.parse({ messagePresets: [" Go ", "", "  "] }).messagePresets).toEqual(["Go"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/stageFeed.test.ts packages/core/src/stageLayout.test.ts packages/core/src/stageSettings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`stageFeed.ts`: import `z` already; add

```ts
export const StageNotesViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  points: z.array(z.object({ heading: z.string(), markdown: z.string() })),
  pointIdx: z.number().int().nonnegative(),
  scrollOffset: z.number(),
});
export type StageNotesView = z.infer<typeof StageNotesViewSchema>;
export const StageMessageSchema = z.object({ text: z.string(), sentAt: z.number() });
export type StageMessage = z.infer<typeof StageMessageSchema>;
```

and in `StageFeedSchema` before `serverNow`: `notes: StageNotesViewSchema.nullable(), message: StageMessageSchema.nullable(),`.

`stageLayout.ts`: add two union members:

```ts
  z.object({
    ...base,
    kind: z.literal("sermonNotes"),
    props: z
      .object({
        highlightColor: z.string().default("#ffd166"),
        dimPast: z.boolean().default(true),
        showCounter: z.boolean().default(true),
        /** Where the active point's top sits, as a fraction of the widget height. */
        anchor: z.number().min(0).max(1).default(0.33),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("message"),
    props: z.object({ flash: z.boolean().default(true) }).default({}),
  }),
```

Replace the Speaker layout's widgets with this arrangement (1920×1080, all inside bounds):

```ts
    { id: "row-title", kind: "rowTitle", rect: { x: 24, y: 24, w: 1472, h: 96 }, style: { fontSize: 44, label: "NOW" } },
    { id: "clock", kind: "clock", rect: { x: 1520, y: 24, w: 376, h: 96 }, style: { fontSize: 64, align: "right", vAlign: "middle", autoFit: false } },
    { id: "notes", kind: "sermonNotes", rect: { x: 24, y: 136, w: 1180, h: 704 }, style: { fontSize: 48, label: "NOTES", border: { width: 2, color: "#333333", radius: 12 }, autoFit: false } },
    { id: "current", kind: "currentSlide", rect: { x: 1228, y: 136, w: 668, h: 340 }, style: { fontSize: 40, label: "LIVE" } },
    { id: "next", kind: "nextSlide", rect: { x: 1228, y: 492, w: 668, h: 200 }, style: { fontSize: 32, label: "NEXT", color: "#bbbbbb" } },
    { id: "cue", kind: "rowCue", rect: { x: 1228, y: 708, w: 668, h: 132 }, style: { fontSize: 32, label: "CUE", color: "#ffd166" } },
    { id: "timer", kind: "timer", rect: { x: 1228, y: 856, w: 330, h: 96 }, style: { fontSize: 52, label: "TIMER", autoFit: false } },
    { id: "video", kind: "videoRemaining", rect: { x: 1566, y: 856, w: 330, h: 96 }, style: { fontSize: 52, label: "VIDEO", autoFit: false } },
    { id: "message", kind: "message", rect: { x: 24, y: 968, w: 1872, h: 88 }, style: { fontSize: 52, align: "center", vAlign: "middle", color: "#000000", background: "#ffd166", autoFit: true } },
```

`stageSettings.ts`:

```ts
import { z } from "zod";

export const DEFAULT_MESSAGE_PRESETS = ["Wrap up", "5 minutes", "Stand by"];

export const StageSettingsSchema = z.object({
  messagePresets: z
    .array(z.string())
    .default(DEFAULT_MESSAGE_PRESETS)
    .transform((list) => list.map((p) => p.trim()).filter(Boolean)),
});
export type StageSettings = z.infer<typeof StageSettingsSchema>;
```

`index.ts`: `export * from "./stageSettings";`

- [ ] **Step 4: Run tests and fix fallout**

Run: `pnpm vitest run packages/core/src server/src/stageFeed.test.ts server/src/stageFeedHub.test.ts`
Then `pnpm -r --no-bail typecheck`. `server/src/stageFeed.ts` `buildStageFeed` must now return `notes` and `message`: in this task return `notes: null, message: null` (Task 4 fills them). Update server feed test fixtures if they build feeds by hand. The renderer's `StageWidgetView` switch must handle the two new kinds: in this task render `null` for both (Task 5 implements them) so it typechecks.

- [ ] **Step 5: Commit**

```bash
git add -A packages/core/src server/src apps/renderer/src
git commit -m "feat(core): notes and message in the stage feed and Speaker layout"
```

---

### Task 3: Protocol + server `StageState` holder and handlers

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`, `server/src/channels.ts`, `server/src/ws.ts`
- Create: `server/src/stageState.ts`
- Test: `server/src/stageState.test.ts`

**Interfaces:**
- Consumes: `reduceStageState`, `StageState`, `INITIAL_STAGE_STATE`, `splitPoints` (Task 1); `shows.getShow`; `stageFeedHub.invalidateAll`; `broadcast`.
- Produces:
  - Client messages: `{ type: "notes_select"; showId: string; notesId: string | null }`, `{ type: "notes_point"; delta?: number; index?: number }` (exactly one; zod refine), `{ type: "notes_scroll"; delta: number }`, `{ type: "notes_reset" }`, `{ type: "notes_overflow"; direction: "next" | "prev"; atPoint: number }`, `{ type: "stage_message"; text: string }`, `{ type: "stage_message_clear" }`
  - Server message: `{ type: "stage_state"; state: StageState; pointCount: number; title: string | null; pointHeading: string | null; nextHeading: string | null }`
  - `channels.onLiveRow(listener: (channel: string, source: RowSource) => void): () => void` — fired whenever a channel's `liveRow` is set (take with source, `setLiveRow`, `mediaTake` with showId, `takePvwToPgm` carry).
  - `server/src/stageState.ts`: `getStageState(): StageState`; `dispatchStage(action: StageAction): Promise<void>`; `onRowTaken(source: RowSource): Promise<void>`; `stageStateMessage(): Promise<ServerMessage>`; `subscribeStageState(listener: (s: StageState) => void): () => void`; `_resetForTest(): void`.

- [ ] **Step 1: Write the failing tests**

`server/src/stageState.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowSchema, type Show } from "@overlaysys/core";
import * as shows from "./shows";
import * as stage from "./stageState";

const show: Show = ShowSchema.parse({
  id: "show-1",
  name: "Sunday",
  projectId: "p",
  songs: [],
  sermonNotes: [
    { id: "n1", title: "Grace", body: "# One\na\n# Two\nb\n# Three\nc" },
    { id: "n2", title: "Other", body: "# X" },
  ],
  rows: [
    { kind: "graphic", id: "r1", templateId: "t", data: {}, sermonNotesId: "n1" },
    { kind: "graphic", id: "r2", templateId: "t", data: {} },
  ],
});

describe("stageState", () => {
  beforeEach(() => {
    stage._resetForTest();
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show-1" ? show : null));
  });
  afterEach(() => vi.restoreAllMocks());

  it("taking a row with a notes link selects that set", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    expect(stage.getStageState().notes).toEqual({ showId: "show-1", notesId: "n1" });
  });

  it("taking a row without a link keeps the active notes", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.dispatchStage({ type: "point", delta: 1 });
    await stage.onRowTaken({ showId: "show-1", rowId: "r2" });
    expect(stage.getStageState()).toMatchObject({ notes: { notesId: "n1" }, pointIdx: 1 });
  });

  it("re-taking the linked row doesn't reset the position", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.dispatchStage({ type: "point", delta: 2 });
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    expect(stage.getStageState().pointIdx).toBe(2);
  });

  it("a take from a different show clears the active notes", async () => {
    await stage.onRowTaken({ showId: "show-1", rowId: "r1" });
    await stage.onRowTaken({ showId: "other-show", rowId: "x" });
    expect(stage.getStageState().notes).toBeNull();
  });

  it("navigation clamps against the active notes' point count", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "point", delta: 10 });
    expect(stage.getStageState().pointIdx).toBe(2);
  });

  it("two overflow reports for the same point advance once", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "overflow", direction: "next", atPoint: 0 });
    await stage.dispatchStage({ type: "overflow", direction: "next", atPoint: 0 });
    expect(stage.getStageState().pointIdx).toBe(1);
  });

  it("notifies subscribers only on change", async () => {
    const seen = vi.fn();
    const off = stage.subscribeStageState(seen);
    await stage.dispatchStage({ type: "point", delta: 1 }); // no notes → no-op
    expect(seen).not.toHaveBeenCalled();
    await stage.dispatchStage({ type: "message", text: "Wrap up", now: 1 });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("stageStateMessage reports headings and counts, and nulls for missing notes", async () => {
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "n1" });
    await stage.dispatchStage({ type: "point", delta: 1 });
    expect(await stage.stageStateMessage()).toMatchObject({
      type: "stage_state",
      pointCount: 3,
      title: "Grace",
      pointHeading: "Two",
      nextHeading: "Three",
    });
    await stage.dispatchStage({ type: "select", showId: "show-1", notesId: "gone" });
    expect(await stage.stageStateMessage()).toMatchObject({ pointCount: 0, title: null, pointHeading: null, nextHeading: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/stageState.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`server/src/stageState.ts`:

```ts
// The one confidence-monitor state shared by every stage channel: active
// sermon notes, point/scroll position and the booth message. Mutated only
// through dispatchStage (pure reducer in @overlaysys/core) and onRowTaken.

import {
  INITIAL_STAGE_STATE,
  reduceStageState,
  splitPoints,
  type NotesPoint,
  type RowSource,
  type SermonNotes,
  type StageAction,
  type StageState,
} from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "./shows";

type Listener = (s: StageState) => void;

let state: StageState = INITIAL_STAGE_STATE;
const listeners = new Set<Listener>();

export function getStageState(): StageState {
  return state;
}

export function subscribeStageState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function _resetForTest(): void {
  state = INITIAL_STAGE_STATE;
  listeners.clear();
}

/** The active notes document and its points, or null when none / deleted. */
export async function activeNotes(s: StageState = state): Promise<{ notes: SermonNotes; points: NotesPoint[] } | null> {
  if (!s.notes) return null;
  const show = await shows.getShow(s.notes.showId);
  const notes = show?.sermonNotes?.find((n) => n.id === s.notes!.notesId);
  return notes ? { notes, points: splitPoints(notes.body) } : null;
}

function commit(next: StageState): void {
  if (next === state) return;
  state = next;
  for (const l of [...listeners]) {
    try {
      l(state);
    } catch (err) {
      console.warn("[stageState] listener failed", err);
    }
  }
}

export async function dispatchStage(action: StageAction): Promise<void> {
  const count = action.type === "select" ? 0 : (await activeNotes())?.points.length ?? 0;
  commit(reduceStageState(state, action, count));
}

/** Called whenever a channel's liveRow is set. */
export async function onRowTaken(source: RowSource): Promise<void> {
  if (state.notes && state.notes.showId !== source.showId) {
    commit(reduceStageState(state, { type: "select", showId: source.showId, notesId: null }, 0));
  }
  const show = await shows.getShow(source.showId);
  const row = show?.rows.find((r) => r.id === source.rowId);
  if (row?.sermonNotesId) {
    commit(reduceStageState(state, { type: "select", showId: source.showId, notesId: row.sermonNotesId }, 0));
  }
}

export async function stageStateMessage(): Promise<ServerMessage> {
  const active = await activeNotes();
  const points = active?.points ?? [];
  const idx = Math.min(state.pointIdx, Math.max(0, points.length - 1));
  return {
    type: "stage_state",
    state,
    pointCount: points.length,
    title: active?.notes.title ?? null,
    pointHeading: points[idx]?.heading ?? null,
    nextHeading: points[idx + 1]?.heading ?? null,
  };
}
```

Protocol (`packages/ws-protocol/src/index.ts`): import `StageStateSchema` from core. Client messages:

```ts
  z.object({ type: z.literal("notes_select"), showId: z.string(), notesId: z.string().nullable() }),
  z
    .object({ type: z.literal("notes_point"), delta: z.number().int().optional(), index: z.number().int().optional() })
    .refine((m) => (m.delta === undefined) !== (m.index === undefined), "exactly one of delta or index"),
  z.object({ type: z.literal("notes_scroll"), delta: z.number() }),
  z.object({ type: z.literal("notes_reset") }),
  z.object({ type: z.literal("notes_overflow"), direction: z.enum(["next", "prev"]), atPoint: z.number().int().nonnegative() }),
  z.object({ type: z.literal("stage_message"), text: z.string().max(200) }),
  z.object({ type: z.literal("stage_message_clear") }),
```

Note: `.refine` returns a `ZodEffects`, which `z.discriminatedUnion` rejects. If so, drop the refine from the schema and enforce "exactly one" in the ws.ts handler (ignore the message when both/neither are set). Server message:

```ts
  z.object({
    type: z.literal("stage_state"),
    state: StageStateSchema,
    pointCount: z.number().int().nonnegative(),
    title: z.string().nullable(),
    pointHeading: z.string().nullable(),
    nextHeading: z.string().nullable(),
  }),
```

`server/src/channels.ts`: add a `liveRowListeners` set and `export function onLiveRow(listener: (channel: string, source: RowSource) => void): () => void`. Add `function noteLiveRow(channel: string, source: RowSource)` that calls each listener in try/catch, and call it everywhere `liveRow` is assigned (`take` with source, `setLiveRow`, `mediaTake` with showId, `takePvwToPgm` carry). Call it after the assignment and before `emit`.

`server/src/ws.ts`:
- Module scope:

```ts
// Cueing a row to preview must not switch the pastor's notes; only rows that
// actually go to air do.
channels.onLiveRow((channel, source) => {
  if (channel === "preview") return;
  void stageState.onRowTaken(source);
});
stageState.subscribeStageState(() => {
  stageFeedHub.invalidateAll();
  void stageState.stageStateMessage().then(broadcast, (err) => console.warn("[stageState] broadcast failed", err));
});
```

- On `hello` (where the connection sends `hello`), also send the current stage state: `void stageState.stageStateMessage().then(send, () => {});`
- Handlers:

```ts
        case "notes_select":
          await stageState.dispatchStage({ type: "select", showId: parsed.showId, notesId: parsed.notesId });
          break;
        case "notes_point":
          if ((parsed.delta === undefined) === (parsed.index === undefined)) break;
          await stageState.dispatchStage(
            parsed.index !== undefined ? { type: "point", index: parsed.index } : { type: "point", delta: parsed.delta! },
          );
          break;
        case "notes_scroll":
          await stageState.dispatchStage({ type: "scroll", delta: parsed.delta });
          break;
        case "notes_reset":
          await stageState.dispatchStage({ type: "reset" });
          break;
        case "notes_overflow":
          await stageState.dispatchStage({ type: "overflow", direction: parsed.direction, atPoint: parsed.atPoint });
          break;
        case "stage_message":
          await stageState.dispatchStage({ type: "message", text: parsed.text, now: Date.now() });
          break;
        case "stage_message_clear":
          await stageState.dispatchStage({ type: "messageClear" });
          break;
```

- After a successful `save_show` / `delete_show`, also broadcast `await stageState.stageStateMessage()` (headings may have changed).

- [ ] **Step 4: Run tests**

The live stage panel thumbnails from the spec are deferred to phase 5 (the designer moves widgets into a shared package the operator can import).

Run: `pnpm vitest run server/src/stageState.test.ts server/src/channels.liveRow.test.ts server/src/ws.test.ts`
Add to `server/src/channels.liveRow.test.ts`:

```ts
  it("onLiveRow fires for sourced takes and setLiveRow, not unsourced takes", () => {
    const seen: string[] = [];
    const off = channels.onLiveRow((ch, src) => seen.push(`${ch}:${src.rowId}`));
    try {
      channels.take("olr", "tpl", {}, undefined, undefined, { showId: "s", rowId: "a" });
      channels.take("olr", "tpl", {});
      channels.setLiveRow("olr", { showId: "s", rowId: "b" });
      expect(seen).toEqual(["olr:a", "olr:b"]);
    } finally {
      off();
    }
  });
```

Expected: PASS. Then `pnpm -r --no-bail typecheck`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/ws-protocol/src server/src
git commit -m "feat(server): shared stage state for sermon notes and messages"
```

---

### Task 4: Notes and message in the stage feed

**Files:**
- Modify: `server/src/stageFeed.ts`, `server/src/stageFeedHub.ts`
- Test: `server/src/stageFeed.test.ts`, `server/src/stageFeedHub.test.ts`

**Interfaces:**
- Consumes: `StageState`, `NotesPoint`, `SermonNotes` (Task 1); `stageState.getStageState`, `stageState.activeNotes` (Task 3); `StageNotesView`, `StageMessage` (Task 2).
- Produces: `StageFeedInputs` gains `stage: StageState` and `notes: { notes: SermonNotes; points: NotesPoint[] } | null`; `buildStageFeed` fills `feed.notes` (with `pointIdx` clamped to `points.length - 1`, `scrollOffset` passed through) and `feed.message`.

- [ ] **Step 1: Write the failing tests**

In `server/src/stageFeed.test.ts`, the shared `base()` helper must pass `stage: INITIAL_STAGE_STATE, notes: null` by default. Add:

```ts
  it("includes the active notes with a clamped point index", () => {
    const f = base(null, {
      stage: { ...INITIAL_STAGE_STATE, notes: { showId: "show-1", notesId: "n" }, pointIdx: 9, scrollOffset: 0.5 },
      notes: {
        notes: { id: "n", title: "Grace", body: "" },
        points: [
          { heading: "A", markdown: "# A" },
          { heading: "B", markdown: "# B" },
        ],
      },
    });
    expect(f.notes).toEqual({
      id: "n",
      title: "Grace",
      points: [
        { heading: "A", markdown: "# A" },
        { heading: "B", markdown: "# B" },
      ],
      pointIdx: 1,
      scrollOffset: 0.5,
    });
  });

  it("notes are null without an active set; message passes through", () => {
    const f = base(null, { stage: { ...INITIAL_STAGE_STATE, message: { text: "Wrap up", sentAt: 3 } } });
    expect(f.notes).toBeNull();
    expect(f.message).toEqual({ text: "Wrap up", sentAt: 3 });
  });

  it("an empty notes document yields notes with no points and index 0", () => {
    const f = base(null, {
      stage: { ...INITIAL_STAGE_STATE, notes: { showId: "s", notesId: "n" }, pointIdx: 2 },
      notes: { notes: { id: "n", title: "Empty", body: "" }, points: [] },
    });
    expect(f.notes).toMatchObject({ points: [], pointIdx: 0 });
  });
```

In `server/src/stageFeedHub.test.ts` add (mock `stageState.activeNotes` / `getStageState` via `vi.spyOn` on `./stageState`):

```ts
  it("feeds include the shared stage message", async () => {
    cfg({ id: "pastor", name: "Pastor", kind: "stage" });
    vi.spyOn(stageState, "getStageState").mockReturnValue({ ...INITIAL_STAGE_STATE, message: { text: "Hi", sentAt: 1 } });
    vi.spyOn(stageState, "activeNotes").mockResolvedValue(null);
    expect((await hub.computeFeed("pastor"))?.message).toEqual({ text: "Hi", sentAt: 1 });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/stageFeed.test.ts server/src/stageFeedHub.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`stageFeed.ts`: add `stage` and `notes` to `StageFeedInputs`; in `buildStageFeed`:

```ts
  const notesView = i.notes
    ? {
        id: i.notes.notes.id,
        title: i.notes.notes.title,
        points: i.notes.points,
        pointIdx: Math.min(i.stage.pointIdx, Math.max(0, i.notes.points.length - 1)),
        scrollOffset: i.stage.scrollOffset,
      }
    : null;
```

and return `notes: notesView, message: i.stage.message`.

`stageFeedHub.ts`: import `* as stageState from "./stageState"`; in `computeFeed`, `const stage = stageState.getStageState(); const notes = await stageState.activeNotes(stage);` and pass both.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run server/src`
Expected: PASS (known importPlan failure aside).

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "feat(server): sermon notes and stage message in stage feeds"
```

---

### Task 5: Renderer — notes and message widgets, overflow reporting

**Files:**
- Create: `apps/renderer/src/stage/notesMarkdown.ts`, `apps/renderer/src/stage/notesOverflow.ts`
- Modify: `apps/renderer/src/stage/widgets.tsx`, `apps/renderer/src/stage/StageView.tsx`, `apps/renderer/src/Renderer.tsx`
- Test: `apps/renderer/src/stage/notesMarkdown.test.ts`, `apps/renderer/src/stage/notesOverflow.test.ts`

**Interfaces:**
- Consumes: `StageFeed.notes`, `StageFeed.message`, widget kinds `sermonNotes`/`message` (Task 2); client message `notes_overflow` (Task 3).
- Produces:
  - `type NotesBlock = { kind: "heading"; level: number; spans: Span[] } | { kind: "para"; spans: Span[] } | { kind: "list"; ordered: boolean; items: Span[][] }`, `type Span = { text: string; bold?: boolean; italic?: boolean }`; `parseNotesMarkdown(md: string): NotesBlock[]`
  - `overflowDirection(o: { scrollOffset: number; boxHeight: number; anchor: number; pointTop: number; pointHeight: number; isFirst: boolean; isLast: boolean }): "next" | "prev" | null`
  - `StageView` gains prop `send?: (msg: ClientMessage) => void`; `StageWidgetView` gains `send?`.

- [ ] **Step 1: Write the failing tests**

`notesMarkdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNotesMarkdown } from "./notesMarkdown";

describe("parseNotesMarkdown", () => {
  it("parses headings, paragraphs and emphasis", () => {
    expect(parseNotesMarkdown("## Grace\nIt is **free** and *undeserved*.")).toEqual([
      { kind: "heading", level: 2, spans: [{ text: "Grace" }] },
      {
        kind: "para",
        spans: [{ text: "It is " }, { text: "free", bold: true }, { text: " and " }, { text: "undeserved", italic: true }, { text: "." }],
      },
    ]);
  });
  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    expect(parseNotesMarkdown("a\nb\n\nc").map((b) => b.kind)).toEqual(["para", "para"]);
    expect(parseNotesMarkdown("a\nb")[0]).toEqual({ kind: "para", spans: [{ text: "a b" }] });
  });
  it("parses bulleted and numbered lists", () => {
    expect(parseNotesMarkdown("- one\n- two\n\n1. first\n2) second")).toEqual([
      { kind: "list", ordered: false, items: [[{ text: "one" }], [{ text: "two" }]] },
      { kind: "list", ordered: true, items: [[{ text: "first" }], [{ text: "second" }]] },
    ]);
  });
  it("leaves unmatched markers as text", () => {
    expect(parseNotesMarkdown("2 * 3 = 6")[0]).toEqual({ kind: "para", spans: [{ text: "2 * 3 = 6" }] });
  });
});
```

`notesOverflow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { overflowDirection } from "./notesOverflow";

const base = { boxHeight: 1000, anchor: 0.33, pointTop: 0, pointHeight: 600, isFirst: false, isLast: false };

describe("overflowDirection", () => {
  it("no overflow while the point is still visible", () => {
    expect(overflowDirection({ ...base, scrollOffset: 0.2 })).toBeNull();
  });
  it("next once the point's bottom scrolls above the anchor", () => {
    // anchor line at 330px; point bottom = 330 + 600 - scroll*1000
    expect(overflowDirection({ ...base, scrollOffset: 0.61 })).toBe("next");
  });
  it("prev once scrolled up past the point's top by a full anchor gap", () => {
    expect(overflowDirection({ ...base, scrollOffset: -0.34 })).toBe("prev");
    expect(overflowDirection({ ...base, scrollOffset: -0.1 })).toBeNull();
  });
  it("never past the ends", () => {
    expect(overflowDirection({ ...base, scrollOffset: 0.9, isLast: true })).toBeNull();
    expect(overflowDirection({ ...base, scrollOffset: -0.9, isFirst: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/renderer/src/stage`
Expected: FAIL for the two new files.

- [ ] **Step 3: Implement pure helpers**

`notesMarkdown.ts`:

```ts
export type Span = { text: string; bold?: boolean; italic?: boolean };
export type NotesBlock =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "para"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] };

const EMPH = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3/g;

export function parseSpans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPH)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else out.push({ text: m[4]!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseNotesMarkdown(md: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Span[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "para", spans: parseSpans(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: h[1]!.length, spans: parseSpans(h[2]!) });
    } else if (b || n) {
      flushPara();
      const ordered = !!n;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseSpans((b ?? n)![1]!));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
```

`notesOverflow.ts`:

```ts
/**
 * Whether free-scrolling has moved past the active point. The active point's
 * top sits at `anchor * boxHeight` before scrolling; scrollOffset shifts it up
 * by `scrollOffset * boxHeight`. Moving on once the point's bottom passes the
 * anchor line (down), or once its top drops a full anchor gap below the anchor
 * line (up), lets a pastor who only uses scroll buttons walk through points.
 */
export function overflowDirection(o: {
  scrollOffset: number;
  boxHeight: number;
  anchor: number;
  pointTop: number;
  pointHeight: number;
  isFirst: boolean;
  isLast: boolean;
}): "next" | "prev" | null {
  const anchorY = o.anchor * o.boxHeight;
  const shift = o.scrollOffset * o.boxHeight;
  const bottom = anchorY + o.pointHeight - shift;
  const top = anchorY - shift;
  if (!o.isLast && o.scrollOffset > 0 && bottom < anchorY) return "next";
  if (!o.isFirst && o.scrollOffset < 0 && top > anchorY * 2) return "prev";
  return null;
}
```

(Check the "next" test: scroll 0.61 → bottom = 330 + 600 − 610 = 320 < 330 ✓; 0.2 → 730 ✓ null. "prev": −0.34 → top = 330 + 340 = 670 > 660 ✓; −0.1 → 430 ✓ null.)

- [ ] **Step 4: Run helper tests**

Run: `pnpm vitest run apps/renderer/src/stage`
Expected: PASS.

- [ ] **Step 5: Widgets (UI; typecheck + manual)**

In `widgets.tsx` implement the two cases (replacing Task 2's `null`):

- `sermonNotes`:
  - No `feed.notes` → `Frame` with "No notes" dimmed text.
  - Otherwise render every point as a block (`parseNotesMarkdown(point.markdown)` → `h1–h3` as bold larger text at 1.25×/1.15×/1.05× of `style.fontSize`, `para` as `<p>`, lists as `<ul>/<ol>`, spans as `<strong>/<em>`), each in a `div` with a ref.
  - Inner scroller: absolutely positioned, `transform: translateY(${anchorPx - activeTop - scrollOffset*boxH}px)` where `activeTop` is the active point element's `offsetTop` (measured in a layout effect on `[pointIdx, scrollOffset, points]`); `transition: transform 300ms ease`.
  - Past points: `opacity: 0.35` when `dimPast`. The active point gets a 6px left border in `highlightColor` and `padding-left: 18px`.
  - When `showCounter`, show `${pointIdx + 1} / ${points.length}` at the top-right in 24px dim text.
  - After layout, call `overflowDirection({...})` with the measured active point height; if it returns a direction and `send` is set, `send({ type: "notes_overflow", direction, atPoint: pointIdx })`. Guard with a ref keyed on `${pointIdx}:${scrollOffset}` so one feed sends at most once.
- `message`: when `feed.message` is null render nothing (no frame). Otherwise `Frame` with `FitBody` of the text. When `props.flash` and `Date.now() - offset - sentAt < 6000` (use `nowMs`), alternate opacity between 1 and 0.4 every 500 ms (derive from `nowMs`: `Math.floor((nowMs - sentAt) / 500) % 2`).

`StageView`: accept `send?: (msg: ClientMessage) => void` and pass it to each `StageWidgetView`. `Renderer.tsx`: pass `send={sendRef.current}` to `StageView`.

Run: `pnpm --filter @overlaysys/renderer typecheck && pnpm --filter @overlaysys/renderer build`

- [ ] **Step 6: Commit**

```bash
git add apps/renderer/src
git commit -m "feat(renderer): sermon notes and stage message widgets"
```

---

### Task 6: Operator — sermon notes editor, import, row link

**Files:**
- Create: `apps/operator/src/lib/notesImport.ts`, `apps/operator/src/app/shows/edit/SermonNotesEditor.tsx`
- Modify: `apps/operator/src/app/shows/edit/page.tsx`, `apps/operator/package.json` (add `mammoth`)
- Test: `apps/operator/src/lib/notesImport.test.ts`

**Interfaces:**
- Consumes: `SermonNotes`, `splitPoints` (Task 1); the page's `update(recipe)` immer pattern (`page.tsx` ~195–203).
- Produces: `normalizeImportedMarkdown(md: string): string`; `notesFromFile(file: File): Promise<{ title: string; body: string }>`.

- [ ] **Step 1: Failing test for the normalizer**

`apps/operator/src/lib/notesImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeImportedMarkdown, titleFromFileName } from "./notesImport";

describe("normalizeImportedMarkdown", () => {
  it("drops images and table pipes, keeps headings, emphasis and lists", () => {
    const md = "# Title\n\n![](data:image/png;base64,AAA)\n\n__Bold__ and _it_\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* one\n* two";
    expect(normalizeImportedMarkdown(md)).toBe("# Title\n\n**Bold** and *it*\n\na b\n1 2\n\n- one\n- two");
  });
  it("unescapes mammoth's backslash escapes and collapses blank runs", () => {
    expect(normalizeImportedMarkdown("Point 1\\. Grace\n\n\n\nNext")).toBe("Point 1. Grace\n\nNext");
  });
  it("trims trailing spaces and the whole document", () => {
    expect(normalizeImportedMarkdown("  \nA  \nB\n\n")).toBe("A\nB");
  });
});

describe("titleFromFileName", () => {
  it("strips the extension", () => {
    expect(titleFromFileName("Sunday Sermon.docx")).toBe("Sunday Sermon");
    expect(titleFromFileName("notes")).toBe("notes");
  });
});
```

Run: `pnpm vitest run apps/operator/src/lib/notesImport.test.ts` → FAIL.

- [ ] **Step 2: Implement `notesImport.ts`**

```ts
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Cleans Markdown produced by mammoth (or pasted) into what the notes splitter and renderer understand. */
export function normalizeImportedMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$\n?/gm, "")
    .replace(/^\s*\|(.*)\|\s*$/gm, (_m, inner: string) =>
      inner.split("|").map((c) => c.trim()).filter(Boolean).join(" "),
    )
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/(^|[^_])_(?!_)(.+?)_(?!_)/g, "$1*$2*")
    .replace(/^(\s*)\*\s+/gm, "$1- ")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function notesFromFile(file: File): Promise<{ title: string; body: string }> {
  const title = titleFromFileName(file.name);
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import("mammoth/mammoth.browser");
    const { value } = await mammoth.convertToMarkdown({ arrayBuffer: await file.arrayBuffer() });
    return { title, body: normalizeImportedMarkdown(value) };
  }
  return { title, body: normalizeImportedMarkdown(await file.text()) };
}
```

Add the dependency: `pnpm --filter @overlaysys/operator add mammoth`. If `mammoth/mammoth.browser` lacks types, add a `declare module "mammoth/mammoth.browser"` in `apps/operator/src/types/mammoth.d.ts` declaring `convertToMarkdown(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>`. Run the test → PASS.

- [ ] **Step 3: Editor UI (typecheck + manual)**

`SermonNotesEditor.tsx` — props `{ notes: SermonNotes[]; onUpdate: (recipe: (s: Show) => void) => void }`:
- Header "Sermon notes" with **+ New set** (id `uuid()`, title "Sermon notes", body "") and **Import…** (hidden `<input type="file" accept=".txt,.md,.markdown,.docx">` → `notesFromFile` → push a new set; show the error inline on failure).
- One collapsible card per set:
  - title `Input`, Delete `IconButton` (confirm with `window.confirm`; also clear `sermonNotesId` on rows that point at it);
  - a two-column body: a left monospace `<textarea>` (min 12 rows) for `body`, and a right live preview of `splitPoints(body)` as a numbered list of headings with the point count ("7 points");
  - a one-line hint: "Start each point with a heading (# Point), or separate points with a blank line."
- Every edit goes through `onUpdate((s) => { ... set.updatedAt = new Date().toISOString(); })`.
- Use the existing `@overlaysys/ui` components (`Panel`, `Input`, `Button`, `IconButton`) like the rest of the page.

`page.tsx`:
- Render `<SermonNotesEditor notes={draft.sermonNotes ?? []} onUpdate={update} />` after the add-row buttons (~line 565).
- In `RundownRowEditor` (graphic, ~945) and `SongRowEditor` (~1194), next to the notes `Input`, add a compact `Select` "Notes set": `— none —` plus each set's title, bound to `row.sermonNotesId`, `patchRow({ sermonNotesId: v || undefined })`. Hide it when the show has no sets. Pass `sermonNotes` down through `RundownTable` props. Scripture and video rows: add the same picker in their row editors if they have an inline editor; otherwise skip (note in the report).

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm --filter @overlaysys/operator build`

- [ ] **Step 4: Commit**

```bash
git add -A apps/operator pnpm-lock.yaml
git commit -m "feat(operator): author and import sermon notes per show"
```

---

### Task 7: Operator — live Stage panel, store, Settings → Stage monitor

**Files:**
- Modify: `apps/operator/src/lib/store.ts`, `apps/operator/src/lib/useWs.ts`, `apps/operator/src/app/page.tsx`, `apps/operator/src/app/shell/areas.ts`, `apps/operator/src/app/shell/areas.test.ts`, `server/src/index.ts`
- Create: `apps/operator/src/app/components/StagePanel.tsx`, `apps/operator/src/app/settings/stage/page.tsx`, `server/src/stageSettings.ts`, `apps/operator/src/lib/stageSettingsClient.ts`
- Test: `server/src/stageSettings.test.ts`, `apps/operator/src/app/shell/areas.test.ts`

**Interfaces:**
- Consumes: `stage_state` (Task 3), client messages (Task 3), `StageSettingsSchema` (Task 2).
- Produces: store fields `stageState: StageStateMessage | null` + `setStageState`; `GET/PUT /api/stage/settings`; `loadStageSettings()`, `saveStageSettings(s)` (server); `getStageSettings()`, `putStageSettings(s)` (operator client, using the same `httpBase()` helper as `pcoClient.ts`).

- [ ] **Step 1: Failing server test**

`server/src/stageSettings.test.ts` — follow `server/src/scriptureSettings.test.ts`'s harness (temp data dir). Assert: a missing file → `{ messagePresets: ["Wrap up", "5 minutes", "Stand by"] }`; save then load round-trips; saving `{ messagePresets: ["  A ", ""] }` stores `["A"]`.

Add to `areas.test.ts`: `expect(routeToArea("/settings/stage")).toBe("settings");` and include `"/settings/stage"` after `"/settings/scripture"` in the two settings-route expectations.

Run → FAIL.

- [ ] **Step 2: Implement server settings**

`server/src/stageSettings.ts` — copy the `scriptureSettings.ts` pattern exactly (file `settings/stage.json`, `StageSettingsSchema`, safeParse fallback to defaults). Add `registerStageSettingsRoutes(app)` with `GET /api/stage/settings` and `PUT /api/stage/settings` (400 on invalid), registered in `server/src/index.ts` next to the scripture routes. Add `{ route: "/settings/stage", label: "Stage monitor", icon: MonitorSmartphone /* from lucide-react */, desktopOnly: true }` after Scripture in `areas.ts`. Run → PASS.

- [ ] **Step 3: Store + useWs (typecheck)**

`store.ts`: `type StageStateMessage = Extract<ServerMessage, { type: "stage_state" }>`; field `stageState: StageStateMessage | null` (init null) and setter. `useWs.ts`: `case "stage_state": store.setStageState(msg); break;`

- [ ] **Step 4: StagePanel (UI; typecheck + manual)**

`StagePanel.tsx`, rendered in `page.tsx`'s right column between `TimersRail` and `HotcardsPanel` with `flexShrink: 0`. `PanelHeader` "Stage". Body:
- **Notes row:** a `Select` of the loaded show's sermon sets (`useStore((s) => s.show)?.sermonNotes`), value = active set when `stageState.state.notes?.showId === show.id`, onChange → `send({ type: "notes_select", showId: show.id, notesId: v || null })`. Below it: `"{title} · {pointIdx+1}/{pointCount}"` and the current `pointHeading` (one line, ellipsis); buttons **◀ Prev**, **Next ▶** (`notes_point` ±1), **↑** / **↓** (`notes_scroll` ∓0.33), **Top** (`notes_reset`). Disabled when no active set.
- **Message row:** text `Input` (max 200) + **Send** (`stage_message`, Enter also sends) + **Clear** (`stage_message_clear`, disabled when no message). Under it, one small button per preset from `getStageSettings()` (fetched once on mount, cached in component state) that sends that text immediately. Show the live message (if any) in an accent pill.
- If the show has no sets, the notes row shows "No sermon notes in this show" with a link to the show editor.

`settings/stage/page.tsx`: `PageChrome` "Stage monitor"; an editable list of message presets (add, remove, reorder up/down, edit text) with Save → `putStageSettings`. Plus a short paragraph explaining that monitors are configured in Settings → Channels (link) and that pastors control notes from Companion's "Pastor Notes" page.

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm --filter @overlaysys/operator build && pnpm vitest run server/src/stageSettings.test.ts apps/operator/src/app/shell/areas.test.ts`

- [ ] **Step 5: Commit**

```bash
git add -A apps/operator server/src
git commit -m "feat(operator): live Stage panel, message presets setting"
```

---

### Task 8: Companion — notes and message actions, variables, feedbacks, Pastor Notes presets

**Files:**
- Modify: `packages/companion-module/src/types.ts`, `state.ts`, `actions.ts`, `variables.ts`, `feedbacks.ts`, `presets.ts`, `index.ts`
- Test: `packages/companion-module/src/__tests__/stage.test.ts` (create)

**Interfaces:**
- Consumes: `stage_state` server message and the seven client messages (Task 3).
- Produces:
  - `CompanionState.stage: { state: StageState; pointCount: number; title: string | null; pointHeading: string | null; nextHeading: string | null } | null` (init null; set from `stage_state`)
  - Action ids: `notes_next_point`, `notes_prev_point`, `notes_goto_point` (option `index`, 1-based number), `notes_scroll_down` / `notes_scroll_up` (option `amount`, number, default 0.33), `notes_top`, `notes_select` (dropdown of the loaded show's sets; plus "none"), `stage_message_send` (option `text`), `stage_message_clear`
  - Variables: `notes_title`, `notes_point`, `notes_point_count`, `notes_point_heading`, `notes_next_heading`, `stage_message`
  - Feedbacks: `notes_active`, `notes_at_first`, `notes_at_last`, `stage_message_showing`
  - Presets category "Pastor Notes": `notes_prev`, `notes_next`, `notes_scroll_up`, `notes_scroll_down`, `notes_top`, `notes_status`

- [ ] **Step 1: Failing tests**

`packages/companion-module/src/__tests__/stage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_STAGE_STATE } from "@overlaysys/core";
import { dispatchAction } from "../actions";
import { feedbackPredicate } from "../feedbacks";
import { apply } from "../state";
import { initialState } from "../types";
import { projectVariables } from "../variables";

const stageMsg = (pointIdx: number, pointCount: number, message: { text: string; sentAt: number } | null = null) =>
  ({
    type: "stage_state",
    state: { ...INITIAL_STAGE_STATE, notes: pointCount ? { showId: "s", notesId: "n" } : null, pointIdx, message },
    pointCount,
    title: pointCount ? "Grace" : null,
    pointHeading: pointCount ? `P${pointIdx + 1}` : null,
    nextHeading: pointCount && pointIdx + 1 < pointCount ? `P${pointIdx + 2}` : null,
  }) as const;

describe("companion stage", () => {
  it("stores stage_state", () => {
    const s = apply(initialState(), stageMsg(1, 3));
    expect(s.stage?.pointCount).toBe(3);
  });

  it("maps actions to client messages", () => {
    const s = initialState();
    expect(dispatchAction(s, "notes_next_point", {}).messages).toEqual([{ type: "notes_point", delta: 1 }]);
    expect(dispatchAction(s, "notes_prev_point", {}).messages).toEqual([{ type: "notes_point", delta: -1 }]);
    expect(dispatchAction(s, "notes_goto_point", { index: 3 }).messages).toEqual([{ type: "notes_point", index: 2 }]);
    expect(dispatchAction(s, "notes_scroll_down", {}).messages).toEqual([{ type: "notes_scroll", delta: 0.33 }]);
    expect(dispatchAction(s, "notes_scroll_up", { amount: 0.5 }).messages).toEqual([{ type: "notes_scroll", delta: -0.5 }]);
    expect(dispatchAction(s, "notes_top", {}).messages).toEqual([{ type: "notes_reset" }]);
    expect(dispatchAction(s, "stage_message_send", { text: "Wrap up" }).messages).toEqual([{ type: "stage_message", text: "Wrap up" }]);
    expect(dispatchAction(s, "stage_message_send", { text: "  " }).messages).toEqual([]);
    expect(dispatchAction(s, "stage_message_clear", {}).messages).toEqual([{ type: "stage_message_clear" }]);
  });

  it("notes_select uses the loaded show and maps 'none' to null", () => {
    const s = { ...initialState(), loadedShowId: "s" };
    expect(dispatchAction(s, "notes_select", { notesId: "n1" }).messages).toEqual([{ type: "notes_select", showId: "s", notesId: "n1" }]);
    expect(dispatchAction(s, "notes_select", { notesId: "__none__" }).messages).toEqual([{ type: "notes_select", showId: "s", notesId: null }]);
    expect(dispatchAction(initialState(), "notes_select", { notesId: "n1" }).messages).toEqual([]);
  });

  it("exposes variables, blank without notes", () => {
    const v = projectVariables(apply(initialState(), stageMsg(1, 3, { text: "Hi", sentAt: 1 })), []);
    expect(v).toMatchObject({ notes_title: "Grace", notes_point: "2", notes_point_count: "3", notes_point_heading: "P2", notes_next_heading: "P3", stage_message: "Hi" });
    const blank = projectVariables(apply(initialState(), stageMsg(0, 0)), []);
    expect(blank).toMatchObject({ notes_title: "", notes_point: "", notes_point_count: "0", notes_point_heading: "", stage_message: "" });
  });

  it("feedbacks", () => {
    const mid = apply(initialState(), stageMsg(1, 3));
    const first = apply(initialState(), stageMsg(0, 3));
    const last = apply(initialState(), stageMsg(2, 3, { text: "x", sentAt: 1 }));
    const none = apply(initialState(), stageMsg(0, 0));
    expect(feedbackPredicate(mid, "notes_active", {})).toBe(true);
    expect(feedbackPredicate(none, "notes_active", {})).toBe(false);
    expect(feedbackPredicate(first, "notes_at_first", {})).toBe(true);
    expect(feedbackPredicate(mid, "notes_at_first", {})).toBe(false);
    expect(feedbackPredicate(last, "notes_at_last", {})).toBe(true);
    expect(feedbackPredicate(none, "notes_at_last", {})).toBe(false);
    expect(feedbackPredicate(last, "stage_message_showing", {})).toBe(true);
    expect(feedbackPredicate(mid, "stage_message_showing", {})).toBe(false);
  });
});
```

(Adjust import paths/names to the module's real exports — e.g. if `apply` takes `(state, msg)` or `projectVariables(state, channels)` order differs; keep the assertions.)

Run: `pnpm vitest run packages/companion-module/src/__tests__/stage.test.ts` → FAIL.

- [ ] **Step 2: Implement**

- `types.ts`: add `stage` field and init `null`.
- `state.ts` `apply`: `case "stage_state": return { ...state, stage: { state: msg.state, pointCount: msg.pointCount, title: msg.title, pointHeading: msg.pointHeading, nextHeading: msg.nextHeading } };`. On `local_disconnected`, set `stage: null`.
- `actions.ts`: add the ids to `ActionId`; `dispatchAction` cases per the test; `actionDefinitions` entries (names like "Notes: next point", "Notes: scroll down", "Stage: send message"); `notes_select` dropdown choices from `state.showCache.get(state.loadedShowId)?.sermonNotes` mapped to `{ id, label: title }` plus `{ id: "__none__", label: "— none —" }`; `amount` number input min 0.05 max 2 default 0.33; `index` number input min 1 default 1; `text` text input.
- `variables.ts`: definitions + values as in the test (`notes_point` is `String(pointIdx + 1)` only when `pointCount > 0`, else `""`; `notes_point_count` `String(pointCount)` or `"0"`).
- `feedbacks.ts`: four definitions + predicates (`notes_at_first`: active && pointIdx === 0; `notes_at_last`: active && pointIdx >= pointCount - 1; active means `pointCount > 0`).
- `presets.ts`: category "Pastor Notes":
  - `notes_prev` "◀ PREV" → `notes_prev_point`; feedback `notes_at_first` with style `{ bgcolor: 0x333333, color: 0x777777 }`.
  - `notes_next` "NEXT ▶\n$(overlaysys:notes_point)/$(overlaysys:notes_point_count)" → `notes_next_point`; feedback `notes_at_last` greyed.
  - `notes_scroll_up` "▲", `notes_scroll_down` "▼", `notes_top` "TOP".
  - `notes_status` "$(overlaysys:notes_point_heading)" size "14", no actions.
  - Plus category "Stage": `stage_msg_wrap` "WRAP UP" → `stage_message_send {text: "Wrap up"}`, `stage_msg_clear` "CLEAR MSG" → `stage_message_clear` with feedback `stage_message_showing` (bgcolor 0xcc0000).
  - Use the variable prefix the module actually uses (check an existing preset that embeds `$(...)`).
- `index.ts`: make `stage_state` refresh variables and feedbacks (add it wherever `mutatesRundownVariables` / `refreshDynamic` decide), and make `show` messages refresh the `notes_select` dropdown (it depends on the loaded show's sets — extend `mutatesDropdownSources`).

Run: `pnpm vitest run packages/companion-module` → PASS; `pnpm -r --no-bail typecheck`.

- [ ] **Step 3: Commit**

```bash
git add packages/companion-module
git commit -m "feat(companion): pastor notes and stage message controls"
```

---

### Task 9: Full verification

- [ ] `pnpm test` — all pass except the known importPlan failure.
- [ ] `pnpm -r --no-bail typecheck` — clean.
- [ ] `pnpm turbo build` — success.
- [ ] Manual checklist for the user (record in the final report):
  1. Show editor: add a notes set, paste a sermon with `#` headings → preview shows the points; import a .docx → headings preserved.
  2. Link the set to a rundown row; take that row → the monitor's NOTES shows point 1 highlighted.
  3. Stage panel Prev/Next/↑/↓/Top move the monitor; two monitor windows stay in sync; scrolling past a point's end moves to the next point once.
  4. Companion: install the dev module, add the Pastor Notes page; buttons drive the monitor; button text shows "2/7" and the heading; Prev greys on point 1.
  5. Send "Wrap up" from the panel and from Companion → message bar flashes on the monitor; Clear removes it.
  6. Settings → Stage monitor: edit presets, Save, presets appear in the panel.
