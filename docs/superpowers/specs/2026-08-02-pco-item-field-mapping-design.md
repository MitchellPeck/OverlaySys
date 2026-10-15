# Planning Center item details + field mapping — design

**Date:** 2026-08-02
**Status:** Approved, ready for implementation planning
**Builds on:** [`2026-07-29-pco-import-improvements-design.md`](./2026-07-29-pco-import-improvements-design.md)

Let the operator see everything Planning Center holds for a plan item, and bind
any of it to a graphic template's fields — by dropdown or by literal value —
the same way song fields bind to intro/outro templates. Bindings are stored on
the row, so re-importing a plan refreshes the graphic from PCO.

---

## Problem

The July 29 work made a template change auto-fill its fields from the plan item
via `mapPcoItemFields`, which runs the `suggestFieldMap` heuristic (exact key
match, then label similarity). That is a guess, and the operator's only recourse
when it guesses wrong is to retype the value by hand — which is then a dead
literal that no re-import will refresh.

Two things are missing:

1. **Visibility.** The operator cannot see what PCO actually holds for an item,
   so they cannot know what is available to map. Item notes — where most
   churches put the real content — are not fetched at all.
2. **Control.** There is no way to say "this template field comes from that PCO
   field." The heuristic either gets it right or you overwrite it.

---

## 1. Data model — bindings on the row

`GraphicRowSchema` (`packages/core/src/show.ts`) gains two optional fields,
mirroring `SongRow`'s `introFieldMap` / `introFieldLiterals` pattern:

```ts
/** templateFieldKey -> pcoItemFieldKey. Re-resolved on every import. */
fieldMap: z.record(z.string(), z.string()).optional(),
/**
 * templateFieldKey -> literal template string. May contain `{key}` tokens
 * naming PCO item fields; see interpolatePcoItemString. Literals win over
 * fieldMap entries for the same template field.
 */
fieldLiterals: z.record(z.string(), z.string()).optional(),
```

Both optional, so every existing show file parses unchanged with no migration.

**`data` remains the rendered truth.** The renderer, the companion module, the
channel take path, and the show editor all keep reading `data` and are untouched
by this spec. `fieldMap`/`fieldLiterals` are the *recipe* that regenerates
`data` at import time. This keeps the change confined to the import path.

**Precedence**, matching `resolveIntroTake`: for a given template field, a
literal wins over a map entry; a field with neither keeps whatever is already in
`data`.

### Re-import semantics

A row's bindings are re-resolved against fresh PCO data every time the plan is
imported into the same show (rows are already matched and replaced in place by
`sourceRef.itemId`). This is the feature's main payoff: the worship leader edits
a plan description in Planning Center, you re-import, the graphic updates.

**Consequence, stated plainly:** a hand-edit made to `data` in the show editor
is overwritten on re-import for any template field that carries a binding.
Fields with no binding are untouched. This matches how imported rows already
behave, but the new bindings make it reachable more often. It is the intended
trade — a binding is a declaration that PCO owns that field.

---

## 2. Core — the PCO item field surface

### Item notes

`PcoPlanItem` (`packages/core/src/pco/pcoTypes.ts`) gains:

```ts
export const PcoItemNoteSchema = z.object({
  categoryId: z.string(),
  /** Human category name, e.g. "Tech Notes". */
  category: z.string(),
  content: z.string(),
});
notes: z.array(PcoItemNoteSchema).optional(),
```

### Field descriptors

`listPcoItemFieldDescriptors` already exists (added July 29, currently with no
production caller — this feature is what it was built for). It gains one
descriptor per note category:

- **key:** `note_<slug>` where `<slug>` is the category name lowercased with
  runs of non-alphanumerics collapsed to `_` and leading/trailing `_` trimmed.
  The `note_` prefix guarantees a note category named "Title" cannot collide
  with the built-in `title` key.
- **label:** the category name verbatim.
- **collisions:** if two categories slugify identically, the second and
  subsequent get `_2`, `_3`, … appended, in the order PCO returned them.
- Notes with empty `content` are omitted, consistent with how the eight existing
  descriptors omit absent values.

The eight existing descriptors (`title`, `description`, `details`, `song_title`,
`author`, `ccli`, `copyright`, `arrangement`) keep their keys and order, and
notes follow them.

### Two new pure functions

Both live beside `mapPcoItemFields` in `packages/core/src/pco/mapPlanItems.ts`.

```ts
export function interpolatePcoItemString(
  template: string,
  item: PcoPlanItem,
): string
```

`{key}` token substitution over the item's field descriptors — a direct parallel
to `interpolateSongString`, with the same rules: `{{` emits a literal `{`, an
unterminated `{` emits the rest verbatim rather than throwing, and an unknown
key resolves to the empty string.

```ts
export function resolvePcoItemFields(
  item: PcoPlanItem,
  templateFields: TemplateFieldLike[],
  fieldMap: Record<string, string> | undefined,
  fieldLiterals: Record<string, string> | undefined,
): Record<string, string>
```

The single resolver that both the import UI's live preview and the server's
import call. Having one function rather than two implementations is what stops
the preview and the imported result from drifting.

Resolution per template field: literal (interpolated) → mapped field's value →
absent from the result. Only `type: "text"` template fields are resolved, for
the reason given in §4.

`mapPcoItemFields` is unchanged. Its role shifts from "produces the final
values" to "produces the initial suggested bindings."

---

## 3. Server

### Fetching notes

`server/src/pco/pcoClient.ts`'s `getPlanItems` fetches item notes alongside song
and arrangement.

**To verify at implementation:** whether PCO Services v2 supports
`?include=item_notes` on the plan-items endpoint. If it does, add it to the
existing include list — no extra round trip. If it does not, fall back to one
`GET /service_types/{st}/plans/{plan}/items/{item}/item_notes` per song/graphic
item, issued concurrently and bounded by the existing pagination/429 retry
helper. The fallback costs one request per item, which is acceptable for plans
of 10-40 items but should be noted in the implementation plan so it is a
conscious choice rather than a surprise.

Note categories are workspace-configured in PCO; the client passes through
whatever it receives and does not assume any particular category exists.

### Import

`ImportItemConfig` (both `server/src/pco/importPlan.ts` and
`apps/operator/src/lib/pcoClient.ts`) gains `fieldMap?` and `fieldLiterals?`.

In the graphic-row branch, `importPlan`:

1. Starts from `cfg.data` (which carries the non-text fields the UI edits
   directly, plus any unbound text field).
2. Overlays `resolvePcoItemFields(item, templateFields, cfg.fieldMap, cfg.fieldLiterals)`
   on top, so a bound field always takes its value from the binding and an
   unbound field keeps whatever the UI sent. Explicitly: bound wins over
   `cfg.data` for the same key.
3. Stores `fieldMap` and `fieldLiterals` on the row via `buildGraphicRow`,
   omitting either when empty (absent, not `{}`, matching how the song field
   maps normalize).

The existing fallback — when a client sends neither bindings nor `data`,
`pcoItemGraphicDefaults` seeds from `mapPcoItemFields` — is retained unchanged
for API clients and older payloads.

---

## 4. Operator UI

### Details disclosure

Each item card on the import page gets a collapsible **Details** section listing
every PCO field for that item as label / value pairs, read-only, notes included.
Long values wrap; `details` (from `htmlDetails`) is shown tag-stripped, matching
what a binding would actually produce. Fields with no value are omitted, so the
list shows what is genuinely available to map.

### Mapping table

The current flat field form is replaced by a mapping table for the template's
**text** fields: `template field ← [dropdown of PCO fields | Literal value…]`,
seeded from `mapPcoItemFields` with the same "suggested" pill and confirm
behavior the intro/outro table uses.

`FieldMappingTable` is reused, not forked. Its props are already generic in
everything but naming — it is a pure props-in/events-out component with no store
access. The change is a rename (`songFields` → `sourceFields`,
`songFieldKey` → `sourceFieldKey` in `SuggestedFieldMatch`) applied across its
three existing call sites (song editor, `SongOverrideEditor`, the SongRow
editor). No behavior change at those sites.

**Deliberate divergence from intro/outro, approved:** the intro/outro table puts
every template field behind the dropdown, including image and color fields.
Graphic templates use images and colors far more heavily than lyric templates
do, and routing those through a plain text input would lose the color picker and
asset picker the operator has today. So the import page splits them:

- **Text fields** → the mapping table (dropdown + literal mode).
- **Image / color / video / time / number fields** → keep their existing
  `FieldInput`, grouped below under a "Fixed values" heading.

Non-text fields therefore cannot be bound to a PCO field. `mapPcoItemFields`
already refuses to fill them, so nothing that works today is lost.

### Interaction with the template-change refill

Changing a row's template keeps bindings whose template-field key exists on the
new template and drops the rest — the same rule `refillItemFields` already
applies to typed values, extended to bindings. Fields new to the template get
fresh suggestions from `mapPcoItemFields`.

---

## 5. Testing

Everything load-bearing is pure and lands in `.ts` files, which Vitest does
collect (`.tsx` is never collected — there is no component test harness):

- `interpolatePcoItemString`: token substitution, `{{` escape, unterminated
  brace, unknown key → empty.
- `listPcoItemFieldDescriptors` with notes: category → `note_<slug>` keys, slug
  collision suffixing, empty-content omission, `note_` prefix preventing
  collision with a built-in key.
- `resolvePcoItemFields`: literal beats map, map resolves, unbound field absent,
  non-text template fields never resolved.
- `importPlan`: bindings are stored on the row; a re-import with *changed* PCO
  data re-resolves them and updates `data`; an unbound field is left alone;
  explicit `cfg.data` for a non-text field survives the merge.

The details disclosure and the mapping table itself remain typecheck-and-review
only, consistent with the rest of the operator app.

---

## Out of scope

- **CCLI SongSelect lyric fetching.** Tracked as a separate spec (Spec B). It
  shares no code with this work — it is a lyrics-fetch transport behind
  `buildImportedSong`, not import-UI plumbing.
- **Binding non-text template fields** (image, color, video, time, number) to
  PCO fields. See §4.
- **Resolving bindings at take time.** `data` stays the rendered truth;
  bindings are resolved only at import. Making the renderer binding-aware would
  be a much larger change touching the channel take path for no current benefit.
- **Bindings on song rows or scripture rows.** Graphic rows only.
- **Editing bindings from the show editor.** They are set on the import page;
  the show editor continues to edit `data` directly.
- **Writing back to Planning Center.** Read-only, as today.
