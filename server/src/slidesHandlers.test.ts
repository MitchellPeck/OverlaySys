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

  it("unimplemented convert messages reply not_implemented", async () => {
    await handleSlidesMessage({ type: "undo_convert_song", conversionId: "c1" }, send);
    expect(sent).toEqual([{ type: "error", code: "not_implemented", message: "undo_convert_song" }]);
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
});
// [/P3.9]
