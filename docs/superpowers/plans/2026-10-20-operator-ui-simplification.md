# Operator UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar + Live/Prep shell and the three-column Show page with a Live · Library · Settings top-bar shell and a fixed "Console" live screen, without changing any take/playback behaviour.

**Architecture:**
- **Pure logic** (route → area, row on-air state, stage-area mode, keyboard hint text) lives in small `lib/` / `shell/` modules, unit-tested with vitest in the node environment.
- **React components** are thin consumers of that logic plus existing store/WebSocket calls. Nothing about the WebSocket protocol, store or server changes.
- **Redirects for moved routes** are client-side stub pages, because the desktop build is a Next static export (no `next.config` redirects).

**Tech Stack:** Next 15 (app router, static export for Electron), React 19, zustand, vitest 4 (node env), pnpm workspaces, `@overlaysys/ui` (inline-style components + CSS-var tokens), new dependency `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-10-20-operator-ui-simplification-design.md`

## Global Constraints

- **No behaviour changes.** WebSocket messages, store shape, keybindings in `app/hooks/useGlobalShortcuts.ts` and server code stay as they are. Moving where a button lives is allowed; changing what it sends is not.
- `onair` red (`colors.onair`) is used only for program/on-air state and the primary Take button.
- Pills are only for warnings and errors; everything else uses `StatusDot`.
- Labels are sentence case. The only uppercase labels allowed are the small "PGM"/"PVW" monitor labels.
- Spacing comes from the existing `space` token (`space[1]=4, [2]=8, [3]=12, [4]=16`).
- No emoji as icons in shell/console UI. Use `lucide-react` icons at `size={16}` (nav) or `size={14}` (inline).
- **The cloud build (`NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE=true`):**
  - has no Live area;
  - hides the desktop-only Settings entries (Channels, Speech-to-text, Planning Center);
  - still redirects `/` to `/shows`.
- **Old URLs:**
  - `/timer` → `/`
  - `/channels` → `/settings/channels`
  - `/stt` → `/settings/stt`
- **Last-route keys:** the format is `overlaysys:lastRoute:<area>`. The old `overlaysys:lastRoute:live|prep` keys are ignored.
- Existing token names and backward-compatible aliases in `packages/ui/src/tokens.ts` are not renamed or removed.
- **Commands:**
  - tests: `pnpm test` from the repo root (vitest, node env, includes `apps/operator/src/**/*.test.ts` and `packages/*/src/**/*.test.ts`);
  - typecheck: `pnpm --filter @overlaysys/operator typecheck` and `pnpm --filter @overlaysys/ui typecheck`.

## Deviations from the spec (decided while planning, from reading the code)

1. **Phase order.** The plan does **Foundations → Live console → Shell → Polish** instead of Foundations → Shell → Console. The console phase removes the `/timer` page by moving timers into the console. If the shell went first, the new nav would drop Timer while it still only existed as its own page, and timers would be unreachable between the two phases.
2. **No section headers in the rundown.** Show rows (`graphic | song | scripture | video`) have no section concept, and adding one would be a data-model change. The mockup's section headers are dropped.
3. **No F-key hints on hotcards.** No F-key bindings exist; adding them would be a behaviour change. The hotcard on-air border is also skipped: the store does not track which hotcard is on air, and the spec says to add no new state.
4. **"Edit slides…" dropped from the Live screen.** In the live Rundown it calls `onEditScriptureRow`, which `app/page.tsx` never passes, so today it does nothing. It's left out of the stage area, and slide editing stays in Library → Shows.
5. **The stage area also handles a selected hotcard.** The store makes row and hotcard selection mutually exclusive, and Cue/Take act on whichever is selected, so the stage area shows a hotcard mode too.
6. **Timer popover width is 560px**, because `TimerPanel` includes live previews.

## Review Focus

1. **Esc closing a popover/menu must not clear program.** The global Esc handler sends `clear program`, so popovers stop the key before it reaches `window`. Pinned by the manual check in Task 4, Step 4, and Task 9, Step 6.
2. **Two rows using the same template with different data.** Only the row whose data matches should show as on air. Pinned by a test in Task 2.
3. **Selected row deleted, or the show switches.** The stage area must fall back to empty, not crash. Pinned by a test in Task 3.
4. **Song session cued on PVW only, or live on both PGM and PVW.** PGM wins; a PVW-only session shows "PVW (cued)". Pinned by a test in Task 3.
5. **Mirror channels.** Clear must not be offered on a mirror (it's a no-op); state shown is the source's. Pinned by a test in Task 8 (`channelDotModel`).

---

## Task 0: Precondition — land the in-progress channel popover work

**Files:** none (git only)

- [ ] **Step 1: Confirm the working tree is clean for the files this plan builds on**

Run: `git status --short apps/operator/src/app/components/ChannelStatus.tsx apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx apps/operator/src/lib/popoverPosition.ts apps/operator/src/lib/popoverPosition.test.ts`
Expected: no output. If there is output, STOP and ask the user to commit or stash that work first. Do not commit it on their behalf.

- [ ] **Step 2: Baseline tests and typecheck**

Run: `pnpm test && pnpm --filter @overlaysys/operator typecheck && pnpm --filter @overlaysys/ui typecheck`
Expected: all pass. Record any pre-existing failures; they are not this plan's to fix.

---

# Phase 1 — Foundations

### Task 1: UI primitives — `lucide-react`, `StatusDot` label, `PanelHeader`, `AreaTabs`, `onair` button

**Files:**
- Modify: `packages/ui/package.json` and `apps/operator/package.json` (add `lucide-react`)
- Modify: `packages/ui/src/Pill.tsx` (extend `StatusDot`)
- Modify: `packages/ui/src/Button.tsx` (add `"onair"` variant)
- Create: `packages/ui/src/PanelHeader.tsx`
- Create: `packages/ui/src/AreaTabs.tsx`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/src/tokens.test.ts` (one added assertion)

**Interfaces:**
- Produces:
  - `StatusDot(props: { tone?: PillTone; size?: number; label?: ReactNode; title?: string; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; style?: CSSProperties })`
    - No `label` and no `onClick`: renders exactly as today (a bare `aria-hidden` span).
    - With `label`: renders `<span>` dot + label inline.
    - With `onClick`: renders a `<button>` containing dot + label.
  - `PanelHeader(props: { title: ReactNode; right?: ReactNode; style?: CSSProperties })`: 32px tall, sentence case, 11px semibold `textDim`, bottom border.
  - `AreaTabs<T extends string>(props: { items: { id: T; label: string; tone: "onair" | "brand" }[]; active: T | null; onSelect: (id: T) => void })`
  - `ButtonVariant` gains `"onair"`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @overlaysys/ui add lucide-react && pnpm --filter @overlaysys/operator add lucide-react`
Expected: both `package.json` files list `lucide-react` under `dependencies`; lockfile updated.

- [ ] **Step 2: Write the failing test** — append to `packages/ui/src/tokens.test.ts` inside the `describe` block:

```ts
  it("keeps the 4/8/12/16 spacing steps the console relies on", () => {
    expect([space[1], space[2], space[3], space[4]]).toEqual([4, 8, 12, 16]);
  });
```

and change the import line to `import { colors, radius, fontFamily, space } from "./tokens";`

- [ ] **Step 3: Run it**

Run: `pnpm vitest run packages/ui/src/tokens.test.ts`
Expected: PASS. This test pins an existing contract rather than driving new code; the components below are presentational and are checked by typecheck and the later manual passes.

- [ ] **Step 4: Extend `StatusDot`** — in `packages/ui/src/Pill.tsx` replace the `DotProps` type and `StatusDot` function with:

```tsx
type DotProps = {
  tone?: PillTone;
  size?: number;
  /** Text shown after the dot. Without it the dot renders bare (legacy). */
  label?: ReactNode;
  title?: string;
  /** Makes the dot+label a button (e.g. opens a status menu). */
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: CSSProperties;
};

export function StatusDot({ tone = "neutral", size = 8, label, title, onClick, style }: DotProps) {
  const dot: CSSProperties = {
    display: "inline-block",
    width: size,
    height: size,
    borderRadius: radius.pill,
    background: TONE[tone],
    flexShrink: 0,
  };
  if (label === undefined && !onClick) {
    return <span aria-hidden title={title} style={{ ...dot, ...style }} />;
  }
  const wrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: fontSize.sm,
    color: colors.textDim,
    whiteSpace: "nowrap",
    ...style,
  };
  const inner = (
    <>
      <span aria-hidden style={dot} />
      {label}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        style={{ ...wrap, background: "transparent", border: "none", padding: "2px 4px", borderRadius: radius.sm, cursor: "pointer" }}
      >
        {inner}
      </button>
    );
  }
  return (
    <span title={title} style={wrap}>
      {inner}
    </span>
  );
}
```

`HTMLAttributes` is still used by `Pill`'s `Props`; leave that import alone.

- [ ] **Step 5: Add the `onair` button variant** — in `packages/ui/src/Button.tsx`:

```ts
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "destructive" | "success" | "onair";
```

and add to `variantStyle`'s switch:

```ts
    case "onair":
      return { background: colors.onair, color: "#fff", borderColor: colors.onair };
```

- [ ] **Step 6: Create `packages/ui/src/PanelHeader.tsx`**

```tsx
import type { CSSProperties, ReactNode } from "react";
import { colors, fontSize, fontWeight, space } from "./tokens";

/** The one panel header style used across the shell and console. */
export function PanelHeader({
  title,
  right,
  style,
}: {
  title: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[2],
        height: 32,
        flexShrink: 0,
        padding: `0 ${space[3]}px`,
        borderBottom: `1px solid ${colors.border}`,
        fontSize: fontSize.xs,
        fontWeight: fontWeight.semibold,
        color: colors.textDim,
        ...style,
      }}
    >
      <span>{title}</span>
      {right !== undefined && (
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: space[2], fontWeight: fontWeight.regular }}>
          {right}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create `packages/ui/src/AreaTabs.tsx`**

```tsx
import { colors, fontSize, fontWeight, radius } from "./tokens";

export type AreaTabItem<T extends string> = { id: T; label: string; tone: "onair" | "brand" };

/** Segmented Live · Library · Settings control in the shell top bar. */
export function AreaTabs<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: AreaTabItem<T>[];
  active: T | null;
  onSelect: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        background: colors.surface2,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.md,
      }}
    >
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onSelect(it.id)}
            style={{
              padding: "4px 12px",
              border: "none",
              borderRadius: radius.sm,
              cursor: "pointer",
              fontSize: fontSize.xs,
              fontWeight: fontWeight.semibold,
              background: on ? (it.tone === "onair" ? colors.onair : colors.brand) : "transparent",
              color: on ? "#fff" : colors.textDim,
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8: Export them** — append to `packages/ui/src/index.ts`:

```ts
export { PanelHeader } from "./PanelHeader";
export { AreaTabs, type AreaTabItem } from "./AreaTabs";
```

- [ ] **Step 9: Typecheck and test**

Run: `pnpm --filter @overlaysys/ui typecheck && pnpm --filter @overlaysys/operator typecheck && pnpm test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/ui apps/operator/package.json pnpm-lock.yaml
git commit -m "feat(ui): StatusDot label/button, PanelHeader, AreaTabs, onair button; add lucide-react"
```

---

# Phase 2 — Live console

### Task 2: `rowAirState` — which rundown rows are on air or cued

**Files:**
- Create: `apps/operator/src/lib/rowAirState.ts`
- Test: `apps/operator/src/lib/rowAirState.test.ts`

**Interfaces:**
- Consumes: `ChannelState`, `SongSessionSummary`, `Show` from `@overlaysys/core`.
- Produces: `type AirState = "program" | "preview" | null` and `rowAirState(row: Show["rows"][number], channelStates: Record<string, ChannelState>, songSessions: Record<string, SongSessionSummary | null>): AirState`. Program wins over preview.

- [ ] **Step 1: Write the failing test** — `apps/operator/src/lib/rowAirState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";
import { rowAirState } from "./rowAirState";

type Row = Show["rows"][number];

const graphic = (id: string, data: Record<string, string>): Row =>
  ({ id, kind: "graphic", templateId: "l3", data }) as unknown as Row;
const song = (id: string, songId: string): Row =>
  ({ id, kind: "song", songId, lyricTemplateId: "lyr" }) as unknown as Row;
const video = (id: string): Row => ({ id, kind: "video", label: "v" }) as unknown as Row;
const scripture = (id: string): Row => ({ id, kind: "scripture", reference: "John 3:16" }) as unknown as Row;

const active = (templateId: string, data: Record<string, string>, phase: "in" | "on" | "out" = "on") =>
  ({ templateId, data, phase, takenAt: 1 });

const session = (songId: string): SongSessionSummary => ({
  songId,
  lyricTemplateId: "lyr",
  arrangement: [],
  cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false,
  trustMode: false,
  startedAt: 1,
});

describe("rowAirState", () => {
  it("matches a graphic row on program by template AND data", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(graphic("a", { name: "Sam" }), states, {})).toBe("program");
  });

  it("does not light a second row that shares the template but not the data", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(graphic("b", { name: "Alex" }), states, {})).toBeNull();
  });

  it("ignores a graphic that is animating out", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("l3", { name: "Sam" }, "out") },
    };
    expect(rowAirState(graphic("a", { name: "Sam" }), states, {})).toBeNull();
  });

  it("reports preview when cued and program wins when on both", () => {
    const g = graphic("a", { name: "Sam" });
    const pvwOnly: Record<string, ChannelState> = {
      preview: { channel: "preview", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(g, pvwOnly, {})).toBe("preview");
    const both: Record<string, ChannelState> = {
      ...pvwOnly,
      program: { channel: "program", active: active("l3", { name: "Sam" }) },
    };
    expect(rowAirState(g, both, {})).toBe("program");
  });

  it("matches a song row by its session's songId", () => {
    expect(rowAirState(song("s", "way-maker"), {}, { program: session("way-maker") })).toBe("program");
    expect(rowAirState(song("s", "way-maker"), {}, { preview: session("way-maker") })).toBe("preview");
    expect(rowAirState(song("s", "other"), {}, { program: session("way-maker") })).toBeNull();
  });

  it("matches a song row by intro/outro subTakeContext", () => {
    const states: Record<string, ChannelState> = {
      program: {
        channel: "program",
        active: { ...active("intro", {}), subTakeContext: { songRowId: "s", sub: "intro" } },
      },
    };
    expect(rowAirState(song("s", "way-maker"), states, {})).toBe("program");
  });

  it("matches a video row by media.rowId unless ended or errored", () => {
    const media = (status: "playing" | "ended" | "error") => ({
      rowId: "v1", assetUrl: "/a.mp4", volume: 1, endAction: "hold" as const, takenAt: 1, paused: false,
      playback: { status, currentTime: 0, duration: 10, updatedAt: 1 },
    });
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("playing") } }, {})).toBe("program");
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("ended") } }, {})).toBeNull();
    expect(rowAirState(video("v1"), { program: { channel: "program", active: null, media: media("error") } }, {})).toBeNull();
  });

  it("never lights scripture rows (state carries no row identity)", () => {
    const states: Record<string, ChannelState> = {
      program: { channel: "program", active: active("scripture", {}) },
    };
    expect(rowAirState(scripture("x"), states, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/operator/src/lib/rowAirState.test.ts`
Expected: FAIL — `Cannot find module './rowAirState'` (or equivalent resolve error).

- [ ] **Step 3: Implement** — `apps/operator/src/lib/rowAirState.ts`:

```ts
import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";

export type AirState = "program" | "preview" | null;

type Row = Show["rows"][number];

const CHANNELS = ["program", "preview"] as const;

function sameData(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function onChannel(
  row: Row,
  ch: (typeof CHANNELS)[number],
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
): boolean {
  const st = channelStates[ch];
  switch (row.kind) {
    case "graphic": {
      const a = st?.active;
      return !!a && a.phase !== "out" && a.templateId === row.templateId && sameData(a.data, row.data);
    }
    case "song":
      return (
        songSessions[ch]?.songId === row.songId ||
        st?.active?.subTakeContext?.songRowId === row.id
      );
    case "video": {
      const m = st?.media;
      return !!m && m.rowId === row.id && m.playback.status !== "ended" && m.playback.status !== "error";
    }
    case "scripture":
      return false;
  }
}

/**
 * Whether a rundown row is currently on program or cued on preview, derived
 * only from state the operator already receives. Program wins over preview.
 * Scripture rows never light: channel state carries no row identity for them.
 */
export function rowAirState(
  row: Row,
  channelStates: Record<string, ChannelState>,
  songSessions: Record<string, SongSessionSummary | null>,
): AirState {
  for (const ch of CHANNELS) {
    if (onChannel(row, ch, channelStates, songSessions)) return ch;
  }
  return null;
}
```

If TypeScript reports the `switch` as not exhaustive because `Row` has more kinds than listed, run `grep -n "kind:" packages/core/src/show.ts`, add the missing kinds with `return false;`, and add a matching `it(...)` asserting `null` for each.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/operator/src/lib/rowAirState.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/rowAirState.ts apps/operator/src/lib/rowAirState.test.ts
git commit -m "feat(operator): derive rundown row on-air/cued state"
```

---

### Task 3: `stageModeFor` and `shortcutHint` — what the stage area shows

**Files:**
- Create: `apps/operator/src/lib/stageMode.ts`
- Test: `apps/operator/src/lib/stageMode.test.ts`

**Interfaces:**
- Consumes: `Show`, `GraphicRow`, `SongRow`, `ScriptureRow`, `VideoRow`, `SongSessionSummary` from `@overlaysys/core`.
- Produces:

```ts
export type StageMode =
  | { kind: "song-live"; channel: "program" | "preview"; session: SongSessionSummary }
  | { kind: "quick-take" }
  | { kind: "song"; row: SongRow }
  | { kind: "scripture"; row: ScriptureRow }
  | { kind: "graphic"; row: GraphicRow }
  | { kind: "video"; row: VideoRow }
  | { kind: "hotcard"; hotcardId: string }
  | { kind: "empty" };

export function stageModeFor(input: {
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  songSessions: Record<string, SongSessionSummary | null>;
  quickTake: boolean;
}): StageMode;

export function shortcutHint(mode: StageMode): string;
```

- [ ] **Step 1: Write the failing test** — `apps/operator/src/lib/stageMode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Show, SongSessionSummary } from "@overlaysys/core";
import { stageModeFor, shortcutHint } from "./stageMode";

const show = {
  id: "sh",
  rows: [
    { id: "g", kind: "graphic", templateId: "l3", data: {} },
    { id: "s", kind: "song", songId: "wm", lyricTemplateId: "lyr" },
    { id: "x", kind: "scripture", reference: "John 3:16" },
    { id: "v", kind: "video", label: "Giving" },
  ],
} as unknown as Show;

const session: SongSessionSummary = {
  songId: "wm", lyricTemplateId: "lyr", arrangement: [], cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false, trustMode: false, startedAt: 1,
};

const base = { show, selectedRowId: null, selectedHotcardId: null, songSessions: {}, quickTake: false };

describe("stageModeFor", () => {
  it("is empty with nothing selected", () => {
    expect(stageModeFor(base)).toEqual({ kind: "empty" });
  });

  it("picks the mode from the selected row's kind", () => {
    expect(stageModeFor({ ...base, selectedRowId: "g" }).kind).toBe("graphic");
    expect(stageModeFor({ ...base, selectedRowId: "s" }).kind).toBe("song");
    expect(stageModeFor({ ...base, selectedRowId: "x" }).kind).toBe("scripture");
    expect(stageModeFor({ ...base, selectedRowId: "v" }).kind).toBe("video");
  });

  it("shows the hotcard when a hotcard is selected", () => {
    expect(stageModeFor({ ...base, selectedHotcardId: "h1" })).toEqual({ kind: "hotcard", hotcardId: "h1" });
  });

  it("falls back to empty when the selected row no longer exists", () => {
    expect(stageModeFor({ ...base, selectedRowId: "deleted" })).toEqual({ kind: "empty" });
  });

  it("falls back to empty when there is no show", () => {
    expect(stageModeFor({ ...base, show: null, selectedRowId: "g" })).toEqual({ kind: "empty" });
  });

  it("quick take overrides row selection", () => {
    expect(stageModeFor({ ...base, selectedRowId: "g", quickTake: true })).toEqual({ kind: "quick-take" });
  });

  it("a live song session overrides everything, program first", () => {
    expect(
      stageModeFor({ ...base, selectedRowId: "g", quickTake: true, songSessions: { preview: session } }),
    ).toEqual({ kind: "song-live", channel: "preview", session });
    expect(
      stageModeFor({ ...base, songSessions: { program: session, preview: { ...session, songId: "other" } } }),
    ).toEqual({ kind: "song-live", channel: "program", session });
  });

  it("treats a null session entry as no session", () => {
    expect(stageModeFor({ ...base, songSessions: { program: null } })).toEqual({ kind: "empty" });
  });
});

describe("shortcutHint", () => {
  it("describes song-mode keys while a song is live", () => {
    const h = shortcutHint({ kind: "song-live", channel: "program", session });
    expect(h).toContain("Space next");
    expect(h).toContain("Esc end song");
  });

  it("describes graphic keys otherwise", () => {
    const h = shortcutHint({ kind: "empty" });
    expect(h).toContain("Enter cue");
    expect(h).toContain("Space take");
    expect(h).toContain("Esc clear program");
  });

  it("describes Space as play/pause for a video row", () => {
    expect(shortcutHint({ kind: "video", row: show.rows[3] as never })).toContain("Space take / play-pause");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/operator/src/lib/stageMode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/operator/src/lib/stageMode.ts`:

```ts
import type { GraphicRow, ScriptureRow, Show, SongRow, SongSessionSummary, VideoRow } from "@overlaysys/core";

export type StageMode =
  | { kind: "song-live"; channel: "program" | "preview"; session: SongSessionSummary }
  | { kind: "quick-take" }
  | { kind: "song"; row: SongRow }
  | { kind: "scripture"; row: ScriptureRow }
  | { kind: "graphic"; row: GraphicRow }
  | { kind: "video"; row: VideoRow }
  | { kind: "hotcard"; hotcardId: string }
  | { kind: "empty" };

/**
 * What the console's stage area shows. Precedence: a live song session
 * (program before preview) > quick take > selected row > selected hotcard >
 * empty. Mirrors the old Show page, where song mode replaced the take column.
 */
export function stageModeFor(input: {
  show: Show | null;
  selectedRowId: string | null;
  selectedHotcardId: string | null;
  songSessions: Record<string, SongSessionSummary | null>;
  quickTake: boolean;
}): StageMode {
  const { show, selectedRowId, selectedHotcardId, songSessions, quickTake } = input;
  for (const channel of ["program", "preview"] as const) {
    const session = songSessions[channel];
    if (session) return { kind: "song-live", channel, session };
  }
  if (quickTake) return { kind: "quick-take" };
  const row = selectedRowId && show ? show.rows.find((r) => r.id === selectedRowId) : undefined;
  if (row) {
    switch (row.kind) {
      case "song":
        return { kind: "song", row };
      case "scripture":
        return { kind: "scripture", row };
      case "graphic":
        return { kind: "graphic", row };
      case "video":
        return { kind: "video", row };
    }
  }
  if (selectedHotcardId) return { kind: "hotcard", hotcardId: selectedHotcardId };
  return { kind: "empty" };
}

/** One-line keyboard hint for the stage area. Text only; bindings live in useGlobalShortcuts. */
export function shortcutHint(mode: StageMode): string {
  if (mode.kind === "song-live") {
    return "Space next · Shift+Space previous · C/B/T chorus/bridge/tag · 1–9 verse · . blank · Esc end song";
  }
  const space = mode.kind === "video" ? "Space take / play-pause" : "Space take";
  return `↑/↓ select · Enter cue · ${space} · ⌘Enter PVW → PGM · Esc clear program`;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/operator/src/lib/stageMode.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/stageMode.ts apps/operator/src/lib/stageMode.test.ts
git commit -m "feat(operator): stage-area mode selection and shortcut hint"
```

---

### Task 4: `AnchoredPopover` — one popover primitive for console menus

**Files:**
- Create: `apps/operator/src/app/components/AnchoredPopover.tsx`

**Interfaces:**
- Consumes: `popoverPosition(anchor, popoverHeight, viewport, width?)` from `@/lib/popoverPosition`.
- Produces: `AnchoredPopover(props: { anchorEl: HTMLElement | null; onClose: () => void; width?: number; children: ReactNode })`
  - Renders in a portal, positioned with `popoverPosition`.
  - Closes on mousedown outside both the popover and the anchor.
  - Closes on Esc, and **stops the Esc from reaching the global shortcuts** (which would clear program).

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { colors, radius, shadow } from "@overlaysys/ui";
import { POPOVER_W, popoverPosition } from "@/lib/popoverPosition";

/**
 * Portal popover hung from an anchor element. Esc is swallowed in the capture
 * phase so the Show page's global Esc ("clear program") never fires while a
 * popover is open.
 */
export function AnchoredPopover({
  anchorEl,
  onClose,
  width = POPOVER_W,
  children,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 0;
      setPos(popoverPosition(r, h, { width: window.innerWidth, height: window.innerHeight }, width));
    };
    place();
    const ro = new ResizeObserver(place);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl, width]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorEl?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [anchorEl, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        maxHeight: "80vh",
        overflow: "auto",
        zIndex: 1500,
        background: colors.surface,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: radius.lg,
        boxShadow: shadow.modal,
        padding: 8,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/app/components/AnchoredPopover.tsx
git commit -m "feat(operator): AnchoredPopover primitive"
```

- [ ] **Step 4: Manual check (deferred)** — once Task 9 wires the first popover, verify: open it, press Esc. The popover closes and program is **not** cleared (on-air graphic stays on the PGM monitor).

---

### Task 5: Rundown becomes list-only, with air-state colour bars

**Files:**
- Modify: `apps/operator/src/app/components/Rundown.tsx`

**Interfaces:**
- Consumes: `rowAirState`, `AirState` (Task 2); lucide icons `Music`, `BookOpen`, `Film`, `Type`.
- Produces: `Rundown()` (no props; the unused `onEditScriptureRow` prop is removed). It still reads/writes `selectedRowId` via the store, so the stage area (Task 6) sees selection.

What moves out (into `StageArea`, Task 6): `cueSelected`, `takeSelected`, the `songStripChannel` / `selectedScriptureRow` computation, and the JSX that renders `SongTakeStrip` / `ScriptureTakeStrip` / Cue-Take buttons. `HotcardsPanel` (both usages) and the hint `<p>` are deleted.

- [ ] **Step 1: Remove the take logic and extra panels**

In `Rundown.tsx`:
- delete the `RundownProps` interface and change the signature to `export function Rundown() {`;
- delete the `cueSelected` and `takeSelected` functions;
- delete everything from the comment `// When the selected row is a song row, render the three-segment` down to (and including) the take-strip JSX block that ends just before `<table`;
- delete the `<p>` hint after `</table>`;
- delete both `<HotcardsPanel />` usages.

Remove the now-unused imports: `HotcardsPanel`, `SongTakeStrip`, `ScriptureTakeStrip`, `resolveSongChannel`, `Button`, `ScriptureRow`, `SongRow`, plus any store selectors that are no longer read (`selectedHotcardId`, `hotcardCache`, `songSessions` — re-add `songSessions` in Step 2). Change the no-show branch to:

```tsx
  if (!show) {
    return (
      <p style={{ color: colors.textDim, padding: 12, margin: 0 }}>
        No show loaded. Pick one from the top bar.
      </p>
    );
  }
```

- [ ] **Step 2: Add the row component and replace the table**

Add near the bottom of the file (replacing the `th()` / `td()` helpers, which become unused):

```tsx
function RundownItem({
  index,
  icon,
  title,
  typeLabel,
  detail,
  selected,
  air,
  onClick,
  onDoubleClick,
}: {
  index: number;
  icon: React.ReactNode;
  title: React.ReactNode;
  typeLabel: string;
  detail?: React.ReactNode;
  selected: boolean;
  air: AirState;
  onClick: () => void;
  onDoubleClick?: () => void;
}) {
  const bar = air === "program" ? colors.onair : air === "preview" ? colors.ok : "transparent";
  const tint =
    air === "program" ? "rgba(255,51,65,0.12)" : air === "preview" ? "rgba(16,185,129,0.10)" : "transparent";
  return (
    <div
      role="listitem"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 8px",
        borderRadius: radius.md,
        cursor: "pointer",
        background: tint,
        boxShadow: `inset 3px 0 0 ${bar}`,
        outline: selected ? `1px solid ${colors.brand}` : "none",
        outlineOffset: -1,
      }}
    >
      <span style={{ width: 18, textAlign: "right", color: colors.textMuted, fontSize: 11, paddingTop: 1 }}>{index}</span>
      <span style={{ color: colors.textDim, paddingTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: colors.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {detail && <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{detail}</div>}
      </div>
      <span style={{ fontSize: 10, color: colors.textMuted, paddingTop: 2 }}>{typeLabel}</span>
    </div>
  );
}
```

Replace the whole `<table>…</table>` with a list that keeps every existing per-kind click/double-click handler exactly as written, but wraps them in `RundownItem`:

```tsx
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
        {show.rows.map((row, i) => {
          const selected = row.id === selectedRowId;
          const air = rowAirState(row, channelStates, songSessions);
          if (row.kind === "song") {
            const song = songs.find((s) => s.id === row.songId);
            const cachedSong = songCache[row.songId];
            const showSong = show.songs.find((s) => s.songId === row.songId);
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<Music size={14} />}
                title={song?.title ?? row.songId}
                typeLabel="song"
                detail={
                  cachedSong
                    ? arrangementSummary(resolveArrangement(row, showSong, cachedSong), cachedSong)
                    : (row.arrangement ?? showSong?.arrangement ?? []).join(" · ") || "Default arrangement"
                }
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
                onDoubleClick={() => {
                  setSelectedRow(row.id);
                  send({
                    type: "song_take_pvw_to_pgm",
                    showId: show.id,
                    songRowId: row.id,
                    fromChannel: "preview",
                    toChannel: row.channelHint ?? "program",
                  });
                }}
              />
            );
          }
          if (row.kind === "scripture") {
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<BookOpen size={14} />}
                title={row.reference}
                typeLabel="scripture"
                detail={row.translation}
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
              />
            );
          }
          if (row.kind === "video") {
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<Film size={14} />}
                title={row.label || "Video"}
                typeLabel="video"
                detail={`${row.durationSec ? `${formatClock(row.durationSec)} · ` : ""}${row.endAction === "clear" ? "clears at end" : "holds at end"}`}
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
                onDoubleClick={() => {
                  setSelectedRow(row.id);
                  if (onAirMediaFor(row, useStore.getState().channelStates)) return;
                  send(videoRowTakeMessage(row));
                }}
              />
            );
          }
          const tplMeta = templates.find((t) => t.id === row.templateId);
          const tpl = templateCache[row.templateId] ?? null;
          return (
            <RundownItem
              key={row.id}
              index={i + 1}
              icon={<Type size={14} />}
              title={tplMeta?.name ?? row.templateId}
              typeLabel="graphic"
              detail={<DataSummary data={row.data} fields={tpl?.fields ?? null} onPreviewImage={setPreview} />}
              selected={selected}
              air={air}
              onClick={() => setSelectedRow(row.id)}
              onDoubleClick={() => {
                setSelectedRow(row.id);
                send({
                  type: "take",
                  channel: row.channelHint ?? "program",
                  templateId: row.templateId,
                  data: row.data,
                });
              }}
            />
          );
        })}
      </div>
```

Add the selectors and imports this needs:

```tsx
import { BookOpen, Film, Music, Type } from "lucide-react";
import { rowAirState, type AirState } from "@/lib/rowAirState";
// inside Rundown():
const channelStates = useStore((s) => s.channelStates);
const songSessions = useStore((s) => s.songSessions);
```

Keep `DataSummary`, `renderFieldValue`, `truncate` and `ImagePreviewModal` unchanged. If `DataSummary` returns a table-cell-shaped element (`<td>`), change its outermost element to a `<div>`.

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test`
Expected: PASS. (`app/page.tsx` still renders `<Rundown />` with no props.)

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/components/Rundown.tsx
git commit -m "refactor(operator): rundown is list-only with on-air/cued colour bars"
```

The Show page temporarily has no take buttons for the selected row between this commit and Task 6; keyboard shortcuts still work. Land Tasks 5–10 together in one PR.

---

### Task 6: `StageArea` + Quick take

**Files:**
- Create: `apps/operator/src/app/components/StageArea.tsx`
- Modify: `apps/operator/src/app/components/TakePanel.tsx` (reduce to Cue / Take / Update)

**Interfaces:**
- Consumes:
  - `stageModeFor`, `shortcutHint`, `StageMode` (Task 3);
  - `SongModePanel({ channel, session })`;
  - `SongTakeStrip({ show, row, channel, liveSession })`;
  - `ScriptureTakeStrip({ row, channel })`;
  - `TakePanel()`;
  - `resolveSongChannel(row, showSong, cachedSong, lyricTemplate)` from `@overlaysys/core`;
  - `onAirMediaFor`, `videoRowTakeMessage` from `@/lib/mediaTake`;
  - `PanelHeader`, `Button` (variant `"onair"`).
- Produces: `StageArea()`.

- [ ] **Step 1: Trim `TakePanel` to three buttons**

In `TakePanel.tsx`, replace the three `<div style={row}>…</div>` button blocks (from `Take ▶ {channelLabel(pgmChannel)}` through `Update PGM`) and the `<p>` hint below them with:

```tsx
      <div style={{ ...row, marginTop: 12 }}>
        <Button onClick={() => take(pvwChannel)} size="lg" disabled={takesDisabled} title={disabledTitle}>
          Cue → {channelLabel(pvwChannel)}
        </Button>
        <Button onClick={() => take(pgmChannel)} variant="onair" size="lg" disabled={takesDisabled} title={disabledTitle}>
          Take → {channelLabel(pgmChannel)}
        </Button>
        <Button onClick={() => update(pgmChannel)} size="lg" disabled={takesDisabled} title={disabledTitle}>
          Update {channelLabel(pgmChannel)}
        </Button>
      </div>
```

Delete the now-unused `clear` and `swap` functions. PVW → PGM swap is still on ⌘Enter, and clearing is on Esc and the channel menus (Task 8). Also update the component's doc comment to say "Quick take".

- [ ] **Step 2: Create `StageArea.tsx`**

```tsx
"use client";

import { useState } from "react";
import { resolveSongChannel } from "@overlaysys/core";
import { Button, PanelHeader, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { onAirMediaFor, videoRowTakeMessage } from "@/lib/mediaTake";
import { shortcutHint, stageModeFor, type StageMode } from "@/lib/stageMode";
import { SongModePanel } from "./SongModePanel";
import { SongTakeStrip } from "./SongTakeStrip";
import { ScriptureTakeStrip } from "./ScriptureTakeStrip";
import { TakePanel } from "./TakePanel";

/**
 * Centre-bottom of the Live console: controls for whatever is selected.
 * Content changes with the mode; the region itself never moves.
 */
export function StageArea() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const selectedRowId = useStore((s) => s.selectedRowId);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const songSessions = useStore((s) => s.songSessions);
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const hotcards = useStore((s) => s.hotcards);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const channelStates = useStore((s) => s.channelStates);
  const [quickTake, setQuickTake] = useState(false);

  const mode = stageModeFor({ show, selectedRowId, selectedHotcardId, songSessions, quickTake });

  function fireHotcard(id: string, target: "preview" | "program") {
    const h = hotcardCache[id];
    if (!h) {
      send({ type: "get_hotcard", hotcardId: id });
      return;
    }
    send({ type: target === "preview" ? "cue" : "take", channel: h.channelHint ?? target, templateId: h.templateId, data: h.data });
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", margin: "0 12px 12px", background: colors.surface2, borderRadius: 8 }}>
      <PanelHeader
        title={headingFor(mode)}
        right={
          mode.kind !== "song-live" && (
            <Button size="sm" variant={quickTake ? "primary" : "ghost"} onClick={() => setQuickTake((v) => !v)}>
              Quick take
            </Button>
          )
        }
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
        {mode.kind === "song-live" && <SongModePanel channel={mode.channel} session={mode.session} />}
        {mode.kind === "quick-take" && <TakePanel />}
        {mode.kind === "song" && show && (() => {
          const cachedSong = songCache[mode.row.songId];
          const showSong = show.songs.find((s) => s.songId === mode.row.songId);
          const channel = cachedSong
            ? resolveSongChannel(mode.row, showSong, cachedSong, templateCache[mode.row.lyricTemplateId]) ?? "program"
            : "program";
          return <SongTakeStrip show={show} row={mode.row} channel={channel} liveSession={songSessions[channel] ?? null} />;
        })()}
        {mode.kind === "scripture" && (
          <ScriptureTakeStrip row={mode.row} channel={mode.row.channelHint ?? "program"} />
        )}
        {mode.kind === "graphic" && (
          <TakeButtons
            onCue={() =>
              send({ type: "cue", channel: mode.row.channelHint ?? "preview", templateId: mode.row.templateId, data: mode.row.data })
            }
            onTake={() =>
              send({ type: "take", channel: mode.row.channelHint ?? "program", templateId: mode.row.templateId, data: mode.row.data })
            }
          />
        )}
        {mode.kind === "video" && (
          onAirMediaFor(mode.row, channelStates) ? (
            <p style={{ color: colors.textDim, margin: 0 }}>On air. Use the transport in the bottom bar.</p>
          ) : (
            <TakeButtons onTake={() => send(videoRowTakeMessage(mode.row))} />
          )
        )}
        {mode.kind === "hotcard" && (
          <>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {hotcards.find((h) => h.id === mode.hotcardId)?.name ?? "Hotcard"}
            </div>
            <TakeButtons onCue={() => fireHotcard(mode.hotcardId, "preview")} onTake={() => fireHotcard(mode.hotcardId, "program")} />
          </>
        )}
        {mode.kind === "empty" && (
          <p style={{ color: colors.textDim, margin: 0 }}>Select a rundown item, or use Quick take.</p>
        )}
      </div>
      <div style={{ padding: "6px 12px", fontSize: 11, color: colors.textMuted, borderTop: `1px solid ${colors.border}` }}>
        {shortcutHint(mode)}
      </div>
    </div>
  );
}

function headingFor(mode: StageMode): string {
  switch (mode.kind) {
    case "song-live":
      return mode.channel === "program" ? "Song mode · PGM" : "Song mode · PVW (cued)";
    case "quick-take":
      return "Quick take";
    case "song":
      return "Song";
    case "scripture":
      return "Scripture";
    case "graphic":
      return "Graphic";
    case "video":
      return "Video";
    case "hotcard":
      return "Hotcard";
    case "empty":
      return "Stage";
  }
}

function TakeButtons({ onCue, onTake }: { onCue?: () => void; onTake: () => void }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {onCue && (
        <Button size="lg" onClick={onCue}>
          Cue → PVW
        </Button>
      )}
      <Button size="lg" variant="onair" onClick={onTake} style={{ minWidth: 140 }}>
        Take
      </Button>
    </div>
  );
}
```

Check that `hotcards` items have a `name` field: `grep -n "name" packages/core/src/hotcard.ts`. If the field is called something else, use it.

Check that `resolveSongChannel` can return `undefined`. The old Rundown code used `resolved ?? "program"`, so keep the `?? "program"`.

- [ ] **Step 3: Typecheck and tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test`
Expected: PASS. `StageArea` is not mounted yet (Task 10).

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/components/StageArea.tsx apps/operator/src/app/components/TakePanel.tsx
git commit -m "feat(operator): StageArea with Quick take; TakePanel trimmed to Cue/Take/Update"
```

---

### Task 7: Program/Preview monitors

**Files:**
- Create: `apps/operator/src/app/components/Monitors.tsx`

**Interfaces:**
- Consumes: `ChannelPreview({ config, state })`, `useResolvedChannelConfigs()`, store `channelStates`.
- Produces: `Monitors(props: { compact: boolean })`. Shows the configs with id `"preview"` and `"program"`. A missing config renders a dim "No <name> channel" placeholder.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import type { ChannelConfig } from "@overlaysys/core";
import { colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { ChannelPreview } from "./ChannelPreview";

/** Large PVW / PGM monitors. `compact` shrinks them while a song is live. */
export function Monitors({ compact }: { compact: boolean }) {
  const configs = useResolvedChannelConfigs();
  const channelStates = useStore((s) => s.channelStates);
  const pick = (id: string) => configs.find((c) => c.id === id) ?? null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "repeat(2, minmax(0, 240px))" : "repeat(2, minmax(0, 1fr))",
        gap: 12,
        padding: 12,
        flexShrink: 0,
      }}
    >
      <Monitor label="PVW" ring={colors.ok} ringWidth={1} config={pick("preview")} channelStates={channelStates} />
      <Monitor label="PGM" ring={colors.onair} ringWidth={2} config={pick("program")} channelStates={channelStates} />
    </div>
  );
}

function Monitor({
  label,
  ring,
  ringWidth,
  config,
  channelStates,
}: {
  label: string;
  ring: string;
  ringWidth: number;
  config: ChannelConfig | null;
  channelStates: ReturnType<typeof useStore.getState>["channelStates"];
}) {
  return (
    <div style={{ position: "relative", borderRadius: 6, overflow: "hidden", boxShadow: `0 0 0 ${ringWidth}px ${ring}`, background: "#05070c" }}>
      {config ? (
        <ChannelPreview config={config} state={channelStates[config.mirrorOf ?? config.id]} />
      ) : (
        <div style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", color: colors.textMuted, fontSize: 12 }}>
          No {label === "PGM" ? "program" : "preview"} channel
        </div>
      )}
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.8,
          padding: "2px 6px",
          borderRadius: 3,
          background: ring,
          color: label === "PGM" ? "#fff" : "#04130d",
        }}
      >
        {label}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/app/components/Monitors.tsx
git commit -m "feat(operator): PVW/PGM monitors for the live console"
```

---

### Task 8: Bottom bar — transport + channel dots with menus

**Files:**
- Create: `apps/operator/src/lib/channelDotModel.ts`
- Test: `apps/operator/src/lib/channelDotModel.test.ts`
- Create: `apps/operator/src/lib/useChannelWindowPrefs.ts` (logic moved out of `ChannelStatus.tsx`)
- Create: `apps/operator/src/app/components/ChannelDots.tsx`
- Create: `apps/operator/src/app/components/ConsoleBottomBar.tsx`
- Modify: `apps/operator/src/app/components/MediaTransportStrip.tsx` (add `inline` prop)
- Delete (Task 10, once nothing imports them): `ChannelsList.tsx`, `ChannelStatus.tsx`

**Interfaces:**
- Produces:
  - `channelDotModel(config: ChannelConfig, channelStates: Record<string, ChannelState>): { tone: "live" | "good" | "dim"; busy: boolean; canClear: boolean; sourceId: string }`
  - `useChannelWindowPrefs(config: ChannelConfig | undefined): { hasPrefs: boolean; fallbackWarning: { configuredLabel: string | null; actualLabel: string } | null; refresh: () => Promise<void> }`
  - `ChannelDots()`
  - `ConsoleBottomBar()`
  - `MediaTransportStrip(props?: { inline?: boolean })`

- [ ] **Step 1: Write the failing test** — `apps/operator/src/lib/channelDotModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { channelDotModel } from "./channelDotModel";

const cfg = (id: string, extra: Partial<ChannelConfig> = {}) =>
  ({ id, name: id, renderMode: "normal", ...extra }) as ChannelConfig;
const on = (channel: string): ChannelState => ({
  channel,
  active: { templateId: "t", data: {}, phase: "on", takenAt: 1 },
});

describe("channelDotModel", () => {
  it("program with content is live (red)", () => {
    expect(channelDotModel(cfg("program"), { program: on("program") })).toMatchObject({ tone: "live", busy: true, canClear: true });
  });

  it("other channels with content are good (green)", () => {
    expect(channelDotModel(cfg("stage"), { stage: on("stage") }).tone).toBe("good");
  });

  it("an empty channel is dim and cannot be cleared", () => {
    expect(channelDotModel(cfg("preview"), {})).toMatchObject({ tone: "dim", busy: false, canClear: false });
  });

  it("media alone counts as busy", () => {
    const st: ChannelState = {
      channel: "program",
      active: null,
      media: {
        rowId: "v", assetUrl: "/a.mp4", volume: 1, endAction: "hold", takenAt: 1, paused: false,
        playback: { status: "playing", currentTime: 0, duration: 1, updatedAt: 1 },
      },
    };
    expect(channelDotModel(cfg("program"), { program: st }).busy).toBe(true);
  });

  it("a mirror reflects its source's state but never offers Clear", () => {
    const m = channelDotModel(cfg("key", { mirrorOf: "program" }), { program: on("program") });
    expect(m).toMatchObject({ sourceId: "program", busy: true, canClear: false, tone: "good" });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/operator/src/lib/channelDotModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/operator/src/lib/channelDotModel.ts`:

```ts
import type { ChannelConfig, ChannelState } from "@overlaysys/core";

/**
 * Bottom-bar dot for one channel. Mirrors show their source's state (that's
 * what their renderer displays) but never offer Clear — clearing a mirror is
 * a no-op server-side.
 */
export function channelDotModel(
  config: ChannelConfig,
  channelStates: Record<string, ChannelState>,
): { tone: "live" | "good" | "dim"; busy: boolean; canClear: boolean; sourceId: string } {
  const sourceId = config.mirrorOf ?? config.id;
  const st = channelStates[sourceId];
  const busy = !!st?.active || !!st?.media;
  const tone = !busy ? "dim" : config.id === "program" ? "live" : "good";
  return { tone, busy, canClear: busy && !config.mirrorOf, sourceId };
}
```

Run: `pnpm vitest run apps/operator/src/lib/channelDotModel.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Extract the window-prefs hook** — create `apps/operator/src/lib/useChannelWindowPrefs.ts` by moving the `hasPrefs` / `fallbackWarning` state, `refreshPrefsState` callback and the subscribe `useEffect` verbatim out of `ChannelStatus.tsx`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChannelConfig } from "@overlaysys/core";
import { getDesktopApi, isElectron } from "@/lib/desktop";

export function useChannelWindowPrefs(config: ChannelConfig | undefined) {
  const [hasPrefs, setHasPrefs] = useState(false);
  const [fallbackWarning, setFallbackWarning] = useState<{
    configuredLabel: string | null;
    actualLabel: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!isElectron() || !config) return;
    const api = getDesktopApi();
    if (!api) return;
    const [prefsFile, resolutions] = await Promise.all([
      api.getChannelWindowPrefs(),
      api.getChannelWindowResolutions(),
    ]);
    setHasPrefs(!!prefsFile.channels[config.id]);
    const r = resolutions[config.id];
    setFallbackWarning(
      r && r.matchedBy === "fallback" && r.configuredLabel
        ? { configuredLabel: r.configuredLabel, actualLabel: r.actualLabel }
        : null,
    );
  }, [config]);

  useEffect(() => {
    if (!isElectron() || !config) return;
    const api = getDesktopApi();
    if (!api) return;
    void refresh();
    const offOpened = api.onChannelWindowOpened(() => void refresh());
    const offClosed = api.onChannelWindowClosed(() => void refresh());
    return () => {
      offOpened();
      offClosed();
    };
  }, [config, refresh]);

  return { hasPrefs, fallbackWarning, refresh };
}
```

- [ ] **Step 5: Create `ChannelDots.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import type { ChannelConfig } from "@overlaysys/core";
import { Button, StatusDot, colors } from "@overlaysys/ui";
import { ExternalLink, RotateCw, Settings2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { channelDotModel } from "@/lib/channelDotModel";
import { useChannelWindowPrefs } from "@/lib/useChannelWindowPrefs";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import { AnchoredPopover } from "./AnchoredPopover";
import { ChannelWindowSettingsPopover } from "./ChannelWindowSettingsPopover";

export function ChannelDots() {
  const channels = useResolvedChannelConfigs();
  if (channels.length === 0) {
    return <span style={{ color: colors.textMuted, fontSize: 12 }}>No channels configured</span>;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {channels.map((c) => (
        <ChannelDot key={c.id} config={c} />
      ))}
    </div>
  );
}

function ChannelDot({ config }: { config: ChannelConfig }) {
  const { send } = useWs();
  const channelStates = useStore((s) => s.channelStates);
  const model = channelDotModel(config, channelStates);
  const { hasPrefs, fallbackWarning, refresh } = useChannelWindowPrefs(config);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [menu, setMenu] = useState<"closed" | "menu" | "settings">("closed");
  const href = `http://localhost:3001/?channel=${encodeURIComponent(config.id)}`;

  return (
    <span ref={anchorRef}>
      <StatusDot
        tone={model.tone}
        label={config.name}
        title={fallbackWarning ? `Configured for ${fallbackWarning.configuredLabel}; using ${fallbackWarning.actualLabel}` : undefined}
        onClick={() => setMenu((m) => (m === "closed" ? "menu" : "closed"))}
        style={fallbackWarning ? { color: colors.warn } : undefined}
      />
      {menu === "menu" && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setMenu("closed")} width={220}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {config.mirrorOf && (
              <div style={{ fontSize: 11, color: colors.textDim, padding: "2px 4px" }}>Mirrors {config.mirrorOf}</div>
            )}
            <MenuButton
              icon={<ExternalLink size={14} />}
              label="Open renderer"
              onClick={() => {
                if (isElectron()) getDesktopApi()?.openChannelWindow(config.id);
                else window.open(href, "_blank", "noreferrer");
                setMenu("closed");
              }}
            />
            {isElectron() && hasPrefs && (
              <MenuButton
                icon={<RotateCw size={14} />}
                label="Reopen on configured display"
                onClick={() => {
                  void getDesktopApi()?.reopenChannelOnConfiguredDisplay(config.id);
                  setMenu("closed");
                }}
              />
            )}
            {isElectron() && (
              <MenuButton icon={<Settings2 size={14} />} label="Window settings…" onClick={() => setMenu("settings")} />
            )}
            {!config.mirrorOf && (
              <MenuButton
                icon={<X size={14} />}
                label={model.canClear ? "Clear" : "Already empty"}
                disabled={!model.canClear}
                onClick={() => {
                  send({ type: "clear", channel: config.id });
                  setMenu("closed");
                }}
              />
            )}
          </div>
        </AnchoredPopover>
      )}
      {menu === "settings" && (
        <ChannelWindowSettingsPopover
          channelId={config.id}
          anchorEl={anchorRef.current}
          onClose={() => setMenu("closed")}
          onSaved={() => void refresh()}
        />
      )}
    </span>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start", border: "none" }}
    >
      {icon}
      {label}
    </Button>
  );
}
```

`ChannelWindowSettingsPopover` has its own Esc/close handling. Check whether its Esc reaches the global "clear program" handler: read its `useEffect`s (`sed -n 60,120p apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx`). If it doesn't swallow Esc, add the same capture-phase `keydown` listener used in `AnchoredPopover` (Task 4, Step 1) inside it.

- [ ] **Step 6: `MediaTransportStrip` inline mode** — change its signature and outer container:

```tsx
export function MediaTransportStrip({ inline = false }: { inline?: boolean } = {}) {
  const channelStates = useStore((s) => s.channelStates);
  const entries = Object.values(channelStates).filter(
    (s): s is typeof s & { media: ChannelMedia } => !!s.media,
  );
  if (entries.length === 0) return null;
  return (
    <div
      style={
        inline
          ? { display: "flex", gap: 8, alignItems: "stretch", minWidth: 0 }
          : { display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }
      }
    >
      {entries.map((s) => (
        <div key={s.channel} style={inline ? { width: 360, flexShrink: 0 } : undefined}>
          <ChannelTransport channel={s.channel} media={s.media} />
        </div>
      ))}
    </div>
  );
}
```

Replace the `🎬` span in `ChannelTransport` with `<Film size={14} aria-hidden />` (import `Film` from `lucide-react`).

- [ ] **Step 7: Create `ConsoleBottomBar.tsx`**

```tsx
"use client";

import { colors } from "@overlaysys/ui";
import { MediaTransportStrip } from "./MediaTransportStrip";
import { ChannelDots } from "./ChannelDots";

export function ConsoleBottomBar() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        minHeight: 40,
        padding: "6px 12px",
        background: colors.surface,
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <MediaTransportStrip inline />
      <div style={{ marginLeft: "auto" }}>
        <ChannelDots />
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Typecheck and tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/operator/src/lib/channelDotModel.ts apps/operator/src/lib/channelDotModel.test.ts apps/operator/src/lib/useChannelWindowPrefs.ts apps/operator/src/app/components/ChannelDots.tsx apps/operator/src/app/components/ConsoleBottomBar.tsx apps/operator/src/app/components/MediaTransportStrip.tsx apps/operator/src/app/components/ChannelWindowSettingsPopover.tsx
git commit -m "feat(operator): console bottom bar with transport and channel dot menus"
```

---

### Task 9: Right rail — timers (with popover) and hotcards; retire `/timer`

**Files:**
- Create: `apps/operator/src/app/components/TimersRail.tsx`
- Modify: `apps/operator/src/app/components/HotcardsPanel.tsx`
- Create: `apps/operator/src/app/components/RouteRedirect.tsx`
- Modify: `apps/operator/src/app/timer/page.tsx` (becomes a redirect)

**Interfaces:**
- Consumes: `AnchoredPopover` (Task 4), `TimerPanel()`, `ActiveTimersPanel()`, `PanelHeader`.
- Produces:
  - `TimersRail()`
  - `HotcardsPanel()`: renders its own `PanelHeader`; no border-top, no hint line.
  - `RouteRedirect(props: { to: string })`: client `router.replace(to)` on mount, renders nothing. Reused in Task 13.

- [ ] **Step 1: Create `RouteRedirect.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Client-side redirect for moved routes (the desktop build is a static export, so no server redirects). */
export function RouteRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
```

- [ ] **Step 2: Replace `app/timer/page.tsx` entirely with**

```tsx
"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";

/** Timers now live on the Live console (right rail, "+ New"). */
export default function TimerPage() {
  return <RouteRedirect to="/" />;
}
```

- [ ] **Step 3: Create `TimersRail.tsx`**

```tsx
"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, PanelHeader } from "@overlaysys/ui";
import { AnchoredPopover } from "./AnchoredPopover";
import { ActiveTimersPanel } from "./ActiveTimersPanel";
import { TimerPanel } from "./TimerPanel";

export function TimersRail() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <PanelHeader
        title="Timers"
        right={
          <span ref={anchorRef}>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> New
            </Button>
          </span>
        }
      />
      <div style={{ padding: 12, overflow: "auto" }}>
        <ActiveTimersPanel />
      </div>
      {open && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setOpen(false)} width={560}>
          <TimerPanel />
        </AnchoredPopover>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Restyle `HotcardsPanel`**

In `HotcardsPanel.tsx`:
- Replace the `header` constant with:

```tsx
  const header = (
    <PanelHeader
      title={`Hotcards · ${hotcards.length}`}
      right={
        <>
          <ViewToggleButton active={view === "list"} onClick={() => persistView("list")} label="List" />
          <ViewToggleButton active={view === "grid"} onClick={() => persistView("grid")} label="Grid" />
          <Link href="/hotcards" style={{ color: colors.textDim, fontSize: 11, textDecoration: "none" }}>
            Manage
          </Link>
        </>
      }
    />
  );
```

- In both returns, replace `<section style={{ paddingTop: 16, borderTop: \`1px solid ${colors.border}\`, marginTop: 16 }}>` with `<section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>`, and wrap the content after `{header}` in `<div style={{ padding: 12, overflow: "auto" }}>…</div>`.
- Delete the `<p>` hint ("Click to select · Enter to cue …").
- Add `PanelHeader` to the `@overlaysys/ui` import.

- [ ] **Step 5: Typecheck and tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/components/TimersRail.tsx apps/operator/src/app/components/HotcardsPanel.tsx apps/operator/src/app/components/RouteRedirect.tsx apps/operator/src/app/timer/page.tsx
git commit -m "feat(operator): timers and hotcards right rail; /timer redirects to the console"
```

Manual check for Review Focus #1 (after Task 10 mounts this): put a graphic on PGM, open "+ New", press Esc. The popover closes and the PGM graphic stays on air.

---

### Task 10: Compose the Live console page

**Files:**
- Modify: `apps/operator/src/app/page.tsx`
- Delete: `apps/operator/src/app/components/ChannelsList.tsx`, `apps/operator/src/app/components/ChannelStatus.tsx`

**Interfaces:**
- Consumes: `Rundown`, `Monitors`, `StageArea`, `TimersRail`, `HotcardsPanel`, `ConsoleBottomBar`, `ShowPicker`, `PageChrome`, `PanelHeader`.

- [ ] **Step 1: Replace the body of `ShowPageLocal`'s return and remove `ShellPanel`**

Keep `ShowPage` and all of `ShowPageLocal`'s hooks (show loading, localStorage, `useGlobalShortcuts`) unchanged. Delete the `activeSongChannel` / `activeSongSession` locals and replace them with:

```tsx
  const songModeActive = !!(programSession ?? previewSession);
```

Replace the returned JSX with:

```tsx
  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "minmax(0,1fr) auto", overflow: "hidden" }}>
      <PageChrome title="Show" context={<ShowPicker />} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr) 300px",
          gap: 1,
          background: colors.border,
          minHeight: 0,
        }}
      >
        <section style={columnStyle}>
          <PanelHeader title="Rundown" right={show ? `${show.rows.length} items` : undefined} />
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Rundown />
          </div>
        </section>
        <section style={columnStyle}>
          <Monitors compact={songModeActive} />
          <StageArea />
        </section>
        <section style={columnStyle}>
          <TimersRail />
          <HotcardsPanel />
        </section>
      </div>
      <ConsoleBottomBar />
    </div>
  );
```

and add below the component:

```tsx
const columnStyle: React.CSSProperties = {
  background: colors.panel,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};
```

Fix the imports:
- remove `TakePanel`, `ChannelsList`, `SongModePanel`, `MediaTransportStrip`;
- add `PanelHeader` from `@overlaysys/ui`, plus `Monitors`, `StageArea`, `TimersRail`, `HotcardsPanel`, `ConsoleBottomBar`.

Delete the `ShellPanel` function.

- [ ] **Step 2: Delete the retired components**

Run: `grep -rn "ChannelsList\|ChannelStatus\b" apps/operator/src --include=*.tsx --include=*.ts`
Expected: no matches outside the two files themselves. Then:

```bash
git rm apps/operator/src/app/components/ChannelsList.tsx apps/operator/src/app/components/ChannelStatus.tsx
```

- [ ] **Step 3: Typecheck, tests, build**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test && pnpm --filter @overlaysys/operator build:static`
Expected: all pass; the static export contains `out/timer/index.html`.

- [ ] **Step 4: Manual verification in the desktop app** — run `pnpm desktop`, at 1440p and 1920p window sizes:

- [ ] **Graphic row:** select → stage shows Cue / Take; Cue lights the row green and shows on PVW; Take lights it red on PGM.
- [ ] **Two rows with the same template but different data:** only the taken one is red.
- [ ] **Song row:**
  - [ ] Select → `SongTakeStrip`.
  - [ ] Take → the stage switches to "Song mode · PGM", the monitors shrink, and nothing else moves.
  - [ ] Space / Shift+Space / C / 1 / . / Esc all behave as before.
  - [ ] Ending the song restores the normal monitors.
- [ ] **Song cued on PVW only:** heading reads "Song mode · PVW (cued)".
- [ ] **Scripture row:** select → `ScriptureTakeStrip` works.
- [ ] **Video row:** Take → transport appears in the bottom bar; Space toggles play/pause; the stage says "On air…".
- [ ] **Hotcard:** click a tile → stage shows the hotcard with Cue / Take; double-click still fires.
- [ ] **Quick take:** pick a template, fill fields, Cue / Take / Update all work.
- [ ] **Timers:** "+ New" opens the popover; start a countdown; it appears in the rail; Esc closes the popover without clearing PGM.
- [ ] **Channel dot menu:** Open renderer, Window settings…, Clear (disabled when empty, absent on mirrors); Esc closes without clearing PGM.
- [ ] **Old URL:** `/timer` lands on `/`.
- [ ] **Delete the selected row in Library → Shows** while it's selected live: the stage falls back to empty without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/page.tsx
git commit -m "feat(operator): Live console layout (rundown | monitors+stage | timers+hotcards, bottom bar)"
```

---

# Phase 3 — Shell

### Task 11: `areas.ts` — Live · Library · Settings model

**Files:**
- Create: `apps/operator/src/app/shell/areas.ts`
- Test: `apps/operator/src/app/shell/areas.test.ts`
- Delete: `apps/operator/src/app/shell/workspaces.ts`, `apps/operator/src/app/shell/workspaces.test.ts` (in Task 12, once nothing imports them)

**Interfaces:**
- Produces:

```ts
export type AreaId = "live" | "library" | "settings";
export type Destination = { route: string; label: string; icon: LucideIcon; desktopOnly?: boolean };
export type Area = { id: AreaId; label: string; destinations: Destination[] };
export const AREAS: Record<AreaId, Area>;
export const AREA_ORDER: readonly AreaId[]; // ["live", "library", "settings"]
export const LEGACY_REDIRECTS: Record<string, string>;
export function routeToArea(pathname: string): AreaId;
export function areasFor(cloud: boolean): AreaId[];
export function destinationsFor(id: AreaId, cloud: boolean): Destination[];
export function defaultRouteFor(id: AreaId, cloud: boolean): string;
export const lastRouteKey: (id: AreaId) => string;   // `overlaysys:lastRoute:${id}`
export const LAST_NON_LIVE_KEY: string;             // "overlaysys:lastRoute:nonLive"
export function liveToggleTarget(current: AreaId, lastNonLive: string | null, cloud: boolean): string;
```

- [ ] **Step 1: Write the failing test** — `apps/operator/src/app/shell/areas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AREAS, AREA_ORDER, LEGACY_REDIRECTS, areasFor, defaultRouteFor, destinationsFor,
  lastRouteKey, liveToggleTarget, routeToArea,
} from "./areas";

describe("areas model", () => {
  it("maps the console to live", () => {
    expect(routeToArea("/")).toBe("live");
  });

  it("maps library routes, including nested editors", () => {
    for (const p of ["/shows", "/shows/edit", "/songs", "/songs/edit", "/design", "/design/edit", "/hotcards", "/hotcards/edit"]) {
      expect(routeToArea(p), p).toBe("library");
    }
  });

  it("maps settings routes, including ones without a /settings prefix", () => {
    for (const p of ["/settings/channels", "/settings/stt", "/pco", "/data", "/projects", "/account"]) {
      expect(routeToArea(p), p).toBe("settings");
    }
  });

  it("does not treat '/' as a prefix of everything", () => {
    expect(routeToArea("/projects")).toBe("settings");
  });

  it("falls back to library for unknown routes", () => {
    expect(routeToArea("/nonsense")).toBe("library");
  });

  it("hides live and desktop-only settings in the cloud build", () => {
    expect(areasFor(true)).toEqual(["library", "settings"]);
    expect(areasFor(false)).toEqual(["live", "library", "settings"]);
    expect(destinationsFor("settings", true).map((d) => d.route)).toEqual(["/data", "/projects", "/account"]);
    expect(destinationsFor("settings", false).map((d) => d.route)).toEqual([
      "/settings/channels", "/settings/stt", "/pco", "/data", "/projects", "/account",
    ]);
  });

  it("has a default route that is visible in each build", () => {
    expect(defaultRouteFor("live", false)).toBe("/");
    expect(defaultRouteFor("library", true)).toBe("/shows");
    expect(defaultRouteFor("settings", false)).toBe("/settings/channels");
    expect(defaultRouteFor("settings", true)).toBe("/data");
  });

  it("redirects the old live-tool routes", () => {
    expect(LEGACY_REDIRECTS).toEqual({
      "/timer": "/",
      "/channels": "/settings/channels",
      "/stt": "/settings/stt",
    });
  });

  it("uses per-area last-route keys", () => {
    expect(lastRouteKey("library")).toBe("overlaysys:lastRoute:library");
  });

  it("⌘⇧L goes to Live from elsewhere and back to the last non-live route from Live", () => {
    expect(liveToggleTarget("library", "/songs", false)).toBe("/");
    expect(liveToggleTarget("live", "/songs/edit", false)).toBe("/songs/edit");
    expect(liveToggleTarget("live", null, false)).toBe("/shows");
  });

  it("⌘⇧L does nothing useful in cloud (stays put on the current area's default)", () => {
    expect(liveToggleTarget("library", "/songs", true)).toBe("/songs");
  });

  it("lists areas in tab order", () => {
    expect(AREA_ORDER).toEqual(["live", "library", "settings"]);
    expect(AREAS.library.destinations.map((d) => d.label)).toEqual(["Shows", "Songs", "Designs", "Hotcards"]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/operator/src/app/shell/areas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/operator/src/app/shell/areas.ts`:

```ts
// Single source of truth for the Live · Library · Settings shell. Replaces
// workspaces.ts (Live/Prep).

import {
  ArrowDownUp, CloudDownload, FolderKanban, ListOrdered, Mic, MonitorPlay,
  MonitorSpeaker, Music, Palette, UserRound, Zap, type LucideIcon,
} from "lucide-react";

export type AreaId = "live" | "library" | "settings";

export type Destination = {
  route: string;
  label: string;
  icon: LucideIcon;
  /** Hidden in the cloud/web build (no paired renderer). */
  desktopOnly?: boolean;
};

export type Area = { id: AreaId; label: string; destinations: Destination[] };

export const AREA_ORDER = ["live", "library", "settings"] as const;

export const AREAS: Record<AreaId, Area> = {
  live: {
    id: "live",
    label: "Live",
    destinations: [{ route: "/", label: "Show", icon: MonitorPlay, desktopOnly: true }],
  },
  library: {
    id: "library",
    label: "Library",
    destinations: [
      { route: "/shows", label: "Shows", icon: ListOrdered },
      { route: "/songs", label: "Songs", icon: Music },
      { route: "/design", label: "Designs", icon: Palette },
      { route: "/hotcards", label: "Hotcards", icon: Zap },
    ],
  },
  settings: {
    id: "settings",
    label: "Settings",
    destinations: [
      { route: "/settings/channels", label: "Channels", icon: MonitorSpeaker, desktopOnly: true },
      { route: "/settings/stt", label: "Speech-to-text", icon: Mic, desktopOnly: true },
      { route: "/pco", label: "Planning Center", icon: CloudDownload, desktopOnly: true },
      { route: "/data", label: "Data", icon: ArrowDownUp },
      { route: "/projects", label: "Projects", icon: FolderKanban },
      { route: "/account", label: "Account", icon: UserRound },
    ],
  },
};

/** Old live-tool routes and where they moved. Each has a client redirect page. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/timer": "/",
  "/channels": "/settings/channels",
  "/stt": "/settings/stt",
};

const ALL: { route: string; area: AreaId }[] = AREA_ORDER.flatMap((id) =>
  AREAS[id].destinations.map((d) => ({ route: d.route, area: id })),
);

/** Longest-prefix match; "/" only matches exactly. Unknown routes → library. */
export function routeToArea(pathname: string): AreaId {
  let best: { route: string; area: AreaId } | null = null;
  for (const d of ALL) {
    const hit = d.route === "/" ? pathname === "/" : pathname === d.route || pathname.startsWith(d.route + "/");
    if (hit && (!best || d.route.length > best.route.length)) best = d;
  }
  return best?.area ?? "library";
}

export function destinationsFor(id: AreaId, cloud: boolean): Destination[] {
  return AREAS[id].destinations.filter((d) => !(cloud && d.desktopOnly));
}

export function areasFor(cloud: boolean): AreaId[] {
  return AREA_ORDER.filter((id) => destinationsFor(id, cloud).length > 0);
}

export function defaultRouteFor(id: AreaId, cloud: boolean): string {
  return destinationsFor(id, cloud)[0]?.route ?? "/shows";
}

export const lastRouteKey = (id: AreaId): string => `overlaysys:lastRoute:${id}`;
export const LAST_NON_LIVE_KEY = "overlaysys:lastRoute:nonLive";

/** Where ⌘⇧L goes: into Live from anywhere else; back out of Live to the last non-live route. */
export function liveToggleTarget(current: AreaId, lastNonLive: string | null, cloud: boolean): string {
  if (cloud) return lastNonLive ?? defaultRouteFor(current, cloud);
  if (current !== "live") return "/";
  return lastNonLive ?? defaultRouteFor("library", cloud);
}
```

The cloud test expects `liveToggleTarget("library", "/songs", true)` to be `"/songs"`. The implementation returns `lastNonLive` in cloud, which is `"/songs"`, so it matches.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/operator/src/app/shell/areas.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/shell/areas.ts apps/operator/src/app/shell/areas.test.ts
git commit -m "feat(operator): Live/Library/Settings area model"
```

---

### Task 12: New shell — top bar, sub-nav, status dots, command palette

**Files:**
- Create: `apps/operator/src/app/shell/TopBar.tsx`
- Create: `apps/operator/src/app/shell/SubNav.tsx`
- Create: `apps/operator/src/app/shell/StatusBar.tsx` (replaces `StatusPills.tsx`)
- Modify: `apps/operator/src/app/shell/AppShell.tsx`
- Modify: `apps/operator/src/app/shell/CommandPalette.tsx`
- Modify: `apps/operator/src/app/components/SyncStatusPill.tsx`
- Delete: `Sidebar.tsx`, `WorkspaceToggle.tsx`, `StatusPills.tsx`, `workspaces.ts`, `workspaces.test.ts` (all in `apps/operator/src/app/shell/`)

**Interfaces:**
- Consumes: everything from `areas.ts` (Task 11), `AreaTabs`, `StatusDot`, `Pill`, `AnchoredPopover`, `ProjectSwitcher`, `AccountMenu`, `useShellChrome`.
- Produces:
  - `enterArea(router: { push: (r: string) => void }, id: AreaId, cloud: boolean): void`, exported from `TopBar.tsx`. It navigates to `localStorage[lastRouteKey(id)] ?? defaultRouteFor(id, cloud)`.
  - `TopBar()`, `SubNav(props: { area: AreaId })`, `StatusBar()`.

- [ ] **Step 1: `SyncStatusPill` follows the dots-not-pills rule** — replace its final `return (...)` with:

```tsx
  if (tone === "warn" || tone === "bad") {
    return (
      <Pill tone={tone} title={title}>
        {label}
      </Pill>
    );
  }
  return <StatusDot tone={tone} label={label} title={title} />;
```

Import `StatusDot` alongside `Pill`. This also drops the `⇅` glyph and the `uppercase` prop.

- [ ] **Step 2: Create `StatusBar.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Pill, StatusDot, colors, type PillTone } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { SyncStatusPill } from "@/app/components/SyncStatusPill";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";

export function StatusBar() {
  if (isCloudMode()) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <SyncStatusPill />
      <SttDot />
      <ServerDot />
    </div>
  );
}

function ServerDot() {
  const conn = useStore((s) => s.conn);
  const [port, setPort] = useState("");
  useEffect(() => {
    try {
      const url = new URL(getClient().getUrl());
      setPort(url.port || (url.protocol === "wss:" ? "443" : "80"));
    } catch {
      // ignore parse errors — fall back to no port
    }
  }, [conn]);
  if (conn === "closed") return <Pill tone="bad">Disconnected</Pill>;
  return (
    <StatusDot
      tone={conn === "open" ? "good" : "warn"}
      label={`Server${port ? ` :${port}` : ""}`}
      title={conn === "open" ? "Connected" : "Connecting…"}
    />
  );
}

const STT_TONES: Record<string, PillTone> = { idle: "dim", starting: "warn", running: "good", stopped: "dim", error: "bad" };

function SttDot() {
  const { send } = useWs();
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  if (!status) return null;
  const tone = STT_TONES[status.state] ?? "dim";
  const running = status.state === "running" || status.state === "starting";
  return (
    <span ref={anchorRef}>
      {tone === "bad" ? (
        <span onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }} title={status.lastError ?? undefined}>
          <Pill tone="bad">STT error</Pill>
        </span>
      ) : (
        <StatusDot tone={tone} label="STT" title={`STT: ${status.state}`} onClick={() => setOpen((v) => !v)} />
      )}
      {open && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setOpen(false)} width={220}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <div style={{ color: colors.textDim }}>Speech-to-text: {status.state}</div>
            {running ? (
              <Button size="sm" onClick={() => { send({ type: "stt_spawner_stop" }); setOpen(false); }}>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!config}
                title={config ? undefined : "Configure STT in Settings first"}
                onClick={() => { if (config) send({ type: "stt_spawner_start", config }); setOpen(false); }}
              >
                Start
              </Button>
            )}
            <Link href="/settings/stt" onClick={() => setOpen(false)} style={{ color: colors.textDim }}>
              Speech-to-text settings
            </Link>
          </div>
        </AnchoredPopover>
      )}
    </span>
  );
}
```

Check the store field names: `grep -n "sttSpawnerConfig\|sttSpawnerStatus" apps/operator/src/lib/store.ts`. Also check whether `stt_spawner_start`'s `config` type accepts the stored config as-is: `grep -rn "stt_spawner_start" packages/ws-protocol/src`. If the store type is nullable or differs, narrow it to match. The STT page sends `config: draft!`, where `draft` is a copy of `sttSpawnerConfig`.

- [ ] **Step 3: Create `SubNav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors, fontWeight } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { AccountMenu } from "@/app/components/AccountMenu";
import { destinationsFor, type AreaId } from "./areas";

function isActive(pathname: string, route: string): boolean {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(route + "/");
}

/** Left sub-nav for Library and Settings. Live has none. */
export function SubNav({ area }: { area: AreaId }) {
  const pathname = usePathname() ?? "/";
  const items = destinationsFor(area, isCloudMode());
  return (
    <aside
      style={{
        width: 168,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
        gap: 2,
      }}
    >
      {items.map((d) => {
        const on = isActive(pathname, d.route);
        const Icon = d.icon;
        return (
          <Link
            key={d.route}
            href={d.route}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 9px",
              borderRadius: 7,
              textDecoration: "none",
              fontWeight: fontWeight.medium,
              color: on ? colors.text : colors.textDim,
              background: on ? colors.brandSubtle : "transparent",
            }}
          >
            <Icon size={16} aria-hidden />
            {d.label}
          </Link>
        );
      })}
      {area === "settings" && (
        <>
          <div style={{ flex: 1 }} />
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
            <AccountMenu />
          </div>
        </>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Create `TopBar.tsx`**

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { AreaTabs, colors } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { ProjectSwitcher } from "@/app/components/ProjectSwitcher";
import { useShellChrome } from "./ShellChromeContext";
import { StatusBar } from "./StatusBar";
import { AREAS, areasFor, defaultRouteFor, lastRouteKey, routeToArea, type AreaId } from "./areas";

/** Navigate to an area's last-visited route, falling back to its default. */
export function enterArea(router: { push: (r: string) => void }, id: AreaId, cloud: boolean): void {
  const saved = typeof window !== "undefined" ? localStorage.getItem(lastRouteKey(id)) : null;
  router.push(saved || defaultRouteFor(id, cloud));
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const cloud = isCloudMode();
  const area = routeToArea(pathname);
  const chrome = useShellChrome();
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 40,
        padding: "0 12px",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
      }}
    >
      <AreaTabs
        items={areasFor(cloud).map((id) => ({ id, label: AREAS[id].label, tone: id === "live" ? "onair" : "brand" }))}
        active={area}
        onSelect={(id) => {
          if (id !== area) enterArea(router, id, cloud);
        }}
      />
      {chrome.title !== undefined && <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{chrome.title}</h1>}
      {chrome.context && (
        <div style={{ color: colors.textDim, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>{chrome.context}</div>
      )}
      <ProjectSwitcher />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {chrome.actions}
        <StatusBar />
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Rewrite `AppShell.tsx`**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { ShellChromeProvider } from "./ShellChromeContext";
import { SubNav } from "./SubNav";
import { TopBar } from "./TopBar";
import { LAST_NON_LIVE_KEY, lastRouteKey, routeToArea } from "./areas";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellChromeProvider>
      <ShellFrame>{children}</ShellFrame>
    </ShellChromeProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const area = routeToArea(pathname);

  // Remember where you were in each area (tabs return there) and the last
  // non-live route (⌘⇧L returns there from Live).
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(lastRouteKey(area), pathname);
    if (area !== "live") localStorage.setItem(LAST_NON_LIVE_KEY, pathname);
  }, [area, pathname]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden" }}>
      <TopBar />
      <div style={{ display: "flex", minHeight: 0 }}>
        {area !== "live" && <SubNav area={area} />}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
      <CommandPalette />
    </div>
  );
}
```

- [ ] **Step 6: Update `CommandPalette.tsx`**

Replace its workspace imports with:

```ts
import { enterArea } from "./TopBar";
import { AREAS, LAST_NON_LIVE_KEY, areasFor, destinationsFor, liveToggleTarget, routeToArea } from "./areas";
```

Replace the ⌘⇧L branch body with:

```ts
        e.preventDefault();
        setOpen(false);
        const cloud = isCloudMode();
        const last = typeof window !== "undefined" ? localStorage.getItem(LAST_NON_LIVE_KEY) : null;
        router.push(liveToggleTarget(routeToArea(pathname), last, cloud));
```

Replace the `commands` memo body with:

```ts
    const cloud = isCloudMode();
    const nav: Command[] = areasFor(cloud).flatMap((id) =>
      destinationsFor(id, cloud).map((d) => ({
        label: `${AREAS[id].label} · ${d.label}`,
        run: () => router.push(d.route),
      })),
    );
    const actions: Command[] = areasFor(cloud).map((id) => ({
      label: `Go to ${AREAS[id].label}`,
      run: () => enterArea(router, id, cloud),
    }));
    return [...nav, ...actions];
```

- [ ] **Step 7: Delete the old shell files**

```bash
git rm apps/operator/src/app/shell/Sidebar.tsx apps/operator/src/app/shell/WorkspaceToggle.tsx apps/operator/src/app/shell/StatusPills.tsx apps/operator/src/app/shell/workspaces.ts apps/operator/src/app/shell/workspaces.test.ts
```

Run: `grep -rn "workspaces\|WorkspaceToggle\|StatusPills\|Sidebar\b\|enterWorkspace" apps/operator/src`
Expected: no matches.

- [ ] **Step 8: Typecheck, tests, both builds**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test && pnpm --filter @overlaysys/operator build:static && pnpm --filter @overlaysys/operator build:cloud`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A apps/operator/src/app/shell apps/operator/src/app/components/SyncStatusPill.tsx
git commit -m "feat(operator): Live/Library/Settings top-bar shell replaces sidebar and Live/Prep toggle"
```

---

### Task 13: Move Channels and STT setup under `/settings`

**Files:**
- Move: `apps/operator/src/app/channels/page.tsx` → `apps/operator/src/app/settings/channels/page.tsx`
- Move: `apps/operator/src/app/stt/page.tsx` → `apps/operator/src/app/settings/stt/page.tsx`
- Create: new `apps/operator/src/app/channels/page.tsx` and `apps/operator/src/app/stt/page.tsx` (redirect stubs)
- Create: `apps/operator/src/app/settings/page.tsx` (redirect to the default Settings route)
- Modify: `apps/operator/src/lib/useResolvedChannels.ts` (comment only)

**Interfaces:**
- Consumes: `RouteRedirect` (Task 9), `LEGACY_REDIRECTS`, `defaultRouteFor` (Task 11).

- [ ] **Step 1: Move the pages with history**

```bash
mkdir -p apps/operator/src/app/settings/channels apps/operator/src/app/settings/stt
git mv apps/operator/src/app/channels/page.tsx apps/operator/src/app/settings/channels/page.tsx
git mv apps/operator/src/app/stt/page.tsx apps/operator/src/app/settings/stt/page.tsx
```

- [ ] **Step 2: Add the redirect stubs**

`apps/operator/src/app/channels/page.tsx`:

```tsx
"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { LEGACY_REDIRECTS } from "@/app/shell/areas";

export default function ChannelsRedirect() {
  return <RouteRedirect to={LEGACY_REDIRECTS["/channels"]!} />;
}
```

`apps/operator/src/app/stt/page.tsx`:

```tsx
"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { LEGACY_REDIRECTS } from "@/app/shell/areas";

export default function SttRedirect() {
  return <RouteRedirect to={LEGACY_REDIRECTS["/stt"]!} />;
}
```

`apps/operator/src/app/settings/page.tsx`:

```tsx
"use client";

import { RouteRedirect } from "@/app/components/RouteRedirect";
import { defaultRouteFor } from "@/app/shell/areas";
import { isCloudMode } from "@/lib/mode";

export default function SettingsIndex() {
  return <RouteRedirect to={defaultRouteFor("settings", isCloudMode())} />;
}
```

Also switch `app/timer/page.tsx` to `LEGACY_REDIRECTS["/timer"]!` for consistency.

- [ ] **Step 3: Fix references to the old routes**

Run: `grep -rn '"/channels"\|"/stt"\|href="/stt\|href="/channels' apps/operator/src`
Expected: only the redirect stubs and `areas.ts`. Change any other hit to the `/settings/...` route. Update the two comment mentions of `/channels` in `lib/useResolvedChannels.ts` to `/settings/channels`. In the moved pages, check for `pathname === "/stt"`-style checks (`grep -n '"/stt\|"/channels' apps/operator/src/app/settings`) and update them.

- [ ] **Step 4: Typecheck, tests, builds**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test && pnpm --filter @overlaysys/operator build:static && pnpm --filter @overlaysys/operator build:cloud`
Expected: all pass. `out/settings/channels/index.html`, `out/settings/stt/index.html`, `out/channels/index.html` and `out/stt/index.html` exist in the static export.

- [ ] **Step 5: Manual verification (desktop app, `pnpm desktop`)**

- [ ] **Tabs:**
  - [ ] Live / Library / Settings switch areas.
  - [ ] Each tab returns to the last page you were on in that area.
  - [ ] Live has no sub-nav; Library and Settings do.
- [ ] **⌘⇧L:**
  - [ ] From Songs goes to Live.
  - [ ] From Live goes back to Songs.
- [ ] **⌘K palette:** lists "Library · Songs", "Settings · Speech-to-text", "Go to Live", etc.
- [ ] **Old URLs:** `/channels`, `/stt`, `/timer` and `/settings` all land on the right page.
- [ ] **Status dots:**
  - [ ] Server shows green with the port.
  - [ ] Stopping the server shows a "Disconnected" pill.
  - [ ] The STT dot opens a menu with Start/Stop and a settings link; Esc closes it without clearing PGM.
- [ ] **Settings sub-nav:** shows the Account menu at the bottom.
- [ ] **Cloud build** (`pnpm --filter @overlaysys/operator build:cloud` then serve `out/`, or `NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE=true pnpm --filter @overlaysys/operator dev`):
  - [ ] No Live tab.
  - [ ] Settings shows Data / Projects / Account only.
  - [ ] `/` goes to `/shows`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/operator/src/app/channels apps/operator/src/app/stt apps/operator/src/app/settings apps/operator/src/app/timer apps/operator/src/lib/useResolvedChannels.ts
git commit -m "feat(operator): move channel and STT setup under /settings with redirects"
```

---

# Phase 4 — Polish

### Task 14: Apply the visual rules across Library and Settings

**Files** (each a contained edit; no logic changes):
- Modify: `apps/operator/src/app/design/edit/page.tsx`, `apps/operator/src/app/hotcards/edit/page.tsx`, `apps/operator/src/app/shows/edit/page.tsx`, `apps/operator/src/app/settings/channels/page.tsx`, `apps/operator/src/app/components/SongModePanel.tsx`, `apps/operator/src/app/components/ActiveTimersPanel.tsx`, `apps/operator/src/app/components/TimerPanel.tsx` — uppercase letter-spaced `<h3>` headers.
- Modify: `apps/operator/src/app/shows/edit/page.tsx`, `apps/operator/src/app/shows/edit/SongsInShowPanel.tsx`, `apps/operator/src/app/songs/edit/page.tsx`, `apps/operator/src/app/components/SongModePanel.tsx`, `apps/operator/src/app/components/AccountMenu.tsx`, `apps/operator/src/app/components/CloudSignInButton.tsx` — emoji used as icons.
- Modify: `packages/ui/src/EntityList.tsx` and/or `apps/operator/src/app/components/ManagementList.tsx` — row actions on hover.

**Interfaces:**
- Consumes: `PanelHeader`, `StatusDot`, lucide icons.

- [ ] **Step 1: Headers** — find the uppercase headers:

Run: `grep -rn "letterSpacing: 1.2" apps/operator/src/app`

For each hit that is a section/panel heading (an `<h3>`/`<div>` whose style also has `textTransform: "uppercase"`):
- If it sits at the top of a panel, replace the element with `<PanelHeader title="<Sentence case text>" right={…existing right-side controls…} />`.
- Otherwise, drop `textTransform: "uppercase"` and `letterSpacing: 1.2`, and set `fontSize: 11, fontWeight: 600, color: colors.textDim`.

Write the heading text in sentence case ("Active timers", not "ACTIVE TIMERS"). Leave the PGM/PVW monitor labels in `Monitors.tsx` as they are.

- [ ] **Step 2: Emoji icons → lucide** — apply this mapping wherever the glyph is used as an icon (a JSX text node or `aria-hidden` span). Leave arrows (`→`, `←`) inside sentences and code comments alone.

| Glyph | lucide component |
|---|---|
| `♪` | `Music` |
| `📖` | `BookOpen` |
| `🎬` | `Film` |
| `🎤` | `Mic` |
| `☁` | `Cloud` |
| `⚠` | `TriangleAlert` |
| `✓` | `Check` |
| `✕` | `X` |
| `▾` / `▸` (disclosure) | `ChevronDown` / `ChevronRight` |
| `▶` (on a button) | drop the glyph; keep the text |

Use `size={14}` inline and `aria-hidden`.

Run afterwards: `grep -rnP "[\x{1F300}-\x{1FAFF}]|[♪☁⚠✓✕▾▸▶]" apps/operator/src/app --include=*.tsx`
Expected: only hits inside comments or string literals that aren't rendered as icons. Review each remaining hit by eye.

- [ ] **Step 3: Pills → dots for non-warning status**

Run: `grep -rn "<Pill" apps/operator/src/app`

For each `Pill` whose `tone` is `good`, `dim`, `neutral`, `ready` or `off`, replace it with `<StatusDot tone={…} label={…} />`. Keep `warn`, `bad` and `live` as `Pill`.

- [ ] **Step 4: Hover-only row actions in list views** — in the list component that renders per-row action buttons (`packages/ui/src/EntityList.tsx` `EntityRow` and/or `ManagementList.tsx`):
- Wrap the actions container in a `div` with `className="row-actions"`.
- Add this once to `apps/operator/src/app/globals.css`:

```css
[role="listitem"] .row-actions,
tr .row-actions { opacity: 0; transition: opacity 120ms; }
[role="listitem"]:hover .row-actions,
[role="listitem"]:focus-within .row-actions,
tr:hover .row-actions,
tr:focus-within .row-actions { opacity: 1; }
```

Make sure the row element is a `tr` or has `role="listitem"`.

- [ ] **Step 5: Typecheck, tests, builds**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm test && pnpm --filter @overlaysys/operator build:static`
Expected: all pass.

- [ ] **Step 6: Manual pass** — open each Library and Settings page:
- [ ] Headers are sentence case.
- [ ] No emoji icons remain.
- [ ] Status shows as dots except warnings and errors.
- [ ] List row actions appear on hover and on keyboard focus.
- [ ] Nothing that worked before is broken: create/edit/delete one show, song, design and hotcard.

- [ ] **Step 7: Commit**

```bash
git add -A apps/operator/src packages/ui/src
git commit -m "style(operator): sentence-case headers, lucide icons, dots for status, hover row actions"
```

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| 1. Shell: top bar, AreaTabs, PageChrome slots, StatusDots, AccountMenu → Settings | 1, 12 |
| 1. Areas/routes table, redirects, `areas.ts`, ⌘⇧L, cloud build | 11, 12, 13 |
| 1. Timer → popover + rail; Channels → dots/menu + `/settings/channels`; STT → dot menu + `/settings/stt` | 8, 9, 12, 13 |
| 2. Rundown list-only, colour bars, hover actions | 5 (hover actions for Library lists in 14) |
| 2. Monitors with rings, shrink in song mode | 7, 10 |
| 2. Stage area table + Quick take + one hint line | 3, 6 |
| 2. Right rail: timers + hotcards | 9 |
| 2. Bottom bar: transport + channel dots/menu | 8 |
| 3. Visual system (lucide, StatusDot, PanelHeader, AreaTabs, space, colour rules, sentence case) | 1, 14 (rules applied throughout) |
| 4. Library/Settings pages | 13, 14 |
| Error handling (disconnected, no show, deleted row, song priority, old bookmarks/keys) | 3, 5, 10, 11, 12, 13 |
| Testing | 2, 3, 8, 11 (unit); 10, 13, 14 (manual) |
