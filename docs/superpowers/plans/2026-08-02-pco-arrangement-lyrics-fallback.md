# PCO Arrangement Lyrics Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Planning Center plan item's arrangement carries no lyrics, import the lyrics from another arrangement of the same PCO song that does.

**Architecture:** A pure selection rule and an `effectiveLyricsArrangement(item)` accessor land in `packages/core`. `pcoClient.getPlanItems` calls a new `listSongArrangements` only for song items that came back without lyrics, and stashes the winner on `PcoPlanItem.lyricsArrangement`. The two places that build a `Song` from an arrangement switch to the accessor — `buildImportedSong` itself is untouched, because it already takes the arrangement as a parameter and already writes the `pco_arrangement_id` stamp from whatever it is given.

**Tech Stack:** TypeScript, pnpm workspaces + turbo, Zod (schemas in `packages/core`), Vitest (node environment), React 19 / Next.js static export for `apps/operator`, Fastify for `server`.

## Global Constraints

- Run tests with `pnpm test` from the repo root. A single file: `pnpm vitest run <path>`. Typecheck: `pnpm typecheck`.
- Do **NOT** run `pnpm lint` — only `apps/operator` defines a lint script, it shells out to `next lint`, and it prompts interactively for an ESLint config. `pnpm test` + `pnpm typecheck` are the gates.
- Vitest collects `packages/*/src/**/*.test.ts`, `server/src/**/*.test.ts`, `apps/desktop/src/**/*.test.ts`, `apps/operator/src/**/*.test.ts`. **`.tsx` files are NEVER collected** and there is no React component test harness. Logic that must be tested belongs in a `.ts` file.
- `packages/core` is pure: no I/O, no React, no server imports, fully deterministic.
- Baseline before Task 1: **625 tests passing across 51 files**, `pnpm typecheck` clean across 13 packages. Do not regress either.
- Selection rule, fixed: the first arrangement with non-empty `lyrics`, in the order PCO returns them, excluding the item's own arrangement. No preference ordering.
- Provenance: `customFields.pco_arrangement_id` must record the arrangement the lyrics actually came from, never the item's when a fallback was used.
- Match surrounding style: named exports, JSDoc block comments explaining *why* on non-obvious logic.
- Commit per task on the current branch. End every commit message body with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- The working tree contains unrelated in-flight edits by another author (`apps/operator/src/lib/useWs.ts`, `apps/operator/src/lib/useWs.test.ts`, `packages/companion-module/*`, `packages/core/src/showSchedule*`). Never `git add -A` or `git add .` — add only the exact paths each task names. Do not stash, revert, or touch those files.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/pco/pcoTypes.ts` (modify) | `PcoPlanItem.lyricsArrangement` | 1 |
| `packages/core/src/pco/mapPlanItems.ts` (modify) | `pickLyricsArrangement`, `effectiveLyricsArrangement`, `ItemPreview.lyricsFromArrangement`, `buildItemPreview` update | 1 |
| `packages/core/src/pco/mapPlanItems.test.ts` (modify) | Tests for all of the above | 1 |
| `server/src/pco/pcoClient.ts` (modify) | `listSongArrangements`, shared arrangement parser, conditional fallback fetch | 2 |
| `server/src/pco/pcoClient.test.ts` (create) | First test file for this client, via the injectable `fetchImpl` | 2 |
| `server/src/pco/importPlan.ts` (modify) | Both import branches use the effective arrangement | 3 |
| `server/src/pco/importPlan.test.ts` (modify) | Fallback lyrics + stamp, in both branches | 3 |
| `apps/operator/src/app/pco/page.tsx` (modify) | Draft builder uses the effective arrangement; "lyrics from X" label | 4 |

Order: 1 → 2 (2 consumes `pickLyricsArrangement`), 1 → 3, 1 → 4. Tasks 3 and 4 are independent of each other.

---

### Task 1: Core — selection rule, accessor, preview

**Files:**
- Modify: `packages/core/src/pco/pcoTypes.ts` (the `PcoPlanItemSchema` object, currently ending with `arrangement: PcoArrangementSchema.optional(),`)
- Modify: `packages/core/src/pco/mapPlanItems.ts` (add near `buildImportedSong`; update `ItemPreview` and `buildItemPreview` at the end of the file)
- Modify: `packages/core/src/pco/mapPlanItems.test.ts`

**Interfaces:**
- Produces:
  - `PcoPlanItem.lyricsArrangement?: PcoArrangement`
  - `pickLyricsArrangement(arrangements: PcoArrangement[], excludeId?: string): PcoArrangement | undefined`
  - `effectiveLyricsArrangement(item: PcoPlanItem): PcoArrangement | undefined`
  - `ItemPreview.lyricsFromArrangement?: string`

Background you need: `buildImportedSong(id, pcoSong, arrangement, opts)` already writes `customFields[PCO_ARRANGEMENT_ID_KEY] = arrangement.id` from whatever arrangement it is handed (`mapPlanItems.ts:165`). That is why passing the effective arrangement is sufficient for provenance in the non-draft path, and why this task adds no change there.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/pco/mapPlanItems.test.ts`. Add `effectiveLyricsArrangement` and `pickLyricsArrangement` to the existing import list from `./mapPlanItems`, and add `type PcoArrangement` to the type import from `./pcoTypes`.

```ts
describe("pickLyricsArrangement", () => {
  const empty: PcoArrangement = { id: "a1", name: "Default", lyrics: "" };
  const blank: PcoArrangement = { id: "a2", name: "Blank", lyrics: "   \n  " };
  const full: PcoArrangement = { id: "a3", name: "Acoustic in G", lyrics: "Verse 1\nline" };
  const alsoFull: PcoArrangement = { id: "a4", name: "Band", lyrics: "Chorus\nother" };

  it("returns the first arrangement with non-empty lyrics", () => {
    expect(pickLyricsArrangement([empty, full, alsoFull])?.id).toBe("a3");
  });

  it("treats whitespace-only lyrics as empty", () => {
    expect(pickLyricsArrangement([blank, full])?.id).toBe("a3");
  });

  it("skips the excluded arrangement even when it has lyrics", () => {
    expect(pickLyricsArrangement([full, alsoFull], "a3")?.id).toBe("a4");
  });

  it("returns undefined when nothing has lyrics", () => {
    expect(pickLyricsArrangement([empty, blank])).toBeUndefined();
    expect(pickLyricsArrangement([])).toBeUndefined();
  });
});

describe("effectiveLyricsArrangement", () => {
  const own: PcoArrangement = { id: "own", lyrics: "Verse 1\nmine" };
  const fallback: PcoArrangement = { id: "fb", name: "Acoustic", lyrics: "Verse 1\ntheirs" };

  it("prefers the fallback when one was resolved", () => {
    const item: PcoPlanItem = {
      id: "i", title: "T", itemType: "song",
      song: { id: "p", title: "T" },
      arrangement: { id: "own", lyrics: "" },
      lyricsArrangement: fallback,
    };
    expect(effectiveLyricsArrangement(item)?.id).toBe("fb");
  });

  it("falls back to the item's own arrangement", () => {
    const item: PcoPlanItem = {
      id: "i", title: "T", itemType: "song",
      song: { id: "p", title: "T" }, arrangement: own,
    };
    expect(effectiveLyricsArrangement(item)?.id).toBe("own");
  });

  it("returns undefined when the item has neither", () => {
    expect(effectiveLyricsArrangement({ id: "i", title: "T", itemType: "header" })).toBeUndefined();
  });
});

describe("buildItemPreview with a lyrics fallback", () => {
  const lib: Song[] = [];
  const base = {
    id: "i1", title: "New Song", itemType: "song" as const,
    song: { id: "p1", title: "New Song" },
  };

  it("reports hasLyrics and names the source arrangement", () => {
    const p = buildItemPreview(
      { ...base, arrangement: { id: "own", lyrics: "" },
        lyricsArrangement: { id: "fb", name: "Acoustic in G", lyrics: "Verse 1\nx" } },
      lib,
    );
    expect(p.hasLyrics).toBe(true);
    expect(p.lyricsFromArrangement).toBe("Acoustic in G");
  });

  it("falls back to the arrangement id when it has no name", () => {
    const p = buildItemPreview(
      { ...base, arrangement: { id: "own", lyrics: "" },
        lyricsArrangement: { id: "fb-id", lyrics: "Verse 1\nx" } },
      lib,
    );
    expect(p.lyricsFromArrangement).toBe("fb-id");
  });

  it("omits lyricsFromArrangement when the item's own arrangement has lyrics", () => {
    const p = buildItemPreview({ ...base, arrangement: { id: "own", lyrics: "Verse 1\nx" } }, lib);
    expect(p.hasLyrics).toBe(true);
    expect(p.lyricsFromArrangement).toBeUndefined();
  });

  it("reports hasLyrics false when neither arrangement has any", () => {
    const p = buildItemPreview({ ...base, arrangement: { id: "own", lyrics: "" } }, lib);
    expect(p.hasLyrics).toBe(false);
    expect(p.lyricsFromArrangement).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/src/pco/mapPlanItems.test.ts`
Expected: FAIL — `pickLyricsArrangement is not a function`, and the `lyricsArrangement` property errors under typecheck.

- [ ] **Step 3: Add the schema field**

In `packages/core/src/pco/pcoTypes.ts`, inside `PcoPlanItemSchema`, immediately after the existing `arrangement: PcoArrangementSchema.optional(),` line:

```ts
  /**
   * An arrangement of the same PCO song that carries lyrics, resolved by the
   * client when the item's own `arrangement` has none. Absent when the item's
   * arrangement has lyrics, or when no sibling arrangement has any either.
   */
  lyricsArrangement: PcoArrangementSchema.optional(),
```

- [ ] **Step 4: Add the selection rule and accessor**

In `packages/core/src/pco/mapPlanItems.ts`, immediately above `export function buildImportedSong`:

```ts
function hasLyricText(arrangement: PcoArrangement | undefined): boolean {
  return !!arrangement?.lyrics && arrangement.lyrics.trim() !== "";
}

/**
 * Choose the arrangement to take lyrics from out of a song's arrangements.
 * First one with non-empty lyrics wins, in PCO's returned order — there is no
 * preference ordering, because PCO exposes nothing that reliably marks an
 * arrangement as canonical. `excludeId` skips the plan item's own arrangement,
 * which the caller has already established is empty.
 */
export function pickLyricsArrangement(
  arrangements: PcoArrangement[],
  excludeId?: string,
): PcoArrangement | undefined {
  return arrangements.find((a) => a.id !== excludeId && hasLyricText(a));
}

/**
 * The arrangement a caller should read lyrics (and sequence) from. Sequence
 * travels with lyrics deliberately: `reorderArrangementBySequence` matches
 * sequence labels against parsed section labels, so pairing one arrangement's
 * sequence with another's sections would silently produce a wrong section
 * order rather than an error.
 */
export function effectiveLyricsArrangement(
  item: PcoPlanItem,
): PcoArrangement | undefined {
  return item.lyricsArrangement ?? item.arrangement;
}
```

Add `PcoArrangement` to the existing `import type { PcoArrangement, PcoPlanItem, PcoSong } from "./pcoTypes";` line if it is not already there.

- [ ] **Step 5: Update the preview**

In the same file, add to the `ItemPreview` interface, after the `hasLyrics` field:

```ts
  /**
   * Set only when the lyrics came from a DIFFERENT arrangement than the one
   * the plan item references — the source arrangement's name, or its id when
   * unnamed. The import UI surfaces this so a substitution is never silent.
   */
  lyricsFromArrangement?: string;
```

Then replace the `return` block at the end of `buildItemPreview`:

```ts
  const match = matchLibrarySong(item.song, library);
  const lyricsArrangement = effectiveLyricsArrangement(item);
  const hasLyrics = hasLyricText(lyricsArrangement);
  return {
    ...base,
    ...(match
      ? {
          match: {
            songId: match.song.id,
            title: match.song.title,
            confidence: match.confidence,
          },
        }
      : { willCreateSong: true }),
    hasLyrics,
    ...(hasLyrics && item.lyricsArrangement
      ? {
          lyricsFromArrangement:
            item.lyricsArrangement.name ?? item.lyricsArrangement.id,
        }
      : {}),
  };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core/src/pco/mapPlanItems.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 7: Full gates + commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Test count rises from 625 to 636.

```bash
git add packages/core/src/pco/pcoTypes.ts packages/core/src/pco/mapPlanItems.ts packages/core/src/pco/mapPlanItems.test.ts
git commit -m "feat(core): resolve lyrics from a sibling PCO arrangement"
```

---

### Task 2: Client — fetch sibling arrangements when lyrics are missing

**Files:**
- Modify: `server/src/pco/pcoClient.ts` (the `PcoClient` interface near the top; the arrangement parsing inside `getPlanItems`; the returned object)
- Create: `server/src/pco/pcoClient.test.ts`

**Interfaces:**
- Consumes: `pickLyricsArrangement(arrangements, excludeId?)` from Task 1.
- Produces: `PcoClient.listSongArrangements(songId: string): Promise<PcoArrangement[]>`, and `getPlanItems` now populating `item.lyricsArrangement`.

Background you need: `createPcoClient(authorization, fetchImpl)` takes an injectable `fetchImpl` defaulting to global `fetch` — that is the seam your tests use, no network required. Its internal `getAll(pathOrUrl)` follows JSON:API `links.next` pagination and retries 429s, returning `{ data, included }`. `str(v)` normalizes a value to `string | undefined`, treating `""` as undefined.

- [ ] **Step 1: Write the failing test**

Create `server/src/pco/pcoClient.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createPcoClient } from "./pcoClient";

/** Minimal JSON:API responder keyed by URL substring. */
function stubFetch(routes: Record<string, unknown>): {
  impl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => routes[key],
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ITEMS_ROUTE = "/plans/plan-1/items";
const ARRANGEMENTS_ROUTE = "/songs/song-1/arrangements";

function itemsDoc(arrangementLyrics: string) {
  return {
    data: [
      {
        type: "Item",
        id: "item-1",
        attributes: { title: "Amazing Grace", sequence: 1, item_type: "song" },
        relationships: {
          song: { data: { type: "Song", id: "song-1" } },
          arrangement: { data: { type: "Arrangement", id: "arr-own" } },
        },
      },
    ],
    included: [
      { type: "Song", id: "song-1", attributes: { title: "Amazing Grace" } },
      {
        type: "Arrangement",
        id: "arr-own",
        attributes: { name: "Default", lyrics: arrangementLyrics },
      },
    ],
  };
}

describe("getPlanItems lyrics fallback", () => {
  it("does not fetch arrangements when the item's own has lyrics", async () => {
    const { impl, calls } = stubFetch({ [ITEMS_ROUTE]: itemsDoc("Verse 1\nmine") });
    const client = createPcoClient("Bearer x", impl);

    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items[0]?.lyricsArrangement).toBeUndefined();
    expect(calls.some((c) => c.includes("/arrangements"))).toBe(false);
  });

  it("falls back to a sibling arrangement that has lyrics", async () => {
    const { impl } = stubFetch({
      [ITEMS_ROUTE]: itemsDoc(""),
      [ARRANGEMENTS_ROUTE]: {
        data: [
          { type: "Arrangement", id: "arr-own", attributes: { name: "Default", lyrics: "" } },
          {
            type: "Arrangement",
            id: "arr-acoustic",
            attributes: { name: "Acoustic in G", lyrics: "Verse 1\ntheirs", sequence: ["Verse 1"] },
          },
        ],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    const items = await client.getPlanItems("st-1", "plan-1");

    expect(items[0]?.lyricsArrangement?.id).toBe("arr-acoustic");
    expect(items[0]?.lyricsArrangement?.sequence).toEqual(["Verse 1"]);
    // The item's own arrangement is still reported truthfully.
    expect(items[0]?.arrangement?.id).toBe("arr-own");
  });

  it("leaves lyricsArrangement unset when no sibling has lyrics", async () => {
    const { impl } = stubFetch({
      [ITEMS_ROUTE]: itemsDoc(""),
      [ARRANGEMENTS_ROUTE]: {
        data: [{ type: "Arrangement", id: "arr-own", attributes: { lyrics: "" } }],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    expect((await client.getPlanItems("st-1", "plan-1"))[0]?.lyricsArrangement).toBeUndefined();
  });

  it("listSongArrangements parses name, lyrics and sequence", async () => {
    const { impl } = stubFetch({
      [ARRANGEMENTS_ROUTE]: {
        data: [
          {
            type: "Arrangement",
            id: "arr-1",
            attributes: { name: "Band", lyrics: "Chorus\nx", sequence: ["Chorus"] },
          },
        ],
      },
    });
    const client = createPcoClient("Bearer x", impl);

    const arrangements = await client.listSongArrangements("song-1");

    expect(arrangements).toEqual([
      { id: "arr-1", name: "Band", lyrics: "Chorus\nx", sequence: ["Chorus"] },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run server/src/pco/pcoClient.test.ts`
Expected: FAIL — `client.listSongArrangements is not a function`, and `lyricsArrangement` is undefined in the fallback case.

- [ ] **Step 3: Extract the arrangement parser**

In `server/src/pco/pcoClient.ts`, add above `createPcoClient` (next to `coerceItemType`):

```ts
function parseArrangement(r: JsonApiResource) {
  const seq = r.attributes?.["sequence"];
  return PcoArrangementSchema.parse({
    id: r.id,
    name: str(r.attributes?.["name"]),
    lyrics: str(r.attributes?.["lyrics"]),
    sequence: Array.isArray(seq) ? seq.map((s) => String(s)) : undefined,
  });
}
```

Then inside `getPlanItems`, replace the inline arrangement block:

```ts
        const arrRef = rel["arrangement"]?.data;
        const arrRes = arrRef ? byKey.get(`${arrRef.type}:${arrRef.id}`) : undefined;
        const arrangement = arrRes ? parseArrangement(arrRes) : undefined;
```

(Deleting the now-unused local `const seq = arrRes?.attributes?.["sequence"];` line.)

- [ ] **Step 4: Declare `listSongArrangements` and implement it once**

Add to the `PcoClient` interface:

```ts
  listSongArrangements(songId: string): Promise<PcoArrangement[]>;
```

Add `PcoArrangement` to the `@overlaysys/core` type imports at the top of the file.

`getPlanItems` needs to call this too, and a method in the returned object literal cannot reach its siblings through `this` cleanly. So implement it **once** as a local function inside `createPcoClient`, declared just above the `return {` of the returned object (next to `getAll`):

```ts
  async function listSongArrangements(songId: string): Promise<PcoArrangement[]> {
    const { data } = await getAll(`/songs/${songId}/arrangements?per_page=100`);
    return data.map(parseArrangement);
  }
```

Then expose it on the returned object as a shorthand property — do NOT write a second implementation:

```ts
  return {
    listSongArrangements,
    async listServiceTypes() {
```

- [ ] **Step 5: Wire the conditional fallback**

Replace `getPlanItems`'s final `return items.sort(...)` with:

```ts
      items.sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0));

      // Lyrics live on the arrangement in PCO, and a song's lyrics are often
      // filled in on only one of several arrangements. When the arrangement
      // this plan item references is empty, look at the song's others. Only
      // lyric-less song items pay for the extra request.
      return Promise.all(
        items.map(async (item) => {
          if (item.itemType !== "song" || !item.song) return item;
          const own = item.arrangement;
          if (own?.lyrics && own.lyrics.trim() !== "") return item;
          const siblings = await listSongArrangements(item.song.id);
          const pick = pickLyricsArrangement(siblings, own?.id);
          return pick ? { ...item, lyricsArrangement: pick } : item;
        }),
      );
```

Add `pickLyricsArrangement` to the `@overlaysys/core` value imports at the top of the file.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run server/src/pco/pcoClient.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Full gates + commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Test count 636 → 640. Confirm `server/src/pco/importPlan.test.ts` still passes — its `fakeClient` object literal now needs the new interface method, so if typecheck complains, add `listSongArrangements: async () => []` to that fixture as part of this task.

```bash
git add server/src/pco/pcoClient.ts server/src/pco/pcoClient.test.ts server/src/pco/importPlan.test.ts
git commit -m "feat(server): fetch sibling PCO arrangements when lyrics are missing"
```

---

### Task 3: Server import consumes the effective arrangement

**Files:**
- Modify: `server/src/pco/importPlan.ts` (the `buildImportedSong` call in the non-draft branch; the `PCO_ARRANGEMENT_ID_KEY` stamp in the draft branch)
- Modify: `server/src/pco/importPlan.test.ts`

**Interfaces:**
- Consumes: `effectiveLyricsArrangement(item)` from Task 1.

Background: there are exactly two arrangement reads in this file. The non-draft branch passes `item.arrangement` into `buildImportedSong`, which stamps `pco_arrangement_id` from it internally — so changing the argument fixes both lyrics and provenance at once. The draft branch stamps `item.arrangement.id` explicitly and must be changed separately.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/pco/importPlan.test.ts`, inside the existing `describe("importPlan", …)` block. Extend the module-level `ITEMS` array with a fourth item whose own arrangement is empty:

```ts
  {
    id: "item-D",
    title: "Fallback Song",
    sequence: 4,
    itemType: "song",
    song: { id: "pco-song-D", title: "Fallback Song" },
    arrangement: { id: "arr-D-empty", name: "Default", lyrics: "" },
    lyricsArrangement: {
      id: "arr-D-acoustic",
      name: "Acoustic",
      lyrics: "Chorus\nfallback line",
      sequence: ["Chorus"],
    },
  },
```

Then the tests:

```ts
  it("imports lyrics from the fallback arrangement and stamps its id", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-D", kind: "song", songAction: "create", templateId: "tpl-lyric" }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 1 });
    const song = await songs.getSong("fallback-song");
    expect(song?.sections[0]?.slides[0]?.lines).toEqual(["fallback line"]);
    // Provenance points at the arrangement the lyrics actually came from.
    expect(song?.customFields["pco_arrangement_id"]).toBe("arr-D-acoustic");
  });

  it("stamps the fallback arrangement id on the client-draft path too", async () => {
    const draft = SongSchema.parse({
      id: "whatever",
      title: "Fallback Song",
      sections: [{ id: "c1", kind: "chorus", label: "Chorus", slides: [{ id: "c1s1", lines: ["edited"] }] }],
      defaultArrangement: ["c1"],
      customFields: {},
    });

    await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-D", kind: "song", songAction: "create", templateId: "tpl-lyric", song: draft }],
      },
      NOW,
    );

    const song = await songs.getSong("fallback-song");
    expect(song?.sections[0]?.slides[0]?.lines).toEqual(["edited"]);
    expect(song?.customFields["pco_arrangement_id"]).toBe("arr-D-acoustic");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run server/src/pco/importPlan.test.ts`
Expected: FAIL — the first gets an empty stub (`[""]`) with `pco_arrangement_id` of `"arr-D-empty"`; the second gets the right lyrics but the wrong stamp.

- [ ] **Step 3: Use the effective arrangement in both branches**

In `server/src/pco/importPlan.ts`, add `effectiveLyricsArrangement` to the `@overlaysys/core` imports. Then, in the song-resolution loop, immediately after `const id = existing ? existing.id : resolveImportedSongId(pcoSong, existingIds);`:

```ts
    // Lyrics (and the sequence that orders them) may come from a sibling
    // arrangement when the plan item's own has none — see pcoClient.
    const lyricsArrangement = effectiveLyricsArrangement(item);
```

In the **draft** branch, change the stamp line to:

```ts
          ...(lyricsArrangement ? { [PCO_ARRANGEMENT_ID_KEY]: lyricsArrangement.id } : {}),
```

In the **non-draft** branch, change the `buildImportedSong` call's third argument:

```ts
      const built = buildImportedSong(id, pcoSong, lyricsArrangement, {
        updatedAt: now,
        preserveCustomFields: existing?.customFields,
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/src/pco/importPlan.test.ts`
Expected: PASS — the two new tests plus all pre-existing ones. Note the pre-existing tests use items with lyrics on their own arrangement, so `effectiveLyricsArrangement` returns `item.arrangement` for them and nothing changes.

- [ ] **Step 5: Full gates + commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. Test count 640 → 642.

```bash
git add server/src/pco/importPlan.ts server/src/pco/importPlan.test.ts
git commit -m "feat(server): import lyrics from the effective PCO arrangement"
```

---

### Task 4: Operator UI — draft builder and the "lyrics from" label

**Files:**
- Modify: `apps/operator/src/app/pco/page.tsx`

**Interfaces:**
- Consumes: `effectiveLyricsArrangement(item)` and `ItemPreview.lyricsFromArrangement` from Task 1.

This task has no automated coverage — Vitest never collects `.tsx`. `pnpm typecheck` and careful self-review are the gates. Do not write a component test; it would not run.

- [ ] **Step 1: Point the draft builder at the effective arrangement**

In `apps/operator/src/app/pco/page.tsx`, add `effectiveLyricsArrangement` to the existing `@overlaysys/core` value imports (alongside `buildImportedSong` and `resolveImportedSongId`).

Find the draft-building effect's `buildImportedSong` call — currently:

```tsx
        next[item.id] = buildImportedSong(songId, item.song, item.arrangement).song;
```

Change the third argument:

```tsx
        next[item.id] = buildImportedSong(
          songId,
          item.song,
          effectiveLyricsArrangement(item),
        ).song;
```

This matters: without it, the modal would show an empty stub for exactly the songs the fallback just rescued, and that stub would be what gets imported.

- [ ] **Step 2: Surface the substitution in the New songs panel**

In the New-songs panel's row, next to the existing `no lyrics` pill (the block gated on `pv?.hasLyrics === false`), add:

```tsx
                          {pv?.lyricsFromArrangement && (
                            <Pill tone="good" uppercase>
                              lyrics from {pv.lyricsFromArrangement}
                            </Pill>
                          )}
```

- [ ] **Step 3: Surface it on the item card too**

In `ItemConfigCard`, find the existing no-lyrics notice:

```tsx
              {cfg.songAction === "create" && preview?.hasLyrics === false && (
```

Immediately after that block, add:

```tsx
              {preview?.lyricsFromArrangement && (
                <p style={{ color: colors.textDim, fontSize: 12, marginTop: -4 }}>
                  Lyrics will come from the “{preview.lyricsFromArrangement}” arrangement —
                  this item’s own arrangement has none.
                </p>
              )}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, 642 tests, 13/13 packages.

Manual check (needs a live Planning Center connection): open **Planning Center**, pick a plan containing a song whose referenced arrangement has no lyrics but which has another arrangement that does. Confirm the item card explains where the lyrics will come from, the New-songs row shows the `lyrics from …` pill, the Edit modal shows the real lyrics rather than an empty stub, and after importing, the created song has those lyrics with `pco_arrangement_id` set to the fallback arrangement.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/pco/page.tsx
git commit -m "feat(operator): show which PCO arrangement supplied a song's lyrics"
```

---

## Verification checklist (after all tasks)

- [ ] `pnpm test` — 642 passing
- [ ] `pnpm typecheck` — 13/13 clean
- [ ] A song whose plan-item arrangement is empty imports with lyrics from a sibling arrangement
- [ ] `pco_arrangement_id` records the arrangement the lyrics came from, on both the draft and non-draft paths
- [ ] A song whose own arrangement has lyrics is unaffected, and issues no extra request
- [ ] A song with no lyrics anywhere still produces the empty stub plus its warning
- [ ] The import page never substitutes an arrangement silently
