# Planning Center Import Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Planning Center import refill overlay-template fields from the plan item when the template changes, let the operator fully configure each song the import will create, and open the imported show when the import succeeds.

**Architecture:** A new pure mapper in `packages/core` turns a PCO plan item into template field values by reusing the existing `suggestFieldMap` heuristic; both the operator UI and the server import fall back to it, so client and server agree. The song editor UI is extracted from `apps/operator/src/app/songs/edit/page.tsx` into a controlled `SongDraftEditor` component so the import page can host the exact same editor inside a modal; the resulting `Song` draft rides along in the import request and the server persists it (owning id resolution and PCO stamps). Navigation after import is a small addition to the import page's success path.

**Tech Stack:** TypeScript, pnpm workspaces + turbo, Zod (schemas in `packages/core`), Vitest (node environment, `*.test.ts` only — there is no React component test harness), React 19 / Next.js (static export) for `apps/operator`, Fastify for `server`.

## Global Constraints

- Run tests with `pnpm test` (root Vitest). Vitest only collects `packages/*/src/**/*.test.ts`, `server/src/**/*.test.ts`, `apps/desktop/src/**/*.test.ts`, `apps/operator/src/**/*.test.ts` — **`.tsx` files are never collected**, so UI behavior that must be tested has to live in a `.ts` module.
- Typecheck with `pnpm typecheck`, lint with `pnpm lint` (both run through turbo across all workspaces).
- `packages/core` is pure: no I/O, no React, no server imports. Everything there must be deterministic (ids/timestamps are passed in).
- Never trust a client-supplied library id. The server resolves song ids itself.
- Existing behavior that must not regress: re-importing the same plan updates rows in place by `sourceRef.itemId`, and previously imported songs are matched by `customFields.pco_song_id`.
- Match the surrounding code style: named exports, JSDoc block comments explaining *why* on non-obvious logic, `colors`/`space` tokens from `@overlaysys/ui` rather than hard-coded values.
- Commit after each task with a `feat(scope):` / `refactor(scope):` / `fix(scope):` message. Current branch is `feat/song-arrangement-override`; stay on it.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/pco/mapPlanItems.ts` (modify) | Add `listPcoItemFieldDescriptors` + `mapPcoItemFields`; re-point `pcoItemGraphicDefaults` at the new mapper | 1 |
| `packages/core/src/pco/mapPlanItems.test.ts` (modify) | Unit tests for the mapper; update the changed `pcoItemGraphicDefaults` signature | 1 |
| `server/src/pco/importPlan.ts` (modify) | Use template fields (not just the first text field) for the graphic fallback; accept a client-configured `song` draft | 1, 4 |
| `apps/operator/src/lib/pcoFieldRefill.ts` (create) | Pure merge of "refill from PCO" + "keep the user's edits", so it is unit-testable | 2 |
| `apps/operator/src/lib/pcoFieldRefill.test.ts` (create) | Tests for that merge | 2 |
| `apps/operator/src/app/pco/page.tsx` (modify) | Track edited keys, refill on template change, host the New-songs section + modal, navigate after import | 2, 5, 6 |
| `apps/operator/src/app/songs/edit/SongDraftEditor.tsx` (create) | Controlled song editor (metadata, custom fields, defaults, sections, arrangement), extracted verbatim from the page | 3 |
| `apps/operator/src/app/songs/edit/page.tsx` (modify) | Keeps routing, load, save, chrome, paste-lyrics; renders `SongDraftEditor` | 3 |
| `apps/operator/src/lib/pcoClient.ts` (modify) | `ImportItemConfig.song?: Song` | 4 |
| `server/src/pco/importPlan.test.ts` (modify) | Tests for the supplied-draft path | 4 |

Task order matters: 1 → 2 (2 consumes the core mapper), 3 → 5 (5 renders the extracted editor), 4 → 5 (5 sends the field 4 accepts). 6 is independent.

---

### Task 1: Core mapper — PCO plan item → template field values

**Files:**
- Modify: `packages/core/src/pco/mapPlanItems.ts` (add mapper near `pcoItemGraphicDefaults`, currently line ~201-219)
- Modify: `packages/core/src/pco/mapPlanItems.test.ts`
- Modify: `server/src/pco/importPlan.ts:108-115` (the `titleFieldFor` memo) and `:224` (its call site)

**Interfaces:**
- Consumes: `suggestFieldMap`, `FieldDescriptor`, `TemplateFieldLike` from `packages/core/src/songResolution.ts` (already exported through `@overlaysys/core`).
- Produces:
  - `listPcoItemFieldDescriptors(item: PcoPlanItem): FieldDescriptor[]`
  - `mapPcoItemFields(item: PcoPlanItem, templateFields: TemplateFieldLike[]): Record<string, string>`
  - `pcoItemGraphicDefaults(item: PcoPlanItem, templateFields?: TemplateFieldLike[]): { data: Record<string, string>; notes?: string }` — **signature change**, second parameter was `titleField?: string`.

Background: `suggestFieldMap(templateFields, descriptors)` returns a `Record<templateFieldKey, SuggestedFieldMatch>` where a match is `{kind:"exact"|"suggested", songFieldKey}` or `{kind:"none"}`. It matches exact keys case-insensitively first, then greedily by label similarity, and every template field key is present in the result.

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/pco/mapPlanItems.test.ts`, after the existing `describe("buildImportedSong", …)` block (keep the existing imports and add `listPcoItemFieldDescriptors`, `mapPcoItemFields` to the import list from `./mapPlanItems`):

```ts
describe("mapPcoItemFields", () => {
  const fullItem: PcoPlanItem = {
    id: "item-1",
    title: "Amazing Grace",
    itemType: "song",
    description: "Band only",
    htmlDetails: "<p>Key of <b>G</b></p>",
    song: { id: "pco-123", title: "Amazing Grace (Live)", author: "John Newton", ccliNumber: "22025", copyright: "Public Domain" },
    arrangement: { id: "arr-1", name: "Sunday Arrangement", lyrics: "Verse 1\nx" },
  };

  it("lists only the descriptors the item actually carries", () => {
    const bare: PcoPlanItem = { id: "i", title: "Welcome", itemType: "header" };
    expect(listPcoItemFieldDescriptors(bare).map((d) => d.key)).toEqual(["title"]);
    expect(listPcoItemFieldDescriptors(fullItem).map((d) => d.key)).toEqual([
      "title", "description", "details", "song_title", "author", "ccli", "copyright", "arrangement",
    ]);
  });

  it("fills template fields whose key matches a PCO field exactly", () => {
    const data = mapPcoItemFields(fullItem, [
      { key: "title", label: "Headline", type: "text" },
      { key: "author", label: "By", type: "text" },
    ]);
    expect(data).toEqual({ title: "Amazing Grace", author: "John Newton" });
  });

  it("falls back to label similarity when keys differ", () => {
    const data = mapPcoItemFields(fullItem, [{ key: "line1", label: "Copyright", type: "text" }]);
    expect(data["line1"]).toBe("Public Domain");
  });

  it("seeds the first text field with the item title when nothing else claims it", () => {
    const data = mapPcoItemFields(
      { id: "i", title: "Welcome & Offering", itemType: "header" },
      [{ key: "line1", label: "Top Line", type: "text" }, { key: "line2", label: "Bottom Line", type: "text" }],
    );
    expect(data).toEqual({ line1: "Welcome & Offering" });
  });

  it("never writes into non-text template fields", () => {
    const data = mapPcoItemFields(fullItem, [
      { key: "title", label: "Title", type: "image" },
      { key: "author", label: "Author", type: "color" },
    ]);
    expect(data).toEqual({});
  });

  it("strips html from details", () => {
    const data = mapPcoItemFields(fullItem, [{ key: "details", label: "Details", type: "text" }]);
    expect(data["details"]).toBe("Key of G");
  });
});
```

Replace the existing `pcoItemGraphicDefaults` test (currently at line ~123) with:

```ts
  it("pcoItemGraphicDefaults maps item fields→template fields and description→notes", () => {
    const item: PcoPlanItem = { id: "item-2", title: "Offering", itemType: "header", description: "5 min" };
    expect(pcoItemGraphicDefaults(item, [{ key: "headline", label: "Headline", type: "text" }])).toEqual({
      data: { headline: "Offering" },
      notes: "5 min",
    });
    expect(pcoItemGraphicDefaults(item)).toEqual({ data: {}, notes: "5 min" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run packages/core/src/pco/mapPlanItems.test.ts`
Expected: FAIL — `listPcoItemFieldDescriptors is not a function` / `mapPcoItemFields is not a function`.

- [ ] **Step 3: Implement the mapper**

In `packages/core/src/pco/mapPlanItems.ts`, extend the imports at the top:

```ts
import {
  suggestFieldMap,
  type FieldDescriptor,
  type TemplateFieldLike,
} from "../songResolution";
```

Then replace the existing `pcoItemGraphicDefaults` function (and its doc comment) with this block:

```ts
/**
 * Plain-text-ify PCO's `htmlDetails`. PCO stores rich text there; template
 * fields are plain strings, so tags become newlines/nothing and the handful of
 * entities PCO actually emits are decoded.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Every value a plan item can contribute to a graphic template, in a fixed
 * order. `read` returns undefined when the item doesn't carry that value, in
 * which case the field is omitted entirely (so it can't be suggested).
 */
const PCO_ITEM_FIELD_SPECS: Array<{
  key: string;
  label: string;
  read: (item: PcoPlanItem) => string | undefined;
}> = [
  { key: "title", label: "Title", read: (i) => i.title },
  { key: "description", label: "Description", read: (i) => i.description },
  { key: "details", label: "Details", read: (i) => (i.htmlDetails ? stripHtml(i.htmlDetails) : undefined) },
  { key: "song_title", label: "Song Title", read: (i) => i.song?.title },
  { key: "author", label: "Author", read: (i) => i.song?.author },
  { key: "ccli", label: "CCLI Number", read: (i) => i.song?.ccliNumber },
  { key: "copyright", label: "Copyright", read: (i) => i.song?.copyright },
  { key: "arrangement", label: "Arrangement", read: (i) => i.arrangement?.name },
];

function pcoItemFields(item: PcoPlanItem): Array<FieldDescriptor & { value: string }> {
  const out: Array<FieldDescriptor & { value: string }> = [];
  for (const spec of PCO_ITEM_FIELD_SPECS) {
    const raw = spec.read(item);
    if (!raw || raw.trim() === "") continue;
    out.push({ key: spec.key, label: spec.label, type: "text", value: raw.trim() });
  }
  return out;
}

/**
 * Descriptors for the values this plan item carries — the PCO-side half of a
 * {@link suggestFieldMap} call. Values with no content are omitted so they
 * never get suggested for a template field.
 */
export function listPcoItemFieldDescriptors(item: PcoPlanItem): FieldDescriptor[] {
  return pcoItemFields(item).map(({ key, label, type }) => ({ key, label, type }));
}

/**
 * Derive template field values from a plan item, reusing the same
 * exact-key-then-label-similarity heuristic the song intro/outro mapping
 * tables use. Only `text` fields are filled — an image/color/time field can't
 * hold a PCO string, and label similarity would happily suggest one.
 *
 * Fallback (the original seeding behavior): if the template's first text field
 * ends up empty, it gets the item title.
 */
export function mapPcoItemFields(
  item: PcoPlanItem,
  templateFields: TemplateFieldLike[],
): Record<string, string> {
  const textFields = templateFields.filter((f) => f.type === "text");
  const fields = pcoItemFields(item);
  const valueByKey = new Map(fields.map((f) => [f.key, f.value]));
  const suggestions = suggestFieldMap(
    textFields,
    fields.map(({ key, label, type }) => ({ key, label, type })),
  );

  const data: Record<string, string> = {};
  for (const [templateKey, match] of Object.entries(suggestions)) {
    if (match.kind === "none") continue;
    const value = valueByKey.get(match.songFieldKey);
    if (value) data[templateKey] = value;
  }

  const first = textFields[0];
  if (first && !data[first.key] && item.title.trim() !== "") {
    data[first.key] = item.title.trim();
  }
  return data;
}

/**
 * Default graphic field values + notes for a plan item: field values come from
 * {@link mapPcoItemFields} and PCO's plain-text description / html details
 * become the row `notes`. Used as a server-side fallback when the client sends
 * no explicit field values.
 */
export function pcoItemGraphicDefaults(
  item: PcoPlanItem,
  templateFields: TemplateFieldLike[] = [],
): { data: Record<string, string>; notes?: string } {
  const notesParts = [item.description, item.htmlDetails].filter(
    (v): v is string => !!v && v.trim() !== "",
  );
  return {
    data: mapPcoItemFields(item, templateFields),
    ...(notesParts.length > 0 ? { notes: notesParts.join("\n\n") } : {}),
  };
}
```

- [ ] **Step 4: Run the core tests to verify they pass**

Run: `pnpm vitest run packages/core/src/pco/mapPlanItems.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Update the server's fallback to pass template fields**

In `server/src/pco/importPlan.ts`, replace the `titleFieldCache` / `titleFieldFor` block (lines ~108-115) with:

```ts
  // Memoize each template's field list (used only when a config omits explicit
  // field data and we fall back to deriving values from the plan item).
  const templateFieldsCache = new Map<string, Field[]>();
  async function templateFieldsFor(templateId: string): Promise<Field[]> {
    const hit = templateFieldsCache.get(templateId);
    if (hit) return hit;
    const tpl = await getTemplate(templateId);
    const fields = tpl?.fields ?? [];
    templateFieldsCache.set(templateId, fields);
    return fields;
  }
```

Add `type Field` to the `@overlaysys/core` import list at the top of the file.

Then at the call site (line ~224) change:

```ts
        const defaults = pcoItemGraphicDefaults(item, await titleFieldFor(templateId));
```

to:

```ts
        const defaults = pcoItemGraphicDefaults(item, await templateFieldsFor(templateId));
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS. (`server/src/pco/importPlan.test.ts` exercises the fallback via `item-C`; its assertion is on `notes`, which is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pco/mapPlanItems.ts packages/core/src/pco/mapPlanItems.test.ts server/src/pco/importPlan.ts
git commit -m "feat(core): map PCO plan item values onto template text fields"
```

---

### Task 2: Refill line-item fields when the overlay template changes

**Files:**
- Create: `apps/operator/src/lib/pcoFieldRefill.ts`
- Create: `apps/operator/src/lib/pcoFieldRefill.test.ts`
- Modify: `apps/operator/src/app/pco/page.tsx` (`ItemCfg` at :45-53, seeding effect at :133-151, `onPickPlan` at :239-253, `setKind` at :275-285, and the two card callbacks at :459-463)

**Interfaces:**
- Consumes: `mapPcoItemFields` (Task 1), `PcoPlanItem`, `Field` from `@overlaysys/core`.
- Produces: `refillItemFields(opts: { item: PcoPlanItem; templateFields: Field[]; data: Record<string,string>; edited: ReadonlySet<string> }): Record<string, string>` — used by the import page on template change and on first seed.

- [ ] **Step 1: Write the failing test**

Create `apps/operator/src/lib/pcoFieldRefill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Field, PcoPlanItem } from "@overlaysys/core";
import { refillItemFields } from "./pcoFieldRefill";

const item: PcoPlanItem = {
  id: "i1",
  title: "Announcements",
  itemType: "item",
  description: "Two slides",
};

const oldFields: Field[] = [{ key: "headline", label: "Headline", type: "text" }];
const newFields: Field[] = [
  { key: "headline", label: "Headline", type: "text" },
  { key: "description", label: "Description", type: "text" },
];

describe("refillItemFields", () => {
  it("fills the new template's fields from the plan item", () => {
    expect(
      refillItemFields({ item, templateFields: newFields, data: {}, edited: new Set() }),
    ).toEqual({ headline: "Announcements", description: "Two slides" });
  });

  it("keeps a user-edited value when the new template has that field", () => {
    const out = refillItemFields({
      item,
      templateFields: newFields,
      data: { headline: "Hand typed" },
      edited: new Set(["headline"]),
    });
    expect(out).toEqual({ headline: "Hand typed", description: "Two slides" });
  });

  it("drops a user-edited value when the new template has no such field", () => {
    const out = refillItemFields({
      item,
      templateFields: [{ key: "line1", label: "Line 1", type: "text" }],
      data: { headline: "Hand typed" },
      edited: new Set(["headline"]),
    });
    expect(out).toEqual({ line1: "Announcements" });
  });

  it("does not carry over auto-filled values from the previous template", () => {
    const seeded = refillItemFields({ item, templateFields: oldFields, data: {}, edited: new Set() });
    const out = refillItemFields({
      item,
      templateFields: [{ key: "description", label: "Description", type: "text" }],
      data: seeded,
      edited: new Set(),
    });
    expect(out).toEqual({ description: "Two slides" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/operator/src/lib/pcoFieldRefill.test.ts`
Expected: FAIL — cannot resolve `./pcoFieldRefill`.

- [ ] **Step 3: Implement the helper**

Create `apps/operator/src/lib/pcoFieldRefill.ts`:

```ts
import { mapPcoItemFields, type Field, type PcoPlanItem } from "@overlaysys/core";

/**
 * Recompute a graphic row's field values for a (possibly new) template.
 *
 * Everything is re-derived from the PCO plan item, then the values the
 * operator typed by hand are layered back on top — but only for keys the new
 * template actually declares. Auto-filled values from the previous template
 * are intentionally dropped: they were derived, not chosen, and their keys
 * are meaningless to the new template.
 */
export function refillItemFields(opts: {
  item: PcoPlanItem;
  templateFields: Field[];
  data: Record<string, string>;
  edited: ReadonlySet<string>;
}): Record<string, string> {
  const next = mapPcoItemFields(opts.item, opts.templateFields);
  const declared = new Set(opts.templateFields.map((f) => f.key));
  for (const key of opts.edited) {
    if (!declared.has(key)) continue;
    const value = opts.data[key];
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run apps/operator/src/lib/pcoFieldRefill.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Track edited keys in the import page config**

In `apps/operator/src/app/pco/page.tsx`:

Add the import:

```ts
import { refillItemFields } from "@/lib/pcoFieldRefill";
```

Extend `ItemCfg` (line ~45):

```ts
interface ItemCfg {
  include: boolean;
  kind: RowKind;
  songAction: SongAction;
  songId?: string;
  lyricTemplateId: string;
  graphicTemplateId: string;
  data: Record<string, string>;
  /** Field keys the operator typed into — preserved across template changes. */
  edited: Set<string>;
}
```

In `onPickPlan`'s `nextCfgs` loop (line ~244) add `edited: new Set<string>(),` to the object literal.

Change the field-change callback passed to `ItemConfigCard` (line ~461):

```tsx
                        onFieldChange={(key, value) =>
                          patch(item.id, (c) => ({
                            ...c,
                            data: { ...c.data, [key]: value },
                            edited: new Set(c.edited).add(key),
                          }))
                        }
```

- [ ] **Step 6: Refill on template change and re-key the seeding guard**

Replace the seeding effect (lines ~131-151) with:

```tsx
  // Fill a graphic row's fields from its PCO item once the chosen template's
  // body arrives. Keyed by item+template so switching templates re-seeds
  // (the switch handler below covers the warm-cache case; this covers the
  // cold one). `refillItemFields` preserves anything the user typed.
  useEffect(() => {
    setCfgs((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        const c = next[item.id];
        if (!c || c.kind !== "item") continue;
        const seedKey = `${item.id}:${c.graphicTemplateId}`;
        if (seededRef.current.has(seedKey)) continue;
        const tpl = templateCache[c.graphicTemplateId];
        if (!tpl) continue; // wait for the body, retry when it arrives
        seededRef.current.add(seedKey);
        const data = refillItemFields({
          item,
          templateFields: tpl.fields,
          data: c.data,
          edited: c.edited,
        });
        next[item.id] = { ...c, data };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [items, templateCache]);
```

Replace `setKind` (lines ~275-285) with:

```tsx
  function setKind(item: PcoPlanItem, kind: RowKind) {
    patch(item.id, (c) => {
      if (kind !== "item") return { ...c, kind };
      const tpl = templateCache[c.graphicTemplateId];
      if (!tpl) return { ...c, kind };
      seededRef.current.add(`${item.id}:${c.graphicTemplateId}`);
      return {
        ...c,
        kind,
        data: refillItemFields({
          item,
          templateFields: tpl.fields,
          data: c.data,
          edited: c.edited,
        }),
      };
    });
  }
```

Replace the `onGraphicTemplate` callback passed to `ItemConfigCard` (line ~460) with:

```tsx
                        onGraphicTemplate={(id) =>
                          patch(item.id, (c) => {
                            const tpl = templateCache[id];
                            if (!tpl) return { ...c, graphicTemplateId: id };
                            seededRef.current.add(`${item.id}:${id}`);
                            return {
                              ...c,
                              graphicTemplateId: id,
                              data: refillItemFields({
                                item,
                                templateFields: tpl.fields,
                                data: c.data,
                                edited: c.edited,
                              }),
                            };
                          })
                        }
```

- [ ] **Step 7: Verify build + behavior**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

Manual check (needs a Planning Center connection): `pnpm desktop`, open **Planning Center**, pick a service type + plan. For a non-song item, switch its **Template** between two templates with different field sets and confirm the new template's text fields arrive pre-filled (title, description, details). Type a custom value into a field, switch to a template that declares the same field key, and confirm the typed value survives; switch to one that doesn't and confirm it's gone.

- [ ] **Step 8: Commit**

```bash
git add apps/operator/src/lib/pcoFieldRefill.ts apps/operator/src/lib/pcoFieldRefill.test.ts apps/operator/src/app/pco/page.tsx
git commit -m "feat(operator): refill PCO item fields when the row template changes"
```

---

### Task 3: Extract `SongDraftEditor` from the song edit page

Pure refactor — no behavior change. The goal is a controlled editor the import page can mount inside a modal.

**Files:**
- Create: `apps/operator/src/app/songs/edit/SongDraftEditor.tsx`
- Modify: `apps/operator/src/app/songs/edit/page.tsx`

**Interfaces:**
- Produces: `export function SongDraftEditor({ draft, onChange }: { draft: Song; onChange: (next: Song) => void }): JSX.Element`
- `page.tsx` continues to own load/save; it passes `draft` and `setDraft`.

- [ ] **Step 1: Create the component shell**

Create `apps/operator/src/app/songs/edit/SongDraftEditor.tsx` with this header and skeleton (the panels get filled in by the next step):

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Song,
  type Section,
  type SuggestedFieldMatch,
  listSongFieldDescriptors,
  suggestFieldMap,
} from "@overlaysys/core";
import { Button, Field, Input, Panel, Select, Textarea, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { isCloudMode } from "@/lib/mode";
import { getTemplateCloud } from "@/lib/cloudData";
import { FieldMappingTable } from "./FieldMappingTable";

/**
 * Controlled editor for a single {@link Song} draft: metadata, custom fields,
 * intro/outro + channel defaults, sections/slides and the default arrangement.
 * Extracted from the song edit page so the Planning Center import can offer
 * the same editor for songs it is about to create — the page owns loading and
 * saving, this component owns nothing but the draft.
 */
export function SongDraftEditor({
  draft,
  onChange,
}: {
  draft: Song;
  onChange: (next: Song) => void;
}) {
  // ...
}
```

- [ ] **Step 2: Move the editor internals across verbatim**

Move these from `page.tsx` into `SongDraftEditor` (line numbers are pre-refactor hints; the symbol names are the anchor). Nothing here should be rewritten beyond the mechanical `setDraft` change described below.

Into the component body:
- `templates`, `templateCache`, `setTemplate`, `projects`, `currentProjectId` store reads (:47-51), `conn` (:44), `send` (:43), `cloud` (:72)
- `channelConfigs` + `channelChoices` (:52-56)
- `introConfirmed` / `outroConfirmed` state (:66-67)
- `newFieldKey` / `newFieldError` state (:69-70)
- `dragSecIdx` / `secDropZone` state (:59-60)
- `const { confirm, dialog } = useDialog();` (:71 — `alert` stays in the page for cloud errors)
- `moveSection` (:87-98)
- the template-hydration effect (:127-160)
- `projectSchema`, `songFieldDescriptors`, `introTemplate`, `outroTemplate`, `introSuggestions`, `outroSuggestions` (:167-187)
- both cold-cache seeding effects (:195-224)
- `setMeta`, `projectSchemaKeyMap`, `adHocKeys`, `addAdHocField`, `updateSection`, `updateSlide`, `addSlide`, `removeSlide`, `addSection`, `removeSection`, `setCustomField`, `removeCustomField`, `changeSubTakeTemplate` (:228-441)

Into the module scope (below the component):
- `SECTION_ID_PREFIX`, `KIND_LABEL` (:901-919)
- `ArrangementEditor` (:921-1048)

Into the returned JSX (wrapped in a `<>…</>` fragment, in this order):
- the `Metadata` panel (:483-517)
- the `Custom Fields` panel (:519-600)
- the `Defaults` panel (:602-741)
- the `Sections` heading + empty state + `draft.sections.map(...)` block (:743-861)
- the add-section button row (:863-883)
- the `Default Arrangement` panel (:885-894)
- `{dialog}` last (the delete-section confirm lives here now)

Mechanical changes while moving:
- `setDraft((d) => (d ? { ...d, X } : d))` becomes `onChange({ ...draft, X })`.
- `setDraft((d) => { … return next; })` bodies that read `d` become straight-line code against `draft`, e.g.:

```tsx
  function moveSection(from: number, to: number) {
    if (from === to) return;
    const next = draft.sections.slice();
    const [removed] = next.splice(from, 1);
    if (!removed) return;
    const adjustedTo = from < to ? to - 1 : to;
    next.splice(adjustedTo, 0, removed);
    onChange({ ...draft, sections: next });
  }
```

- `setMeta` becomes:

```tsx
  function setMeta<K extends keyof Song>(key: K, value: Song[K]) {
    onChange({ ...draft, [key]: value });
  }
```

- Drop the `if (!draft) return …` guards and the `draft!` non-null assertions (`draft` is a required prop now).
- In the seeding effects, `setDraft((d) => (d ? { ...d, defaultIntroFieldMap: next } : d))` becomes `onChange({ ...draft, defaultIntroFieldMap: next })`; keep the existing `eslint-disable-next-line react-hooks/exhaustive-deps` comments and the `[introTemplate]` / `[outroTemplate]` dep arrays exactly as they are.

- [ ] **Step 3: Slim the page down to load/save/chrome**

In `apps/operator/src/app/songs/edit/page.tsx`:
- Delete everything moved in Step 2.
- Keep: `useSearchParams` + Suspense wrapper, `id`, `send`, `conn`, `cached`, `setSongInStore`, `templates` (still needed for the cloud template-metas load effect), `draft`/`setDraft`, `pasteOpen`, `alert` + `dialog` from `useDialog()`, `cloud`, `showCloudError`, the song-load effect (:100-125), `save()`, `PageChrome`, `PasteLyricsModal`, and the `if (!draft) return …` guard.
- Replace the panels in `PageBody` with:

```tsx
      <PageBody maxWidth={1100} style={{ height: "100%" }}>
        {pasteOpen && (
          <PasteLyricsModal
            song={draft}
            onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            onClose={() => setPasteOpen(false)}
          />
        )}
        <SongDraftEditor draft={draft} onChange={setDraft} />
      </PageBody>
      {dialog}
```

- Add `import { SongDraftEditor } from "./SongDraftEditor";` and remove imports that are now unused (`Field`, `Input`, `Panel`, `Select`, `Textarea`, `Section`, `SuggestedFieldMatch`, `listSongFieldDescriptors`, `suggestFieldMap`, `FieldMappingTable`, `useResolvedChannelConfigs`, `getTemplateCloud`, `useMemo` — verify against the final file; `pnpm lint` will flag leftovers).

- [ ] **Step 4: Verify the refactor is inert**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS, with no unused-import warnings.

Manual check: `pnpm desktop` → **Songs** → open a song. Confirm every panel renders as before; edit the title, add a custom field, pick an intro template and confirm the mapping table appears with suggestions, drag a section to reorder, delete a section (confirm dialog appears), edit the default arrangement, then **Save** and reload the page to confirm the changes persisted.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/app/songs/edit/SongDraftEditor.tsx apps/operator/src/app/songs/edit/page.tsx
git commit -m "refactor(operator): extract SongDraftEditor from the song edit page"
```

---

### Task 4: Server accepts a fully configured song draft

**Files:**
- Modify: `server/src/pco/importPlan.ts` (`ImportItemConfig` at :37-50, song-resolution loop at :127-172, row loop at :196-234)
- Modify: `apps/operator/src/lib/pcoClient.ts` (`ImportItemConfig` at :48-56)
- Modify: `server/src/pco/importPlan.test.ts`

**Interfaces:**
- Produces: `ImportItemConfig.song?: Song` — when set on a `kind: "song"` item, the server persists that song instead of building one from PCO data. The server still owns the id, the `pco_song_id` / `pco_arrangement_id` custom fields and `updatedAt`.

- [ ] **Step 1: Write the failing tests**

Add to `server/src/pco/importPlan.test.ts` inside the existing `describe("importPlan", …)` block. Add `PCO_SONG_ID_KEY` to the `@overlaysys/core` import at the top of the file, and add this helper next to `existingLibrarySong`:

```ts
function configuredDraft(overrides: Partial<Song> = {}): Song {
  return SongSchema.parse({
    id: "client-supplied-id",
    title: "Brand New Song",
    sections: [{ id: "c1", kind: "chorus", label: "Chorus", slides: [{ id: "c1s1", lines: ["edited line"] }] }],
    defaultArrangement: ["c1"],
    customFields: { hymn_number: "42" },
    defaultLyricTemplateId: "tpl-lyric",
    defaultIntroTemplateId: "tpl-intro",
    defaultIntroFieldLiterals: { line1: "{title}" },
    defaultChannel: "main",
    ...overrides,
  });
}
```

Then the tests:

```ts
  it("persists a client-configured song draft instead of rebuilding it", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft() }],
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ rows: 1, songsCreated: 1, songsUpdated: 0 });

    // The client id is ignored; the server derives the id from the PCO title.
    // (`songs.getSong` resolves to `Song | null`, so assert null, not undefined.)
    expect(await songs.getSong("client-supplied-id")).toBeNull();
    const saved = await songs.getSong("brand-new-song");
    expect(saved?.sections[0]?.slides[0]?.lines).toEqual(["edited line"]);
    expect(saved?.defaultIntroTemplateId).toBe("tpl-intro");
    expect(saved?.defaultIntroFieldLiterals).toEqual({ line1: "{title}" });
    expect(saved?.defaultChannel).toBe("main");
    expect(saved?.customFields["hymn_number"]).toBe("42");
    // PCO stamps are still applied on top of the draft.
    expect(saved?.customFields[PCO_SONG_ID_KEY]).toBe("pco-song-B");
    expect(saved?.customFields["pco_arrangement_id"]).toBe("arr-B");
    expect(saved?.updatedAt).toBe(NOW);
  });

  it("re-resolves a draft id that collides with an unrelated library song", async () => {
    await songs.saveSong(existingLibrarySong()); // id: amazing-grace

    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-A", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft({ id: "amazing-grace", title: "Amazing Grace" }) }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 1 });
    // The pre-existing library song is untouched...
    const untouched = await songs.getSong("amazing-grace");
    expect(untouched?.sections[0]?.slides[0]?.lines).toEqual(["x"]);
    // ...and the draft landed on a collision-free id.
    const created = await songs.getSong("amazing-grace-2");
    expect(created?.customFields[PCO_SONG_ID_KEY]).toBe("pco-song-A");
  });

  it("reuses the library id of a previously imported song and counts it as an update", async () => {
    await songs.saveSong(
      SongSchema.parse({
        id: "legacy-id",
        title: "Brand New Song",
        sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["old"] }] }],
        defaultArrangement: ["v1"],
        customFields: { [PCO_SONG_ID_KEY]: "pco-song-B", keep_me: "yes" },
      }),
    );

    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft() }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 0, songsUpdated: 1 });
    const saved = await songs.getSong("legacy-id");
    expect(saved?.sections[0]?.slides[0]?.lines).toEqual(["edited line"]);
    // Pre-existing custom fields survive underneath the draft's own.
    expect(saved?.customFields["keep_me"]).toBe("yes");
    expect(saved?.customFields["hymn_number"]).toBe("42");
    expect(await songs.getSong("brand-new-song")).toBeNull();
  });

  it("reports an invalid song draft and skips the row entirely", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [
          { itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: { id: "x", title: "y" } as unknown as Song },
          { itemId: "item-C", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } },
        ],
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.itemId).toBe("item-B");
    expect(result.counts.songsCreated).toBe(0);
    const show = await shows.getShow(result.showId!);
    // The bad item produced no row at all (not a silent graphic row), and the
    // healthy item still imported.
    expect(show?.rows.map((r) => r.sourceRef?.itemId)).toEqual(["item-C"]);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run server/src/pco/importPlan.test.ts`
Expected: FAIL — `song` is not a known property of `ImportItemConfig` (typecheck) and the assertions don't hold.

- [ ] **Step 3: Add the field to both `ImportItemConfig` declarations**

In `server/src/pco/importPlan.ts`, add to the interface (after `songId`):

```ts
  /**
   * Song kind + create: a fully configured song from the import UI, persisted
   * as-is. The server still owns the id, the PCO custom-field stamps and
   * `updatedAt` — a client id is never trusted.
   */
  song?: Song;
```

Extend the `@overlaysys/core` import list in that file with `PCO_ARRANGEMENT_ID_KEY`, `SongSchema`, and `type Song`.

In `apps/operator/src/lib/pcoClient.ts`, add `song?: Song;` to its `ImportItemConfig` and add `Song` to the type import from `@overlaysys/core`.

- [ ] **Step 4: Use the draft in the song-resolution loop**

In `server/src/pco/importPlan.ts`, declare a skip set just above the loop (next to `songIdByItem`, line ~126):

```ts
  // Items whose song could not be persisted. They are skipped in the row loop
  // rather than silently falling through to a graphic row.
  const failedItems = new Set<string>();
```

Replace the "Create — or update a previously imported song in place" block (lines ~148-171) with:

```ts
    // Create — or update a previously imported song in place.
    const existing = library.find(
      (s) => !s.deletedAt && s.customFields?.[PCO_SONG_ID_KEY] === pcoSong.id,
    );
    const id = existing ? existing.id : resolveImportedSongId(pcoSong, existingIds);

    let songToSave: Song;
    if (cfg.song) {
      // The operator configured this song in the import UI: persist their
      // draft verbatim, but keep ownership of identity + PCO stamps.
      const parsed = SongSchema.safeParse(cfg.song);
      if (!parsed.success) {
        errors.push({ itemId: item.id, message: `Invalid song configuration: ${parsed.error.message}` });
        failedItems.add(item.id);
        continue;
      }
      songToSave = {
        ...parsed.data,
        id,
        customFields: {
          ...(existing?.customFields ?? {}),
          ...parsed.data.customFields,
          [PCO_SONG_ID_KEY]: pcoSong.id,
          ...(item.arrangement ? { [PCO_ARRANGEMENT_ID_KEY]: item.arrangement.id } : {}),
        },
        updatedAt: now,
      };
    } else {
      const built = buildImportedSong(id, pcoSong, item.arrangement, {
        updatedAt: now,
        preserveCustomFields: existing?.customFields,
      });
      warnings.push(...built.warnings);
      songToSave = built.song;
    }

    try {
      await songs.saveSong(songToSave);
    } catch (err) {
      errors.push({ itemId: item.id, message: err instanceof Error ? err.message : String(err) });
      failedItems.add(item.id);
      continue;
    }
    if (existing) {
      counts.songsUpdated++;
    } else {
      counts.songsCreated++;
      existingIds.add(id);
      library.push(songToSave);
    }
    songIdByItem.set(item.id, id);
```

- [ ] **Step 5: Skip failed items in the row loop**

At the top of the row-building loop (`for (const item of chosen) {`, line ~196), add:

```ts
    if (failedItems.has(item.id)) continue;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run server/src/pco/importPlan.test.ts`
Expected: PASS — the four new tests plus the three pre-existing ones.

- [ ] **Step 7: Full verification + commit**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add server/src/pco/importPlan.ts server/src/pco/importPlan.test.ts apps/operator/src/lib/pcoClient.ts
git commit -m "feat(server): persist a client-configured song draft on PCO import"
```

---

### Task 5: "New songs" section + song config modal on the import page

**Files:**
- Modify: `apps/operator/src/app/pco/page.tsx`

**Interfaces:**
- Consumes: `SongDraftEditor` (Task 3), `ImportItemConfig.song` (Task 4), `buildImportedSong` / `resolveImportedSongId` from `@overlaysys/core`, `Modal` from `@overlaysys/ui`.

- [ ] **Step 1: Add imports and draft state**

In `apps/operator/src/app/pco/page.tsx`:

```ts
import {
  buildImportedSong,
  resolveImportedSongId,
  type Song,
} from "@overlaysys/core";   // merge into the existing type-only import block; these are value imports
import { Modal } from "@overlaysys/ui";   // add to the existing @overlaysys/ui import
import { SongDraftEditor } from "@/app/songs/edit/SongDraftEditor";
```

Add state next to the other item state (line ~79):

```ts
  const songMetas = useStore((s) => s.songs);
  const [songDrafts, setSongDrafts] = useState<Record<string, Song>>({});
  const [customizedSongs, setCustomizedSongs] = useState<Set<string>>(() => new Set());
  const [editingSongItemId, setEditingSongItemId] = useState<string | null>(null);
```

In `onPickPlan`, next to `seededRef.current = new Set();` (line ~254), reset them:

```ts
      setSongDrafts({});
      setCustomizedSongs(new Set());
      setEditingSongItemId(null);
```

- [ ] **Step 2: Derive the list and build drafts**

Add below `includedCount` (line ~290):

```tsx
  // Items that will put a NEW song into the library. Linked songs are excluded
  // on purpose — their configuration already lives in the library and the
  // import must not silently overwrite it.
  const creatingSongItems = useMemo(
    () =>
      items.filter((it) => {
        const c = cfgs[it.id];
        return (
          !!c?.include &&
          c.kind === "song" &&
          c.songAction === "create" &&
          it.itemType === "song" &&
          !!it.song
        );
      }),
    [items, cfgs],
  );

  // Build each draft with the same core builders the server would use, so the
  // modal shows exactly what would otherwise be created. Ids are resolved
  // against the library plus the drafts already built this session; the server
  // re-resolves anyway, this is just for display.
  useEffect(() => {
    setSongDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      const taken = new Set(songMetas.map((s) => s.id));
      for (const draft of Object.values(next)) taken.add(draft.id);
      for (const item of creatingSongItems) {
        if (next[item.id] || !item.song) continue;
        const songId = resolveImportedSongId(item.song, taken);
        taken.add(songId);
        next[item.id] = buildImportedSong(songId, item.song, item.arrangement).song;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [creatingSongItems, songMetas]);
```

- [ ] **Step 3: Send the drafts with the import**

In `doImport`'s payload loop (line ~308), change the song branch to:

```tsx
        if (isSong && c.kind === "song") {
          const draft = c.songAction === "create" ? songDrafts[it.id] : undefined;
          payload.push({
            itemId: it.id,
            kind: "song",
            songAction: c.songAction,
            songId: c.songAction === "link" ? c.songId : undefined,
            templateId: c.lyricTemplateId || undefined,
            ...(draft ? { song: draft } : {}),
          });
        } else {
```

- [ ] **Step 4: Render the section**

Insert between the Items panel and the Import target panel (after the block ending at line ~469):

```tsx
            {creatingSongItems.length > 0 && (
              <Panel title={`New songs (${creatingSongItems.length})`}>
                <Stack gap={2}>
                  <p style={{ color: colors.textDim, fontSize: 12 }}>
                    These songs will be written to the library on import. Edit one to
                    set its templates, fields, lyrics and arrangement first.
                  </p>
                  {creatingSongItems.map((item) => {
                    const draft = songDrafts[item.id];
                    const pv = previews[item.id];
                    // A prior-import (pco-id) match means the server updates that
                    // library song in place — the draft replaces its config.
                    const updatesExisting = pv?.match?.confidence === "pco-id";
                    return (
                      <div
                        key={item.id}
                        style={{
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: 12,
                        }}
                      >
                        <Inline gap={2} align="center">
                          <strong style={{ color: colors.text }}>
                            {draft?.title ?? item.title}
                          </strong>
                          <Pill tone={updatesExisting ? "warn" : "accent"} uppercase>
                            {updatesExisting ? "updates existing" : "creates new"}
                          </Pill>
                          {pv?.hasLyrics === false && (
                            <Pill tone="dim" uppercase>
                              no lyrics
                            </Pill>
                          )}
                          {customizedSongs.has(item.id) && (
                            <Pill tone="good" uppercase>
                              customized
                            </Pill>
                          )}
                          <div style={{ marginLeft: "auto" }}>
                            <Button
                              size="sm"
                              disabled={!draft}
                              onClick={() => setEditingSongItemId(item.id)}
                            >
                              Edit…
                            </Button>
                          </div>
                        </Inline>
                      </div>
                    );
                  })}
                </Stack>
              </Panel>
            )}
```

- [ ] **Step 5: Render the modal**

Add just inside the `status === "connected"` `<Stack gap={4}>`, after the section from Step 4:

```tsx
            {editingSongItemId && songDrafts[editingSongItemId] && (
              <SongDraftModal
                draft={songDrafts[editingSongItemId]!}
                onCancel={() => setEditingSongItemId(null)}
                onSave={(next) => {
                  const itemId = editingSongItemId;
                  setSongDrafts((prev) => ({ ...prev, [itemId]: next }));
                  if (JSON.stringify(next) !== JSON.stringify(songDrafts[itemId])) {
                    setCustomizedSongs((prev) => new Set(prev).add(itemId));
                  }
                  setEditingSongItemId(null);
                }}
              />
            )}
```

And add this component at the bottom of the file, next to `GraphicFields`:

```tsx
/**
 * Hosts {@link SongDraftEditor} in a modal with its own local draft, so
 * Cancel discards the operator's edits and Save commits them in one go.
 */
function SongDraftModal({
  draft,
  onCancel,
  onSave,
}: {
  draft: Song;
  onCancel: () => void;
  onSave: (next: Song) => void;
}) {
  const [local, setLocal] = useState<Song>(draft);
  return (
    <Modal
      open
      size="lg"
      title={`Configure “${draft.title}”`}
      onClose={onCancel}
      footer={
        <>
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => onSave(local)}>
            Save
          </Button>
        </>
      }
    >
      <SongDraftEditor draft={local} onChange={setLocal} />
    </Modal>
  );
}
```

- [ ] **Step 6: Verify**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

Manual check: `pnpm desktop` → **Planning Center** → pick a plan containing a song that isn't in the library yet. Confirm a **New songs** panel appears between Items and Import target, listing that song with a `creates new` pill. Click **Edit…**, confirm the full song editor renders inside the modal (metadata, custom fields, intro/outro defaults with mapping tables, sections, arrangement). Set an intro template, edit a lyric line, **Save**, and confirm the row now shows a `customized` pill. Switch the item's **Song** dropdown to "Link to …" (if a match exists) and confirm the row disappears from the section. Import, then open the created song from **Songs** and confirm the intro template and edited lyric persisted.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/app/pco/page.tsx
git commit -m "feat(operator): configure new songs before a Planning Center import"
```

---

### Task 6: Open the imported show

**Files:**
- Modify: `apps/operator/src/app/pco/page.tsx` (`doImport` at :298-341, result panel at :510-529)

- [ ] **Step 1: Add the router + navigation**

Add the imports:

```ts
import { useRouter } from "next/navigation";
import { refreshShowMetasCloud } from "@/lib/cloudData";   // merge with the existing getTemplateCloud import
```

Add `const router = useRouter();` next to the other hooks (line ~66).

Add a helper above `doImport`:

```tsx
  /**
   * Make the imported show the active one and jump to its editor. The server
   * already broadcasts show_list/song_list after an import, so local mode only
   * needs the get_show; cloud mode has no broadcast and refreshes explicitly.
   */
  const openShow = useCallback(
    async (showId: string) => {
      if (cloud) await refreshShowMetasCloud();
      else send({ type: "get_show", showId });
      router.push(`/shows/edit?id=${encodeURIComponent(showId)}`);
    },
    [cloud, send, router],
  );
```

In `doImport`, after `setResult(res);`:

```tsx
      setResult(res);
      if (res.ok && res.showId) await openShow(res.showId);
```

- [ ] **Step 2: Add an Open show button to the failed-import panel**

In the result panel (line ~510), after the errors `.map(...)`:

```tsx
                  {!result.ok && result.showId && (
                    <div>
                      <Button size="sm" onClick={() => void openShow(result.showId!)}>
                        Open show
                      </Button>
                    </div>
                  )}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Manual check: `pnpm desktop` → **Planning Center** → import a plan into a new show. The app should land on the show editor for the imported show with its rows present, and the header's show picker should show it as active.

- [ ] **Step 4: Commit**

```bash
git add apps/operator/src/app/pco/page.tsx
git commit -m "feat(operator): open the imported show after a successful PCO import"
```

---

## Verification checklist (after all tasks)

- [ ] `pnpm test` — all green, including the new core / operator / server tests
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — clean, no unused imports left behind by Task 3
- [ ] Song edit page behaves exactly as it did before Task 3
- [ ] Switching a line item's template refills its fields and keeps typed values
- [ ] A new song can be fully configured before import and the config persists
- [ ] A successful import lands on the imported show
