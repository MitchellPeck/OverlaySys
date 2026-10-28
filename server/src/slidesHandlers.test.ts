import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Deck } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";

const broadcasts: ServerMessage[] = [];
const scheduleSync = vi.fn();
vi.mock("./broadcast", () => ({
  broadcast: (m: ServerMessage) => broadcasts.push(m),
  registerSender: () => () => {},
}));
vi.mock("./cloudSync", () => ({ scheduleSync: () => scheduleSync() }));

import * as decks from "./decks";
import * as shows from "./shows";
import { handleSlidesMessage } from "./slidesHandlers";

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
});

afterEach(async () => {
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
    broadcasts.length = 0;
    await handleSlidesMessage({ type: "restore_deck", deckId: "d1" }, send);
    expect(broadcasts.map((m) => m.type)).toEqual(["deck", "deck_list"]);
    const list = broadcasts[1];
    expect(list?.type === "deck_list" && list.decks.map((d) => d.id)).toEqual(["d1"]);
  });

  it("duplicate_deck creates a copy and broadcasts", async () => {
    await handleSlidesMessage({ type: "save_deck", deck: deck() }, send);
    broadcasts.length = 0;
    await handleSlidesMessage({ type: "duplicate_deck", deckId: "d1" }, send);
    const list = broadcasts.find((m) => m.type === "deck_list");
    expect(list?.type === "deck_list" && list.decks).toHaveLength(2);
  });

  it("list_decks replies only to the sender", async () => {
    await handleSlidesMessage({ type: "list_decks" }, send);
    expect(sent.map((m) => m.type)).toEqual(["deck_list"]);
    expect(broadcasts).toEqual([]);
  });
});
