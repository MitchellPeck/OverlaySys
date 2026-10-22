# Scripture Intro + Companion Scripture Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scripture rows get an intro that queues the scripture on its channel; slides are driven by a server-side scripture session from both the operator and Companion; the operator's song Intro button queues like Companion's.

**Architecture:** Core gains scripture intro fields, a global `ScriptureSettings`, intro resolution and channel-state shapes. `@overlaysys/scripture` owns slide take data. The server gets `scriptureSession` (mirrors `songSession`), hooks in `channels.ts`, settings storage/routes and ws handlers. Companion and the operator send the new messages and read the new channel state.

**Tech Stack:** TypeScript, zod, Fastify + ws (server), Bitfocus Companion module SDK, React/Next (operator), vitest (root config, Node env).

**Spec:** `docs/superpowers/specs/2026-10-22-scripture-intro-companion-design.md`

## Global Constraints

- Scripture intro field keys, verbatim: `reference`, `book`, `translation`, `translationName`, `attribution`.
- Intro resolution order per template field: literal (interpolated) → mapped field → `field.default ?? ""`. Template id / map / literals each: row value ?? settings value. `skipIntro` → no intro.
- Wire messages, verbatim: `scripture_take_intro {showId,rowId,channel?}`, `scripture_take_slide {showId,rowId,slideIdx,channel?}`, `scripture_advance {channel,delta:-1|1}`, `scripture_goto {channel,slideIdx}` (0-based), `scripture_end {channel}`.
- Channel default when omitted: `row.channelHint ?? "program"`.
- Error copy: `No intro configured for this scripture row` (code `not_configured`); missing show/row/slide → code `not_found`.
- Settings file: `<dataRoot>/settings/scripture.json`; routes `GET/PUT /api/scripture/settings`.
- Companion slide numbers are 1-based in options; wire is 0-based.
- Songs and scripture end each other on a channel; scripture intro auto-out keeps the queue.
- Stage only the files each task names (`git add <paths>`). Run tests from the worktree root: `pnpm vitest run <path>`.
- Work in worktree `../OverlaySys-scripture-intro`, branch `feat/scripture-intro`.

## Review Focus

1. **Template has fields the mapping doesn't cover** — they get the template default, not "undefined". Pinned in Task 2.
2. **Companion "go to slide 12" on a 5-slide scripture** — nothing happens, nothing thrown. Pinned in Task 5.
3. **Scripture intro while a song is live on that channel** — song ends, scripture queued. Pinned in Task 5.
4. **Missing/corrupt `settings/scripture.json`** — treated as `{}` (no default intro), never crashes. Pinned in Task 4.
5. **Next pressed with nothing live or queued** — no-op. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/show.ts` (mod) | ScriptureRow intro fields |
| `packages/core/src/scriptureSettings.ts` (new) | `ScriptureSettingsSchema` |
| `packages/core/src/channel.ts` (mod) | `scriptureContext`, `scriptureSession`, `queuedScripture` |
| `packages/core/src/songResolution.ts` (mod) | generic `interpolateWith` |
| `packages/core/src/scriptureIntro.ts` (new) | resolution, descriptors, suggestions |
| `packages/scripture/src/slideData.ts` (new) | `slideReference`, `scriptureSlideData` (moved from operator) |
| `packages/ws-protocol/src/index.ts` (mod) | five messages |
| `server/src/scriptureSettings.ts` (new) | load/save settings |
| `server/src/scripture.ts` (mod) | settings routes |
| `server/src/scriptureSession.ts` (new) | per-channel session + queue |
| `server/src/channels.ts` (mod) | scripture hooks |
| `server/src/scriptureHandlers.ts` (new) | ws message handling |
| `server/src/ws.ts` (mod) | route the five messages |
| `packages/companion-module/src/{actions,feedbacks,variables,labels,presets}.ts` (mod) | Companion controls |
| `apps/operator/src/lib/scriptureSettings.ts` (new) | settings cache hook |
| `apps/operator/src/lib/scriptureClient.ts` (mod) | settings fetch/save |
| `apps/operator/src/app/components/ScriptureTakeStrip.tsx` (rewrite) | Intro + server slide takes |
| `apps/operator/src/app/components/SongTakeStrip.tsx` (mod) | Intro → `take_song_sub` |
| `apps/operator/src/app/components/StageArea.tsx` (mod) | pass `show` |
| `apps/operator/src/lib/rowAirState.ts` (mod) | scripture lights |
| `apps/operator/src/app/components/ScriptureIntroEditor.tsx` (new) | template + mapping editor |
| `apps/operator/src/app/settings/scripture/page.tsx` (mod) | Default intro panel |
| `apps/operator/src/app/components/ScriptureRowModal.tsx` + `shows/edit/page.tsx` (mod) | row intro section + save |

---

### Task 1: Core schemas

**Files:**
- Modify: `packages/core/src/show.ts` (ScriptureRowSchema), `packages/core/src/channel.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/scriptureSettings.ts`
- Test: `packages/core/src/scriptureSchemas.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // show.ts — ScriptureRow gains
  introTemplateId?: string; introFieldMap?: Record<string,string>; introFieldLiterals?: Record<string,string>; skipIntro?: boolean;
  // scriptureSettings.ts
  export const ScriptureSettingsSchema; export type ScriptureSettings = { introTemplateId?: string; introFieldMap?: Record<string,string>; introFieldLiterals?: Record<string,string> };
  // channel.ts
  export const ScriptureContextSchema; export type ScriptureContext = { rowId: string; sub: "intro" } | { rowId: string; sub: "slide"; slideIdx: number };
  export const ScriptureSessionSummarySchema; export type ScriptureSessionSummary = { rowId: string; reference: string; slideIdx: number; slideCount: number; slideReference: string; text: string };
  export const QueuedScriptureSchema; export type QueuedScripture = { rowId: string; reference: string };
  ActiveGraphic.scriptureContext?: ScriptureContext; ChannelState.scriptureSession?: ScriptureSessionSummary; ChannelState.queuedScripture?: QueuedScripture;
  ```

- [ ] **Step 1: Write the failing test** — `packages/core/src/scriptureSchemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ChannelStateSchema, ScriptureRowSchema, ScriptureSettingsSchema } from "./index";

const row = {
  kind: "scripture",
  id: "s1",
  reference: "John 3:16",
  translation: "KJV",
  slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
  templateId: "t",
};

describe("scripture schemas", () => {
  it("scripture rows keep intro fields", () => {
    const r = ScriptureRowSchema.parse({
      ...row,
      introTemplateId: "intro",
      introFieldMap: { title: "reference" },
      introFieldLiterals: { sub: "{translation}" },
      skipIntro: false,
    });
    expect(r.introTemplateId).toBe("intro");
    expect(r.introFieldMap).toEqual({ title: "reference" });
    expect(r.introFieldLiterals).toEqual({ sub: "{translation}" });
    expect(r.skipIntro).toBe(false);
  });

  it("settings accept an empty object and a full default", () => {
    expect(ScriptureSettingsSchema.parse({})).toEqual({});
    expect(
      ScriptureSettingsSchema.parse({ introTemplateId: "i", introFieldMap: { a: "reference" }, introFieldLiterals: {} }),
    ).toMatchObject({ introTemplateId: "i" });
  });

  it("channel state carries scripture session, queue and context", () => {
    const s = ChannelStateSchema.parse({
      channel: "program",
      active: { templateId: "t", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "s1", sub: "slide", slideIdx: 2 } },
      scriptureSession: { rowId: "s1", reference: "John 3:16-21", slideIdx: 2, slideCount: 5, slideReference: "John 3:18", text: "x" },
      queuedScripture: { rowId: "s1", reference: "John 3:16-21" },
    });
    expect(s.active?.scriptureContext).toEqual({ rowId: "s1", sub: "slide", slideIdx: 2 });
    expect(s.scriptureSession?.slideCount).toBe(5);
    expect(s.queuedScripture?.rowId).toBe("s1");
  });

  it("an intro context has no slideIdx", () => {
    const s = ChannelStateSchema.parse({
      channel: "program",
      active: { templateId: "t", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "s1", sub: "intro" } },
    });
    expect(s.active?.scriptureContext).toEqual({ rowId: "s1", sub: "intro" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/scriptureSchemas.test.ts`
Expected: FAIL — `ScriptureSettingsSchema` undefined / intro fields stripped.

- [ ] **Step 3: Implement**
  - `show.ts` `ScriptureRowSchema`, after `source: …optional(),` add:

```ts
  /** Intro template override; falls back to ScriptureSettings.introTemplateId. */
  introTemplateId: z.string().optional(),
  /** templateFieldKey -> scripture field key (reference, book, translation, translationName, attribution). */
  introFieldMap: z.record(z.string(), z.string()).optional(),
  /** templateFieldKey -> literal with {key} tokens; wins over introFieldMap. */
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
  /** Operator opted this row out of an intro. */
  skipIntro: z.boolean().optional(),
```

  - Create `packages/core/src/scriptureSettings.ts`:

```ts
import { z } from "zod";

/** Install-wide scripture defaults (stored server-side in settings/scripture.json). */
export const ScriptureSettingsSchema = z.object({
  introTemplateId: z.string().optional(),
  introFieldMap: z.record(z.string(), z.string()).optional(),
  introFieldLiterals: z.record(z.string(), z.string()).optional(),
});
export type ScriptureSettings = z.infer<typeof ScriptureSettingsSchema>;
```

  - `channel.ts`, after `SubTakeContextSchema`/type:

```ts
/** Identity of a scripture take: its intro, or one of its slides. */
export const ScriptureContextSchema = z.discriminatedUnion("sub", [
  z.object({ rowId: z.string(), sub: z.literal("intro") }),
  z.object({ rowId: z.string(), sub: z.literal("slide"), slideIdx: z.number().int().nonnegative() }),
]);
export type ScriptureContext = z.infer<typeof ScriptureContextSchema>;
```

    add `scriptureContext: ScriptureContextSchema.optional(),` to `ActiveGraphicSchema`; after `QueuedSongSchema`/type:

```ts
/** The scripture row whose slides are live on a channel. */
export const ScriptureSessionSummarySchema = z.object({
  rowId: z.string(),
  reference: z.string(),
  slideIdx: z.number().int().nonnegative(),
  slideCount: z.number().int().positive(),
  /** Reference of the live slide, e.g. "John 3:16b-17". */
  slideReference: z.string(),
  text: z.string(),
});
export type ScriptureSessionSummary = z.infer<typeof ScriptureSessionSummarySchema>;

/** A scripture row armed by its intro; the next slide command starts it. */
export const QueuedScriptureSchema = z.object({ rowId: z.string(), reference: z.string() });
export type QueuedScripture = z.infer<typeof QueuedScriptureSchema>;
```

    and in `ChannelStateSchema` after `queuedSong`:

```ts
  scriptureSession: ScriptureSessionSummarySchema.optional(),
  queuedScripture: QueuedScriptureSchema.optional(),
```

  - `index.ts`: add `export * from "./scriptureSettings";`

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/core`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/show.ts packages/core/src/channel.ts packages/core/src/scriptureSettings.ts packages/core/src/index.ts packages/core/src/scriptureSchemas.test.ts
git commit -m "feat(core): scripture intro fields, settings and channel state"
```

---

### Task 2: Intro resolution

**Files:**
- Modify: `packages/core/src/songResolution.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/scriptureIntro.ts`
- Test: `packages/core/src/scriptureIntro.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `FieldDescriptor`, `TemplateFieldLike`, `SuggestedFieldMatch`, `ResolvedTake`, `suggestFieldMap` from `songResolution.ts`.
- Produces:
  ```ts
  export function interpolateWith(template: string, lookup: (key: string) => string | undefined): string   // songResolution.ts
  export const SCRIPTURE_FIELD_DESCRIPTORS: FieldDescriptor[];
  export interface ScriptureIntroContext { bookName?: string; translationName?: string }
  export function scriptureFieldValues(row: ScriptureRow, ctx: ScriptureIntroContext): Record<string, string>;
  export function introTemplateIdFor(row: ScriptureRow, settings: ScriptureSettings): string | null;   // null when skipped / unset
  export function hasScriptureIntro(row: ScriptureRow, settings: ScriptureSettings): boolean;
  export function resolveScriptureIntro(row, settings, templates: Array<{ id: string; fields: Array<{ key: string; default?: string }> }>, ctx): ResolvedTake | null;
  export function suggestScriptureFieldMap(templateFields: TemplateFieldLike[]): Record<string, SuggestedFieldMatch>;
  ```

- [ ] **Step 1: Write the failing test** — `packages/core/src/scriptureIntro.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ScriptureRow } from "./show";
import {
  hasScriptureIntro,
  introTemplateIdFor,
  resolveScriptureIntro,
  scriptureFieldValues,
  suggestScriptureFieldMap,
} from "./scriptureIntro";
import { interpolateWith } from "./songResolution";

const row = (extra: Partial<ScriptureRow> = {}): ScriptureRow =>
  ({
    kind: "scripture",
    id: "s1",
    reference: "John 3:16-21",
    translation: "NIV",
    translationAbbreviation: "NIV",
    attribution: "© Biblica",
    slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
    templateId: "body",
    ...extra,
  }) as ScriptureRow;

const tpl = {
  id: "intro",
  fields: [
    { key: "title", default: "T" },
    { key: "subtitle", default: "S" },
    { key: "extra", default: "keep-me" },
  ],
};
const ctx = { bookName: "John", translationName: "New International Version" };

describe("scriptureFieldValues", () => {
  it("exposes the five scripture fields", () => {
    expect(scriptureFieldValues(row(), ctx)).toEqual({
      reference: "John 3:16-21",
      book: "John",
      translation: "NIV",
      translationName: "New International Version",
      attribution: "© Biblica",
    });
  });

  it("falls back to the translation id when there is no abbreviation", () => {
    expect(scriptureFieldValues(row({ translationAbbreviation: undefined, translation: "KJV" }), {}).translation).toBe("KJV");
  });
});

describe("resolveScriptureIntro", () => {
  it("uses the settings default when the row sets nothing", () => {
    const out = resolveScriptureIntro(
      row(),
      { introTemplateId: "intro", introFieldMap: { title: "reference", subtitle: "translation" } },
      [tpl],
      ctx,
    );
    expect(out).toEqual({ templateId: "intro", fieldValues: { title: "John 3:16-21", subtitle: "NIV", extra: "keep-me" } });
  });

  it("row overrides each piece independently", () => {
    const out = resolveScriptureIntro(
      row({ introFieldLiterals: { title: "{book} — {translationName}" } }),
      { introTemplateId: "intro", introFieldMap: { subtitle: "attribution" } },
      [tpl],
      ctx,
    );
    expect(out!.fieldValues).toEqual({ title: "John — New International Version", subtitle: "© Biblica", extra: "keep-me" });
  });

  it("unmapped template fields get their default (Review Focus 1)", () => {
    const out = resolveScriptureIntro(row(), { introTemplateId: "intro" }, [tpl], ctx);
    expect(out!.fieldValues).toEqual({ title: "T", subtitle: "S", extra: "keep-me" });
  });

  it("skipIntro, no template anywhere, or unknown template → null", () => {
    expect(resolveScriptureIntro(row({ skipIntro: true }), { introTemplateId: "intro" }, [tpl], ctx)).toBeNull();
    expect(resolveScriptureIntro(row(), {}, [tpl], ctx)).toBeNull();
    expect(resolveScriptureIntro(row({ introTemplateId: "nope" }), {}, [tpl], ctx)).toBeNull();
  });

  it("introTemplateIdFor / hasScriptureIntro follow the same rules", () => {
    expect(introTemplateIdFor(row(), { introTemplateId: "d" })).toBe("d");
    expect(introTemplateIdFor(row({ introTemplateId: "r" }), { introTemplateId: "d" })).toBe("r");
    expect(introTemplateIdFor(row({ skipIntro: true }), { introTemplateId: "d" })).toBeNull();
    expect(hasScriptureIntro(row(), {})).toBe(false);
  });
});

describe("helpers", () => {
  it("interpolateWith substitutes, escapes and blanks unknown keys", () => {
    const look = (k: string) => ({ a: "1" } as Record<string, string>)[k];
    expect(interpolateWith("x{a}y{{z}}{nope}", look)).toBe("x1y{z}");
    expect(interpolateWith("open {a", look)).toBe("open {a");
  });

  it("suggestScriptureFieldMap matches a 'reference' field exactly", () => {
    const s = suggestScriptureFieldMap([
      { key: "reference", label: "Reference", type: "text" },
      { key: "foo", label: "Translation", type: "text" },
    ]);
    expect(s.reference).toEqual({ kind: "exact", songFieldKey: "reference" });
    expect(s.foo).toEqual({ kind: "suggested", songFieldKey: "translation" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/scriptureIntro.test.ts`
Expected: FAIL — cannot resolve `./scriptureIntro`.

- [ ] **Step 3: Extract `interpolateWith`** — in `songResolution.ts`, add above `interpolateSongString` and make it delegate:

```ts
/**
 * `{key}` substitution shared by song and scripture literals. `{{`/`}}` escape
 * to braces; unknown keys become ""; an unterminated `{` is emitted verbatim.
 */
export function interpolateWith(template: string, lookup: (key: string) => string | undefined): string {
  let out = "";
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "{") {
      if (template[i + 1] === "{") {
        out += "{";
        i += 2;
        continue;
      }
      const end = template.indexOf("}", i + 1);
      if (end < 0) {
        out += template.slice(i);
        break;
      }
      out += lookup(template.slice(i + 1, end)) ?? "";
      i = end + 1;
    } else if (ch === "}" && template[i + 1] === "}") {
      out += "}";
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
```

and replace the body of `interpolateSongString` with:

```ts
  return interpolateWith(template, (key) => resolveCustomFieldValue(key, row, showSong, song));
```

(Keep its doc comment. Existing `songResolution.test.ts` interpolate tests are the guard.)

- [ ] **Step 4: Implement** — `packages/core/src/scriptureIntro.ts`:

```ts
import type { ScriptureRow } from "./show";
import type { ScriptureSettings } from "./scriptureSettings";
import {
  interpolateWith,
  suggestFieldMap,
  type FieldDescriptor,
  type ResolvedTake,
  type SuggestedFieldMatch,
  type TemplateFieldLike,
} from "./songResolution";

/** Fields a scripture intro template can map to or interpolate. */
export const SCRIPTURE_FIELD_DESCRIPTORS: FieldDescriptor[] = [
  { key: "reference", label: "Reference", type: "text" },
  { key: "book", label: "Book", type: "text" },
  { key: "translation", label: "Translation", type: "text" },
  { key: "translationName", label: "Translation name", type: "text" },
  { key: "attribution", label: "Attribution", type: "text" },
];

/** Values core can't derive itself (book names and translation names live in @overlaysys/scripture). */
export interface ScriptureIntroContext {
  bookName?: string;
  translationName?: string;
}

export function scriptureFieldValues(row: ScriptureRow, ctx: ScriptureIntroContext): Record<string, string> {
  return {
    reference: row.reference,
    book: ctx.bookName ?? "",
    translation: row.translationAbbreviation ?? row.translation,
    translationName: ctx.translationName ?? "",
    attribution: row.attribution ?? "",
  };
}

export function introTemplateIdFor(row: ScriptureRow, settings: ScriptureSettings): string | null {
  if (row.skipIntro) return null;
  return row.introTemplateId ?? settings.introTemplateId ?? null;
}

export function hasScriptureIntro(row: ScriptureRow, settings: ScriptureSettings): boolean {
  return introTemplateIdFor(row, settings) !== null;
}

export function resolveScriptureIntro(
  row: ScriptureRow,
  settings: ScriptureSettings,
  templates: Array<{ id: string; fields: Array<{ key: string; default?: string }> }>,
  ctx: ScriptureIntroContext,
): ResolvedTake | null {
  const templateId = introTemplateIdFor(row, settings);
  if (!templateId) return null;
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;
  const fieldMap = row.introFieldMap ?? settings.introFieldMap ?? {};
  const literals = row.introFieldLiterals ?? settings.introFieldLiterals ?? {};
  const values = scriptureFieldValues(row, ctx);

  const fieldValues: Record<string, string> = {};
  for (const field of template.fields) {
    const literal = literals[field.key];
    if (literal !== undefined) {
      fieldValues[field.key] = interpolateWith(literal, (k) => values[k]);
      continue;
    }
    const mapped = fieldMap[field.key];
    fieldValues[field.key] = mapped !== undefined ? (values[mapped] ?? "") : (field.default ?? "");
  }
  return { templateId, fieldValues };
}

export function suggestScriptureFieldMap(templateFields: TemplateFieldLike[]): Record<string, SuggestedFieldMatch> {
  return suggestFieldMap(templateFields, SCRIPTURE_FIELD_DESCRIPTORS);
}
```

  `index.ts`: add `export * from "./scriptureIntro";`

  If `ResolvedTake` is not exported from `songResolution.ts`, export it (it's an interface at ~line 80).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run packages/core`
Expected: all PASS (including existing song interpolation tests).

Note on the `suggested` assertion: `suggestFieldMap` scores labels with `labelSimilarity`; if "Translation" ↔ "Translation" yields a different match kind, assert the observed `songFieldKey` only and record a ruling.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/songResolution.ts packages/core/src/scriptureIntro.ts packages/core/src/scriptureIntro.test.ts packages/core/src/index.ts
git commit -m "feat(core): scripture intro resolution"
```

---

### Task 3: Slide take data in `@overlaysys/scripture`

**Files:**
- Create: `packages/scripture/src/slideData.ts`, `packages/scripture/src/slideData.test.ts` (moved from `apps/operator/src/lib/scriptureReference.test.ts`)
- Delete: `apps/operator/src/lib/scriptureReference.ts`, `apps/operator/src/lib/scriptureReference.test.ts`
- Modify: `packages/scripture/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SlideLike { verses: ScriptureVerse[] }
  export interface ScriptureRowLike { slides: SlideLike[]; translation: string; translationAbbreviation?: string; attribution?: string }
  export function slideReference(slides: SlideLike[], slideIdx: number): string;
  export function scriptureSlideData(row: ScriptureRowLike, slideIdx: number): { text: string; reference: string; translation: string; attribution: string };
  ```

- [ ] **Step 1: Move the test** — `git mv apps/operator/src/lib/scriptureReference.test.ts packages/scripture/src/slideData.test.ts`, then in it replace the imports with:

```ts
import { describe, expect, it } from "vitest";
import { scriptureSlideData, slideReference, type SlideLike } from "./slideData";
```

  change `const s = (...verses: ReturnType<typeof v>[]): ScriptureSlide => ({ id: Math.random().toString(), verses });` to `const s = (...verses: ReturnType<typeof v>[]): SlideLike => ({ verses });`, and append:

```ts
describe("scriptureSlideData", () => {
  it("builds the take data the strip used to send", () => {
    const slides = [s(v(3, 16, "For God so")), s(v(3, 16, "loved"), v(3, 17, "For God sent"))];
    expect(scriptureSlideData({ slides, translation: "KJV", translationAbbreviation: "KJV", attribution: "PD" }, 1)).toEqual({
      text: "loved\nFor God sent",
      reference: "John 3:16b-17",
      translation: "KJV",
      attribution: "PD",
    });
  });

  it("falls back to the translation id and empty attribution", () => {
    const d = scriptureSlideData({ slides: [s(v(3, 16, "x"))], translation: "WEB" }, 0);
    expect(d.translation).toBe("WEB");
    expect(d.attribution).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/scripture/src/slideData.test.ts`
Expected: FAIL — cannot resolve `./slideData`.

- [ ] **Step 3: Implement** — `git mv apps/operator/src/lib/scriptureReference.ts packages/scripture/src/slideData.ts`, then edit it:
  - Replace its imports with `import { BOOKS } from "./books";` and `import type { ScriptureVerse } from "./types";`
  - Add the `SlideLike` / `ScriptureRowLike` interfaces above, change the `slideReference` parameter type from `ScriptureSlide[]` to `SlideLike[]` (body unchanged).
  - Append:

```ts
/** The data a scripture slide take sends to its template. */
export function scriptureSlideData(
  row: ScriptureRowLike,
  slideIdx: number,
): { text: string; reference: string; translation: string; attribution: string } {
  const slide = row.slides[slideIdx];
  return {
    text: slide ? slide.verses.map((v) => v.text).join("\n") : "",
    reference: slideReference(row.slides, slideIdx),
    translation: row.translationAbbreviation ?? row.translation,
    attribution: row.attribution ?? "",
  };
}
```

  - `packages/scripture/src/index.ts`: add `export * from "./slideData";`
  - `apps/operator/src/app/components/ScriptureTakeStrip.tsx`: change `import { slideReference } from "@/lib/scriptureReference";` to `import { slideReference } from "@overlaysys/scripture";` (the strip is rewritten in Task 8; this keeps it compiling now).
  - `grep -rn "scriptureReference" apps packages server` — fix any other import the same way.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/scripture && pnpm --filter @overlaysys/operator typecheck`
Expected: PASS; typecheck clean (TS6053 `.next/types` errors in the main checkout are unrelated; the worktree has no `.next`).

- [ ] **Step 5: Commit**

```bash
git add -A packages/scripture/src/slideData.ts packages/scripture/src/slideData.test.ts packages/scripture/src/index.ts apps/operator/src/lib/scriptureReference.ts apps/operator/src/lib/scriptureReference.test.ts apps/operator/src/app/components/ScriptureTakeStrip.tsx
git commit -m "refactor(scripture): slide take data lives in @overlaysys/scripture"
```

(`-A` limited to the named paths records the moves/deletes.)

---

### Task 4: Protocol messages + scripture settings storage/routes

**Files:**
- Modify: `packages/ws-protocol/src/index.ts`, `server/src/scripture.ts`
- Create: `server/src/scriptureSettings.ts`
- Test: `packages/ws-protocol/src/scriptureMessages.test.ts`, `server/src/scriptureSettings.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ClientMessage union gains the five scripture_* messages (Global Constraints)
  // server/src/scriptureSettings.ts
  export function loadScriptureSettings(): Promise<ScriptureSettings>;   // missing/corrupt → {}
  export function saveScriptureSettings(s: ScriptureSettings): Promise<ScriptureSettings>;
  // routes: GET /api/scripture/settings → ScriptureSettings; PUT (body ScriptureSettings) → saved | 400 { message }
  ```

- [ ] **Step 1: Write the failing tests**

`packages/ws-protocol/src/scriptureMessages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./index";

describe("scripture client messages", () => {
  it("parses all five", () => {
    for (const m of [
      { type: "scripture_take_intro", showId: "s", rowId: "r" },
      { type: "scripture_take_intro", showId: "s", rowId: "r", channel: "preview" },
      { type: "scripture_take_slide", showId: "s", rowId: "r", slideIdx: 0 },
      { type: "scripture_advance", channel: "program", delta: -1 },
      { type: "scripture_goto", channel: "program", slideIdx: 3 },
      { type: "scripture_end", channel: "program" },
    ]) {
      expect(ClientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });

  it("rejects bad deltas and negative slide indexes", () => {
    expect(ClientMessageSchema.safeParse({ type: "scripture_advance", channel: "p", delta: 2 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "scripture_goto", channel: "p", slideIdx: -1 }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "scripture_take_slide", showId: "s", rowId: "r", slideIdx: 1.5 }).success).toBe(false);
  });
});
```

`server/src/scriptureSettings.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadScriptureSettings, saveScriptureSettings } from "./scriptureSettings";
import { registerScriptureRoutes } from "./scripture";

let tmp: string;
let prev: string | undefined;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-scrset-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
});
afterEach(async () => {
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("scripture settings", () => {
  it("missing file → {} (Review Focus 4)", async () => {
    expect(await loadScriptureSettings()).toEqual({});
  });

  it("corrupt file → {}", async () => {
    await fs.mkdir(path.join(tmp, "settings"), { recursive: true });
    await fs.writeFile(path.join(tmp, "settings", "scripture.json"), "{not json");
    expect(await loadScriptureSettings()).toEqual({});
  });

  it("round-trips", async () => {
    await saveScriptureSettings({ introTemplateId: "i", introFieldMap: { title: "reference" } });
    expect(await loadScriptureSettings()).toEqual({ introTemplateId: "i", introFieldMap: { title: "reference" } });
  });

  it("GET/PUT routes", async () => {
    const app = Fastify();
    await registerScriptureRoutes(app);
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/api/scripture/settings" })).json()).toEqual({});
    const put = await app.inject({ method: "PUT", url: "/api/scripture/settings", payload: { introTemplateId: "i" } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ introTemplateId: "i" });
    const bad = await app.inject({ method: "PUT", url: "/api/scripture/settings", payload: { introTemplateId: 5 } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/scripture/settings" })).json()).toEqual({ introTemplateId: "i" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/ws-protocol/src/scriptureMessages.test.ts server/src/scriptureSettings.test.ts`
Expected: FAIL — messages not in the union; cannot resolve `./scriptureSettings`.

- [ ] **Step 3: Protocol** — in `ClientMessageSchema`, after the `take_pvw_to_pgm` object add:

```ts
  // ── Scripture (server-side session; see server/src/scriptureSession.ts) ──
  z.object({
    // Intro sub-take: puts the resolved intro on air and queues the row so
    // the next scripture slide command starts it.
    type: z.literal("scripture_take_intro"),
    showId: z.string(),
    rowId: z.string(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("scripture_take_slide"),
    showId: z.string(),
    rowId: z.string(),
    slideIdx: z.number().int().nonnegative(),
    channel: z.string().optional(),
  }),
  z.object({
    type: z.literal("scripture_advance"),
    channel: z.string(),
    delta: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({
    type: z.literal("scripture_goto"),
    channel: z.string(),
    slideIdx: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("scripture_end"), channel: z.string() }),
```

- [ ] **Step 4: Settings module** — `server/src/scriptureSettings.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { ScriptureSettingsSchema, type ScriptureSettings } from "@overlaysys/core";
import { dataRoot } from "./storage";

const file = () => path.join(dataRoot(), "settings", "scripture.json");

/** Install-wide scripture defaults. A missing or unreadable file means "no defaults". */
export async function loadScriptureSettings(): Promise<ScriptureSettings> {
  try {
    const parsed = ScriptureSettingsSchema.safeParse(JSON.parse(await fs.readFile(file(), "utf8")));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export async function saveScriptureSettings(settings: ScriptureSettings): Promise<ScriptureSettings> {
  const parsed = ScriptureSettingsSchema.parse(settings);
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await fs.writeFile(file(), JSON.stringify(parsed, null, 2));
  return parsed;
}
```

  Routes — in `server/src/scripture.ts` add imports `import { ScriptureSettingsSchema } from "@overlaysys/core";` and `import { loadScriptureSettings, saveScriptureSettings } from "./scriptureSettings";`, and inside `registerScriptureRoutes` (before the translations route):

```ts
  app.get("/api/scripture/settings", async () => loadScriptureSettings());

  app.put<{ Body: unknown }>("/api/scripture/settings", async (req, reply) => {
    const parsed = ScriptureSettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.message });
    return saveScriptureSettings(parsed.data);
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run packages/ws-protocol server/src/scriptureSettings.test.ts server/src/scripture.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ws-protocol/src/index.ts packages/ws-protocol/src/scriptureMessages.test.ts server/src/scriptureSettings.ts server/src/scriptureSettings.test.ts server/src/scripture.ts
git commit -m "feat: scripture session messages and settings storage"
```

---

### Task 5: Server scripture session + channel hooks

**Files:**
- Create: `server/src/scriptureSession.ts`
- Modify: `server/src/channels.ts`
- Test: `server/src/scriptureSession.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `scriptureSlideData` (Task 3); `reportViews` from `server/src/apiBible/fums.ts`.
- Produces:
  ```ts
  // scriptureSession.ts
  export function takeIntro(ch: string, showId: string, row: ScriptureRow, intro: { templateId: string; fieldValues: Record<string,string> }): void;
  export function takeSlide(ch: string, showId: string, row: ScriptureRow, slideIdx: number): boolean;  // false = out of range
  export function advance(ch: string, delta: -1 | 1): void;
  export function goTo(ch: string, slideIdx: number): void;
  export function end(ch: string): void;
  export function getLive(ch: string): { showId: string; row: ScriptureRow; slideIdx: number } | undefined;
  export function getQueued(ch: string): { showId: string; row: ScriptureRow } | undefined;
  export function dropAll(ch: string): void;
  export function dropLive(ch: string): boolean;
  export function dropQueued(ch: string): boolean;
  export function moveQueued(from: string, to: string): QueuedScripture | null;
  export function resetAll(): void;   // tests
  // channels.ts
  take(channel, templateId, data, subTakeContext?, scripture?: { context: ScriptureContext; session?: ScriptureSessionSummary; queued?: QueuedScripture }): void
  export function setQueuedScripture(channel: string, q: QueuedScripture | null): void
  ```

- [ ] **Step 1: Write the failing tests** — `server/src/scriptureSession.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptureRow, Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as scriptureSession from "./scriptureSession";
import * as songSession from "./songSession";
import * as fums from "./apiBible/fums";

const CH = "program";
const v = (verse: number, text: string) => ({ book: "JHN", chapter: 3, verse, text });
const row: ScriptureRow = {
  kind: "scripture",
  id: "row-s",
  reference: "John 3:16-18",
  translation: "KJV",
  templateId: "body",
  slides: [
    { id: "slide-0", verses: [v(16, "For God")] },
    { id: "slide-1", verses: [v(17, "For God sent")] },
    { id: "slide-2", verses: [v(18, "He that")] },
  ],
} as ScriptureRow;
const intro = { templateId: "intro-tpl", fieldValues: { title: "John 3:16-18" } };
const song: Song = {
  id: "song", title: "Song", customFields: {}, defaultArrangement: ["v"],
  sections: [{ id: "v", kind: "verse", label: "Verse 1", slides: [{ id: "s", lines: ["L"] }] }],
} as Song;

beforeEach(() => {
  songSession.endAll();
  songSession.clearQueued(CH);
  scriptureSession.resetAll();
  channels.take(CH, "other", {});
});

describe("scriptureSession", () => {
  it("intro goes on air with context and queues the row", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.active?.scriptureContext).toEqual({ rowId: "row-s", sub: "intro" });
    expect(s.queuedScripture).toEqual({ rowId: "row-s", reference: "John 3:16-18" });
    expect(s.scriptureSession).toBeUndefined();
  });

  it("Next after an intro starts the queued row at slide 1 in one take", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    const takes = vi.spyOn(channels, "take");
    scriptureSession.advance(CH, 1);
    expect(takes).toHaveBeenCalledTimes(1);
    takes.mockRestore();
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("body");
    expect(s.active?.data).toMatchObject({ text: "For God", reference: "John 3:16", translation: "KJV" });
    expect(s.active?.scriptureContext).toEqual({ rowId: "row-s", sub: "slide", slideIdx: 0 });
    expect(s.scriptureSession).toMatchObject({ rowId: "row-s", slideIdx: 0, slideCount: 3, slideReference: "John 3:16" });
    expect(s.queuedScripture).toBeUndefined();
  });

  it("goTo after an intro starts at that slide", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.goTo(CH, 2);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(2);
  });

  it("Previous with only a queue does nothing", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.advance(CH, -1);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.queuedScripture?.rowId).toBe("row-s");
  });

  it("Next / Previous move within bounds and stop at the ends", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    scriptureSession.advance(CH, -1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(0);
    scriptureSession.advance(CH, 1);
    scriptureSession.advance(CH, 1);
    scriptureSession.advance(CH, 1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(2);
  });

  it("goTo out of range is a no-op (Review Focus 2)", () => {
    scriptureSession.takeSlide(CH, "show", row, 1);
    expect(() => scriptureSession.goTo(CH, 11)).not.toThrow();
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(1);
    expect(scriptureSession.takeSlide(CH, "show", row, 9)).toBe(false);
  });

  it("Next with nothing live or queued is a no-op (Review Focus 5)", () => {
    scriptureSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("other");
    expect(s.scriptureSession).toBeUndefined();
  });

  it("end with only a queue cancels it and leaves the intro up", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.end(CH);
    const s = channels.getState(CH);
    expect(s.queuedScripture).toBeUndefined();
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.active?.phase).toBe("in");
  });

  it("end with a live session clears the channel and the session", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    scriptureSession.end(CH);
    const s = channels.getState(CH);
    expect(s.scriptureSession).toBeUndefined();
    expect(s.active?.phase).toBe("out");
  });

  it("an external take or operator clear drops session and queue", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.take(CH, "lower-third", {});
    expect(channels.getState(CH).queuedScripture).toBeUndefined();
    scriptureSession.takeSlide(CH, "show", row, 0);
    channels.clear(CH);
    expect(channels.getState(CH).scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive(CH)).toBeUndefined();
  });

  it("an auto-out clear keeps the queue", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.clear(CH, { keepQueuedSong: true });
    expect(channels.getState(CH).queuedScripture?.rowId).toBe("row-s");
    expect(scriptureSession.getQueued(CH)).toBeDefined();
  });

  it("PVW→PGM of a scripture intro carries the queue to program", () => {
    scriptureSession.takeIntro("preview", "show", row, intro);
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).queuedScripture?.rowId).toBe("row-s");
    expect(channels.getState(CH).active?.scriptureContext).toEqual({ rowId: "row-s", sub: "intro" });
    expect(channels.getState("preview").queuedScripture).toBeUndefined();
    scriptureSession.advance(CH, 1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(0);
  });

  it("a scripture intro ends a live song on that channel (Review Focus 3)", () => {
    songSession.start(CH, { song, lyricTemplateId: "lyric", arrangement: ["v"], trustMode: false });
    scriptureSession.takeIntro(CH, "show", row, intro);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
    expect(s.queuedScripture?.rowId).toBe("row-s");
  });

  it("starting a song ends live scripture on that channel", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    songSession.start(CH, { song, lyricTemplateId: "lyric", arrangement: ["v"], trustMode: false });
    expect(channels.getState(CH).scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive(CH)).toBeUndefined();
  });

  it("reports api.bible usage on slide takes", () => {
    const spy = vi.spyOn(fums, "reportViews").mockResolvedValue();
    const niv = { ...row, source: { provider: "api.bible", bibleId: "B", fetchedAt: "x", usageTokens: ["t1"] } } as ScriptureRow;
    scriptureSession.takeSlide(CH, "show", niv, 0);
    expect(spy).toHaveBeenCalledWith(["t1"]);
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/scriptureSession.test.ts`
Expected: FAIL — cannot resolve `./scriptureSession`.

- [ ] **Step 3: Implement `server/src/scriptureSession.ts`**

```ts
import type { QueuedScripture, ScriptureRow, ScriptureSessionSummary } from "@overlaysys/core";
import { scriptureSlideData } from "@overlaysys/scripture";
import * as channels from "./channels";
import { reportViews } from "./apiBible/fums";

// Scripture equivalent of songSession: an intro queues its row on the channel;
// the next slide command (Next / go to slide) starts it. Channel state carries
// `scriptureSession` / `queuedScripture` so the operator and Companion agree.

interface Live {
  showId: string;
  row: ScriptureRow;
  slideIdx: number;
}
interface Queued {
  showId: string;
  row: ScriptureRow;
}

const live = new Map<string, Live>();
const queued = new Map<string, Queued>();

export function getLive(ch: string): Live | undefined {
  return live.get(ch);
}

export function getQueued(ch: string): Queued | undefined {
  return queued.get(ch);
}

export function dropLive(ch: string): boolean {
  return live.delete(ch);
}

export function dropQueued(ch: string): boolean {
  return queued.delete(ch);
}

export function dropAll(ch: string): void {
  live.delete(ch);
  queued.delete(ch);
}

export function resetAll(): void {
  live.clear();
  queued.clear();
}

const queuedSummary = (row: ScriptureRow): QueuedScripture => ({ rowId: row.id, reference: row.reference });

export function takeIntro(
  ch: string,
  showId: string,
  row: ScriptureRow,
  intro: { templateId: string; fieldValues: Record<string, string> },
): void {
  channels.take(ch, intro.templateId, intro.fieldValues, undefined, {
    context: { rowId: row.id, sub: "intro" },
    queued: queuedSummary(row),
  });
  queued.set(ch, { showId, row });
}

export function takeSlide(ch: string, showId: string, row: ScriptureRow, slideIdx: number): boolean {
  if (!Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= row.slides.length) return false;
  const data = scriptureSlideData(row, slideIdx);
  const session: ScriptureSessionSummary = {
    rowId: row.id,
    reference: row.reference,
    slideIdx,
    slideCount: row.slides.length,
    slideReference: data.reference,
    text: data.text,
  };
  channels.take(ch, row.templateId, data, undefined, {
    context: { rowId: row.id, sub: "slide", slideIdx },
    session,
  });
  live.set(ch, { showId, row, slideIdx });
  if (row.source?.provider === "api.bible") void reportViews(row.source.usageTokens);
  return true;
}

export function advance(ch: string, delta: -1 | 1): void {
  const l = live.get(ch);
  if (l) {
    takeSlide(ch, l.showId, l.row, l.slideIdx + delta);
    return;
  }
  const q = queued.get(ch);
  if (q && delta > 0) takeSlide(ch, q.showId, q.row, 0);
}

export function goTo(ch: string, slideIdx: number): void {
  const l = live.get(ch);
  if (l) {
    takeSlide(ch, l.showId, l.row, slideIdx);
    return;
  }
  const q = queued.get(ch);
  if (q) takeSlide(ch, q.showId, q.row, slideIdx);
}

export function end(ch: string): void {
  if (live.has(ch)) {
    channels.clear(ch);
    return;
  }
  if (queued.delete(ch)) channels.setQueuedScripture(ch, null);
}

/** Move a queue between channels without emitting (PVW→PGM of an intro). */
export function moveQueued(from: string, to: string): QueuedScripture | null {
  const entry = queued.get(from);
  queued.delete(to);
  if (!entry) return null;
  queued.delete(from);
  queued.set(to, entry);
  return queuedSummary(entry.row);
}
```

  Note `takeSlide` ignores an out-of-range target before touching anything, so `advance` at the ends and `goTo(11)` are no-ops.

- [ ] **Step 4: Hook `server/src/channels.ts`**
  - Imports: add `QueuedScripture, ScriptureContext, ScriptureSessionSummary` to the `@overlaysys/core` type import and `import * as scriptureSession from "./scriptureSession";`
  - `take` signature and body:

```ts
export function take(
  channel: string,
  templateId: string,
  data: Record<string, string>,
  subTakeContext?: SubTakeContext,
  scripture?: { context: ScriptureContext; session?: ScriptureSessionSummary; queued?: QueuedScripture },
): void {
```

    after the existing `if (!takeIsInternal) { … }` block and before `s.active = {` insert:

```ts
  // Every take replaces whatever scripture owned the channel — including song
  // slides (internal takes) and scripture's own takes, which re-establish
  // their state from `scripture` below. One emit carries both changes.
  scriptureSession.dropAll(channel);
  delete s.scriptureSession;
  delete s.queuedScripture;
  if (scripture?.session) s.scriptureSession = scripture.session;
  if (scripture?.queued) s.queuedScripture = scripture.queued;
```

    and change the `s.active = {…}` literal to also spread `...(scripture ? { scriptureContext: scripture.context } : {}),`.

    Caution: `scriptureSession.takeSlide/takeIntro` set their maps *after* `channels.take` returns, so the `dropAll` above doesn't erase them.
  - `clear`: inside the existing `if (!clearIsInternal) { … }` block append:

```ts
    if (scriptureSession.dropLive(channel)) {
      const st = getOrInit(channel);
      delete st.scriptureSession;
    }
```

    and next to the queued-song drop add:

```ts
  if (!clearIsInternal && !options?.keepQueuedSong && scriptureSession.dropQueued(channel)) {
    delete s.queuedScripture;
    states.set(channel, s);
    if (!s.active) emit(channel);
  }
```

  - Add after `setQueuedSong`:

```ts
export function setQueuedScripture(channel: string, queued: QueuedScripture | null): void {
  const s = getOrInit(channel);
  if (queued === null) delete s.queuedScripture;
  else s.queuedScripture = queued;
  states.set(channel, s);
  emit(channel);
}
```

  - `takePvwToPgm`: after the song `carried` logic and before `pgm.active = {`:

```ts
  // Scripture mirrors songs: live scripture on the destination ends; a
  // promoted scripture intro carries its queue.
  if (scriptureSession.dropLive(toChannel)) delete pgm.scriptureSession;
  let carriedScripture: QueuedScripture | null = null;
  if (queued.scriptureContext?.sub === "intro") {
    carriedScripture = scriptureSession.moveQueued(fromChannel, toChannel);
  } else {
    scriptureSession.dropQueued(toChannel);
  }
  if (carriedScripture) {
    pgm.queuedScripture = carriedScripture;
    delete src.queuedScripture;
  } else {
    delete pgm.queuedScripture;
  }
```

    and add `...(queued.scriptureContext ? { scriptureContext: queued.scriptureContext } : {}),` to the `pgm.active` literal.

    Caution: `clear(fromChannel)` at the end of `takePvwToPgm` must not drop the moved queue — it was already removed from `from` by `moveQueued`, and `dropQueued(from)` then returns false. Good.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run server/src/scriptureSession.test.ts server/src/songSession.test.ts server/src/channels`
Expected: all PASS (song tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/src/scriptureSession.ts server/src/scriptureSession.test.ts server/src/channels.ts
git commit -m "feat(server): scripture session with intro queue"
```

---

### Task 6: Server message handlers

**Files:**
- Create: `server/src/scriptureHandlers.ts`
- Modify: `server/src/ws.ts`
- Test: `server/src/scriptureHandlers.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5; `shows.getShow`, `templates.getTemplate`, `getScriptureRegistry` (server/src/scripture.ts), `BOOKS` (`@overlaysys/scripture`).
- Produces:
  ```ts
  export type ScriptureMessage = Extract<ClientMessage, { type: "scripture_take_intro" | "scripture_take_slide" | "scripture_advance" | "scripture_goto" | "scripture_end" }>;
  export function handleScriptureMessage(msg: ScriptureMessage, send: (m: ServerMessage) => void): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests** — `server/src/scriptureHandlers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Show, ScriptureRow } from "@overlaysys/core";
import * as shows from "./shows";
import * as templates from "./templates";
import * as channels from "./channels";
import * as scriptureSession from "./scriptureSession";
import { saveScriptureSettings } from "./scriptureSettings";
import { handleScriptureMessage } from "./scriptureHandlers";

const row = {
  kind: "scripture", id: "r1", reference: "John 3:16", translation: "KJV", templateId: "body",
  channelHint: "lower", slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
} as ScriptureRow;
const show = { id: "show1", name: "S", projectId: "p", rows: [row], songs: [] } as unknown as Show;
const introTpl = { id: "intro", name: "Intro", fields: [{ key: "title", label: "Title", type: "text" }, { key: "book", label: "Book", type: "text" }] };

let tmp: string;
let prev: string | undefined;
let sent: unknown[];
const send = (m: unknown) => sent.push(m);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-scrh-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  sent = [];
  scriptureSession.resetAll();
  vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "show1" ? show : null));
  vi.spyOn(templates, "getTemplate").mockImplementation(async (id) => (id === "intro" ? (introTpl as never) : null));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("handleScriptureMessage", () => {
  it("intro with no default and no override → not_configured", async () => {
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_configured", message: "No intro configured for this scripture row" }]);
  });

  it("intro uses the settings default, the row's channel hint, and fills book", async () => {
    await saveScriptureSettings({ introTemplateId: "intro", introFieldMap: { title: "reference", book: "book" } });
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1" }, send);
    expect(sent).toEqual([]);
    const s = channels.getState("lower");
    expect(s.active?.data).toEqual({ title: "John 3:16", book: "John" });
    expect(s.queuedScripture?.rowId).toBe("r1");
  });

  it("explicit channel wins", async () => {
    await saveScriptureSettings({ introTemplateId: "intro" });
    await handleScriptureMessage({ type: "scripture_take_intro", showId: "show1", rowId: "r1", channel: "preview" }, send);
    expect(channels.getState("preview").queuedScripture?.rowId).toBe("r1");
  });

  it("unknown show / row / slide → not_found", async () => {
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "nope", rowId: "r1", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "nope", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "r1", slideIdx: 4 }, send);
    expect(sent.map((m) => (m as { code: string }).code)).toEqual(["not_found", "not_found", "not_found"]);
  });

  it("slide, advance, goto and end route to the session", async () => {
    await handleScriptureMessage({ type: "scripture_take_slide", showId: "show1", rowId: "r1", slideIdx: 0, channel: "program" }, send);
    expect(channels.getState("program").scriptureSession?.rowId).toBe("r1");
    await handleScriptureMessage({ type: "scripture_goto", channel: "program", slideIdx: 0 }, send);
    await handleScriptureMessage({ type: "scripture_advance", channel: "program", delta: 1 }, send);
    await handleScriptureMessage({ type: "scripture_end", channel: "program" }, send);
    expect(channels.getState("program").scriptureSession).toBeUndefined();
    expect(sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/scriptureHandlers.test.ts`
Expected: FAIL — cannot resolve `./scriptureHandlers`.

- [ ] **Step 3: Implement `server/src/scriptureHandlers.ts`**

```ts
import type { ScriptureRow } from "@overlaysys/core";
import { resolveScriptureIntro, introTemplateIdFor } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import * as shows from "./shows";
import * as templates from "./templates";
import * as scriptureSession from "./scriptureSession";
import { loadScriptureSettings } from "./scriptureSettings";
import { getScriptureRegistry } from "./scripture";

export type ScriptureMessage = Extract<
  ClientMessage,
  { type: "scripture_take_intro" | "scripture_take_slide" | "scripture_advance" | "scripture_goto" | "scripture_end" }
>;

type Send = (m: ServerMessage) => void;

async function findRow(showId: string, rowId: string, send: Send): Promise<ScriptureRow | null> {
  const show = await shows.getShow(showId);
  if (!show) {
    send({ type: "error", code: "not_found", message: showId });
    return null;
  }
  const row = show.rows.find((r) => r.id === rowId);
  if (!row || row.kind !== "scripture") {
    send({ type: "error", code: "not_found", message: rowId });
    return null;
  }
  return row;
}

export async function handleScriptureMessage(msg: ScriptureMessage, send: Send): Promise<void> {
  switch (msg.type) {
    case "scripture_take_intro": {
      const row = await findRow(msg.showId, msg.rowId, send);
      if (!row) return;
      const settings = await loadScriptureSettings();
      const templateId = introTemplateIdFor(row, settings);
      if (!templateId) {
        send({ type: "error", code: "not_configured", message: "No intro configured for this scripture row" });
        return;
      }
      const tpl = await templates.getTemplate(templateId);
      if (!tpl) {
        send({ type: "error", code: "not_found", message: templateId });
        return;
      }
      const firstBook = row.slides[0]?.verses[0]?.book;
      const intro = resolveScriptureIntro(row, settings, [tpl], {
        bookName: BOOKS.find((b) => b.id === firstBook)?.name,
        translationName: getScriptureRegistry().listTranslations().find((t) => t.id === row.translation)?.name,
      });
      if (!intro) {
        send({ type: "error", code: "not_configured", message: "No intro configured for this scripture row" });
        return;
      }
      scriptureSession.takeIntro(msg.channel ?? row.channelHint ?? "program", msg.showId, row, intro);
      return;
    }
    case "scripture_take_slide": {
      const row = await findRow(msg.showId, msg.rowId, send);
      if (!row) return;
      const ok = scriptureSession.takeSlide(msg.channel ?? row.channelHint ?? "program", msg.showId, row, msg.slideIdx);
      if (!ok) send({ type: "error", code: "not_found", message: `slide ${msg.slideIdx + 1}` });
      return;
    }
    case "scripture_advance":
      scriptureSession.advance(msg.channel, msg.delta);
      return;
    case "scripture_goto":
      scriptureSession.goTo(msg.channel, msg.slideIdx);
      return;
    case "scripture_end":
      scriptureSession.end(msg.channel);
      return;
  }
}
```

  If `templates.getTemplate`'s return type's `fields[].default` isn't `string | undefined`, cast `[tpl]` minimally and record a ruling.

- [ ] **Step 4: Route in `server/src/ws.ts`** — import `import { handleScriptureMessage } from "./scriptureHandlers";` and add before `case "list_channels":`:

```ts
        case "scripture_take_intro":
        case "scripture_take_slide":
        case "scripture_advance":
        case "scripture_goto":
        case "scripture_end":
          await handleScriptureMessage(parsed, send);
          break;
```

- [ ] **Step 5: Run to verify pass; typecheck**

Run: `pnpm vitest run server/src/scriptureHandlers.test.ts server/src/scriptureSession.test.ts && (cd server && npx tsc --noEmit)`
Expected: PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/scriptureHandlers.ts server/src/scriptureHandlers.test.ts server/src/ws.ts
git commit -m "feat(server): handle scripture intro/slide/advance/goto/end messages"
```

---

### Task 7: Companion scripture controls

**Files:**
- Modify: `packages/companion-module/src/actions.ts`, `feedbacks.ts`, `variables.ts`, `labels.ts`, `presets.ts`
- Test: `packages/companion-module/src/__tests__/scripture.test.ts` (new); update existing scripture expectations in `__tests__/*.test.ts` if any assert "does nothing"

**Interfaces:**
- Consumes: Task 4 messages; Task 1 channel state.
- Produces: ActionIds `scripture_take_intro`, `scripture_take_intro_by_index`, `scripture_take_intro_at_cursor`, `scripture_take_slide`, `scripture_take_slide_by_index`, `scripture_take_slide_at_cursor`, `scripture_advance`, `scripture_goto`, `scripture_end`; FeedbackIds `scripture_active`, `scripture_queued`, `scripture_slide_is`; variables `<c>_scripture_ref`, `<c>_scripture_slide`, `<c>_scripture_text`, `<c>_scripture_queued_ref`.

- [ ] **Step 1: Write the failing tests** — `packages/companion-module/src/__tests__/scripture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ScriptureRow, Show } from "@overlaysys/core";
import { initialState } from "../types";
import { dispatchAction } from "../actions";
import { feedbackPredicate } from "../feedbacks";
import { projectVariables } from "../variables";
import { rowDisplayLabel } from "../labels";

const scripture = {
  kind: "scripture", id: "sr", reference: "John 3:16-18", translation: "KJV", templateId: "body", channelHint: "lower",
  slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "x" }] }],
} as ScriptureRow;
const graphic = { kind: "graphic", id: "g", templateId: "t", data: {} } as Show["rows"][number];

function state() {
  const s = initialState();
  const show = { id: "show1", name: "S", projectId: "p", rows: [graphic, scripture], songs: [] } as unknown as Show;
  s.showCache.set("show1", show);
  s.loadedShowId = "show1";
  s.loadedShowRowCursor = 1;
  return s;
}

describe("scripture actions", () => {
  it("intro by id / index / cursor", () => {
    expect(dispatchAction(state(), "scripture_take_intro", { showId: "show1", rowId: "sr", channel: "" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr" },
    ]);
    expect(dispatchAction(state(), "scripture_take_intro_by_index", { rowIndex: 2, channel: "program" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr", channel: "program" },
    ]);
    expect(dispatchAction(state(), "scripture_take_intro_at_cursor", { channel: "" }).messages).toEqual([
      { type: "scripture_take_intro", showId: "show1", rowId: "sr" },
    ]);
  });

  it("intro by index on a non-scripture row does nothing", () => {
    expect(dispatchAction(state(), "scripture_take_intro_by_index", { rowIndex: 1 }).messages).toEqual([]);
  });

  it("slide N is 1-based in options and 0-based on the wire", () => {
    expect(dispatchAction(state(), "scripture_take_slide_by_index", { rowIndex: 2, slide: 3, channel: "" }).messages).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 2 },
    ]);
    expect(dispatchAction(state(), "scripture_goto", { channel: "program", slide: 1 }).messages).toEqual([
      { type: "scripture_goto", channel: "program", slideIdx: 0 },
    ]);
  });

  it("advance clamps delta to ±1 and end", () => {
    expect(dispatchAction(state(), "scripture_advance", { channel: "program", delta: -1 }).messages).toEqual([
      { type: "scripture_advance", channel: "program", delta: -1 },
    ]);
    expect(dispatchAction(state(), "scripture_advance", { channel: "program", delta: 5 }).messages).toEqual([
      { type: "scripture_advance", channel: "program", delta: 1 },
    ]);
    expect(dispatchAction(state(), "scripture_end", { channel: "program" }).messages).toEqual([
      { type: "scripture_end", channel: "program" },
    ]);
  });

  it("generic take_row on a scripture row takes slide 1 instead of nothing", () => {
    expect(dispatchAction(state(), "take_row_at_cursor", { channel: "" }).messages).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 0, channel: "lower" },
    ]);
  });

  it("song-aware take: intro → intro, lyrics → slide 1, outro → nothing", () => {
    const go = (sub: string) => dispatchAction(state(), "take_row_song_aware", { target: "cursor", sub, channel: "" }).messages;
    expect(go("intro")).toEqual([{ type: "scripture_take_intro", showId: "show1", rowId: "sr" }]);
    expect(go("lyrics")).toEqual([{ type: "scripture_take_slide", showId: "show1", rowId: "sr", slideIdx: 0 }]);
    expect(go("outro")).toEqual([]);
  });
});

describe("scripture feedbacks, variables, labels", () => {
  function live() {
    const s = state();
    s.channelStates.set("program", {
      channel: "program",
      active: { templateId: "body", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "sr", sub: "slide", slideIdx: 1 } },
      scriptureSession: { rowId: "sr", reference: "John 3:16-18", slideIdx: 1, slideCount: 3, slideReference: "John 3:17", text: "For God sent" },
      queuedScripture: { rowId: "sr", reference: "John 3:16-18" },
    });
    return s;
  }

  it("feedbacks", () => {
    const s = live();
    expect(feedbackPredicate(s, "scripture_active", { channel: "program" })).toBe(true);
    expect(feedbackPredicate(s, "scripture_queued", { channel: "program" })).toBe(true);
    expect(feedbackPredicate(s, "scripture_slide_is", { channel: "program", slide: 2 })).toBe(true);
    expect(feedbackPredicate(s, "scripture_slide_is", { channel: "program", slide: 1 })).toBe(false);
    expect(feedbackPredicate(s, "row_is_active", { rowId: "sr" })).toBe(true);
    expect(feedbackPredicate(s, "row_at_index_is_active", { rowIndex: 2 })).toBe(true);
  });

  it("variables", () => {
    const v = projectVariables(live(), ["program"]);
    expect(v.program_scripture_ref).toBe("John 3:17");
    expect(v.program_scripture_slide).toBe("2/3");
    expect(v.program_scripture_text).toBe("For God sent");
    expect(v.program_scripture_queued_ref).toBe("John 3:16-18");
    expect(v.rundown_2_is_active).toBe("yes");
    const empty = projectVariables(state(), ["program"]);
    expect(empty.program_scripture_slide).toBe("");
  });

  it("rundown label shows the reference", () => {
    expect(rowDisplayLabel(state(), scripture)).toBe("John 3:16-18");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/companion-module/src/__tests__/scripture.test.ts`
Expected: FAIL — unknown action ids produce no messages; predicates/variables undefined.

- [ ] **Step 3: Actions** (`actions.ts`)
  - Add the nine ids to the `ActionId` union.
  - Replace the scripture branch in `rowMessages` with:

```ts
  if (row.kind === "scripture") {
    return [{ type: "scripture_take_slide", showId: state.loadedShowId ?? "", rowId: row.id, slideIdx: 0, channel }];
  }
```

    and in `rowPvwPgmMessages`:

```ts
  if (row.kind === "scripture") {
    // No preview stage for scripture slides: go straight to the To channel.
    return [{ type: "scripture_take_slide", showId: state.loadedShowId ?? "", rowId: row.id, slideIdx: 0, channel: toChannel }];
  }
```

  - In `take_row_song_aware`, after `const pvwPgm = bool("pvwPgm");` insert:

```ts
      if (row.kind === "scripture") {
        const sub = str("sub", "lyrics");
        const channel = pvwPgm ? str("toChannel", "program") : str("channel");
        const ch = channel ? { channel } : {};
        if (sub === "intro") messages.push({ type: "scripture_take_intro", showId: show.id, rowId: row.id, ...ch });
        else if (sub === "lyrics") messages.push({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, ...ch });
        break;
      }
```

  - In `dispatchAction`, add a helper above the `switch`:

```ts
  const loadedShow = () => (state.loadedShowId ? state.showCache.get(state.loadedShowId) : undefined);
  const scriptureRowAt = (target: "index" | "cursor") => {
    const show = loadedShow();
    if (!show) return undefined;
    const idx = target === "index" ? num("rowIndex", 1) - 1 : state.loadedShowRowCursor;
    const row = idx == null ? undefined : show.rows[idx];
    return row && row.kind === "scripture" ? { show, row } : undefined;
  };
  const optChannel = () => (str("channel") ? { channel: str("channel") } : {});
  const slideIdx = () => Math.max(0, Math.floor(num("slide", 1)) - 1);
```

    and cases:

```ts
    case "scripture_take_intro":
      messages.push({ type: "scripture_take_intro", showId: str("showId"), rowId: str("rowId"), ...optChannel() });
      break;
    case "scripture_take_intro_by_index":
    case "scripture_take_intro_at_cursor": {
      const hit = scriptureRowAt(id === "scripture_take_intro_by_index" ? "index" : "cursor");
      if (hit) messages.push({ type: "scripture_take_intro", showId: hit.show.id, rowId: hit.row.id, ...optChannel() });
      break;
    }
    case "scripture_take_slide":
      messages.push({ type: "scripture_take_slide", showId: str("showId"), rowId: str("rowId"), slideIdx: slideIdx(), ...optChannel() });
      break;
    case "scripture_take_slide_by_index":
    case "scripture_take_slide_at_cursor": {
      const hit = scriptureRowAt(id === "scripture_take_slide_by_index" ? "index" : "cursor");
      if (hit) messages.push({ type: "scripture_take_slide", showId: hit.show.id, rowId: hit.row.id, slideIdx: slideIdx(), ...optChannel() });
      break;
    }
    case "scripture_advance":
      messages.push({ type: "scripture_advance", channel: str("channel"), delta: num("delta", 1) < 0 ? -1 : 1 });
      break;
    case "scripture_goto":
      messages.push({ type: "scripture_goto", channel: str("channel"), slideIdx: slideIdx() });
      break;
    case "scripture_end":
      messages.push({ type: "scripture_end", channel: str("channel") });
      break;
```

  - SDK definitions (in the object returned next to the song ones):

```ts
const slideInput: CompanionInputFieldNumber = {
  id: "slide", type: "number", label: "Slide (1-based)", default: 1, min: 1, max: 200, step: 1,
};
```

```ts
    scripture_take_intro: {
      name: "Scripture: take intro (queues the scripture) by row ID",
      options: [showDropdown(state), rowDropdown(state), { ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_intro"),
    },
    scripture_take_intro_by_index: {
      name: "Scripture: take intro from loaded show (by index)",
      options: [rowIndexInput, { ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_intro_by_index"),
    },
    scripture_take_intro_at_cursor: {
      name: "Scripture: take intro of the cursor row",
      options: [{ ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_intro_at_cursor"),
    },
    scripture_take_slide: {
      name: "Scripture: take slide N by row ID",
      options: [showDropdown(state), rowDropdown(state), slideInput, { ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_slide"),
    },
    scripture_take_slide_by_index: {
      name: "Scripture: take slide N from loaded show (by index)",
      options: [rowIndexInput, slideInput, { ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_slide_by_index"),
    },
    scripture_take_slide_at_cursor: {
      name: "Scripture: take slide N of the cursor row",
      options: [slideInput, { ...channelDropdown(state, "channel", "Channel (optional)"), default: "" }],
      callback: wrap("scripture_take_slide_at_cursor"),
    },
    scripture_advance: {
      name: "Scripture: next / previous slide (starts a queued scripture)",
      options: [channelDropdown(state), deltaInput],
      callback: wrap("scripture_advance"),
    },
    scripture_goto: {
      name: "Scripture: go to slide N (starts a queued scripture)",
      options: [channelDropdown(state), slideInput],
      callback: wrap("scripture_goto"),
    },
    scripture_end: {
      name: "Scripture: end (cancels a queued scripture)",
      options: [channelDropdown(state)],
      callback: wrap("scripture_end"),
    },
```

    (`rowDropdown(state)` already uses id `rowId`; check and spread `{ ...rowDropdown(state), id: "rowId" }` if its default id differs.)

- [ ] **Step 4: Feedbacks** (`feedbacks.ts`)
  - Add `"scripture_active" | "scripture_queued" | "scripture_slide_is"` to `FeedbackId`; add `"slide"` to the option `type` union; definitions after `song_queued`:

```ts
  {
    id: "scripture_active",
    name: "Scripture slides live",
    description: "True when the chosen channel shows a scripture slide.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "scripture_queued",
    name: "Scripture queued (intro taken)",
    description: "True when the chosen channel has a scripture armed by its intro. Next / go to slide on that channel will start it.",
    options: [{ id: "channel", type: "channel" }],
  },
  {
    id: "scripture_slide_is",
    name: "Scripture slide N is live",
    description: "True when the chosen channel's live scripture is on slide N (1-based).",
    options: [{ id: "channel", type: "channel" }, { id: "slide", type: "slide" }],
  },
```

  - Predicates:

```ts
    case "scripture_active":
      return Boolean(state.channelStates.get(String(options.channel ?? ""))?.scriptureSession);
    case "scripture_queued":
      return Boolean(state.channelStates.get(String(options.channel ?? ""))?.queuedScripture);
    case "scripture_slide_is": {
      const sess = state.channelStates.get(String(options.channel ?? ""))?.scriptureSession;
      return !!sess && sess.slideIdx === Number(options.slide ?? 1) - 1;
    }
```

  - `rowMatchesPgm`: add a 4th parameter `pgmScriptureRowId: string | undefined` and replace the scripture branch with `return Boolean(pgmScriptureRowId === row.id || active?.scriptureContext?.rowId === row.id);`. Update both callers to pass `pgm?.scriptureSession?.rowId`.
  - SDK option mapping: add

```ts
        case "slide":
          return slideInputF;
```

    with

```ts
const slideInputF: CompanionInputFieldNumber = {
  id: "slide", type: "number", label: "Slide (1-based)", default: 1, min: 1, max: 200, step: 1,
};
```

- [ ] **Step 5: Variables, labels, presets**
  - `variables.ts`: in `variableDefinitions` add per channel

```ts
      { variableId: `${c}_scripture_ref`, name: `${c} scripture slide reference` },
      { variableId: `${c}_scripture_slide`, name: `${c} scripture slide (n/total)` },
      { variableId: `${c}_scripture_text`, name: `${c} scripture slide text` },
      { variableId: `${c}_scripture_queued_ref`, name: `${c} scripture queued by its intro (reference)` },
```

    in `projectVariables` per channel (after the song block):

```ts
    const scr = ch?.scriptureSession;
    out[`${c}_scripture_ref`] = scr?.slideReference ?? "";
    out[`${c}_scripture_slide`] = scr ? `${scr.slideIdx + 1}/${scr.slideCount}` : "";
    out[`${c}_scripture_text`] = scr?.text ?? "";
    out[`${c}_scripture_queued_ref`] = ch?.queuedScripture?.reference ?? "";
```

    and make variables' own `rowMatchesPgm` match the feedbacks version (4th param; call site passes `state.channelStates.get("program")?.scriptureSession?.rowId`).
  - `labels.ts`, in `rowDisplayLabel` before the video line: `if (row.kind === "scripture") return row.reference;`
  - `presets.ts`, after the Song presets:

```ts
  presets["scripture_intro_cursor"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture Intro (cursor row)",
    style: { text: "SCRIPTURE\\nINTRO", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_take_intro_at_cursor", options: { channel: "" } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_queued", options: { channel: "program" }, style: { bgcolor: 0x996600 } }],
  };
  presets["scripture_prev"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture -1",
    style: { text: "◀ -1", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_advance", options: { channel: "program", delta: -1 } }], up: [] }],
    feedbacks: [],
  };
  presets["scripture_next"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture +1",
    style: { text: "+1 ▶", size: "18", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_advance", options: { channel: "program", delta: 1 } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_queued", options: { channel: "program" }, style: { bgcolor: 0x996600 } }],
  };
  presets["scripture_end"] = {
    type: "button",
    category: "Scripture",
    name: "Scripture End",
    style: { text: "END", size: "14", color: white, bgcolor: dark },
    steps: [{ down: [{ actionId: "scripture_end", options: { channel: "program" } }], up: [] }],
    feedbacks: [{ feedbackId: "scripture_active", options: { channel: "program" }, style: { bgcolor: 0x00aa00 } }],
  };
```

    (Match the existing song presets' `feedbacks` entry shape; if they carry no feedbacks, keep the shape the SDK type requires.)

- [ ] **Step 6: Run all Companion tests**

Run: `pnpm vitest run packages/companion-module && pnpm --filter @overlaysys/companion-module typecheck`
Expected: PASS (update any older test that asserted scripture rows send nothing — record the change in the ledger); typecheck clean. If the package has no `typecheck` script, run `cd packages/companion-module && npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add packages/companion-module/src
git commit -m "feat(companion): scripture intro, slide, next/prev, end controls"
```

---

### Task 8: Operator — take strips, air state, settings client

**Files:**
- Create: `apps/operator/src/lib/scriptureSettings.ts`
- Modify: `apps/operator/src/lib/scriptureClient.ts`, `apps/operator/src/app/components/ScriptureTakeStrip.tsx` (rewrite), `apps/operator/src/app/components/SongTakeStrip.tsx`, `apps/operator/src/app/components/StageArea.tsx`, `apps/operator/src/lib/rowAirState.ts`
- Test: `apps/operator/src/lib/rowAirState.test.ts` (update)

**Interfaces:**
- Consumes: Tasks 1–2 (`hasScriptureIntro`, `ScriptureSettings`), Task 4 messages/routes.
- Produces:
  ```ts
  // scriptureClient.ts
  export function getScriptureSettings(): Promise<ScriptureSettings>;
  export function putScriptureSettings(s: ScriptureSettings): Promise<ScriptureSettings>;
  // lib/scriptureSettings.ts
  export function useScriptureSettings(): ScriptureSettings | null;   // null until loaded
  export function setScriptureSettingsCache(s: ScriptureSettings): void;
  ```

- [ ] **Step 1: Write the failing test** — in `rowAirState.test.ts`, replace the existing test asserting scripture never lights (~line 88) with:

```ts
  it("scripture lights from its session or its intro context", () => {
    const row = { kind: "scripture", id: "sr", reference: "John 3:16", translation: "KJV", templateId: "body", slides: [] } as unknown as Show["rows"][number];
    const live = {
      program: { channel: "program", active: null, scriptureSession: { rowId: "sr", reference: "John 3:16", slideIdx: 0, slideCount: 1, slideReference: "John 3:16", text: "x" } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, live, {})).toBe("program");
    const intro = {
      preview: { channel: "preview", active: { templateId: "intro", data: {}, phase: "in", takenAt: 1, scriptureContext: { rowId: "sr", sub: "intro" } } },
    } as unknown as Record<string, ChannelState>;
    expect(rowAirState(row, intro, {})).toBe("preview");
    expect(rowAirState(row, {}, {})).toBeNull();
  });
```

  (Reuse the file's existing imports for `Show`, `ChannelState`, `rowAirState`; add any missing.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run apps/operator/src/lib/rowAirState.test.ts`
Expected: FAIL — scripture returns null.

- [ ] **Step 3: Implement**
  - `rowAirState.ts` scripture case:

```ts
    case "scripture":
      return st?.scriptureSession?.rowId === row.id || st?.active?.scriptureContext?.rowId === row.id;
```

    and update the doc comment ("Scripture rows light from scriptureSession / scriptureContext").
  - `scriptureClient.ts` append:

```ts
export async function getScriptureSettings(): Promise<ScriptureSettings> {
  const r = await fetch(`${httpBase()}/api/scripture/settings`);
  if (!r.ok) throw new Error(`scripture settings: ${r.status}`);
  return r.json();
}

export async function putScriptureSettings(settings: ScriptureSettings): Promise<ScriptureSettings> {
  const r = await fetch(`${httpBase()}/api/scripture/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!r.ok) throw new Error(`scripture settings save: ${r.status}`);
  return r.json();
}
```

    with `import type { ScriptureSettings } from "@overlaysys/core";`
  - `apps/operator/src/lib/scriptureSettings.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";
import type { ScriptureSettings } from "@overlaysys/core";
import { getScriptureSettings } from "./scriptureClient";

// Install-wide scripture defaults, fetched once and shared by every take strip.
let cache: ScriptureSettings | null = null;
let loading = false;
const listeners = new Set<() => void>();

export function setScriptureSettingsCache(s: ScriptureSettings): void {
  cache = s;
  for (const l of listeners) l();
}

function load(): void {
  if (cache || loading) return;
  loading = true;
  getScriptureSettings()
    .then(setScriptureSettingsCache)
    .catch(() => setScriptureSettingsCache({}))
    .finally(() => {
      loading = false;
    });
}

export function useScriptureSettings(): ScriptureSettings | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      load();
      return () => listeners.delete(l);
    },
    () => cache,
    () => null,
  );
}
```

  - `ScriptureTakeStrip.tsx` (rewrite):

```tsx
"use client";

import type { ScriptureRow, Show } from "@overlaysys/core";
import { hasScriptureIntro } from "@overlaysys/core";
import { slideReference } from "@overlaysys/scripture";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useScriptureSettings } from "@/lib/scriptureSettings";

interface Props {
  show: Show;
  row: ScriptureRow;
  channel: string;
}

/**
 * Intro + one button per slide. Everything goes through the server's
 * scripture session, so Companion sees (and can continue) what's pressed here.
 */
export function ScriptureTakeStrip({ show, row, channel }: Props) {
  const { send } = useWs();
  const settings = useScriptureSettings();
  const ch = useStore((s) => s.channelStates[channel]);
  const liveIdx = ch?.scriptureSession?.rowId === row.id ? ch.scriptureSession.slideIdx : null;
  const queued = ch?.queuedScripture?.rowId === row.id;
  const showIntro = settings ? hasScriptureIntro(row, settings) : false;
  const onAir = (on: boolean) => (on ? { outline: `2px solid ${colors.onair}`, outlineOffset: 1 } : {});

  return (
    <div role="toolbar" aria-label="Scripture slides" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {showIntro && (
        <Button
          size="md"
          variant="ghost"
          aria-pressed={queued}
          onClick={() => send({ type: "scripture_take_intro", showId: show.id, rowId: row.id, channel })}
          style={{ minWidth: 100, ...onAir(queued) }}
        >
          Intro{queued ? " · queued" : ""}
        </Button>
      )}
      {row.slides.map((slide, i) => (
        <Button
          key={slide.id}
          size="md"
          variant="primary"
          aria-pressed={liveIdx === i}
          onClick={() => send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: i, channel })}
          style={{ flex: "1 1 auto", minWidth: 120, ...onAir(liveIdx === i) }}
        >
          {i + 1}. {slideReference(row.slides, i)}
        </Button>
      ))}
    </div>
  );
}
```

  - `StageArea.tsx` (~line 120): `<ScriptureTakeStrip show={show} row={mode.row} channel={mode.row.channelHint ?? "program"} />`
  - `SongTakeStrip.tsx` `takeIntro`:

```ts
  function takeIntro() {
    if (!intro) return;
    // Server path so the intro queues its song (section buttons — here or in
    // Companion — then start it), exactly like Companion's intro.
    send({ type: "take_song_sub", showId: show.id, songRowId: row.id, sub: "intro", channel });
    setLastFired("intro");
  }
```

  - `grep -rn "reportScriptureUsage" apps/operator/src` — the strip no longer calls it; leave the function in `scriptureClient.ts` only if something else uses it, else delete it.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run apps/operator && pnpm --filter @overlaysys/operator typecheck`
Expected: PASS; clean. (If `colors.onair` or `variant="ghost"` don't exist in `@overlaysys/ui`, use the closest existing token/variant and record a ruling.)

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/scriptureSettings.ts apps/operator/src/lib/scriptureClient.ts apps/operator/src/app/components/ScriptureTakeStrip.tsx apps/operator/src/app/components/SongTakeStrip.tsx apps/operator/src/app/components/StageArea.tsx apps/operator/src/lib/rowAirState.ts apps/operator/src/lib/rowAirState.test.ts
git commit -m "feat(operator): scripture intro button, server-driven slides, song intro queues"
```

---

### Task 9: Operator — default intro settings + row intro section

**Files:**
- Create: `apps/operator/src/app/components/ScriptureIntroEditor.tsx`
- Modify: `apps/operator/src/app/settings/scripture/page.tsx`, `apps/operator/src/app/components/ScriptureRowModal.tsx`, `apps/operator/src/app/shows/edit/page.tsx`

**Interfaces:**
- Consumes: `SCRIPTURE_FIELD_DESCRIPTORS`, `suggestScriptureFieldMap` (Task 2); `FieldMappingTable` (`apps/operator/src/app/songs/edit/FieldMappingTable.tsx`, props: `templateFields, songFields, value, literals, suggestions, onChange, onLiteralsChange, confirmedKeys?, onConfirm?`); Task 8 settings client/cache.
- Produces:
  ```ts
  export interface IntroConfig { introTemplateId?: string; introFieldMap?: Record<string,string>; introFieldLiterals?: Record<string,string> }
  export function ScriptureIntroEditor(props: { value: IntroConfig; onChange(next: IntroConfig): void }): JSX.Element;
  // ScriptureRowModal SaveArgs gains: intro: IntroConfig & { skipIntro?: boolean }
  ```

- [ ] **Step 1: `ScriptureIntroEditor.tsx`**

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { SCRIPTURE_FIELD_DESCRIPTORS, suggestScriptureFieldMap } from "@overlaysys/core";
import { Field, Select, colors } from "@overlaysys/ui";
import { FieldMappingTable } from "@/app/songs/edit/FieldMappingTable";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export interface IntroConfig {
  introTemplateId?: string;
  introFieldMap?: Record<string, string>;
  introFieldLiterals?: Record<string, string>;
}

/** Template picker + field mapping for a scripture intro (default or per-row). */
export function ScriptureIntroEditor({ value, onChange }: { value: IntroConfig; onChange(next: IntroConfig): void }) {
  const { send } = useWs();
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const tplId = value.introTemplateId ?? "";
  const tpl = tplId ? templateCache[tplId] : undefined;

  useEffect(() => {
    if (tplId && !tpl) send({ type: "get_template", templateId: tplId });
  }, [tplId, tpl, send]);

  const fields = useMemo(() => tpl?.fields ?? [], [tpl]);
  const suggestions = useMemo(() => suggestScriptureFieldMap(fields), [fields]);

  // A freshly picked template starts from the suggested mapping, like songs.
  useEffect(() => {
    if (!tpl || value.introFieldMap !== undefined) return;
    const seeded: Record<string, string> = {};
    for (const [k, m] of Object.entries(suggestions)) if (m.kind !== "none") seeded[k] = m.songFieldKey;
    onChange({ ...value, introFieldMap: seeded });
  }, [tpl, suggestions, value, onChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Field label="Intro template">
        <Select
          value={tplId}
          onChange={(e) => {
            const id = e.target.value;
            onChange(id ? { introTemplateId: id } : {});
          }}
        >
          <option value="">— None —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      {tplId && !tpl && <p style={{ fontSize: 12, color: colors.textDim }}>Loading template…</p>}
      {tpl && (
        <FieldMappingTable
          templateFields={fields}
          songFields={SCRIPTURE_FIELD_DESCRIPTORS}
          value={value.introFieldMap ?? {}}
          literals={value.introFieldLiterals ?? {}}
          suggestions={suggestions}
          onChange={(m) => onChange({ ...value, introFieldMap: m })}
          onLiteralsChange={(l) => onChange({ ...value, introFieldLiterals: l })}
        />
      )}
    </div>
  );
}
```

  If `FieldMappingTable` requires `confirmedKeys`/`onConfirm`, pass `confirmedKeys={new Set(Object.keys(value.introFieldMap ?? {}))}` and a no-op-ish `onConfirm={(k) => onChange({ ...value, introFieldMap: { ...value.introFieldMap, [k]: suggestions[k]?.kind !== "none" ? (suggestions[k] as { songFieldKey: string }).songFieldKey : "" } })}` after checking their exact types; record a ruling. If template-field types don't match `TemplateFieldLike`, map `fields.map((f) => ({ key: f.key, label: f.label, type: f.type }))`.

- [ ] **Step 2: Settings panel** — in `settings/scripture/page.tsx` add below the API.Bible panel:

```tsx
        <DefaultIntroPanel />
```

  and in the same file:

```tsx
function DefaultIntroPanel() {
  const [draft, setDraft] = useState<IntroConfig | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScriptureSettings()
      .then((s) => setDraft(s))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    if (!draft) return;
    setError(null);
    try {
      const s = await putScriptureSettings(draft);
      setScriptureSettingsCache(s);
      setSaved("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel title="Default scripture intro">
      <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
        Used by every scripture row unless the row sets its own intro or skips it.
      </p>
      {draft ? (
        <ScriptureIntroEditor value={draft} onChange={(n) => { setDraft(n); setSaved(null); }} />
      ) : (
        <p>Loading…</p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <Button variant="primary" disabled={!draft} onClick={() => void save()}>Save</Button>
        {saved && <span style={{ fontSize: 12, color: colors.ok }}>{saved}</span>}
      </div>
      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
    </Panel>
  );
}
```

  imports: `ScriptureIntroEditor, type IntroConfig` from `@/app/components/ScriptureIntroEditor`; `getScriptureSettings, putScriptureSettings` from `@/lib/scriptureClient`; `setScriptureSettingsCache` from `@/lib/scriptureSettings`.

- [ ] **Step 3: Row intro section** — `ScriptureRowModal.tsx`:
  - `SaveArgs` gains `intro: IntroConfig & { skipIntro?: boolean };`
  - `Step2` props gain `seedIntro?: IntroConfig & { skipIntro?: boolean }`; `onSave` becomes `(slides, templateId, intro) => void`.
  - In `Step2` state:

```tsx
  const [introMode, setIntroMode] = useState<"default" | "custom" | "none">(
    seedIntro?.skipIntro ? "none" : seedIntro?.introTemplateId ? "custom" : "default",
  );
  const [introCfg, setIntroCfg] = useState<IntroConfig>({
    introTemplateId: seedIntro?.introTemplateId,
    introFieldMap: seedIntro?.introFieldMap,
    introFieldLiterals: seedIntro?.introFieldLiterals,
  });
  const settings = useScriptureSettings();
  const defaultName = templates.find((t) => t.id === settings?.introTemplateId)?.name;
```

  - Render, after the "Text per slide" field:

```tsx
      <Field label="Intro" style={{ marginTop: 12 }}>
        <Select value={introMode} onChange={(e) => setIntroMode(e.target.value as "default" | "custom" | "none")}>
          <option value="default">Use default intro{defaultName ? ` (${defaultName})` : " (none set)"}</option>
          <option value="custom">Custom intro for this row</option>
          <option value="none">No intro</option>
        </Select>
      </Field>
      {introMode === "custom" && (
        <div style={{ marginTop: 8 }}>
          <ScriptureIntroEditor value={introCfg} onChange={setIntroCfg} />
        </div>
      )}
```

  - Save button: `onClick={() => onSave(slides, templateId, introMode === "custom" ? { ...introCfg, skipIntro: false } : introMode === "none" ? { skipIntro: true } : {})}`
  - Pass `seedIntro` from `editingRow` (`{ introTemplateId, introFieldMap, introFieldLiterals, skipIntro }`) where `seedSlides` is passed, and forward `intro` into `onSave({... , intro })`.
  - `shows/edit/page.tsx` `addScriptureRow`: build

```ts
    const introFields = {
      introTemplateId: args.intro.introTemplateId,
      introFieldMap: args.intro.introFieldMap,
      introFieldLiterals: args.intro.introFieldLiterals,
      skipIntro: args.intro.skipIntro || undefined,
    };
```

    and spread `...introFields` into both the edited row object and the new row literal (after `templateId`). Undefined values clear a previous override when switching back to "default".

- [ ] **Step 4: Typecheck and tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm vitest run apps/operator`
Expected: clean; PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/components/ScriptureIntroEditor.tsx apps/operator/src/app/settings/scripture/page.tsx apps/operator/src/app/components/ScriptureRowModal.tsx apps/operator/src/app/shows/edit/page.tsx
git commit -m "feat(operator): default scripture intro and per-row intro section"
```

---

### Task 10: Full verification

- [ ] **Step 1: Full suite + typecheck**

Run: `pnpm vitest run > .superpowers/full.log 2>&1; grep -E "Tests |FAIL" .superpowers/full.log; pnpm -w typecheck`
Expected: all PASS except the known pre-existing `server/src/pco/importPlan.test.ts` date test; typecheck clean.

- [ ] **Step 2: Manual run** (use the `run` skill; throwaway `OVERLAYSYS_DATA_DIR` with a copied template and an intro-capable template)
  1. Settings → Scripture → Default scripture intro: pick a template, mapping auto-suggests; Save.
  2. Add a scripture row (John 3:16-21) — Intro: "Use default intro (…)".
  3. Live page: Intro button visible; press it → intro on program, button shows "· queued".
  4. From a WS client script (Companion stand-in), send `{type:"scripture_goto",channel:"program",slideIdx:0}` → slide 1 on air, strip highlights slide 1; `scripture_advance +1` → slide 2.
  5. Song row: press Intro in the app, then send `song_jump_kind verse 1` → the song starts (proves the operator intro now queues).
  6. Row set to "No intro" → no Intro button.

- [ ] **Step 3: Commit any fixes found, with tests.**
