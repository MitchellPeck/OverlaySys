# OverlaySys UI redesign, shared library, sections and Slides decks

Status: draft — pending owner approval
Date: 2026-10-28
Deadline: in use for the service on **Sunday 2026-11-01**

Inputs: the seven-area UI/UX review and its fix plan (session scratchpad
`uxreview/findings/*.md`, `uxreview/FIX-PLAN.md`), the enrichment catalogue
(`uxreview/ENRICHMENT-CATALOGUE.md`, especially §3 Slides and content.md §2),
and a brainstorm with the owner using mockups (`.superpowers/brainstorm/`).

Marking: **(owner)** = the owner decided it; **(call)** = author's default,
open to veto.

## Why

The owner's verdict on today's UI: "very unappealing", "all of it is
off/wrong". The review agrees: 227 findings, inconsistent controls (browser-
default buttons in the stage editor, five settings page widths, hover-only
row actions that shift layouts), rows that lead with template names
("Section Intro" ×5) instead of content, and cramped wrapping columns.

Separately, the owner fakes liturgy (anthem, Gloria Patri, responses,
Doxology) as Songs. That pollutes the song library and CCLI reporting and
can't map Planning Center items cleanly.

## Goals

1. One coherent look across the whole app, in the spirit of **ProPresenter**
   (owner) but built around overlays and graphics, not presentations
   (owner).
2. A **Live** screen with large PVW/PGM monitors on top, the sectioned
   rundown on the left, and the selected item's content as thumbnails below
   (owner: option B).
3. **Native rundown sections** — a first-class show feature, not dependent on
   Planning Center (owner).
4. **One shared library list component** for Shows, Songs, Designs (graphics
   templates and stage layouts), Hotcards, Slides decks: full width, search,
   sort, filter, context menu, no hover-only buttons (owner). Designs also get
   a thumbnail grid view (owner).
5. **Slides decks**: a library of reusable slide decks and a `slides` rundown
   item, with Planning Center "Import as Slides" (owner).
6. Ready and rehearsed for Sunday 2026-11-01 (owner) without risking the
   service (call: see Delivery).

## Non-goals

- The wider enrichment catalogue (layers per channel, brand kits, show log,
  readiness checks, roles, …) — later, separately prioritised.
- Changing the template engine's rendering model or output protocol beyond
  what Slides needs.
- Re-implementing defects one by one in the old look: visual-polish findings
  are absorbed by the rebuilt screens (see "Relation to the fix plan").
- Cloud-mode parity work beyond keeping the cloud build compiling and not
  showing desktop-only screens.

## Anti-goals (would be a failure even if it "works")

- Anything that can put the wrong thing on air, or make on-air state less
  obvious than today.
- A Sunday-morning build nobody has run end to end.
- Data loss: existing shows, songs, templates, hotcards, stage layouts and
  settings must open unchanged (schema changes are additive; migrations are
  idempotent and keep a backup).
- Liturgy decks still writing CCLI usage.

## Constraints

- Monorepo as today: Next.js operator (`apps/operator`), Vite renderer,
  Node server, `packages/ui` (UI kit), `packages/editor-kit`,
  `packages/stage-widgets`, `packages/core` (schemas), Companion module.
  Build on these; no new UI framework (call).
- Vitest is logic-only (no DOM); UI is verified by typecheck, build and
  screenshot checks against the running app (as done in the review).
- Desktop app loads the operator from the dev/packaged Next build; the server
  owns data under `dataRoot()`.

## Visual system (owner: ProPresenter-style; details are calls)

- **Palette**: neutral charcoal greys replace today's navy. Starting tokens
  (call, tune in implementation): background `#1b1b1d`, panel `#202022`,
  raised `#242426`, control `#3a3a3e`, border `#333336`, text `#e8e8ea`,
  muted `#a0a0a6` / `#8e8e94` (keep ≥4.5:1 on every surface — the existing
  contrast test in `apps/operator/src/app/shell/contrast.test.ts` must keep
  passing with the new values).
- **Colour carries meaning only**: red = on air / program, green = preview /
  next, blue (`#4f7cff`-ish) = selection and primary actions. One colour per
  item kind, used as the thin left bar in lists and as song-arrangement
  chips: graphic (blue), song (amber), slides deck (green-teal), scripture,
  video (violet) — exact hues a call, consistent everywhere.
- **Density**: compact, quiet controls; 11–13 px UI text; colour and weight
  for hierarchy rather than boxes.
- **One control set in `packages/ui`** used everywhere (call): Button
  (primary / secondary / ghost / danger / on-air), Input, NumberInput (commit
  on blur/Enter), Select, SegmentedControl, Checkbox/Switch, Menu (context
  menu), Dialog (replaces `window.confirm` everywhere), Toast, Tooltip,
  Thumbnail. No browser-default controls anywhere (the stage editor today).
- **Layout pattern**: list on the left, the selected thing in the middle,
  properties on the right. One page width model (full width with sensible
  max line lengths in forms) — the five different settings widths go.
- **Save model everywhere**: the same unsaved dot, Save (⌘S), Revert, and the
  existing `useUnsavedGuard` on every editor and settings page.

## Shell (call, following the above)

Top bar keeps Live · Library · Settings and the status indicators, restyled.
The Library and Settings sub-navigation keeps labels at all widths (today it
goes icon-only at 1280). Nav labels and page titles use one glossary
(FIX-PLAN D11). The disconnected state says the server is unreachable and
offers Retry instead of "No show loaded" / "No songs yet".

## Shared library list (owner)

A single component in `packages/ui` used by Shows, Songs, Designs (Graphics
and Stage layouts tabs), Hotcards, Slides decks (and later others).

- Full width; header row with **search**, **sort** menu, **filters**, and
  the page's primary action ("New show", …) in one consistent spot.
- Rows: same row style as the rest of the app — name first, then per-type
  columns. Calls for columns: Shows — date, items, length, edited; Songs —
  author, CCLI, added, last used; Designs — kind/role, used by, edited;
  Hotcards — F-key, output; Slides decks — slides, licensing, tags, edited.
- **Context menu** on right-click and on a visible "⋯" per row: Open,
  Duplicate, Rename, Export, Delete, plus per-type items (e.g. "Convert to
  slide deck" on songs). No hover-only buttons.
- Delete warns when the item is used (call; Designs lacks this today), with
  undo via Recently deleted where the type supports soft delete.
- Keyboard (call): arrows move, Enter opens, typing focuses search.
- **Default sorts (owner)**: Shows by date, newest first; Songs by date
  added, newest first. Others (call): name A–Z, except Designs by recently
  edited.
- **Designs grid view (owner)**: toggle list/thumbnail grid; thumbnails render
  the template with sample/default field data.
- Pages describe columns, filters and menu items; the component owns
  layout, search, sort, selection, keyboard and the menu.

## Live (owner: option B)

- **Top band**: PVW and PGM monitors side by side, large and in a fixed place
  for the whole service (fix-plan D1 "air zone"), PGM red outline, PVW green.
  Beside them a narrow air-controls strip: Take, Clear PVW, Clear PGM, Clear
  all (call: Fade to black is enrichment, not in scope).
- **Left**: the sectioned rundown (below).
- **Below the monitors**: the selected item's content as large thumbnails:
  songs and slides decks one per slide (with section/group colour labels),
  scripture one per passage slide, a graphic as one thumbnail of its filled
  template, video as its poster frame. Click a thumbnail to cue/take it;
  live = red border, next = green border.
- **Right**: timers, stage controls (notes, messages, PCO Live) and hotcards
  in a collapsible drawer (call).
- Existing live behaviour, shortcuts and server protocol stay; the defaults
  from the fix plan's decisions apply (see below).

## Rundown rows and sections (owner)

- Rows are two lines max: line one is what goes on screen (graphic's main
  field value, song or deck title, video name), line two one muted detail
  (subtitle; song sections as small chips "V1 V2 V3 +5"; video length). The
  template name is not the headline (owner, via option B / fix-plan D19).
- Thin left colour bar per kind. On-air row: red edge + "ON AIR"; next row:
  green edge and the only Take button in the list; other rows quiet until
  selected.
- **Sections are native (owner)**: a show has named sections the operator
  adds, renames, reorders, deletes and drags items between, in the show
  editor. On Live they are dividers with the name and (call) the section's
  total length when items have lengths. Planning Center "header" items are
  imported as sections (call). Existing shows with no sections show a flat
  list.
- Data (call): add an ordered section structure to `Show` that existing
  show JSON parses without (e.g. a `sectionId` on rows plus a `sections`
  list on the show) — the builder chooses the exact shape; it must keep row
  order authoritative and be additive.

## Editors (owner approved the mockups)

- **Show editor**: the same sectioned list on the left (drag grips, section
  lengths); the selected item's form on the right with a live thumbnail of
  how it will look on air.
- **Song editor**: arrangement as draggable coloured chips, sections list,
  slides as clickable thumbnails with the text editor below. The same screen
  edits Slides decks (deck mode: flat slide list instead of sections and
  arrangement).
- **Graphics designer**: layers / canvas / inspector / timeline in the new
  chrome; segmented controls; "Preview on PVW" to put the unsaved draft on a
  real output (call: preview channel only).
- **Stage layout designer, Settings, Hotcards, Planning Center, Data**:
  rebuilt with the same controls, page model and save model (call; not
  separately mocked).

## Slides decks (owner; Q1–Q9 accepted as recommended)

**What**: a library of reusable slide decks (anthem, Gloria Patri,
responsive readings, creeds, Doxology…) and a `slides` rundown item that
plays one.

- **Library**: decks are global, like songs, with tags (Q1). A "Slides" page
  in Library using the shared list; items are called "decks" (Q9).
- **Structure**: a deck is a flat ordered list of slides (Q4).
- **Templates (owner)**: the deck has a **default template**; any slide can
  **override** it (e.g. a title card); a slide's content is its template's
  fields (one text field → just text; a Leader/People template → both
  lines). The rundown row can override the deck's default template for that
  week. Precedence: slide override → row override → deck default.
- **Rows reference decks** (Q2): editing a deck updates every show that uses
  it; a row may pick a subset/order of the deck's slides (repeats allowed,
  covering "say the response three times") and override fields for the week;
  "Detach to this show" makes a one-off copy.
- **One-off slides on a row** with "Save to library" (Q3) — after the first
  version (call: not needed for Sunday).
- **Live**: plays like scripture/songs — click a thumbnail, Space advances,
  B blanks; on the last slide Space stops and shows "End of deck · Space
  again to clear" (Q7). Confidence monitor shows current/next slide;
  Companion gets the same next/prev controls as songs (call).
- **Licensing (Q8)**: creating a deck asks once whether it's covered by CCLI
  (with its number) or public domain / own; only CCLI decks write CCLI usage.
- **Planning Center "Import as Slides" (Q5)**: available for any plan item;
  the operator picks the library deck; the choice is remembered, keyed on the
  item's normalised title (case/punctuation-insensitive), with a linked PCO
  song id taking precedence; mappings stored locally on this machine.
- **Convert to slide deck (Q6)**: on a song, builds a deck from its play
  order, rewrites **upcoming** shows that use it to slides rows (keeping their
  PCO link so re-import updates them), records the PCO mapping, soft-deletes
  the song with a "converted to" pointer and Undo; optional title slide.

Grounding: the content enrichment report §2 (`uxreview/enrichment/content.md`)
has a fuller model sketch (deck schema, server engine modelled on scripture,
`data/pco/itemMappings.json`, migration steps); the builder should treat it
as a starting point, not a spec.

## Relation to the fix plan (call)

- **Behaviour defects** in `FIX-PLAN.md` still ship (they're independent of
  the look): the 7 Blockers (6 already on main, the last in progress) and the
  functional Majors/Minors (e.g. Esc/media, F-keys, unrounded numbers, song
  parser and paste issues, PCO arrangement order EXTRA-2, bezier easing
  EXTRA-1, hotcard scoping, settings data loss, Companion empty-row presets).
- **Visual / layout / consistency findings** are satisfied by the rebuilt
  screens; each rebuilt screen must be checked against its area's findings
  so nothing is lost.
- **Fix-plan owner decisions**: use the recommended defaults (D1–D21) unless
  the owner vetoes; D10 is superseded by the shared list's context menu; D15
  and D16 are superseded by the new editors; D22 stays deferred.

## Delivery (call)

- Before the redesign lands, tag the current `main` as a known-good fallback
  (`pre-redesign-2026-10-28`) the owner can run on Sunday morning.
- Land in stages, each green on test/typecheck/build and screenshot-checked:
  1. visual tokens + UI kit controls + shared library list + native sections;
  2. Live + show/song/graphics editors + the remaining pages;
  3. Slides decks (library, row, live, PCO import, convert).
- Saturday: a full run-through of the owner's real All Saints service in the
  new build (PVW/PGM outputs, stage monitor, hotcards, Slides decks).

## Left to the builder

Exact token values and type scale within the constraints above; component
APIs; the precise section and deck schemas (additive); how thumbnails are
rendered (reuse the template engine at small scale vs. cached images);
drawer behaviour; which fix-plan functional tasks fold into which rebuilt
screen.
