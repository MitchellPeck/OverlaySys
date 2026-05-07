# Live Lyric Overlays — Design

**Date:** 2026-05-07
**Status:** Approved for planning
**Context:** Worship services. Repertoire of dozens-to-hundreds of songs, set list known ahead of service but the band routinely calls audibles (extra chorus, drop into a bridge, vamp on the last line). Volunteer operators. No click tracks, no fixed timing.

## Goals

- Add live lyric overlays to OverlaySys without forking it into a separate "lyric tool."
- Songs are first-class, reusable across services, and live alongside graphic rows in a Show.
- Sync to what the band is actually singing via speech-to-text on a vocal feed, with manual override always available and authoritative.
- Reuse the existing Template system unchanged for lyric look-and-feel.

## Non-goals (v1)

- CCLI SongSelect API integration
- ChordPro parsing
- Multi-language / per-slide translations
- Foot pedal / external controllers
- Cross-song STT recognition (the SongRow tells us which song; matcher is scoped to that song)
- Cloud STT (designed-for, not shipped)

## Use case shape (worship, fixed)

- Slide-based authoring (ProPresenter / EasyWorship style). Author pre-splits sections into slides of 1–2 lines.
- Section-level navigation (`Verse 1`, `Chorus`, `Bridge`, `Tag`).
- Spontaneous reordering: operator can jump sections live without re-editing the show.
- STT primary, manual override always available; per-song "trust mode" enables auto-take when STT is confident.

## Architecture

The system gains one new process — a **lyric-listener daemon** — and extends the existing server, operator, and core packages. The renderer is unchanged.

```
[Vocal audio source PC]                                [Operator PC]
  lyric-listener (whisper.cpp) ──── WS ─── server ─── operator UI
                                      │
                                      └── (existing) renderer / OBS
```

Why a sidecar daemon (not in-operator, not in-server):
- Whichever PC has clean access to vocal audio runs the listener; it does not have to be the operator PC or the server.
- Crash-isolated from the operator UI.
- Mirrors the existing operator/renderer/server split.
- The listener is a thin client of the server's WS protocol; same transport as everything else.

STT engine: `whisper.cpp` with `small.en` on CPU, 1.0–1.5s rolling windows, 0.3s overlap. Fully offline. Cloud STT (e.g. Deepgram) is a future plug-in option behind the same `stt_hypothesis` WS message — no protocol change required.

## Data model

Lives in `packages/core` alongside `Template`, `Show`, `Channel`.

### Song

```ts
type SectionKind =
  | "verse" | "chorus" | "bridge" | "tag" | "intro" | "outro" | "other";

interface Slide {
  id: string;
  lines: string[];          // 1–4 lines; rendered into the lyric template's `text` field
}

interface Section {
  id: string;               // stable, used by hotkeys: "v1", "c", "b", "t1"
  kind: SectionKind;
  label: string;            // display: "Verse 1", "Chorus"
  slides: Slide[];
}

interface Song {
  id: string;
  title: string;
  ccliNumber?: string;
  author?: string;
  copyright?: string;
  defaultLyricTemplateId?: string;
  sections: Section[];
  defaultArrangement: string[];   // section ids, e.g. ["v1","c","v2","c","b","c","c"]
}
```

Songs are stored as JSON in `data/songs/*.json` (mirrors `data/templates/`, `data/shows/`). The library is reused across services.

### Show row union

`RundownRow` becomes a discriminated union on `kind`:

```ts
type RundownRow = GraphicRow | SongRow;

interface GraphicRow {
  kind: "graphic";
  id: string;
  templateId: string;
  data: Record<string, string>;
  channelHint?: string;
  notes?: string;
}

interface SongRow {
  kind: "song";
  id: string;
  songId: string;
  lyricTemplateId: string;          // overrides Song.defaultLyricTemplateId
  arrangement?: string[];           // overrides Song.defaultArrangement
  trustMode?: boolean;              // initial trust-mode state for the session
  channelHint?: string;
  notes?: string;
}
```

Existing show JSON files have rows without a `kind` field. Storage layer treats missing `kind` as `"graphic"` on read; writes always include `kind`.

### Lyric templates

Reuse the existing `Template` system unchanged. A "lyric template" is just a regular template with one well-known field: `text` of type `text`. The template engine already supports multiline text content. Authoring (background, text style, position, in/out animations) uses the existing design tool. There is no separate "lyric template editor."

## Live state — SongSession

When a `SongRow` is taken on a channel, the server enters a **SongSession** for that channel. The session is the source of truth for what's on the channel while a song is live.

```ts
interface SongSession {
  channel: string;
  songId: string;
  lyricTemplateId: string;
  arrangement: string[];                       // working copy; mutable mid-song
  cursor: { sectionIdx: number; slideIdx: number };
  blanked: boolean;
  trustMode: boolean;
  startedAt: number;                           // epoch ms
}
```

The session ends when:
- Operator explicitly ends the song (`song_end`)
- The channel is cleared
- A non-song row is taken on the same channel

When a song is live, the channel's existing `ChannelState.active` is also populated as a regular `take` of the lyric template with `data.text` set from the current slide's lines (joined by `\n`). Renderers and OBS see no protocol surprise — they get a normal take/update stream. The new `songSession` summary is added to `state` messages so the operator UI can render song mode.

## WS protocol additions

All additive. Existing messages unchanged.

### Client → Server

- `song_take { channel, showId, songRowId }` — start a session for the song row in a show
- `song_advance { channel, delta: number }` — relative slide step (±1, ±N)
- `song_jump { channel, sectionId, slideIdx?: number }` — jump to a section (defaults to slide 0)
- `song_blank { channel }` — blank screen without ending the session
- `song_set_trust { channel, trustMode: boolean }` — toggle auto-take for the live session
- `song_end { channel }` — end the session and clear the channel
- `stt_listener_register { audioSourceId, label }` — listener daemon announces itself
- `stt_hypothesis { audioSourceId, text, t: number }` — listener streams recognized text
- CRUD on songs: `list_songs`, `get_song`, `save_song`, `delete_song` (mirroring existing template/show CRUD)

### Server → Client

- Existing `state { channel, state }` — `state.active` continues to carry the rendered take; an additional `state.songSession?: SongSessionSummary` is included when a session is live
- `stt_match { channel, suggestedSlide: { sectionIdx, slideIdx }, confidence }` — operator UI highlight
- `stt_listener_state { audioSourceId, status: "online" | "offline" }`
- Song CRUD responses: `song_list`, `song`

## Inference / matcher

### Listener daemon (new package)

Location: `apps/lyric-listener/` (Node + native whisper.cpp binding, or a small Rust/Go binary — implementation choice deferred to plan).

Behavior:
- Captures the configured audio device at 16kHz mono.
- Runs whisper.cpp in 1.0–1.5s rolling windows with 0.3s overlap.
- Normalizes output (lowercase, strip punctuation, collapse whitespace).
- Streams `stt_hypothesis` messages to the server with a stable `audioSourceId` and the recognized text + window timestamp.
- Sends `stt_listener_register` on connect, reconnects with backoff.

### Server-side matcher

Per active SongSession only. No cross-session or cross-song matching.

- On session start, build a token n-gram index for the current song's slides (1–3 grams over normalized lines).
- Search space for each incoming hypothesis: `[current-1, current, current+1, current+2]` plus the first slide of every section in the arrangement (so "drop to bridge" is a single-slide jump from the matcher's perspective).
- Score = normalized token overlap with a small **monotonic-progress prior** (cursor-forward candidates get a bonus over going backward) and a **section-start bonus** when the hypothesis matches a section opener.
- Emit `stt_match` with the top candidate + confidence on every hypothesis, debounced to ~150ms.
- If `trustMode === true` AND `confidence ≥ AUTO_TAKE_THRESHOLD` (initial value: 0.75 — tunable per session) AND candidate is at-or-ahead of the cursor → schedule auto-advance after a 300ms debounce (canceled if a subsequent hypothesis disagrees).
- Otherwise: suggestion only. Operator commits with `space`.

The matcher never auto-jumps backward and never auto-blanks. Backward navigation is operator-only.

## Operator UI

### Song library page (`/songs`)

CRUD interface. List view + edit view. Edit view supports:
- Metadata (title, CCLI, author, copyright)
- Default lyric template picker
- Section editor: add/remove/reorder sections, set kind + label
- Slide editor inside a section: add/remove/reorder slides; each slide is a textarea (1–4 lines)
- Default arrangement editor: drag section ids into order
- Import: paste plain text with `[Section]` markers; OpenLyrics XML upload

### Song mode panel

Opens automatically when a `SongRow` is the active item on a channel, replacing the take panel for that channel. Layout:

- **Left:** section list with hotkey labels (`C`, `B`, `V1`, `V2`, `V3`, `T`). Click jumps; current section highlighted.
- **Middle:** slides for the current section as cards. Current slide outlined boldly; STT-suggested slide outlined in a different accent. Click a card to jump to it.
- **Right:** "Up Next" preview (current slide + next 1–2 slides per arrangement).
- **Top bar:** song title, current section/slide indicator, **Trust Mode** toggle pill, STT confidence meter, listener online indicator, blank state indicator.

### Hotkeys (active when song mode panel is focused)

- `space` — advance: commits STT suggestion if one exists, else +1 slide along arrangement
- `shift+space` — back one slide
- `C` — jump to chorus (first section with `kind: "chorus"`)
- `B` — jump to bridge (first section with `kind: "bridge"`)
- `V1` / `V2` / `V3` — jump to verse N (Nth section with `kind: "verse"`)
- `T` — jump to first tag section
- `.` — blank/unblank screen
- `esc` — end song

Section ids `c`, `b`, `v1`, `v2`, `v3`, `t1` are conventional but not enforced — hotkeys resolve by section `kind` ordinal, not by id, so authors can name sections freely.

### Rundown page

`SongRow` items are visually distinct (book icon + song title) but cued/taken with the same affordances as graphic rows. Taking a song row enters song mode automatically.

## Song authoring & import

In priority order:

1. **Paste plain text with `[Section]` markers** — primary authoring path. Format:
   ```
   [Verse 1]
   First line of verse one
   Second line of verse one

   [Chorus]
   Chorus line one
   Chorus line two
   ```
   Blank line separates slides within a section. Section header sets both `kind` (parsed from header) and `label` (the raw header text). Section id auto-generated.

2. **OpenLyrics XML import** — the de facto interchange format; ProPresenter and others export it. Parse `<verse name="v1">…</verse>` sections.

3. **Manual editing** — slide editor in the song library page.

## Failure modes & recovery

- **Listener daemon offline / disconnects** — operator UI shows "STT offline" badge; manual hotkeys continue to work; matcher emits no `stt_match`.
- **STT mishears or hallucinates** — matcher operates only within the current SongSession, so the worst case is a wrong-slide suggestion, never a wrong song. Trust-mode auto-take is gated on a confidence threshold and a monotonic-progress prior.
- **Network blip operator ↔ server** — existing reconnect logic. SongSession is server-authoritative, so a reconnecting operator picks up the current cursor from the next `state` message.
- **Operator falls behind** — band is past the displayed slide. Operator hits `space` (possibly multiple times) to catch up; STT suggestion typically lands on the right slide and `space` commits it.
- **Audible mid-song (band drops to bridge unexpectedly)** — section openers are always in the matcher's search space, so STT suggests the bridge slide; one `space` (or `B` hotkey) handles it.
- **Show JSON predates the row union** — storage layer treats missing `kind` as `"graphic"` on read.

## Testing strategy

- **Unit (`packages/core`, server matcher):**
  - Token n-gram index build + lookup
  - Matcher scoring with monotonic-progress prior and section-start bonus
  - Arrangement traversal (advance, jump-to-section, end-of-song)
  - Hotkey resolver (`V2` → second verse section regardless of id)
  - OpenLyrics importer round-trip
  - Plain-text-with-markers parser
- **Integration (server):**
  - SongSession lifecycle: take → advance → jump → blank → end
  - Trust-mode auto-advance with synthetic `stt_hypothesis` stream
  - Reconnect mid-session preserves cursor
  - Taking a graphic row on the same channel ends the session
- **Smoke (extension to `server/scripts/smoke.mjs`):**
  - Scripted hypothesis stream against a fixture song verifies end-to-end matching → take → renderer state

The lyric-listener daemon is tested separately with recorded audio fixtures in its own package; the server-side matcher is tested with synthetic hypothesis streams (no audio dependency).

## Phasing

The implementation plan will refine these into ordered tasks; high level only here.

1. **Core data model + storage.** `Song` schema, `RundownRow` union, song CRUD on server, `data/songs/` directory, fixture songs.
2. **Server SongSession + WS protocol additions.** All song_* and stt_* messages, session state machine, smoke-tested with synthetic hypotheses (no UI yet, no listener yet).
3. **Operator song mode UI + hotkeys.** Manual-only (no STT integration yet). Advance, jump, blank, end. Take/clear interactions with rundown.
4. **Song library page.** CRUD UI + paste-with-markers import.
5. **Listener daemon + whisper.cpp + matcher.** Suggestion mode (no auto-take yet). Operator UI surfaces suggestions and confidence.
6. **Trust mode (auto-take).** Threshold tuning, debounce. OpenLyrics import polish.

## Open questions (deferred to plan)

- Listener daemon language/runtime (Node + native binding vs. small Rust/Go binary).
- Exact whisper.cpp model size — `tiny.en` may be enough for clean vocal feeds; `small.en` is the safe default. Benchmark before committing.
- Confidence threshold and debounce values are starting points; expect a tuning pass after first live use.
