# Media library, media rows, live folders and looping slides

## Why

Every week the operator rebuilds the pre-service announcements loop by hand. The graphics change throughout the month, but the loop itself never does: the same graphics, shown full screen, one after another, starting over at the end.

OverlaySys can play a single video as a rundown row. It can't:
- play a photo,
- keep photos and videos anywhere reusable,
- put them in slides,
- advance or repeat slides on its own.

The goal is to build the announcements loop once, keep it in the library, and drop it into each week's show. The graphics then come from a folder on the show computer that the team keeps topping up through the month.

## Goals

1. **Media row.** The rundown's "Video" row becomes a **Media** row that holds either a photo or a video.
2. **Media library.** A Media area holds photos and videos, imported once and reused in any show, slide deck or design.
3. **Live folders.** A library entry points at a folder on the show computer. Its contents follow the folder: files added appear, files removed disappear.
4. **Media in slides.** A slide can be:
   - a **full-screen** photo or video on its own, or
   - a design (template) that has a photo or video as **one layer** among text and shapes.
5. **Timing and looping.**
   - Any slide can **auto-advance** after a hold time. A full-screen video can instead advance when it ends.
   - A deck can **loop**, going back to its first slide after the last one.
6. **Live-folder decks.** A deck can be linked to a live folder. Its slides are then the folder's graphics, in a saved, operator-chosen order. The announcements deck is reused from the library each week and always plays the current graphics.

## Non-goals

- Cloud or shared folders (Google Drive, Dropbox). The folder is a local path on the show computer only.
- Playing live-folder contents on any other machine. Other consoles see the deck, its order and its timing, but they don't receive the folder's files.
- Editing media (cropping, trimming photos, transcoding options) beyond what the existing upload pipeline already does.
- Scheduling: date ranges, "show this graphic until the 15th".
- Audio-only media.

## Anti-goals (it fails if…)

- The loop ever stalls, flashes black, or shows a half-copied file while someone is saving a new graphic into the folder during a service.
- A deleted or renamed file breaks the deck or the show. It must silently drop out of the loop instead.
- Existing Video rows stop working or need redoing after the upgrade.
- Taking something into the loop's own slot fails to stop it, or the loop advances something it shouldn't. (Graphics on top are meant to leave it running; see "Overlays on a running loop".)

## What exists today (build on it)

- **`VideoRow`** (`packages/core/src/show.ts`, `kind: "video"`). It has `assetUrl`, `volume` (0..1), `endAction` (`clear` | `hold`, in `channel.ts`), media transitions and `lengthSec`. It plays in the channel's media slot, beneath graphics.
- **Decks** (`packages/core/src/deck.ts`). A deck has `slides: { id, templateId?, data, label? }[]` and a `defaultTemplateId`. A Slides row references a `deckId`. Decks sync to the cloud. PCO import can map plan items onto decks.
- **Template layers** already include `image` and `video`. A `video` layer has `fit`, `loop` (default true), `muted` (default true) and `playbackRate`, and `src` can be a string or a field reference. The renderer already plays these.
- **Assets** are content-addressed files under `data/assets/<sha256>.<ext>`, served at `/assets/...`, uploaded through `server/src/assets.ts` (which already transcodes video), and synced to cloud storage on publish.

## Design

### 1. Media row

- **Kind and migration.** The row kind becomes `media`, with `mediaType: "image" | "video"`. Existing `kind: "video"` rows migrate on load to `media` with `mediaType: "video"`, keeping every field. Nothing is lost, and the operator redoes nothing. Readers keep accepting `video` until the migration has run everywhere, including cloud copies written by older clients.
- **Photos** cover the whole frame (`fit: cover`, configurable like the layer `fit`). A photo holds until the next take. It has no audio and no end action.
- **Videos** keep today's behaviour: volume, transitions, and end action `clear` | `hold`. The default for new rows becomes **hold last frame**. Videos also gain a **Loop** switch, which plays until the next take.
- **Sound.** A full-screen video plays its audio through the show computer. Each row has a **Mute** switch.
- **Source.** A Media row references either a library item or a direct upload, the way `assetUrl` works today. Picking from the library is the main path.

### 2. Media library

- **A new Media area** beside Songs and Slides in the operator. It shows a thumbnail grid with type badges and durations for video, search by name, operator-made folders, and drag files in to import.
- **Items are stored once.** Each library item is a small record (id, name, type, `assetUrl`, dimensions, duration, folder, createdAt/updatedAt/deletedAt) that points at the existing content-addressed asset. Importing the same file twice reuses the same asset.
- **Changes reach every use.** Shows, decks and template layers reference the library item. Renaming an item, or replacing its file, shows up everywhere it's used.
- **Sync.** Library records sync like decks, through the sync engine with the same soft-delete and last-writer-wins rules. Assets go to cloud storage through the existing publish and asset path.
- **Usage counts.** Every item shows "used by N", the same as decks. Deleting an item that's in use asks first.

### 3. Live folders

- **What it is.** A library entry of type **live folder** stores a name and a **local folder path** on the show computer. Its contents are the photos and videos directly in that folder, not in subfolders, filtered to the extensions the upload pipeline accepts.
- **Watching.** The server, which runs on the show computer, watches the folder.
  - A file counts as present only once it has stopped changing for a short settle time (a few seconds), so a half-copied graphic never plays.
  - Removed files drop out.
  - Files are served from the folder through the server. The renderer only sees server URLs, never local paths.
- **Order.**
  - The deck saves an explicit order of the folder's files, keyed by file name.
  - A **new file joins at the end** and starts at the next loop.
  - A **removed file leaves** without disturbing the others.
  - A file that returns under the same name goes back to its old position.
  - The operator can drag the order in the deck editor whenever they like.
- **Per-graphic hold time.** Each graphic can override the deck's shared hold time; otherwise it uses the default.
- **Other machines.**
  - The live folder's record, the deck's order and its timing all sync.
  - The folder's files don't sync. Another console shows the deck with an "on the show computer" placeholder instead of thumbnails, and may still edit order and timing by file name.
  - The folder path is per machine. It's stored with the show computer's local preferences, not in the synced record. A machine with no path set treats the folder as empty.

### 4. Media in slides

- **Full-screen media slide.** A deck slide may be a media slide, `{ id, media: <library item ref>, holdSec?, advanceOnEnd? }`, with no template. It renders full frame (`cover`) on the channel. A video plays its audio through the show computer unless muted.
- **Media as a layer.** In the slide and graphic designers, an `image` or `video` layer can take its source from the library, as well as by upload. A layer video keeps the existing defaults: loops, silent. It works as a background behind text.
- **A field in the slide.** A template may expose a media field, so each slide in a deck can supply its own photo while sharing one design. The existing field-reference `src` already supports this.

### 5. Timing and looping

- **Per-slide auto-advance.** `holdSec` is set per slide. The deck has a shared default hold time, used by any slide without its own. Full-screen video slides can be set to **advance when the video ends** instead.
- **Per-deck loop.** When a looping deck passes its last slide it goes back to the first one. In a live-folder deck, any files added since the last cycle join here.
- **Who runs the clock.** The server's playback runs the advance timer, not the operator UI, so closing or reloading a console never stops the loop. The timer is cancelled by:
  - any other take on that channel,
  - a clear,
  - the operator stepping manually.

  A manual step (next/previous, the Companion "go to slide N") restarts the hold timer from that slide.
- **Rundown.** A Slides row whose deck auto-advances behaves on Live the way it does today, plus a visible "auto · loops" indicator and a countdown to the next slide.

### 6. The announcements flow (end to end)

1. In Media, add a live folder named "Announcements" and choose the folder on the show computer.
2. In Slides, create the deck "Announcements loop", link it to that live folder, set an 8 s hold, turn on loop, and drag the graphics into order.
3. Each week, add a Slides row for "Announcements loop" to the show, or let PCO import map the plan item onto it, which already works for decks.
4. During the month, the team saves new graphics into the folder. They appear at the end of the loop on the next cycle, and the operator can reorder them in the deck.

## Constraints

- **Assets.** New code uses the server's existing asset path, with its atomic writes, hash naming and SVG CSP. Live-folder files are served read-only, from a resolved path that must stay inside the configured folder.
- **Ids.** New record ids (library items, live folders) match the server's id rule (`[A-Za-z0-9_-]`, at most 64 characters, `server/src/recordId.ts`).
- **Sync.** New synced tables are optional cloud tables, like decks. A migration is written for apps-portal, and the client syncs without them until it has been applied (`optionalColumns` pattern). Remember that apps-portal migrations are applied by hand.
- **Scope of change.** No change to what already-taken graphics do on air.

## Overlays on a running loop (user's decision)

Taking a lower third, scripture, hotcard or other graphic over a running loop **does not stop it**. The loop keeps cycling underneath, and it's still running when the overlay clears.

- **Media-only decks** (every slide is full-screen media, which includes every live-folder deck) play in the channel's **media slot**, beneath graphics, the same as Media rows. Graphics taken on top use the graphics slot and leave the loop alone.
  - Stops the loop: a clear of the media slot, another Media row, another media-only deck, or the operator stepping it manually. A manual step restarts the timer.
  - Doesn't stop the loop: graphics.
- **Decks with any template slide** behave as Slides rows do today, in the graphics slot. Taking another graphic replaces them, and their timer stops. *(Designer's call: mixing slots inside one deck would mean black frames as the deck crosses from one slot to the other.)*
- The anti-goal "anything else must stop it" is narrowed to: anything that takes the **same slot** stops it.

## Decisions made in review (designer's calls, not the user's)

- **Mixed versions.** Older consoles must keep loading shows and decks.
  - Video Media rows keep being written as `kind: "video"`. Only photo rows use the new kind, so an older client fails only on a show that actually contains a photo row. Readers accept both.
  - Media slides also carry `data: {}`, so older clients still parse the deck and just show an empty slide.
- **What a live-folder deck holds.** Only the folder's graphics, nothing else. Its slides are generated from the folder plus the saved order, not stored one by one. On a Slides row that uses it, `slideIds`, `fieldOverrides` and `localSlides` don't apply; the row just picks the deck. "Used by" and PCO deck mapping work the same as for any deck.
- **Auto-advance only on air.** The timer runs only while the deck is on a program channel. Cue or preview shows the current slide, static. Taking it to program starts the timer from that slide.
- **Library references.** Rows, slides and layers store the library item id **plus** the resolved `assetUrl` as a fallback. Bundles, publish, and machines that haven't synced the library yet keep working.
  - Replacing an item's file updates the stored `assetUrl` wherever the item is used, on the next save or sync.
  - Something already on air keeps playing what it started with until its next take. Nothing switches mid-play.
- **A deck that doesn't loop.** When it passes its last slide it holds the last slide and sets the existing at-end state, so item-end behaviour (auto-follow, stage countdown) works as it does for Slides rows today.

## Left to the builder

- The exact settle time for new files, and which file-watching mechanism to use. It must work on macOS.
- Schema field names and where the media-row migration runs (load path or sync).
- Thumbnail generation for live-folder images and videos, reusing the existing poster generation if possible.
- The Media area's layout details, following the existing Songs and Slides library screens.
- How the Companion module exposes auto-advance, for example pause/resume of the loop. Optional, not required for v1.
