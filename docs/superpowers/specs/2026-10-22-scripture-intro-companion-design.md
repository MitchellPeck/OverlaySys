# Scripture intro + Companion scripture controls — design

Date: 2026-10-22
Status: approved in chat, awaiting spec review

## Goal

Scripture rows get an intro sub-take like songs. Taking the intro (from the
operator or Companion) puts it on air and **queues** the scripture on that
channel; the next scripture slide button (Next, "Slide N") then starts the
queued scripture. Companion gets full scripture controls, feedbacks and
variables. The operator's song Intro button also starts queuing (today only
Companion's does).

## Decisions (from brainstorming)

- Drive scripture like songs: a server-side scripture session per channel
  (intro → queued → slides → end), used by both the operator and Companion.
- Intro setup: global default (Settings → Scripture) + per-row override +
  per-row "Skip intro".
- Operator Intro buttons queue for both songs and scripture.
- New `scriptureSession` module mirroring `songSession`; songs untouched apart
  from the operator Intro button.

## 1. Intro configuration

### Row fields — `ScriptureRowSchema` (packages/core/src/show.ts)

```ts
introTemplateId: z.string().optional(),
introFieldMap: z.record(z.string(), z.string()).optional(),      // templateFieldKey -> scripture field key
introFieldLiterals: z.record(z.string(), z.string()).optional(), // templateFieldKey -> "{reference} ({translation})"
skipIntro: z.boolean().optional(),
```

### Global default

- Schema `ScriptureSettingsSchema` (packages/core): `{ introTemplateId?, introFieldMap?, introFieldLiterals? }`.
- Stored at `<dataRoot>/settings/scripture.json`; `GET/PUT /api/scripture/settings`.
- Settings → Scripture page gains a **Default intro** panel: template select +
  the existing `FieldMappingTable` (scripture field descriptors) + literals.

### Scripture intro fields

`reference` (row reference, e.g. "John 3:16-21"), `book` (book name),
`translation` (abbreviation, falls back to translation id), `translationName`,
`attribution`. Literal syntax identical to songs (`{key}`, `{{`/`}}` escapes,
unknown key → "").

### Resolution — `resolveScriptureIntro` (packages/core/src/scriptureIntro.ts)

```ts
resolveScriptureIntro(row, settings, templates, ctx: { translationName?: string })
  => { templateId: string; data: Record<string, string> } | null
```

- `skipIntro` → null. Template id, field map and literals each resolve
  independently: row value ?? settings value. No template id, or template not
  in `templates` → null.
- Per template field: literal (interpolated) → mapped field → `field.default ?? ""`
  (same order as `resolveSubTake`). Reuses `interpolateSongString`'s algorithm
  (shared helper extracted if needed).
- Also exports `listScriptureFieldDescriptors()` and `suggestScriptureFieldMap(template)`
  for the UI (title/heading-like fields ← reference, subtitle-like ← translation).

### Operator UI

- `ScriptureRowModal`: **Intro** section — "Use default intro" (shows the
  default's template name or "No default set"), "Custom" (template + mapping +
  literals), "No intro" (`skipIntro`).

## 2. Slide take data (moved to `@overlaysys/scripture`)

- Move `slideReference` from `apps/operator/src/lib/scriptureReference.ts` into
  `packages/scripture/src/slideData.ts`, plus:

```ts
scriptureSlideData(row: ScriptureRowLike, slideIdx: number)
  => { text: string; reference: string; translation: string; attribution: string }
```

  (same keys/values the take strip sends today). The operator imports from the
  package; its old module is deleted.

## 3. Server session — `server/src/scriptureSession.ts`

State per channel: `live: Map<channel, { showId, row, slideIdx }>`,
`queued: Map<channel, { showId, row }>`.

| Call | Behaviour |
|---|---|
| `takeIntro(ch, showId, row, intro)` | `channels.take(ch, intro.templateId, intro.data, …)` with `scriptureContext {rowId, sub:"intro"}` (drops any song/scripture session + queues), then `queue(ch, …)` |
| `takeSlide(ch, showId, row, idx)` | builds `scriptureSlideData`, takes it with `scriptureContext {rowId, sub:"slide", slideIdx}` via an internal take that keeps the scripture session, sets `live`, clears `queued`, reports api.bible usage |
| `advance(ch, ±1)` | live → move within `0..slideCount-1` (clamped, no-op at ends); no live + queued + `+1` → start queued at slide 0; `-1` with only queued → no-op |
| `goTo(ch, idx)` | live → that slide; no live + queued → start queued at idx; out of range → no-op |
| `end(ch)` | live → clear channel + session; only queued → drop queue, intro stays |
| `moveQueued(from, to)` | PVW→PGM of a scripture intro carries the queue |

Clear points (hooked in `server/src/channels.ts` beside the song ones):
external `take` drops scripture session + queue; operator `clear` drops both;
auto-out clear keeps the queue; `takePvwToPgm` moves the queue when the
promoted active has `scriptureContext.sub === "intro"`, else drops the
destination's; song takes and scripture takes end each other.

Row lookups use the stored show (`shows.getShow`) at message time; a missing
show/row/slide sends `error not_found`.

## 4. Protocol (packages/ws-protocol) and channel state (packages/core/src/channel.ts)

Client → server:

```ts
{ type: "scripture_take_intro", showId, rowId, channel? }
{ type: "scripture_take_slide", showId, rowId, slideIdx, channel? }
{ type: "scripture_advance", channel, delta: -1 | 1 }
{ type: "scripture_goto", channel, slideIdx }          // 0-based on the wire
{ type: "scripture_end", channel }
```

Channel resolution when omitted: `row.channelHint ?? "program"` (same as the
take strip today).

Channel state additions:

```ts
ActiveGraphic.scriptureContext?: { rowId: string; sub: "intro" } | { rowId: string; sub: "slide"; slideIdx: number }
ChannelState.scriptureSession?: { rowId: string; reference: string; slideIdx: number; slideCount: number; slideReference: string; text: string }
ChannelState.queuedScripture?: { rowId: string; reference: string }
```

`scripture_take_intro` with no resolvable intro → `error not_configured`
("No intro configured for this scripture row").

## 5. Companion module

Actions:
- `scripture_take_intro` (row by id), `scripture_take_intro_by_index`, `scripture_take_intro_at_cursor`
- `scripture_take_slide` (row by id + slide N), `_by_index`, `_at_cursor`
- `scripture_advance` (channel, delta), `scripture_goto` (channel, slide N — 1-based in the UI), `scripture_end` (channel)
- Existing: `take_row` / `take_row_at_cursor` on a scripture row → slide 1;
  `take_row_song_aware` with sub=intro → intro, sub=lyrics → slide 1 (outro → no-op);
  PVW→PGM variants on scripture rows → straight to the To channel.

Feedbacks: `scripture_queued` (channel), `scripture_slide_is` (channel, N),
`scripture_active` (channel); `row_is_active` / `row_at_index_is_active` light
for scripture rows via `scriptureSession.rowId` / `scriptureContext.rowId`.

Variables (per channel): `<c>_scripture_ref`, `<c>_scripture_slide` ("2/5"),
`<c>_scripture_text`, `<c>_scripture_queued_ref`. `rowDisplayLabel` shows the
reference for scripture rows.

Presets (category "Scripture"): Intro (cursor row), Previous, Next, End — with
queued/active feedback styling like the song presets.

## 6. Operator

- `ScriptureTakeStrip`: **Intro** segment (hidden when the row resolves no
  intro) sends `scripture_take_intro`; slide buttons send `scripture_take_slide`.
  Client-side usage reporting is removed (server reports).
- `SongTakeStrip`: Intro sends `take_song_sub {sub:"intro"}` instead of a plain take.
- `rowAirState` / `stageMode`: scripture rows show live/queued from channel state.
- Settings → Scripture: Default intro panel (section 1).

## 7. Testing

- core: `resolveScriptureIntro` (row vs default per piece, literals, skip, missing
  template), field descriptors/suggestions, schema additions.
- scripture: `scriptureSlideData` + moved `slideReference` tests.
- server: `scriptureSession.test.ts` mirroring the song queue tests (intro queues
  & intro stays; Next/goTo start queued without an extra take; Prev no-op;
  end/blank-equivalent cancel; external take / operator clear cancel; auto-out
  keeps queue; PVW→PGM carries queue; song ↔ scripture end each other; usage
  reported on slide takes); ws handler tests for the five messages
  (not_found / not_configured paths).
- ws-protocol: schema tests for the new messages and state fields.
- companion: actions, feedbacks, variables tests; replace the "scripture does
  nothing" expectations.
- operator: `rowAirState` / `stageMode` tests updated.
- Manual: operator Intro → Companion-style `scripture_goto 0` shows slide 1; song
  Intro from the app then a section button starts the song.

## Non-goals

- Scripture outro.
- Show-level scripture intro defaults.
- PCO scripture import (separate spec; will reuse the intro defaults).
