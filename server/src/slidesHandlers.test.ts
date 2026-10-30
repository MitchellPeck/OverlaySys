import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Deck, ScriptureRow, Show, Template } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";

const broadcasts: ServerMessage[] = [];
const scheduleSync = vi.fn();
vi.mock("./broadcast", () => ({
  broadcast: (m: ServerMessage) => broadcasts.push(m),
  registerSender: () => () => {},
}));
vi.mock("./cloudSync", () => ({ scheduleSync: () => scheduleSync() }));
// [P3.9]
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));
// [/P3.9]

import * as decks from "./decks";
import * as shows from "./shows";
import * as stageFeedHub from "./stageFeedHub";
import { handleSlidesMessage } from "./slidesHandlers";
// [P3.9]
import * as templates from "./templates";
import * as channels from "./channels";
import * as slidesSession from "./slidesSession";
import * as mediaDeckSession from "./mediaDeckSession";
import * as scriptureSession from "./scriptureSession";
// [/P3.9]

let tmpDir: string;
let prevData: string | undefined;
let prevFix: string | undefined;
let sent: ServerMessage[];
const send = (m: ServerMessage) => void sent.push(m);

const deck = (over: Partial<Deck> = {}): Deck => ({
  id: "d1",
  name: "Deck",
  tags: [],
  defaultTemplateId: "t",
  licensing: { kind: "own" },
  slides: [{ id: "s1", data: { text: "Line A" } }],
  createdAt: "2026-10-28T00:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-slh-"));
  prevData = process.env["OVERLAYSYS_DATA_DIR"];
  prevFix = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await decks.reloadDecks();
  await shows.reloadShows();
  sent = [];
  broadcasts.length = 0;
  scheduleSync.mockClear();
  vi.spyOn(stageFeedHub, "invalidateAll").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (prevData === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevData;
  if (prevFix === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFix;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("slides handlers", () => {
  it("save_deck acks, broadcasts deck + deck_list and schedules sync", async () => {
    await handleSlidesMessage({ type: "save_deck", deck: deck() }, send);
    expect(sent).toContainEqual({ type: "ack", op: "save_deck", id: "d1" });
    expect(broadcasts.map((m) => m.type)).toEqual(["deck", "deck_list"]);
    expect(scheduleSync).toHaveBeenCalled();
  });

  it("save_deck rejects duplicate slide ids", async () => {
    const d = deck({
      slides: [
        { id: "a", data: {} },
        { id: "a", data: {} },
      ],
    });
    await handleSlidesMessage({ type: "save_deck", deck: d }, send);
    expect(sent).toEqual([{ type: "error", code: "invalid", message: "Duplicate slide id" }]);
    expect(broadcasts).toEqual([]);
    expect(await decks.getDeck("d1")).toBeNull();
  });

  it("get_deck on a missing id sends not_found", async () => {
    await handleSlidesMessage({ type: "get_deck", deckId: "nope" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "nope" }]);
  });

  it("get_deck on a tombstoned deck sends not_found", async () => {
    await handleSlidesMessage({ type: "save_deck", deck: deck() }, send);
    await handleSlidesMessage({ type: "delete_deck", deckId: "d1" }, send);
    sent = [];
    await handleSlidesMessage({ type: "get_deck", deckId: "d1" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "d1" }]);
  });

  it("delete_deck then restore_deck round-trips and re-broadcasts deck_list", async () => {
    await handleSlidesMessage({ type: "save_deck", deck: deck() }, send);
    broadcasts.length = 0;
    await handleSlidesMessage({ type: "delete_deck", deckId: "d1" }, send);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "deck_list", decks: [] });
    expect(stageFeedHub.invalidateAll).toHaveBeenCalled();
    expect(scheduleSync).toHaveBeenCalled();
    vi.mocked(stageFeedHub.invalidateAll).mockClear();
    scheduleSync.mockClear();
    broadcasts.length = 0;
    await handleSlidesMessage({ type: "restore_deck", deckId: "d1" }, send);
    expect(broadcasts.map((m) => m.type)).toEqual(["deck", "deck_list"]);
    const list = broadcasts[1];
    expect(list?.type === "deck_list" && list.decks.map((d) => d.id)).toEqual(["d1"]);
    expect(stageFeedHub.invalidateAll).toHaveBeenCalled();
    expect(scheduleSync).toHaveBeenCalled();
  });

  it("duplicate_deck creates a copy and broadcasts", async () => {
    await handleSlidesMessage({ type: "save_deck", deck: deck() }, send);
    broadcasts.length = 0;
    await handleSlidesMessage({ type: "duplicate_deck", deckId: "d1" }, send);
    const list = broadcasts.find((m) => m.type === "deck_list");
    expect(list?.type === "deck_list" && list.decks).toHaveLength(2);
    expect(stageFeedHub.invalidateAll).toHaveBeenCalled();
    expect(scheduleSync).toHaveBeenCalled();
  });

  it("delete_deck on a missing id sends not_found, not ack", async () => {
    await handleSlidesMessage({ type: "delete_deck", deckId: "nope" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "nope" }]);
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it("list_decks replies only to the sender", async () => {
    await handleSlidesMessage({ type: "list_decks" }, send);
    expect(sent.map((m) => m.type)).toEqual(["deck_list"]);
    expect(broadcasts).toEqual([]);
  });
});

// [P3.9] slides take/advance/goto/blank/end
describe("slides live handlers", () => {
  const tpl = (id: string): Template =>
    ({ id, name: id, fields: [{ key: "text", label: "Text", type: "text" }] }) as unknown as Template;
  const knownTemplates = new Map<string, Template>([
    ["t", tpl("t")],
    ["t2", tpl("t2")],
  ]);
  const rows = [
    { kind: "slides", id: "row1", deckId: "d1" },
    { kind: "slides", id: "rowLower", deckId: "d1", channelHint: "lower" },
    { kind: "slides", id: "rowMissingDeck", deckId: "gone" },
    { kind: "slides", id: "rowBadTpl", deckId: "d1", templateId: "nope", slideIds: ["s1", "s2"] },
    { kind: "slides", id: "rowNoTpl", deckId: "dNoTpl" },
    { kind: "slides", id: "rowAllMissing", deckId: "d1", slideIds: ["x", "y"] },
    { kind: "graphic", id: "rowGraphic", templateId: "t", fieldValues: {} },
    { kind: "slides", id: "rowMedia", deckId: "dMedia" },
    { kind: "slides", id: "rowFolder", deckId: "dFolder" },
    { kind: "slides", id: "rowMediaPick", deckId: "dMedia", slideIds: ["m3", "m1"] },
    { kind: "slides", id: "rowFolderPick", deckId: "dFolder", slideIds: ["m1"] },
    { kind: "slides", id: "rowMixed", deckId: "dMixed" },
    {
      kind: "slides",
      id: "rowLocalMedia",
      localSlides: [{ id: "l1", data: {}, media: { assetUrl: "/assets/l1.png", mediaType: "image" } }],
    },
  ];
  const show = { id: "s", name: "Show", projectId: "p", rows, songs: [] } as unknown as Show;
  const threeSlides = deck({
    slides: [
      { id: "s1", data: { text: "Line A" } },
      { id: "s2", data: { text: "Line B" } },
      { id: "s3", data: { text: "Line C" }, templateId: "t2" },
    ],
  });

  beforeEach(async () => {
    vi.spyOn(shows, "getShow").mockImplementation(async (id) => (id === "s" ? show : null));
    vi.spyOn(templates, "getTemplate").mockImplementation(async (id) => knownTemplates.get(id) ?? null);
    await decks.saveDeck(threeSlides);
    await decks.saveDeck(deck({ id: "dNoTpl", defaultTemplateId: "" }));
    const media = (id: string) => ({ id, data: {}, media: { assetUrl: `/assets/${id}.png`, mediaType: "image" as const } });
    await decks.saveDeck(deck({ id: "dMedia", name: "Announcements", slides: [media("m1"), media("m2"), media("m3")] }));
    await decks.saveDeck(deck({ id: "dFolder", slides: [], liveFolderId: "lf-empty", loop: true, defaultHoldSec: 5 }));
    // No default design: its template slide names its own, its photo needs none.
    await decks.saveDeck(
      deck({
        id: "dMixed",
        defaultTemplateId: "",
        mediaFit: "contain",
        mediaPosition: "bottom-right",
        slides: [{ id: "x1", data: { text: "Welcome" }, templateId: "t" }, media("m1")],
      }),
    );
    // A media clear drops the previous test's media deck and its summary.
    for (const ch of ["program", "preview", "lower"]) channels.mediaClear(ch);
    mediaDeckSession.resetAll();
    // External take first: it drops the previous test's sessions from channel state.
    for (const ch of ["program", "preview", "lower"]) channels.take(ch, "before", {});
    slidesSession.resetAll();
    scriptureSession.resetAll();
    sent = [];
    broadcasts.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("slides_take starts the session at slideIdx (default 0) on the row channel", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "row1" }, send);
    expect(sent).toEqual([]);
    const pgm = channels.getState("program");
    expect(pgm.active).toMatchObject({ templateId: "t", data: { text: "Line A" } });
    expect(pgm.slidesSession).toMatchObject({ rowId: "row1", deckId: "d1", title: "Deck", slideIdx: 0, slideCount: 3 });
    expect(pgm.liveRow).toEqual({ showId: "s", rowId: "row1" });

    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowLower", slideIdx: 2 }, send);
    expect(channels.getState("lower").active).toMatchObject({ templateId: "t2", data: { text: "Line C" } });
    expect(channels.getState("lower").slidesSession?.slideIdx).toBe(2);

    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowLower", channel: "preview" }, send);
    expect(channels.getState("preview").slidesSession?.rowId).toBe("rowLower");
    expect(sent).toEqual([]);
  });

  it("slides_take refuses a missing deck", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMissingDeck" }, send);
    expect(sent).toContainEqual({
      type: "error",
      code: "not_found",
      message: "This slides row's deck was deleted or hasn't synced",
    });
    expect(channels.getState("program").active?.templateId).toBe("before");
  });

  it("slides_take refuses a row whose slides were all removed from the deck", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowAllMissing" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "This slides row has no slides" }]);
    expect(channels.getState("program").active?.templateId).toBe("before");
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });

  it("slides_take with an out-of-range slideIdx sends not_found 'slide 9' and changes nothing", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "row1", slideIdx: 9 }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "slide 9" }]);
    expect(channels.getState("program").active?.templateId).toBe("before");
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });

  it("slides_take on a row whose template doesn't resolve sends not_configured 'Pick a design for this deck'", async () => {
    // rowBadTpl: row template "nope" doesn't exist. rowNoTpl: nothing resolves ("").
    for (const rowId of ["rowBadTpl", "rowNoTpl"]) {
      await handleSlidesMessage({ type: "slides_take", showId: "s", rowId }, send);
    }
    expect(sent).toEqual([
      { type: "error", code: "not_configured", message: "Pick a design for this deck" },
      { type: "error", code: "not_configured", message: "Pick a design for this deck" },
    ]);
    expect(channels.getState("program").active?.templateId).toBe("before");
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });

  it("slides_take on a non-slides row sends not_found", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowGraphic" }, send);
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "nope" }, send);
    await handleSlidesMessage({ type: "slides_take", showId: "missing", rowId: "row1" }, send);
    expect(sent).toEqual([
      { type: "error", code: "not_found", message: "rowGraphic" },
      { type: "error", code: "not_found", message: "nope" },
      { type: "error", code: "not_found", message: "missing" },
    ]);
    expect(channels.getState("program").active?.templateId).toBe("before");
  });

  it("slides_take ends a live scripture session on that channel", async () => {
    const scr = {
      kind: "scripture",
      id: "scr",
      reference: "Ref 1:1",
      translation: "KJV",
      templateId: "t",
      slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 1, verse: 1, text: "Line A" }] }],
    } as ScriptureRow;
    scriptureSession.takeSlide("program", "s", scr, 0);
    expect(channels.getState("program").scriptureSession?.rowId).toBe("scr");
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "row1" }, send);
    expect(channels.getState("program").scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive("program")).toBeUndefined();
    expect(channels.getState("program").slidesSession?.rowId).toBe("row1");
  });

  it("slides_advance / goto / blank / end forward to the engine", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "row1" }, send);
    await handleSlidesMessage({ type: "slides_advance", channel: "program", delta: 1 }, send);
    expect(channels.getState("program").slidesSession?.slideIdx).toBe(1);
    await handleSlidesMessage({ type: "slides_advance", channel: "program", delta: -1 }, send);
    expect(channels.getState("program").slidesSession?.slideIdx).toBe(0);
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 2 }, send);
    expect(channels.getState("program").active?.data).toEqual({ text: "Line C" });
    await handleSlidesMessage({ type: "slides_blank", channel: "program" }, send);
    expect(channels.getState("program").slidesSession?.blanked).toBe(true);
    await handleSlidesMessage({ type: "slides_blank", channel: "program" }, send);
    expect(channels.getState("program").slidesSession?.blanked).toBe(false);
    expect(sent).toEqual([]);
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 7 }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "slide 7" }]);
    await handleSlidesMessage({ type: "slides_end", channel: "program" }, send);
    expect(channels.getState("program").slidesSession).toBeUndefined();
    expect(channels.getState("program").active?.phase).toBe("out");
  });

  it("slides_take passes each slide's hold (slide holdSec, else the deck's) and the deck's loop", async () => {
    await decks.saveDeck(
      deck({
        id: "dTimed",
        defaultHoldSec: 4,
        loop: true,
        slides: [
          { id: "s1", data: { text: "Line A" } },
          { id: "s2", data: { text: "Line B" }, holdSec: 9 },
        ],
      }),
    );
    const timedShow = {
      ...show,
      rows: [
        { kind: "slides", id: "rowTimed", deckId: "dTimed", slideIds: ["s2", "s1"] },
        { kind: "slides", id: "rowLocal", localSlides: [{ id: "a", templateId: "t", data: {} }, { id: "b", templateId: "t", data: {}, holdSec: 3 }] },
      ],
    } as unknown as Show;
    vi.mocked(shows.getShow).mockImplementation(async () => timedShow);
    const spy = vi.spyOn(slidesSession, "start");
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowTimed" }, send);
    expect(spy.mock.calls[0]![1].timing).toEqual({ holdSecs: [9, 4], loop: true });
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowLocal" }, send);
    expect(spy.mock.calls[1]![1].timing).toEqual({ holdSecs: [undefined, 3], loop: false });
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowTimed", channel: "preview" }, send);
    expect(sent).toEqual([]);
  });

  it("a mixed deck with no default design takes; its photo airs in the media slot with the deck's placement", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMixed" }, send);
    expect(sent).toEqual([]);
    expect(channels.getState("program").active).toMatchObject({ templateId: "t", phase: "in", data: { text: "Welcome" } });
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "rowMixed", slot: "graphics" });
    await handleSlidesMessage({ type: "slides_advance", channel: "program", delta: 1 }, send);
    expect(channels.getState("program").media).toMatchObject({
      rowId: "rowMixed", assetUrl: "/assets/m1.png", mediaType: "image", fit: "contain", position: "bottom-right", owner: "slidesDeck:rowMixed",
    });
    expect(channels.getState("program").active?.phase).toBe("out");
    await handleSlidesMessage({ type: "slides_end", channel: "program" }, send);
    expect(channels.getState("program").media).toBeNull();
    expect(sent).toEqual([]);
  });

  it("a refused media-deck take says so in plain words", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMedia", slideIdx: 9 }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "That slide is no longer in this deck." }]);
  });

  it("slides_take of a media-only deck plays it in the media slot and leaves graphics alone", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMedia", slideIdx: 1 }, send);
    expect(sent).toEqual([]);
    const pgm = channels.getState("program");
    expect(pgm.active?.templateId).toBe("before");
    expect(pgm.media).toMatchObject({ rowId: "rowMedia", assetUrl: "/assets/m2.png", mediaType: "image", owner: "mediaDeck:rowMedia" });
    expect(pgm.slidesSession).toMatchObject({ rowId: "rowMedia", deckId: "dMedia", title: "Announcements", slideIdx: 1, slideCount: 3, slot: "media" });
    expect(pgm.liveRow).toEqual({ showId: "s", rowId: "rowMedia" });
    expect(slidesSession.getSession("program")).toBeNull();
  });

  it("slides_advance / goto / end drive a media deck (Companion's go to slide N)", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMedia" }, send);
    await handleSlidesMessage({ type: "slides_advance", channel: "program", delta: 1 }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m2.png");
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 2 }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m3.png");
    // A media session goes by key when one is sent (the index may be stale); an unknown key is ignored.
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 2, key: "m1" }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m1.png");
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 2, key: "gone" }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m1.png");
    expect(sent).toEqual([]);
    await handleSlidesMessage({ type: "slides_goto", channel: "program", slideIdx: 7 }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "slide 7" }]);
    await handleSlidesMessage({ type: "slides_end", channel: "program" }, send);
    expect(channels.getState("program").media).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
    expect(channels.getState("program").active?.templateId).toBe("before");
  });

  it("a media-only deck honours the row's slide selection; one-off media slides play too", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowMediaPick" }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m3.png");
    expect(channels.getState("program").slidesSession).toMatchObject({ slideCount: 2, slot: "media" });
    await handleSlidesMessage({ type: "slides_advance", channel: "program", delta: 1 }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/m1.png");
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowLocalMedia" }, send);
    expect(channels.getState("program").media?.assetUrl).toBe("/assets/l1.png");
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "rowLocalMedia", slideCount: 1, slot: "media" });
    expect(sent).toEqual([]);
  });

  it("a live-folder deck ignores the row's slide selection", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowFolderPick" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "This folder has no photos or videos yet." }]);
  });

  it("slides_take of an empty live-folder deck fails with a plain message", async () => {
    await handleSlidesMessage({ type: "slides_take", showId: "s", rowId: "rowFolder" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_found", message: "This folder has no photos or videos yet." }]);
    expect(channels.getState("program").media ?? null).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });
});
// [/P3.9]

// [P3.12] convert handlers
describe("convert handlers", () => {
  it("convert replies song_converted, broadcasts the changes, and undo puts them back", async () => {
    const songs = await import("./songs");
    const itemMappings = await import("./pco/itemMappings");
    await songs.reloadSongs();
    await itemMappings.reloadItemMappings();
    // Placeholder lyrics only.
    await songs.saveSong({
      id: "song-x",
      title: "Placeholder",
      sections: [{ id: "v", kind: "verse", label: "Verse", slides: [{ id: "a", lines: ["Line A"] }] }],
      defaultArrangement: ["v"],
      customFields: {},
    });
    await shows.saveShow({
      id: "sh1",
      name: "Undated show",
      projectId: "default",
      rows: [{ kind: "song", id: "r1", songId: "song-x", lyricTemplateId: "t" }],
      songs: [{ songId: "song-x" }],
    });

    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "song-x", titleSlide: false }, send);
    const reply = sent[0];
    expect(reply).toMatchObject({ type: "song_converted", deckName: "Placeholder", rows: 1, shows: 1, warnings: [] });
    expect(broadcasts.map((m) => m.type)).toEqual(["deck", "deck_list", "song_list", "show_list", "show"]);
    expect(scheduleSync).toHaveBeenCalled();

    sent = [];
    broadcasts.length = 0;
    const conversionId = reply?.type === "song_converted" ? reply.conversionId : "";
    await handleSlidesMessage({ type: "undo_convert_song", conversionId }, send);
    expect(sent).toEqual([
      { type: "song_convert_undone", conversionId, songId: "song-x", restoredShows: 1, skippedShows: 0 },
    ]);
    expect(broadcasts.map((m) => m.type)).toEqual(["deck_list", "song_list", "show_list", "show"]);
    expect((await shows.getShow("sh1"))!.rows[0]).toMatchObject({ kind: "song" });
  });

  it("convert of an unknown song and undo of an unknown id send not_found", async () => {
    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "nope", titleSlide: false }, send);
    await handleSlidesMessage({ type: "undo_convert_song", conversionId: "nope" }, send);
    expect(sent).toEqual([
      { type: "error", code: "not_found", message: "nope" },
      { type: "error", code: "not_found", message: "nope" },
    ]);
  });

  it("a write failure replies handler_error (not not_found); a failed undo can be retried", async () => {
    const songs = await import("./songs");
    const itemMappings = await import("./pco/itemMappings");
    await songs.reloadSongs();
    await itemMappings.reloadItemMappings();
    // Placeholder lyrics only.
    await songs.saveSong({
      id: "song-y",
      title: "Placeholder Y",
      sections: [{ id: "v", kind: "verse", label: "Verse", slides: [{ id: "a", lines: ["Line A"] }] }],
      defaultArrangement: ["v"],
      customFields: {},
    });
    await shows.saveShow({
      id: "sh2",
      name: "Undated show",
      projectId: "default",
      rows: [{ kind: "song", id: "r1", songId: "song-y", lyricTemplateId: "t" }],
      songs: [{ songId: "song-y" }],
    });

    const spy = vi.spyOn(decks, "saveDeck").mockRejectedValueOnce(new Error("disk full"));
    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "song-y", titleSlide: false }, send);
    spy.mockRestore();
    expect(sent).toEqual([{ type: "error", code: "handler_error", message: "disk full [song:song-y]" }]);
    expect(await songs.getSong("song-y")).not.toBeNull();
    expect((await shows.getShow("sh2"))!.rows[0]).toMatchObject({ kind: "song" });

    sent = [];
    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "song-y", titleSlide: false }, send);
    const reply = sent[0];
    const conversionId = reply?.type === "song_converted" ? reply.conversionId : "";
    expect(conversionId).not.toBe("");

    sent = [];
    const undoSpy = vi.spyOn(songs, "saveSong").mockRejectedValueOnce(new Error("disk full"));
    await handleSlidesMessage({ type: "undo_convert_song", conversionId }, send);
    undoSpy.mockRestore();
    expect(sent).toEqual([
      { type: "error", code: "handler_error", message: `disk full [conversion:${conversionId}]` },
    ]);

    sent = [];
    await handleSlidesMessage({ type: "undo_convert_song", conversionId }, send);
    expect(sent).toEqual([
      { type: "song_convert_undone", conversionId, songId: "song-y", restoredShows: 1, skippedShows: 0 },
    ]);
  });

  it("a failed rollback sends song_convert_failed with the id, re-sends the show, and undo by id finishes", async () => {
    const songs = await import("./songs");
    const itemMappings = await import("./pco/itemMappings");
    await songs.reloadSongs();
    await itemMappings.reloadItemMappings();
    // Placeholder lyrics only.
    await songs.saveSong({
      id: "song-z",
      title: "Placeholder Z",
      sections: [{ id: "v", kind: "verse", label: "Verse", slides: [{ id: "a", lines: ["Line A"] }] }],
      defaultArrangement: ["v"],
      customFields: {},
    });
    await shows.saveShow({
      id: "sh3",
      name: "Undated show",
      projectId: "default",
      rows: [{ kind: "song", id: "r1", songId: "song-z", lyricTemplateId: "t" }],
      songs: [{ songId: "song-z" }],
    });

    // Convert fails at the show write; the rollback then fails deleting the deck.
    const s1 = vi.spyOn(shows, "saveShow").mockRejectedValueOnce(new Error("disk full"));
    const s2 = vi.spyOn(decks, "deleteDeck").mockRejectedValueOnce(new Error("disk full again"));
    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "song-z", titleSlide: false }, send);
    s1.mockRestore();
    s2.mockRestore();
    expect(sent[0]).toMatchObject({ type: "error", code: "handler_error" });
    const failed = sent[1];
    expect(failed).toMatchObject({ type: "song_convert_failed", songId: "song-z" });
    expect(broadcasts.some((m) => m.type === "show" && m.show.id === "sh3")).toBe(true);

    sent = [];
    const conversionId = failed?.type === "song_convert_failed" ? failed.conversionId : "";
    await handleSlidesMessage({ type: "undo_convert_song", conversionId }, send);
    expect(sent).toEqual([
      { type: "song_convert_undone", conversionId, songId: "song-z", restoredShows: 0, skippedShows: 0 },
    ]);
    expect(await decks.listDecks()).toEqual([]);
    expect(await songs.getSong("song-z")).not.toBeNull();
  });

  it("a second undo while one is running replies busy", async () => {
    const songs = await import("./songs");
    const itemMappings = await import("./pco/itemMappings");
    await songs.reloadSongs();
    await itemMappings.reloadItemMappings();
    // Placeholder lyrics only.
    await songs.saveSong({
      id: "song-w",
      title: "Placeholder W",
      sections: [{ id: "v", kind: "verse", label: "Verse", slides: [{ id: "a", lines: ["Line A"] }] }],
      defaultArrangement: ["v"],
      customFields: {},
    });
    await handleSlidesMessage({ type: "convert_song_to_deck", songId: "song-w", titleSlide: false }, send);
    const reply = sent[0];
    const conversionId = reply?.type === "song_converted" ? reply.conversionId : "";
    sent = [];
    await Promise.all([
      handleSlidesMessage({ type: "undo_convert_song", conversionId }, send),
      handleSlidesMessage({ type: "undo_convert_song", conversionId }, send),
    ]);
    expect(sent.map((m) => (m.type === "error" ? m.code : m.type)).sort()).toEqual(["busy", "song_convert_undone"]);
    // The busy reply names the conversion, so the requesting client can tell it is its own.
    expect(sent.find((m) => m.type === "error" && m.code === "busy")).toMatchObject({ message: expect.stringContaining(conversionId) });
  });
});
// [/P3.12]
