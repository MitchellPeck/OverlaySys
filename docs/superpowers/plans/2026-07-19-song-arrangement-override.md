# Song Arrangement Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator override a song's section arrangement at the show level (`ShowSong.arrangement`) and row level (`SongRow.arrangement`, already in the schema) via one reusable sequence+palette modal, with the cascade row → show → song.

**Architecture:** Add an optional `arrangement` to `ShowSong`; add a pure `resolveArrangement(row, showSong, song)` resolver (row → showSong → song) and use it at the three `ws.ts` take sites; build a reusable `ArrangementModal` opened from `SongRowEditor` (writes `row.arrangement`) and `SongOverrideEditor` (writes `showSong.arrangement`). No DB migration — shows persist as JSON.

**Tech Stack:** TypeScript, Zod, Next.js 15 / React 19, `@overlaysys/ui` `Modal`, Vitest (node).

## Global Constraints

- Cascade is **`row.arrangement ?? showSong?.arrangement ?? song.defaultArrangement`** — the ShowSong layer sits between row and song.
- Clearing an override at a level **deletes that level's field** (`onSave(undefined)` → delete the key), falling back down the cascade.
- A saved arrangement is **always non-empty**; Save is disabled while empty (use Reset instead).
- Arrangement is an ordered list of **section ids that may repeat** — sequence UI must key chips by **position**, not id.
- No change to the song library editor's `defaultArrangement`; no scripture changes; no DB migration; no new persistence wiring (`ShowSong`/`SongRow` ride the existing `save_show` JSON path).
- `pnpm typecheck` + `pnpm test` stay green.
- Commit only each task's own files — never `git add -A`.

---

### Task 1: Core — `ShowSong.arrangement` + `resolveArrangement` + tests

**Files:**
- Modify: `packages/core/src/show.ts` (add field to `ShowSongSchema`)
- Modify: `packages/core/src/songResolution.ts` (add resolver)
- Modify: `packages/core/src/songResolution.test.ts` (add tests)

**Interfaces:**
- Produces: `ShowSong.arrangement?: string[]`; `resolveArrangement(row: SongRow, showSong: ShowSong | undefined, song: Song): string[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/songResolution.test.ts`. It already has `makeSong`, `makeRow` factories and imports from `./songResolution` / `./show`. Add `resolveArrangement` to the import list at the top, then append:

```ts
describe("resolveArrangement", () => {
  const song = makeSong({ defaultArrangement: ["v1", "c", "v2"] });

  it("falls back to song.defaultArrangement when nothing overrides", () => {
    expect(resolveArrangement(makeRow(), undefined, song)).toEqual(["v1", "c", "v2"]);
  });

  it("uses the ShowSong arrangement over the song default", () => {
    const showSong = { songId: "song1", arrangement: ["v1", "c", "c"] } as ShowSong;
    expect(resolveArrangement(makeRow(), showSong, song)).toEqual(["v1", "c", "c"]);
  });

  it("uses the row arrangement over both ShowSong and song", () => {
    const showSong = { songId: "song1", arrangement: ["v1", "c"] } as ShowSong;
    const row = makeRow({ arrangement: ["c", "v2", "c"] });
    expect(resolveArrangement(row, showSong, song)).toEqual(["c", "v2", "c"]);
  });

  it("ignores an undefined level and continues the cascade", () => {
    // row undefined → falls to showSong
    const showSong = { songId: "song1", arrangement: ["v2"] } as ShowSong;
    expect(resolveArrangement(makeRow(), showSong, song)).toEqual(["v2"]);
    // row + showSong undefined → song default
    expect(resolveArrangement(makeRow(), undefined, song)).toEqual(["v1", "c", "v2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/core/src/songResolution.test.ts`
Expected: FAIL — `resolveArrangement` is not exported.

- [ ] **Step 3: Add the schema field**

In `packages/core/src/show.ts`, inside `ShowSongSchema` (after `lyricTemplateId` / `customFieldOverrides`), add:

```ts
  /** Per-show override of the section play order (ordered section ids; may
   *  repeat). Falls back to Song.defaultArrangement. SongRow.arrangement takes
   *  precedence over this. */
  arrangement: z.array(z.string()).optional(),
```

- [ ] **Step 4: Add the resolver**

In `packages/core/src/songResolution.ts`, add (near `resolveSongChannel`):

```ts
/**
 * Resolves the effective section arrangement (ordered section ids) for a song
 * row. Cascade: SongRow.arrangement → ShowSong.arrangement →
 * Song.defaultArrangement. Returned verbatim — may contain repeats; stale ids
 * are tolerated by the runtime song session and filtered by the editor.
 */
export function resolveArrangement(
  row: SongRow,
  showSong: ShowSong | undefined,
  song: Song,
): string[] {
  return row.arrangement ?? showSong?.arrangement ?? song.defaultArrangement;
}
```

(`SongRow`, `ShowSong`, `Song` are already imported in this file.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run packages/core/src/songResolution.test.ts`
Expected: PASS (all resolveArrangement cases + existing tests).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @overlaysys/core typecheck`
Expected: clean.

```bash
git add packages/core/src/show.ts packages/core/src/songResolution.ts packages/core/src/songResolution.test.ts
git commit -m "feat(core): ShowSong.arrangement + resolveArrangement cascade

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server — use `resolveArrangement` at the three `ws.ts` take sites

**Files:**
- Modify: `server/src/ws.ts`

**Interfaces:**
- Consumes: `resolveArrangement` (Task 1).

- [ ] **Step 1: Import the resolver**

In `server/src/ws.ts`, add `resolveArrangement` to the existing import from the core song-resolution module (the block that already imports `resolveIntroTake`, `resolveSongChannel`, etc. around lines 12–14).

- [ ] **Step 2: `song_take` handler (~line 323)**

After the `song` null-check (`const song = await songs.getSong(row.songId); if (!song) …`), add the ShowSong lookup and use the resolver. Change:

```ts
          songSession.start(parsed.channel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: row.arrangement ?? song.defaultArrangement,
            trustMode: row.trustMode ?? false,
          });
```
to:
```ts
          const showSong = show.songs.find((e) => e.songId === row.songId);
          songSession.start(parsed.channel, {
            song,
            lyricTemplateId: row.lyricTemplateId,
            arrangement: resolveArrangement(row, showSong, song),
            trustMode: row.trustMode ?? false,
          });
```

- [ ] **Step 3: `song_take_pvw_to_pgm` handler (~line 347)**

Same edit: after the `song` null-check, add `const showSong = show.songs.find((e) => e.songId === row.songId);` and change `arrangement: row.arrangement ?? song.defaultArrangement` → `arrangement: resolveArrangement(row, showSong, song)`.

- [ ] **Step 4: Sub-take path (~line 473)**

This handler already computes `const showSong = show.songs.find((e) => e.songId === row.songId)` (~line 415). Only change the arrangement expression:
`arrangement: row.arrangement ?? song.defaultArrangement` → `arrangement: resolveArrangement(row, showSong, song)`.

- [ ] **Step 5: Typecheck + tests + commit**

Run: `pnpm --filter @overlaysys/server typecheck && pnpm vitest run server/src`
Expected: clean + existing server tests pass.

```bash
git add server/src/ws.ts
git commit -m "feat(server): resolve song arrangement through the ShowSong layer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Operator — `ArrangementModal` component

**Files:**
- Create: `apps/operator/src/app/shows/edit/ArrangementModal.tsx`

**Interfaces:**
- Produces: `ArrangementModal({ song, level, value, inherited, onSave, onClose })`.
- Consumes: `Modal`, `Button`, `colors` from `@overlaysys/ui`; `Song` from `@overlaysys/core`.

- [ ] **Step 1: Write the component**

Create `apps/operator/src/app/shows/edit/ArrangementModal.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Modal, Button, colors } from "@overlaysys/ui";
import type { Song } from "@overlaysys/core";

// Subtle accent per section kind, matching the app's token palette.
const KIND_ACCENT: Record<string, { bg: string; border: string }> = {
  chorus: { bg: "rgba(99,102,241,.16)", border: "rgba(99,102,241,.5)" },
  bridge: { bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.5)" },
};

/** Compact "V1 · C · V2" summary of an arrangement, reused by both editors. */
export function arrangementSummary(ids: string[], song: Song): string {
  return ids
    .map((id) => song.sections.find((s) => s.id === id)?.label ?? id)
    .join(" · ");
}

export function ArrangementModal({
  song,
  level,
  value,
  inherited,
  onSave,
  onClose,
}: {
  song: Song;
  level: "show" | "row";
  value: string[] | undefined;
  inherited: string[];
  onSave: (next: string[] | undefined) => void;
  onClose: () => void;
}) {
  const validIds = useMemo(() => new Set(song.sections.map((s) => s.id)), [song]);
  const sectionById = useMemo(
    () => new Map(song.sections.map((s) => [s.id, s] as const)),
    [song],
  );

  // Seed from this level's override if present, else the inherited fallback.
  // Filter stale ids (a section may have been deleted from the song since).
  const seed = value ?? inherited;
  const droppedCount = seed.filter((id) => !validIds.has(id)).length;
  const [seq, setSeq] = useState<string[]>(() => seed.filter((id) => validIds.has(id)));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const overriding = value !== undefined;
  const fallbackLabel = level === "show" ? "the song default" : "the show / song default";

  function append(id: string) {
    setSeq((s) => [...s, id]);
  }
  function removeAt(i: number) {
    setSeq((s) => s.filter((_, j) => j !== i));
  }
  function onDrop(target: number) {
    if (dragIdx === null || dragIdx === target) {
      setDragIdx(null);
      return;
    }
    setSeq((s) => {
      const next = [...s];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(target, 0, moved);
      return next;
    });
    setDragIdx(null);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Arrangement — ${level === "show" ? "Show override" : "This row"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {overriding && (
            <Button
              variant="danger"
              onClick={() => {
                onSave(undefined);
                onClose();
              }}
            >
              Reset to inherited
            </Button>
          )}
          <Button
            variant="primary"
            disabled={seq.length === 0}
            onClick={() => {
              onSave(seq);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div
        style={{
          fontSize: 12.5,
          color: colors.textDim,
          background: colors.surface2,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 12,
        }}
      >
        {overriding
          ? `Overriding arrangement at the ${level} level.`
          : `Currently inheriting from ${fallbackLabel}. Editing here creates a ${level}-level override.`}
        {droppedCount > 0 && (
          <span style={{ color: colors.warn }}>
            {" "}
            {droppedCount} section(s) removed — no longer in the song.
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 7,
          alignItems: "center",
          minHeight: 46,
          padding: 10,
          background: colors.bg,
          border: `1px dashed ${colors.borderStrong}`,
          borderRadius: 10,
        }}
      >
        {seq.length === 0 && (
          <span style={{ color: colors.textDim, fontSize: 12.5 }}>
            Empty — add sections below, or{" "}
            <button
              type="button"
              onClick={() => setSeq(inherited.filter((id) => validIds.has(id)))}
              style={{
                background: "none",
                border: "none",
                color: colors.brand,
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
                font: "inherit",
              }}
            >
              start from inherited
            </button>
            .
          </span>
        )}
        {seq.map((id, i) => {
          const sec = sectionById.get(id);
          const accent = sec ? KIND_ACCENT[sec.kind] : undefined;
          return (
            <span
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: accent?.bg ?? colors.surface2,
                border: `1px solid ${accent?.border ?? colors.borderStrong}`,
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              <span style={{ cursor: "grab", color: colors.textMuted }}>⠿</span>
              {sec?.label ?? id}
              <span
                onClick={() => removeAt(i)}
                style={{ cursor: "pointer", color: colors.textMuted, fontWeight: 700 }}
              >
                ×
              </span>
            </span>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
        <span style={{ color: colors.textDim, fontSize: 12 }}>Add:</span>
        {song.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => append(s.id)}
            style={{
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 7,
              border: `1px dashed ${colors.borderStrong}`,
              background: "transparent",
              color: colors.textDim,
              cursor: "pointer",
            }}
          >
            + {s.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: clean. (`colors.bg`, `colors.surface2`, `colors.borderStrong`, `colors.textMuted`, `colors.brand`, `colors.warn` all exist from the Phase-1 token layer.)

```bash
git add apps/operator/src/app/shows/edit/ArrangementModal.tsx
git commit -m "feat(operator): ArrangementModal — sequence+palette arrangement editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Operator — wire the modal into both editors

**Files:**
- Modify: `apps/operator/src/app/shows/edit/page.tsx` (`SongRowEditor`)
- Modify: `apps/operator/src/app/shows/edit/SongOverrideEditor.tsx`

**Interfaces:**
- Consumes: `ArrangementModal` (Task 3), `resolveArrangement` from `@overlaysys/core` (Task 1, for the inline summary).

`arrangementSummary(ids, song)` is exported from `ArrangementModal.tsx` (Task 3) — import it in both editors for the inline summary.

For the "Arrangement…" trigger, use this link-button style in both editors (or reuse the file's existing override-link style if one is already factored out — match whichever the file uses for its other inline links):

```ts
const linkBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: colors.brand,
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
  textDecoration: "underline",
};
```

- [ ] **Step 1: `SongRowEditor` (row level) — `apps/operator/src/app/shows/edit/page.tsx`**

`SongRowEditor` already has `row: SongRow`, `showSong: ShowSong | undefined`, `songCache`, and `patchRow(patch: Partial<SongRow>)`. The song is `songCache[row.songId]` (already read as `cachedSong`). Add:

- Imports at top of the file: `import { ArrangementModal, arrangementSummary } from "./ArrangementModal";` and `resolveArrangement` added to the existing `@overlaysys/core` import.
- Local state in `SongRowEditor`: `const [arrModalOpen, setArrModalOpen] = useState(false);`
- In the row's controls (near the other per-row override controls — inside the `overridesOpen` section or beside the row's buttons), add, guarded by `cachedSong`:

```tsx
{cachedSong && (
  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
    <span style={{ color: colors.textDim }}>Arrangement:</span>
    <span style={{ color: colors.text }}>
      {arrangementSummary(resolveArrangement(row, showSong, cachedSong), cachedSong)}
    </span>
    <button type="button" onClick={() => setArrModalOpen(true)} style={linkBtnStyle}>
      Arrangement…
    </button>
  </div>
)}
{arrModalOpen && cachedSong && (
  <ArrangementModal
    song={cachedSong}
    level="row"
    value={row.arrangement}
    inherited={showSong?.arrangement ?? cachedSong.defaultArrangement}
    onSave={(next) =>
      patchRow(
        next === undefined
          ? ({ arrangement: undefined } as Partial<SongRow>)
          : { arrangement: next },
      )
    }
    onClose={() => setArrModalOpen(false)}
  />
)}
```

Note on delete-vs-set: `patchRow` merges into the row via `onUpdate`. Confirm `patchRow`'s implementation deletes keys whose value is `undefined` (many patch helpers do `Object.assign`, which leaves `arrangement: undefined` — harmless, since the resolver treats `undefined` as "no override"). If `patchRow` uses immer and you want the key physically removed, delete it: `onUpdate((s) => { const r = s.rows.find(...); if (r?.kind === "song") delete r.arrangement; })`. Either behaves identically at resolution time; match the file's existing pattern for the other optional overrides (e.g. how `introTemplateId` clearing is handled — see the `patchRow`/reset code around the intro/outro controls) and mirror it.

Use the file's existing link-button style for `linkBtnStyle` (the "Edit slides…" / override link styling already in the file); if none is factored out, inline the same style object used by those links.

- [ ] **Step 2: `SongOverrideEditor` (show level) — `apps/operator/src/app/shows/edit/SongOverrideEditor.tsx`**

This component has `entry: ShowSong`, `song: Song`, and `onChange(patch: Partial<ShowSong>)`. Add:

- Imports: `import { ArrangementModal, arrangementSummary } from "./ArrangementModal";`, `useState` (if not already), and `resolveArrangement` from `@overlaysys/core`.
- Local state: `const [arrModalOpen, setArrModalOpen] = useState(false);`
- In the editor body (alongside the other override rows), add:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
  <span style={{ color: colors.textDim }}>Arrangement:</span>
  <span style={{ color: colors.text }}>
    {arrangementSummary(resolveArrangement({} as SongRow, entry, song), song)}
  </span>
  <button type="button" onClick={() => setArrModalOpen(true)} style={linkBtnStyle}>
    Arrangement…
  </button>
</div>
{arrModalOpen && (
  <ArrangementModal
    song={song}
    level="show"
    value={entry.arrangement}
    inherited={song.defaultArrangement}
    onSave={(next) => onChange({ arrangement: next })}
    onClose={() => setArrModalOpen(false)}
  />
)}
```

(The `{} as SongRow` for the summary mirrors the existing `dummyRow` pattern already used in this file for `resolveCustomFieldValue` — the row has no arrangement, so the summary reflects show → song. Reuse the existing `dummyRow` if present.)

- [ ] **Step 3: Typecheck + boot check**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: clean.
Boot: `cd apps/operator && (pnpm dev &)`, wait for Ready, `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/shows/edit` → 200, then `pkill -f "next dev"`. (Interactive open/edit/save is verified in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/shows/edit/page.tsx apps/operator/src/app/shows/edit/SongOverrideEditor.tsx apps/operator/src/app/shows/edit/ArrangementModal.tsx
git commit -m "feat(operator): wire arrangement modal into row + show-song editors

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Typecheck + test**

Run: `pnpm typecheck` (all packages clean) and `pnpm test` (all green, including the new `resolveArrangement` cases).

- [ ] **Step 2: Visual/interactive walk (`/run`)**

Launch the operator, open a show with a song row:
- From the **row**: click "Arrangement…", add / reorder (drag) / remove / repeat a section (e.g. add Chorus twice), Save; confirm the inline summary updates; reopen and confirm it persisted; click "Reset to inherited" and confirm the row falls back.
- From the **Song override panel**: same flow at the show level; confirm a row with no row-level override reflects the show arrangement in its summary, and a row with its own override wins.
- Take the song and confirm it plays the overridden section order.
Note any issue and fix on the relevant file, then re-run Step 1.

- [ ] **Step 3: Commit (only if Step 2 required fixes)**

```bash
git add apps/operator/src/app/shows/edit
git commit -m "fix(operator): resolve arrangement-editor issues from verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes on testing approach

The cascade logic (`resolveArrangement`) is pure and unit-tested in the node harness (Task 1) — the real regression guard. The modal + editor wiring is interactive React (no jsdom), verified by typecheck + the real-app boot/walk (Task 5), consistent with the rest of this codebase.
